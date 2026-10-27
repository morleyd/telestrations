package game

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"testing"
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
	photo := bigPicture(12 << 20)
	rec := upload(api, http.MethodPost, turnsRoute, g.nextTurn(t, "ann", "ben"), "IMG_0620.png", photo)
	if rec.Code != http.StatusOK {
		t.Fatalf("12 MB drawing: %d %s", rec.Code, rec.Body)
	}
	turns := g.turnsBy(t, "ann", "ben")
	if len(turns) != 1 {
		t.Fatalf("ben has %d turns on ann's story, want 1", len(turns))
	}
	if got := readDrawing(t, app, turns[0]); len(got) != len(photo) {
		t.Fatalf("saved %d bytes, want %d", len(got), len(photo))
	}
}

func TestDrawingOverTheCapIsRefusedAndLogged(t *testing.T) {
	var mu sync.Mutex
	var entries []loggedEntry
	app := appWithLogger{newTestApp(t), slog.New(capture{mu: &mu, entries: &entries})}
	api := serveAPI(t, app)
	g := newGame(t, app, "ann", "ben")
	g.play(t, "ann", "ann")

	rec := upload(api, http.MethodPost, turnsRoute, g.nextTurn(t, "ann", "ben"), "huge.png", bigPicture(21<<20))
	var body struct {
		Data map[string]struct {
			Code string `json:"code"`
		} `json:"data"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	if rec.Code != http.StatusBadRequest || body.Data["drawing"].Code != "validation_file_size_limit" {
		t.Fatalf("21 MB drawing: %d %s, want refused as too big on drawing", rec.Code, rec.Body)
	}
	if len(g.turnsBy(t, "ann", "ben")) != 0 {
		t.Fatal("the 21 MB drawing was saved")
	}

	mu.Lock()
	defer mu.Unlock()
	for _, e := range entries {
		if e.Message != "turn: write failed" {
			continue
		}
		if e.Data["user_id"] != g.players["ben"].Id || e.Data["file"] != "huge.png" ||
			!strings.Contains(e.Data["cause"].(string), "maximum allowed file size") {
			t.Fatalf("logged %v, want ben's huge.png with its cause", e.Data)
		}
		return
	}
	t.Fatal("the refused drawing wasn't logged")
}
