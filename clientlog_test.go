package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/logger"
)

// POST /api/client-log: browsers batch their trace events here (see
// web/src/services/log.js), and they land in the dashboard's Logs view next
// to the server's own. Unauthenticated, so it's capped, and a client must not
// be able to pass an entry off as a server one.

// clientLogs turns on log persistence for the test (the test app keeps it
// off), and returns a function that flushes the log buffer and reads back
// the client entries, oldest first.
func clientLogs(t *testing.T, app core.App) func() []loggedEntry {
	t.Helper()
	app.Settings().Logs.MaxDays = 1
	t.Cleanup(func() { app.Settings().Logs.MaxDays = 0 }) // before the app shuts down
	return func() []loggedEntry {
		t.Helper()
		if err := app.Logger().Handler().(*logger.BatchHandler).WriteAll(context.Background()); err != nil {
			t.Fatal(err)
		}
		var rows []struct {
			Message string `db:"message"`
			Level   int    `db:"level"`
			Data    string `db:"data"`
		}
		err := app.AuxDB().NewQuery("SELECT message, level, data FROM _logs WHERE message LIKE 'client: %' ORDER BY rowid").
			All(&rows)
		if err != nil {
			t.Fatal(err)
		}
		out := make([]loggedEntry, len(rows))
		for i, r := range rows {
			out[i] = loggedEntry{Message: r.Message, Level: r.Level}
			if err := json.Unmarshal([]byte(r.Data), &out[i].Data); err != nil {
				t.Fatal(err)
			}
		}
		return out
	}
}

type loggedEntry struct {
	Message string
	Level   int
	Data    map[string]any
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
	app := newTestApp(t)
	api := serveAPI(t, app)
	read := clientLogs(t, app)

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
	app := newTestApp(t)
	api := serveAPI(t, app)
	read := clientLogs(t, app)

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
	app := newTestApp(t)
	api := serveAPI(t, app)
	read := clientLogs(t, app)

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
	if seq := got[0].Data["seq"]; seq != float64(50) {
		t.Errorf("the oldest kept entry is seq %v, want 50", seq)
	}
}

func TestClientLogRefusesOversizeAndMalformedBodies(t *testing.T) {
	app := newTestApp(t)
	api := serveAPI(t, app)
	read := clientLogs(t, app)

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
	app := newTestApp(t)
	api := serveAPI(t, app)
	read := clientLogs(t, app)

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
