package game

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"slices"
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

// Every write takes the next place in its story, whatever the writer sent:
// the server numbers turns. Under that, the unique (story_id, turn_index)
// index refuses a second write to one place, and the error names story_id,
// which the client's fallback looks for (refusalCode in services/pocketbase).
func TestOneWritePerPlaceInAStory(t *testing.T) {
	app := newTestApp(t)
	g := newGame(t, app, "ann", "ben")
	g.play(t, "ann", "ann")

	col, err := app.FindCollectionByNameOrId("turns")
	if err != nil {
		t.Fatal(err)
	}
	next := core.NewRecord(col)
	next.Load(g.nextTurn(t, "ann", "ben"))
	next.Set("turn_index", 0) // claims the opening word's place
	if err := app.Save(next); err != nil {
		t.Fatal(err)
	}
	if got := next.GetInt("turn_index"); got != 1 {
		t.Errorf("ben's turn after ann's word was numbered %d, want 1", got)
	}

	// Only an update can move a turn now, so that's what tries the index.
	next.Set("turn_index", 0)
	err = app.Save(next)
	if err == nil {
		t.Fatal("two turns were saved at place 0 of ann's story")
	}
	// The API turns a validation error into its response data the same way.
	data := router.NewBadRequestError("", err).Data
	for _, field := range []string{"story_id", "turn_index"} {
		if item, _ := data[field].(map[string]any); item["code"] != "validation_not_unique" {
			t.Errorf("%s: %v, want validation_not_unique", field, data[field])
		}
	}
}

// The turn-kind rule end to end, timed game or not (timed games once
// submitted the word again for a blank canvas): a story opens with a word,
// then drawings and guesses alternate, and each right turn is accepted.
func TestTurnKindsAlternateTimedOrNot(t *testing.T) {
	app := newTestApp(t)
	api := serveAPI(t, app)
	for _, timed := range []bool{false, true} {
		g := newGame(t, app, "ann", "ben", "cat")
		if timed {
			g.timed(t)
		}
		steps := []struct {
			name      string
			isDrawing bool
			want      string // a refusal code, or "" for accepted
		}{
			{"ann", true, codeWrongTurnType},
			{"ann", false, ""},
			{"ben", false, codeWrongTurnType},
			{"ben", true, ""},
			{"cat", true, codeWrongTurnType},
			{"cat", false, ""},
		}
		for i, s := range steps {
			rec := call(api, http.MethodPost, turnsPath, g.turn("ann", s.name, s.isDrawing))
			code, _ := refusal(rec)
			if (s.want == "" && rec.Code != http.StatusOK) || code != s.want {
				t.Fatalf("timed %v, step %d (%s, drawing %v): %d %s", timed, i, s.name, s.isDrawing, rec.Code, rec.Body)
			}
		}
	}
}

// Once a story is done nothing more is written to it, not even a turn or a
// timeout with no player (a finished story waits on no one).
func TestFinishedStoryTakesNoMoreTurns(t *testing.T) {
	app := newTestApp(t)
	api := serveAPI(t, app)
	g := newGame(t, app, "ann", "ben", "cat").timed(t)
	g.play(t, "ann", "ann")
	g.play(t, "ann", "ben")
	g.play(t, "ann", "cat")

	if rec := call(api, http.MethodPost, turnsPath, g.turn("ann", "nobody", true)); rec.Code != http.StatusBadRequest {
		t.Errorf("a turn with no player: %d %s", rec.Code, rec.Body)
	}
	if rec := call(api, http.MethodPost, "/api/stories/"+g.stories["ann"].Id+"/timeout",
		map[string]any{"user_id": ""}); rec.Code != http.StatusBadRequest {
		t.Errorf("a timeout with no player: %d %s", rec.Code, rec.Body)
	}
	if s, _ := loadStory(app, g.stories["ann"].Id); s.Taken != 3 {
		t.Fatalf("ann's finished story has %d turns, want 3", s.Taken)
	}
}

