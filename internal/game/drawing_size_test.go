package game

import (
	"bytes"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/hook"
)

// How big a drawing a player can upload (turns.drawing's maxSize, migration
// 1784600000): a full-size phone photo over PocketBase's default 5 MB saves,
// and one over the cap is refused with the reason on the field, and logged.

// bigPicture is a PNG of size bytes: the type check reads only its start.
func bigPicture(size int) []byte {
	return append(bytes.Clone(pngPixel), make([]byte, size-len(pngPixel))...)
}

func TestDrawingTakesAPhotoOverFiveMB(t *testing.T) {
	app := newTestApp(t)
	api := serveAPI(t, app)
	g := newGame(t, app, "ann", "ben")
	g.play(t, "ann", "ann")
	photo := bigPicture(8 << 20)
	rec := upload(api, http.MethodPost, turnsRoute, g.nextTurn(t, "ann", "ben"), "IMG_0620.png", photo)
	if rec.Code != http.StatusOK {
		t.Fatalf("8 MB drawing: %d %s", rec.Code, rec.Body)
	}
	turns := g.turnsBy(t, "ann", "ben")
	if len(turns) != 1 {
		t.Fatalf("ben has %d turns on ann's story, want 1", len(turns))
	}
	if got := readDrawing(t, app, turns[0]); len(got) != len(photo) {
		t.Fatalf("saved %d bytes, want %d", len(got), len(photo))
	}
}

// loggedApp is a test app whose log a test can read back: writeFailures gives
// the "turn: write failed" entries so far.
func loggedApp(t *testing.T) (app appWithLogger, writeFailures func() []loggedEntry) {
	var mu sync.Mutex
	var entries []loggedEntry
	app = appWithLogger{newTestApp(t), slog.New(capture{mu: &mu, entries: &entries})}
	return app, func() []loggedEntry {
		mu.Lock()
		defer mu.Unlock()
		var failed []loggedEntry
		for _, e := range entries {
			if e.Message == "turn: write failed" {
				failed = append(failed, e)
			}
		}
		return failed
	}
}

// wantLogged checks there's exactly one write failure logged, by user, with
// file and a cause containing cause.
func wantLogged(t *testing.T, failures []loggedEntry, user, file, cause string) {
	t.Helper()
	if len(failures) != 1 {
		t.Fatalf("logged %d write failures, want 1: %v", len(failures), failures)
	}
	got, _ := failures[0].Data["cause"].(string)
	if d := failures[0].Data; d["user_id"] != user || d["file"] != file || !strings.Contains(got, cause) {
		t.Fatalf("logged %v, want %s's %s with a cause of %q", d, user, file, cause)
	}
}

func TestDrawingOverTheCapIsRefusedAndLogged(t *testing.T) {
	app, writeFailures := loggedApp(t)
	api := serveAPI(t, app)
	g := newGame(t, app, "ann", "ben")
	g.play(t, "ann", "ann")

	rec := upload(api, http.MethodPost, turnsRoute, g.nextTurn(t, "ann", "ben"), "huge.png", bigPicture(11<<20))
	var body struct {
		Data map[string]struct {
			Code string `json:"code"`
		} `json:"data"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	if rec.Code != http.StatusBadRequest || body.Data["drawing"].Code != "validation_file_size_limit" {
		t.Fatalf("11 MB drawing: %d %s, want refused as too big on drawing", rec.Code, rec.Body)
	}
	if len(g.turnsBy(t, "ann", "ben")) != 0 {
		t.Fatal("the 11 MB drawing was saved")
	}
	wantLogged(t, writeFailures(), g.players["ben"].Id, "huge.png", "maximum allowed file size")
}

// The turns update rule is open, so an edit's failure is logged too.
func TestDrawingEditOverTheCapIsLogged(t *testing.T) {
	app, writeFailures := loggedApp(t)
	api := serveAPI(t, app)
	g := newGame(t, app, "ann", "ben")
	g.play(t, "ann", "ann")
	turn := g.drawWithFile(t, "ann", "ben")

	rec := upload(api, http.MethodPatch, turnsRoute+"/"+turn.Id, nil, "huge.png", bigPicture(11<<20))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("editing in an 11 MB drawing: %d %s, want refused", rec.Code, rec.Body)
	}
	wantLogged(t, writeFailures(), g.players["ben"].Id, "huge.png", "maximum allowed file size")
}

// The log binds ahead of the other request hooks, so it sees a failure in
// one of them, not just in the save at the end of the chain.
func TestTurnWriteLogSeesAnotherHooksFailure(t *testing.T) {
	app, writeFailures := loggedApp(t)
	// Ahead of the game's own hooks (priority 0), so it fails before them.
	app.OnRecordCreateRequest("turns").Bind(&hook.Handler[*core.RecordRequestEvent]{
		Priority: -50,
		Func:     func(*core.RecordRequestEvent) error { return errors.New("disk full") },
	})
	api := serveAPI(t, app)
	g := newGame(t, app, "ann", "ben")
	g.play(t, "ann", "ann")

	rec := upload(api, http.MethodPost, turnsRoute, g.nextTurn(t, "ann", "ben"), "d.png", pngPixel)
	if rec.Code == http.StatusOK {
		t.Fatal("the drawing saved, though a hook failed")
	}
	wantLogged(t, writeFailures(), g.players["ben"].Id, "d.png", "disk full")
}

// A refusal with a code is the player's to read, and bindDrawingTypes logs a
// refused type itself: it isn't logged again as a write failure.
func TestTurnWriteLogLeavesOutRefusals(t *testing.T) {
	app, writeFailures := loggedApp(t)
	api := serveAPI(t, app)
	g := newGame(t, app, "ann", "ben")
	g.play(t, "ann", "ann")

	rec := upload(api, http.MethodPost, turnsRoute, g.nextTurn(t, "ann", "ben"), "scan.tiff", tiffHeader)
	if code, _ := refusal(rec); code != codeBadPicture {
		t.Fatalf("TIFF drawing: %d %s, want refused as %s", rec.Code, rec.Body, codeBadPicture)
	}
	if failures := writeFailures(); len(failures) != 0 {
		t.Fatalf("logged the refusal as a write failure: %v", failures)
	}
}

func TestClipKeepsUTF8Whole(t *testing.T) {
	for _, c := range []struct {
		in   string
		n    int
		want string
	}{
		{"d.png", 5, "d.png"},
		{"abcdef", 4, "abcd…"},
		{"ab€", 4, "ab…"}, // € is 3 bytes: cut inside it, it's dropped
	} {
		if got := clip(c.in, c.n); got != c.want {
			t.Errorf("clip(%q, %d) = %q, want %q", c.in, c.n, got, c.want)
		}
	}
}
