package main

import (
	"bytes"
	"encoding/base64"
	"io"
	"net/http"
	"slices"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/filesystem"
)

// What a skip writes (skipTurn): the turn the skipped player owed, carrying
// the previous turn forward unchanged, so the next player sees what they would
// have if the skipped player had passed it straight on.

// pngPixel is a 1x1 PNG, as the e2e helpers upload.
var pngPixel, _ = base64.StdEncoding.DecodeString(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMEAYE0k9kAAAAASUVORK5CYII=")

// drawWithFile writes name's drawing on starter's story with a real image.
func (g *testGame) drawWithFile(t *testing.T, starter, name string) *core.Record {
	t.Helper()
	turn := g.nextTurn(t, starter, name)
	if !turn["is_drawing"].(bool) {
		t.Fatalf("%s's next turn on %s's story is a word, not a drawing", name, starter)
	}
	file, err := filesystem.NewFileFromBytes(pngPixel, "d.png")
	if err != nil {
		t.Fatal(err)
	}
	turn["drawing"] = file
	return save(t, g.app, "turns", turn)
}

func readDrawing(t *testing.T, app core.App, turn *core.Record) []byte {
	t.Helper()
	fsys, err := app.NewFilesystem()
	if err != nil {
		t.Fatal(err)
	}
	defer fsys.Close()
	r, err := fsys.GetReader(turn.BaseFilesPath() + "/" + turn.GetString("drawing"))
	if err != nil {
		t.Fatalf("reading %s's drawing: %v", turn.Id, err)
	}
	defer r.Close()
	data, err := io.ReadAll(r)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func TestSkipCarriesADrawingForward(t *testing.T) {
	app := newTestApp(t)
	g := newGame(t, app, "ann", "ben", "cat", "dan")
	g.play(t, "ann", "ann")
	drawing := g.drawWithFile(t, "ann", "ben")

	if _, err := skipPendingTurns(app, g.game.Id, g.players["cat"].Id, false); err != nil {
		t.Fatal(err)
	}
	skip := g.turnsBy(t, "ann", "cat")[0]
	if !skip.GetBool("skipped") || skip.GetBool("timed_out") || !skip.GetBool("is_drawing") {
		t.Fatalf("cat's skip: skipped=%v timed_out=%v is_drawing=%v, want a host-skipped drawing",
			skip.GetBool("skipped"), skip.GetBool("timed_out"), skip.GetBool("is_drawing"))
	}
	if skip.GetString("drawing") == "" || skip.GetString("drawing") == drawing.GetString("drawing") {
		t.Fatalf("cat's skip has drawing %q; want its own copy of ben's %q",
			skip.GetString("drawing"), drawing.GetString("drawing"))
	}
	if !bytes.Equal(readDrawing(t, app, skip), pngPixel) {
		t.Fatal("cat's copy of the drawing isn't ben's image")
	}

	// dan, guessing next, is shown the copy.
	s, err := loadStory(app, g.stories["ann"].Id)
	if err != nil {
		t.Fatal(err)
	}
	if s.NextUser != g.players["dan"].Id || s.PrevTurn != skip.Id {
		t.Fatalf("ann's story waits on %s after turn %s, want dan after cat's skip", g.name(s.NextUser), s.PrevTurn)
	}
}

func TestSkipCarriesAWordForward(t *testing.T) {
	app := newTestApp(t)
	g := newGame(t, app, "ann", "ben", "cat")
	g.play(t, "ann", "ann")

	if _, err := skipPendingTurns(app, g.game.Id, g.players["ben"].Id, false); err != nil {
		t.Fatal(err)
	}
	skip := g.turnsBy(t, "ann", "ben")[0]
	if !skip.GetBool("skipped") || skip.GetBool("is_drawing") || skip.GetString("prompt") != "ann's word" {
		t.Fatalf("ben's skip: skipped=%v is_drawing=%v prompt=%q, want ann's word carried forward",
			skip.GetBool("skipped"), skip.GetBool("is_drawing"), skip.GetString("prompt"))
	}
	// cat draws next, from ann's word.
	if turn := g.nextTurn(t, "ann", "cat"); !turn["is_drawing"].(bool) {
		t.Fatal("cat's turn after ben's skipped word should be a drawing")
	}
}

// A skipped opening word is one of the starting words, so the story still
// starts. A host skip and a timeout both get one; only the timeout is marked.
func TestSkippedOpeningWordIsAStartingWord(t *testing.T) {
	app := newTestApp(t)
	api := serveAPI(t, app)
	for _, timedOut := range []bool{false, true} {
		g := newGame(t, app, "ann", "ben").timed(t)
		if timedOut {
			if rec := g.timeout(api, "ben", "ben"); rec.Code != http.StatusOK {
				t.Fatalf("timeout: %d %s", rec.Code, rec.Body)
			}
		} else if rec := g.hostAct(api, "skip", g.players["ann"], g.players["ben"]); rec.Code != http.StatusOK {
			t.Fatalf("skip: %d %s", rec.Code, rec.Body)
		}
		word := g.turnsBy(t, "ben", "ben")[0]
		if !word.GetBool("skipped") || word.GetBool("is_drawing") || word.GetBool("timed_out") != timedOut {
			t.Errorf("timed out %v: ben's opening skip is skipped=%v is_drawing=%v timed_out=%v", timedOut,
				word.GetBool("skipped"), word.GetBool("is_drawing"), word.GetBool("timed_out"))
		}
		if !slices.Contains(skipStartingWords, word.GetString("prompt")) {
			t.Errorf("timed out %v: ben's opening word %q isn't a starting word", timedOut, word.GetString("prompt"))
		}
	}
}

// The host can skip themselves (they stepped away too), but not drop
// themselves: nobody would be left to run the game.
func TestHostCanBeSkippedNotDropped(t *testing.T) {
	app := newTestApp(t)
	api := serveAPI(t, app)
	g := newGame(t, app, "ann", "ben")
	ann := g.players["ann"]

	if rec := g.hostAct(api, "drop", ann, ann); rec.Code != http.StatusBadRequest {
		t.Fatalf("the host dropping themselves: %d %s, want 400", rec.Code, rec.Body)
	}
	if isDropped(app, ann.Id) {
		t.Fatal("the host was marked dropped")
	}
	if rec := g.hostAct(api, "skip", ann, ann); rec.Code != http.StatusOK || skippedCount(t, rec) != 1 {
		t.Fatalf("the host skipping their own opening word: %d %s", rec.Code, rec.Body)
	}
}