// Host powers (Skip, Drop) go to whoever has is_host, so only the player who
// created the game may have it: a later join can't claim it, and nobody can
// promote themselves (or reseat themselves, or move games) afterwards.
func TestOnlyTheCreatorHosts(t *testing.T) {
	app := newTestApp(t)
	api := serveAPI(t, app)

	lobby := newLobby(t, app, "ann", "ben")
	rec := call(api, http.MethodPost, "/api/collections/users/records",
		map[string]any{"username": "dee", "game_id": lobby.game.Id, "is_host": true})
	var joined struct {
		IsHost bool `json:"is_host"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &joined); rec.Code != http.StatusOK || err != nil {
		t.Fatalf("join: %d %s", rec.Code, rec.Body)
	}
	if joined.IsHost {
		t.Error("a player joining as host became a second host")
	}

	g := newGame(t, app, "ann", "ben", "cat")
	ben, cat := g.players["ben"], g.players["cat"]
	rec = call(api, http.MethodPatch, "/api/collections/users/records/"+ben.Id, map[string]any{
		"is_host": true, "position": 7, "game_id": lobby.game.Id, "username": "benny",
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("update: %d %s", rec.Code, rec.Body)
	}
	after, err := app.FindRecordById("users", ben.Id)
	if err != nil {
		t.Fatal(err)
	}
	if after.GetBool("is_host") || after.GetInt("position") != ben.GetInt("position") ||
		after.GetString("game_id") != g.game.Id || after.GetString("username") != "benny" {
		t.Errorf("after ben's update: is_host=%v position=%d game=%s username=%q; want only the name changed",
			after.GetBool("is_host"), after.GetInt("position"), after.GetString("game_id"), after.GetString("username"))
	}
	if rec := g.hostAct(api, "skip", ben, cat); rec.Code != http.StatusForbidden {
		t.Errorf("ben skipping cat as host: %d, want 403", rec.Code)
	}
}

// The roster is fixed once the game begins. The users API rules refuse a join
// or a leave by then, but PocketBase checks them before the write, so the
// guard checks again inside it: a /begin that lands after the rule check
// must still stop the join or the leave.
func TestJoinOrLeaveUnderABeginIsRefused(t *testing.T) {
	t.Run("join", func(t *testing.T) {
		app := newTestApp(t)
		api := serveAPI(t, app)
		g := newLobby(t, app, "ann", "ben")
		beforeTheGuard(app.OnRecordCreateRequest("users"), func() { g.begin(t, api, "ann", "ben") })

		rec := call(api, http.MethodPost, "/api/collections/users/records",
			map[string]any{"username": "cat", "game_id": g.game.Id})
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("cat's join: %d %s, want 400", rec.Code, rec.Body)
		}
		if seats := g.seats(t); !slices.Equal(seats, []int{0, 1}) {
			t.Fatalf("seats %v, want ann and ben's only", seats)
		}
	})
	t.Run("leave", func(t *testing.T) {
		app := newTestApp(t)
		api := serveAPI(t, app)
		g := newLobby(t, app, "ann", "ben", "cat")
		beforeTheGuard(app.OnRecordDeleteRequest("users"), func() { g.begin(t, api, "ann", "ben", "cat") })

		rec := call(api, http.MethodDelete, "/api/collections/users/records/"+g.players["cat"].Id, nil)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("cat's leave: %d %s, want 400", rec.Code, rec.Body)
		}
		if seats := g.seats(t); !slices.Equal(seats, []int{0, 1, 2}) {
			t.Fatalf("seats %v, want all three still seated", seats)
		}
	})
}

// A rename writes the whole player back, so it must not write back a seat or
// a dropped flag older than the write: a /begin or a drop that lands after
// PocketBase loaded the player keeps what it wrote, and the rename still
// changes the name.
func TestRenameKeepsABeginOrADropThatLandedUnderIt(t *testing.T) {
	rename := func(t *testing.T, api http.Handler, user *core.Record) {
		t.Helper()
		rec := call(api, http.MethodPatch, "/api/collections/users/records/"+user.Id,
			map[string]any{"username": "benny"})
		if rec.Code != http.StatusOK {
			t.Fatalf("rename: %d %s", rec.Code, rec.Body)
		}
	}
	reload := func(t *testing.T, app core.App, user *core.Record) *core.Record {
		t.Helper()
		after, err := app.FindRecordById("users", user.Id)
		if err != nil {
			t.Fatal(err)
		}
		if after.GetString("username") != "benny" {
			t.Errorf("the rename didn't land: username %q", after.GetString("username"))
		}
		return after
	}

	t.Run("begin", func(t *testing.T) {
		app := newTestApp(t)
		api := serveAPI(t, app)
		g := newLobby(t, app, "ann", "ben")
		beforeTheGuard(app.OnRecordUpdateRequest("users"), func() { g.begin(t, api, "ann", "ben") })

		rename(t, api, g.players["ben"])
		if seat := reload(t, app, g.players["ben"]).GetInt("position"); seat != 1 {
			t.Errorf("ben is in seat %d after renaming, want the 1 /begin gave him", seat)
		}
	})
	t.Run("drop", func(t *testing.T) {
		app := newTestApp(t)
		api := serveAPI(t, app)
		g := newGame(t, app, "ann", "ben", "cat")
		ann, ben := g.players["ann"], g.players["ben"]
		beforeTheGuard(app.OnRecordUpdateRequest("users"), func() {
			if rec := g.hostAct(api, "drop", ann, ben); rec.Code != http.StatusOK {
				t.Fatalf("drop: %d %s", rec.Code, rec.Body)
			}
		})

		rename(t, api, ben)
		if !reload(t, app, ben).GetBool("dropped") {
			t.Error("ben's rename undid his drop")
		}
	})
}
