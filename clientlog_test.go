package main

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"sync"
	"testing"

	"github.com/pocketbase/pocketbase/tests"
)

// POST /api/client-log: browsers batch their trace events here (see
// web/src/services/log.js), and the server logs them, to land in the
// dashboard's Logs view next to its own. Unauthenticated, so it's capped, and a client must not
// be able to pass an entry off as a server one.

// appWithLogger is the app with its Logger swapped, so the API it serves
// logs where a test can read it. (PocketBase's own log store is off in tests,
// and turning it on races its background writer.)
type appWithLogger struct {
	*tests.TestApp
	log *slog.Logger
}

func (a appWithLogger) Logger() *slog.Logger { return a.log }

type loggedEntry struct {
	Message string
	Level   int
	Data    map[string]any
}

// capture is an slog handler that keeps every record, with the attrs added
// by Logger.With merged in.
type capture struct {
	mu      *sync.Mutex
	entries *[]loggedEntry
	attrs   []slog.Attr
}

func (c capture) Enabled(context.Context, slog.Level) bool { return true }
func (c capture) WithGroup(string) slog.Handler            { return c }
func (c capture) WithAttrs(attrs []slog.Attr) slog.Handler {
	c.attrs = append(slices.Clone(c.attrs), attrs...)
	return c
}
func (c capture) Handle(_ context.Context, r slog.Record) error {
	data := map[string]any{}
	for _, a := range c.attrs {
		data[a.Key] = a.Value.Any()
	}
	r.Attrs(func(a slog.Attr) bool {
		data[a.Key] = a.Value.Any()
		return true
	})
	c.mu.Lock()
	defer c.mu.Unlock()
	*c.entries = append(*c.entries, loggedEntry{Message: r.Message, Level: int(r.Level), Data: data})
	return nil
}

// serveLogged serves app's API logging into memory, and returns a function
// that reads back the client entries logged so far, oldest first.
func serveLogged(t *testing.T) (http.Handler, func() []loggedEntry) {
	t.Helper()
	var mu sync.Mutex
	var entries []loggedEntry
	app := appWithLogger{newTestApp(t), slog.New(capture{mu: &mu, entries: &entries})}
	read := func() []loggedEntry {
		mu.Lock()
		defer mu.Unlock()
		var out []loggedEntry
		for _, e := range entries {
			if strings.HasPrefix(e.Message, "client: ") {
				out = append(out, e)
			}
		}
		return out
	}
	return serveAPI(t, app), read
}

func postLog(api http.Handler, contentType string, body []byte) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, "/api/client-log", bytes.NewReader(body))
	req.Header.Set("Content-Type", contentType)
	rec := httptest.NewRecorder()
	api.ServeHTTP(rec, req)
	return rec
}

func logBatch(entries ...map[string]any) []byte {
	body, _ := json.Marshal(map[string]any{
		"session": "s1", "browser": "firefox", "ua": "test", "game": "abcde", "gameId": "g1",
		"username": "ann", "userId": "u1", "entries": entries,
	})
	return body
}

