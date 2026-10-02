package game

import (
	"encoding/json"
	"net/http"
	"testing"
)

// GET /api/games/{id}/players, as TakeTurn reads it after every turn: a
// player who reads `finished` is sent to the review, and Manage players
// shows `owes`. Sending someone to the review early cuts the stories short
// for everyone behind them, so these pin when a player counts as done.

// players reads the endpoint the way the client does, keyed by username.
func (g *testGame) status(t *testing.T, api http.Handler) map[string]playerStatus {
	t.Helper()
	rec := call(api, http.MethodGet, "/api/games/"+g.game.Id+"/players", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("players: %d %s", rec.Code, rec.Body)
	}
	var body struct {
		Players []playerStatus `json:"players"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	out := map[string]playerStatus{}
	for _, p := range body.Players {
		out[p.Username] = p
	}
	return out
}

// want is the part of a player's status a case checks.
type want struct {
	finished bool
	owes     int
	turns    int
	hasStory bool
}

func (g *testGame) requireStatus(t *testing.T, api http.Handler, wants map[string]want) {
	t.Helper()
	got := g.status(t, api)
	for name, w := range wants {
		p := got[name]
		if have := (want{p.Finished, p.Owes, p.Turns, p.HasStory}); have != w {
			t.Errorf("%s: %+v, want %+v", name, have, w)
		}
	}
}

// The fast player: ann has a turn on every story that exists, but ben hasn't
// opened his yet. She mustn't be finished, or she'd leave for the review
// before ben's story ever reaches her.
func TestPlayersNotFinishedUntilEveryStoryIsOpen(t *testing.T) {
	app := newTestApp(t)
	api := serveAPI(t, app)
	g := newGame(t, app, "ann", "ben")
	if err := app.Delete(g.stories["ben"]); err != nil {
		t.Fatal(err)
	}
	delete(g.stories, "ben")

	g.play(t, "ann", "ann")
	g.requireStatus(t, api, map[string]want{
		"ann": {finished: false, owes: 0, turns: 1, hasStory: true},
		"ben": {finished: false, owes: 1, turns: 0, hasStory: false},
	})

	// ben opens his story and catches up on ann's: he's done, she isn't.
	g.stories["ben"] = save(t, app, "stories", map[string]any{"starter_id": g.players["ben"].Id, "game_id": g.game.Id})
	g.play(t, "ben", "ben")
	g.play(t, "ann", "ben")
	g.requireStatus(t, api, map[string]want{
		"ann": {finished: false, owes: 1, turns: 1, hasStory: true},
		"ben": {finished: true, owes: 0, turns: 2, hasStory: true},
	})

	g.play(t, "ben", "ann")
	g.requireStatus(t, api, map[string]want{
		"ann": {finished: true, owes: 0, turns: 2, hasStory: true},
		"ben": {finished: true, owes: 0, turns: 2, hasStory: true},
	})
}

// owes counts every story waiting on a player, which is what the host's
// Skip acts on.
func TestPlayersOwesCountsEveryWaitingStory(t *testing.T) {
	app := newTestApp(t)
	api := serveAPI(t, app)
	g := danOwesThree(t, app)
	g.requireStatus(t, api, map[string]want{
		"dan": {finished: false, owes: 3, turns: 1, hasStory: true},
		"ann": {finished: false, owes: 1, turns: 1, hasStory: true}, // dan's story
	})
}

// A dropped player is done at once, their unopened story goes, and the
// others finish without them: their own turns plus the skips written for
// the dropped player complete every story.
func TestPlayersFinishWithoutADroppedPlayer(t *testing.T) {
	app := newTestApp(t)
	api := serveAPI(t, app)
	g := newGame(t, app, "ann", "ben", "cat")
	if rec := g.hostAct(api, "drop", g.players["ann"], g.players["cat"]); rec.Code != http.StatusOK {
		t.Fatalf("drop: %d %s", rec.Code, rec.Body)
	}
	g.requireStatus(t, api, map[string]want{
		"cat": {finished: true, owes: 0, turns: 0, hasStory: false},
		"ann": {finished: false, owes: 1, turns: 0, hasStory: true},
	})
	if got := g.status(t, api)["cat"]; !got.Dropped {
		t.Error("cat isn't reported dropped")
	}

	g.play(t, "ann", "ann")
	g.play(t, "ben", "ben") // passes to cat: skipped, on to ann
	g.play(t, "ann", "ben") // passes to cat: skipped, story done
	g.play(t, "ben", "ann") // done
	g.requireStatus(t, api, map[string]want{
		"ann": {finished: true, owes: 0, turns: 2, hasStory: true},
		"ben": {finished: true, owes: 0, turns: 2, hasStory: true},
		"cat": {finished: true, owes: 0, turns: 2, hasStory: false},
	})
}
