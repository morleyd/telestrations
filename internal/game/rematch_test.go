package game

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"slices"
	"testing"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// Play again (POST /api/games/{gameId}/rematch, migrations/1784400000_rematch):
// the host starts a new game with the same players, straight into play.

func (g *testGame) rematch(api http.Handler, host *core.Record, body map[string]any) *httptest.ResponseRecorder {
	body["host_id"] = host.Id
	return call(api, http.MethodPost, "/api/games/"+g.game.Id+"/rematch", body)
}

// rematchedGame is the game a successful rematch response names.
func rematchedGame(t *testing.T, app core.App, rec *httptest.ResponseRecorder) *core.Record {
	t.Helper()
	if rec.Code != http.StatusOK {
		t.Fatalf("rematch: %d %s", rec.Code, rec.Body)
	}
	var resp struct {
		GameID   string `json:"game_id"`
		GameCode string `json:"game_code"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	game, err := app.FindRecordById("games", resp.GameID)
	if err != nil {
		t.Fatal(err)
	}
	if game.GetString("game_code") != resp.GameCode || len(resp.GameCode) != 5 {
		t.Fatalf("rematch named game code %q, the game has %q", resp.GameCode, game.GetString("game_code"))
	}
	return game
}

// playOut plays every story in the game to its end, each turn by whoever the
// story is waiting on.
func (g *testGame) playOut(t *testing.T) {
	t.Helper()
	for played := true; played; {
		played = false
		for starter := range g.stories {
			s, err := loadStory(g.app, g.stories[starter].Id)
			if errors.Is(err, sql.ErrNoRows) {
				delete(g.stories, starter) // a dropped player's empty story, removed
				continue
			} else if err != nil {
				t.Fatal(err)
			}
			if s.NextUser != "" {
				g.play(t, starter, g.name(s.NextUser))
				played = true
			}
		}
	}
}

// The new game: the players who weren't dropped, in the same seats, with the
// settings asked for, started; each seat points back at the player it
// continues, and the old game points at the new one.
func TestRematchSeatsTheSamePlayers(t *testing.T) {
	app := newTestApp(t)
	api := serveAPI(t, app)
	g := newGame(t, app, "ann", "ben", "cat", "dan")
	if rec := g.hostAct(api, "drop", g.players["ann"], g.players["cat"]); rec.Code != http.StatusOK {
		t.Fatalf("drop: %d %s", rec.Code, rec.Body)
	}
	g.playOut(t)

	next := rematchedGame(t, app, g.rematch(api, g.players["ann"], map[string]any{
		"rounds": 2, "endless": false, "round_duration": 45,
	}))
	if !next.GetBool("isStarted") || next.GetInt("rounds") != 2 || next.GetBool("endless") ||
		next.GetInt("roundDuration") != 45 || next.Id == g.game.Id {
		t.Errorf("the new game: started %v, rounds %d, endless %v, duration %d",
			next.GetBool("isStarted"), next.GetInt("rounds"), next.GetBool("endless"), next.GetInt("roundDuration"))
	}
	old, err := app.FindRecordById("games", g.game.Id)
	if err != nil {
		t.Fatal(err)
	}
	if old.GetString("next_game") != next.Id {
		t.Errorf("the old game's next_game is %q, want the new game", old.GetString("next_game"))
	}

	seats, err := app.FindRecordsByFilter("users", "game_id = {:g}", "position", 0, 0, dbx.Params{"g": next.Id})
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for i, seat := range seats {
		name := seat.GetString("username")
		names = append(names, name)
		if seat.GetInt("position") != i || seat.GetString("from_user") != g.players[name].Id {
			t.Errorf("%s's new seat: position %d, from %q", name, seat.GetInt("position"), seat.GetString("from_user"))
		}
		if seat.GetBool("is_host") != (name == "ann") || seat.GetBool("dropped") {
			t.Errorf("%s's new seat: host %v, dropped %v", name, seat.GetBool("is_host"), seat.GetBool("dropped"))
		}
	}
	if !slices.Equal(names, []string{"ann", "ben", "dan"}) {
		t.Errorf("the new game seats %v, want ann, ben, dan (cat was dropped)", names)
	}

	// Starting again (a double click, another tab) gives the same game.
	again := rematchedGame(t, app, g.rematch(api, g.players["ann"], map[string]any{"rounds": 3}))
	if again.Id != next.Id {
		t.Errorf("a second rematch made another game")
	}
	if n, _ := app.CountRecords("users", dbx.HashExp{"game_id": next.Id}); n != 3 {
		t.Errorf("the new game has %d players after a second rematch, want 3", n)
	}

	// And it plays: everyone opens their story and the first turns go in.
	r := &testGame{app: app, game: next, players: map[string]*core.Record{}, stories: map[string]*core.Record{}}
	for _, seat := range seats {
		name := seat.GetString("username")
		r.players[name] = seat
		rec := call(api, http.MethodPost, "/api/collections/stories/records",
			map[string]any{"starter_id": seat.Id, "game_id": next.Id})
		if rec.Code != http.StatusOK {
			t.Fatalf("%s opening their story in the new game: %d %s", name, rec.Code, rec.Body)
		}
		var created struct {
			ID string `json:"id"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil {
			t.Fatal(err)
		}
		if r.stories[name], err = app.FindRecordById("stories", created.ID); err != nil {
			t.Fatal(err)
		}
	}
	for _, name := range []string{"ann", "ben", "dan"} {
		if rec := r.submit(t, api, name, name); rec.Code != http.StatusOK {
			t.Fatalf("%s's opening word in the new game: %d %s", name, rec.Code, rec.Body)
		}
	}
	if owes := r.owes(t, "ben"); !slices.Equal(owes, []string{"ann"}) {
		t.Errorf("in the new game ben owes %v, want ann's story", owes)
	}
}

