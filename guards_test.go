package main

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"
)

// Every refusal a client can get writing a turn, opening a story or timing
// out, with the code TakeTurn acts on (refused() in TakeTurn.vue):
// turn_skipped and player_removed move the player on with a message,
// turn_taken and not_your_turn move them on quietly, and wrong_turn_type
// tells them to refresh. A guard that returned a plain error instead would
// leave the client unable to tell what happened, with the player stuck on a
// turn screen, so each path is pinned here.
func TestRefusalCodes(t *testing.T) {
	app := newTestApp(t)
	api := serveAPI(t, app)
	send := func(turn map[string]any) *httptest.ResponseRecorder {
		return call(api, http.MethodPost, turnsPath, turn)
	}
	act := func(t *testing.T, g *testGame, action, name string) {
		t.Helper()
		if rec := g.hostAct(api, action, g.players["ann"], g.players[name]); rec.Code != http.StatusOK {
			t.Fatalf("%s %s: %d %s", action, name, rec.Code, rec.Body)
		}
	}

	cases := []struct {
		name string
		do   func(t *testing.T, g *testGame) *httptest.ResponseRecorder
		want string
	}{
		{"a second turn by the same player", func(t *testing.T, g *testGame) *httptest.ResponseRecorder {
			g.play(t, "ann", "ann")
			return send(g.turn("ann", "ann", true))
		}, codeTurnTaken},
		{"a turn out of rotation", func(t *testing.T, g *testGame) *httptest.ResponseRecorder {
			return send(g.turn("ann", "cat", false))
		}, codeNotYourTurn},
		{"a turn with no player on a finished story", func(t *testing.T, g *testGame) *httptest.ResponseRecorder {
			g.play(t, "ann", "ann")
			g.play(t, "ann", "ben")
			g.play(t, "ann", "cat")
			return send(g.turn("ann", "nobody", true))
		}, codeNotYourTurn},
		{"a turn the host skipped", func(t *testing.T, g *testGame) *httptest.ResponseRecorder {
			g.play(t, "ann", "ann")
			act(t, g, "skip", "ben")
			return send(g.turn("ann", "ben", true))
		}, codeTurnSkipped},
		{"a turn by a dropped player", func(t *testing.T, g *testGame) *httptest.ResponseRecorder {
			g.play(t, "ann", "ann")
			act(t, g, "drop", "ben")
			return send(g.turn("ann", "ben", true))
		}, codePlayerRemoved},
		{"a story opened by a dropped player", func(t *testing.T, g *testGame) *httptest.ResponseRecorder {
			act(t, g, "drop", "ben") // deletes his unopened story
			return call(api, http.MethodPost, "/api/collections/stories/records",
				map[string]any{"starter_id": g.players["ben"].Id, "game_id": g.game.Id})
		}, codePlayerRemoved},
		{"a timeout for a dropped player", func(t *testing.T, g *testGame) *httptest.ResponseRecorder {
			g.play(t, "ann", "ann")
			act(t, g, "drop", "ben")
			return g.timeout(api, "ann", "ben")
		}, codePlayerRemoved},
		{"a timeout after the player submitted", func(t *testing.T, g *testGame) *httptest.ResponseRecorder {
			g.play(t, "ann", "ann")
			g.play(t, "ann", "ben")
			return g.timeout(api, "ann", "ben")
		}, codeTurnTaken},
		{"a timeout after the host skipped", func(t *testing.T, g *testGame) *httptest.ResponseRecorder {
			g.play(t, "ann", "ann")
			act(t, g, "skip", "ben")
			return g.timeout(api, "ann", "ben")
		}, codeTurnSkipped},
		{"a timeout for someone else's turn", func(t *testing.T, g *testGame) *httptest.ResponseRecorder {
			return g.timeout(api, "ann", "cat")
		}, codeNotYourTurn},
		{"a drawing as an opening word", func(t *testing.T, g *testGame) *httptest.ResponseRecorder {
			return send(g.turn("ann", "ann", true))
		}, codeWrongTurnType},
		{"a drawing after a drawing", func(t *testing.T, g *testGame) *httptest.ResponseRecorder {
			g.play(t, "ann", "ann")
			g.play(t, "ann", "ben")
			return send(g.turn("ann", "cat", true))
		}, codeWrongTurnType},
		{"a word after a word", func(t *testing.T, g *testGame) *httptest.ResponseRecorder {
			g.play(t, "ann", "ann")
			return send(g.turn("ann", "ben", false))
		}, codeWrongTurnType},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			g := newGame(t, app, "ann", "ben", "cat").timed(t)
			rec := c.do(t, g)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status %d, want 400: %s", rec.Code, rec.Body)
			}
			if code, byIndex := refusal(rec); code != c.want || byIndex {
				t.Fatalf("refused as %q (by the unique index: %v), want %q from the guard: %s",
					code, byIndex, c.want, rec.Body)
			}
		})
	}
}

// The unique index under the turn guard: nothing, not even a server-side
// write, can give a player two turns on one story, and the error names the
// fields the client's fallback looks for (refusalCode in services/pocketbase).
func TestOneTurnPerPlayerPerStory(t *testing.T) {
	app := newTestApp(t)
	g := newGame(t, app, "ann", "ben")
	g.play(t, "ann", "ann")

	col, err := app.FindCollectionByNameOrId("turns")
	if err != nil {
		t.Fatal(err)
	}
	dup := core.NewRecord(col)
	dup.Load(g.turn("ann", "ann", true))
	err = app.Save(dup)
	if err == nil {
		t.Fatal("a second turn by ann on her story was saved")
	}
	// The API turns a validation error into its response data the same way.
	data := router.NewBadRequestError("", err).Data
	for _, field := range []string{"user_id", "story_id"} {
		if item, _ := data[field].(map[string]any); item["code"] != "validation_not_unique" {
			t.Errorf("%s: %v, want validation_not_unique", field, data[field])
		}
	}
}