func TestClientLogRecordsABatch(t *testing.T) {
	api, read := serveLogged(t)

	rec := postLog(api, "application/json", logBatch(
		map[string]any{"seq": 1, "t": "2026-10-01T12:00:00Z", "level": "info", "event": "turn.show",
			"attrs": map[string]any{"story": "st1"}},
		map[string]any{"seq": 2, "level": "warn", "event": "snack"},
		map[string]any{"seq": 3, "level": "error", "event": "window.error"},
		map[string]any{"seq": 4, "level": "debug", "event": "unknown level"},
	))
	if rec.Code != http.StatusNoContent {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
	got := read()
	if len(got) != 4 {
		t.Fatalf("logged %d entries, want 4", len(got))
	}
	for i, want := range []struct {
		message string
		level   int
	}{{"client: turn.show", 0}, {"client: snack", 4}, {"client: window.error", 8}, {"client: unknown level", 0}} {
		if got[i].Message != want.message || got[i].Level != want.level {
			t.Errorf("entry %d: %q at level %d, want %q at %d", i, got[i].Message, got[i].Level, want.message, want.level)
		}
	}
	first := got[0].Data
	for key, want := range map[string]any{
		"source": "client", "game": "abcde", "game_id": "g1", "user": "ann", "user_id": "u1",
		"browser": "firefox", "session": "s1", "client_time": "2026-10-01T12:00:00Z",
	} {
		if first[key] != want {
			t.Errorf("data.%s = %v, want %v", key, first[key], want)
		}
	}
	if attrs, _ := first["attrs"].(map[string]any); attrs["story"] != "st1" {
		t.Errorf("data.attrs = %v, want the entry's attrs", first["attrs"])
	}
}

// navigator.sendBeacon, used when a tab is hidden or closed, posts as
// text/plain.
func TestClientLogAcceptsABeacon(t *testing.T) {
	api, read := serveLogged(t)

	rec := postLog(api, "text/plain;charset=UTF-8", logBatch(map[string]any{"seq": 1, "level": "info", "event": "visibility"}))
	if rec.Code != http.StatusNoContent {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
	if got := read(); len(got) != 1 || got[0].Message != "client: visibility" {
		t.Fatalf("logged %v, want the beacon's entry", got)
	}
}

// Over the entry cap the server keeps the newest, which is what explains
// whatever went wrong.
func TestClientLogKeepsTheNewestEntries(t *testing.T) {
	api, read := serveLogged(t)

	entries := make([]map[string]any, maxClientLogEntries+50)
	for i := range entries {
		entries[i] = map[string]any{"seq": i, "level": "info", "event": "e"}
	}
	if rec := postLog(api, "application/json", logBatch(entries...)); rec.Code != http.StatusNoContent {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
	got := read()
	if len(got) != maxClientLogEntries {
		t.Fatalf("logged %d entries, want the cap of %d", len(got), maxClientLogEntries)
	}
	if seq := got[0].Data["seq"]; seq != int64(50) {
		t.Errorf("the oldest kept entry is seq %v, want 50", seq)
	}
}

func TestClientLogRefusesOversizeAndMalformedBodies(t *testing.T) {
	api, read := serveLogged(t)

	huge := logBatch(map[string]any{"seq": 1, "level": "info", "event": "big",
		"attrs": map[string]any{"blob": strings.Repeat("x", maxClientLogBytes)}})
	for name, body := range map[string][]byte{"oversize": huge, "malformed": []byte("{not json")} {
		if rec := postLog(api, "application/json", body); rec.Code != http.StatusBadRequest {
			t.Errorf("%s: status %d, want 400", name, rec.Code)
		}
	}
	if got := read(); len(got) != 0 {
		t.Fatalf("refused bodies logged %d entries", len(got))
	}
}

// A client entry always reads as a client one: its event is prefixed and its
// attrs are nested, so it can't pose as the server's turn audit.
func TestClientLogCantPoseAsTheServer(t *testing.T) {
	api, read := serveLogged(t)

	rec := postLog(api, "application/json", logBatch(map[string]any{
		"seq": 1, "level": "warn", "event": "turn: out of rotation",
		"attrs": map[string]any{"source": "server", "user_id": "someone else"},
	}))
	if rec.Code != http.StatusNoContent {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
	got := read()
	if len(got) != 1 {
		t.Fatalf("logged %d entries, want 1", len(got))
	}
	if got[0].Message != "client: turn: out of rotation" {
		t.Errorf("message %q isn't marked as the client's", got[0].Message)
	}
	if got[0].Data["source"] != "client" || got[0].Data["user_id"] != "u1" {
		t.Errorf("data %v: the entry's attrs overrode the batch's own fields", got[0].Data)
	}
}