// Only the host, and only once everyone is done; an untimed game asks for no
// timer, and rounds are at least one.
func TestRematchRules(t *testing.T) {
	app := newTestApp(t)
	api := serveAPI(t, app)
	g := newGame(t, app, "ann", "ben")
	g.play(t, "ann", "ann")
	if rec := g.rematch(api, g.players["ann"], map[string]any{}); rec.Code != http.StatusBadRequest {
		t.Errorf("a rematch mid-game: %d %s, want 400", rec.Code, rec.Body)
	}
	g.playOut(t)
	if rec := g.rematch(api, g.players["ben"], map[string]any{}); rec.Code != http.StatusForbidden {
		t.Errorf("a rematch by a player who isn't the host: %d %s, want 403", rec.Code, rec.Body)
	}
	next := rematchedGame(t, app, g.rematch(api, g.players["ann"], map[string]any{"rounds": 0, "round_duration": 0}))
	if next.GetInt("rounds") != 1 || next.GetInt("roundDuration") != -1 {
		t.Errorf("rounds 0, duration 0 made a game with rounds %d, duration %d; want 1, untimed",
			next.GetInt("rounds"), next.GetInt("roundDuration"))
	}

	// A duration in fractions of a second (an older page's "4.1 minutes") is
	// rounded, not refused.
	f := newGame(t, app, "eve", "fay")
	f.playOut(t)
	if got := rematchedGame(t, app, f.rematch(api, f.players["eve"], map[string]any{
		"round_duration": 245.99999999999997,
	})).GetInt("roundDuration"); got != 246 {
		t.Errorf("a duration of 245.99... seconds made %d, want 246", got)
	}

	// An endless game is done once the host has ended it and time is up.
	e := newGame(t, app, "cat", "dan").withRounds(t, 1, true)
	e.play(t, "cat", "cat")
	if rec := e.rematch(api, e.players["cat"], map[string]any{}); rec.Code != http.StatusBadRequest {
		t.Errorf("a rematch of an endless game nobody ended: %d %s, want 400", rec.Code, rec.Body)
	}
	e.timeUp(t)
	rematchedGame(t, app, e.rematch(api, e.players["cat"], map[string]any{"endless": true}))
}

// A client can't link games or carry a player over itself: those are the
// rematch's.
func TestRematchLinksAreTheServers(t *testing.T) {
	app := newTestApp(t)
	api := serveAPI(t, app)
	g := newLobby(t, app, "ann")
	other := newLobby(t, app, "ben")

	rec := call(api, http.MethodPatch, gamesPath+"/"+g.game.Id, map[string]any{"next_game": other.game.Id})
	if rec.Code != http.StatusOK {
		t.Fatalf("update: %d %s", rec.Code, rec.Body)
	}
	if game, _ := app.FindRecordById("games", g.game.Id); game.GetString("next_game") != "" {
		t.Error("a client linked a game to another")
	}
	rec = call(api, http.MethodPost, "/api/collections/users/records", map[string]any{
		"username": "cat", "game_id": g.game.Id, "from_user": other.players["ben"].Id,
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("join: %d %s", rec.Code, rec.Body)
	}
	if cat, err := app.FindFirstRecordByFilter("users", "username = 'cat'"); err != nil || cat.GetString("from_user") != "" {
		t.Errorf("a join claimed to carry ben over: %v %v", cat, err)
	}
	rec = call(api, http.MethodPatch, "/api/collections/users/records/"+g.players["ann"].Id,
		map[string]any{"from_user": other.players["ben"].Id})
	if rec.Code != http.StatusOK {
		t.Fatalf("rename: %d %s", rec.Code, rec.Body)
	}
	if ann, _ := app.FindRecordById("users", g.players["ann"].Id); ann.GetString("from_user") != "" {
		t.Error("an update made ann carry ben over")
	}
}
