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

// turnCount is a player's turns as the waiting list's Players view counts
// them: taken, how many of those were skipped, and of how many in all (-1 for
// none: an endless game).
type turnCount struct{ turns, skipped, total int }

func (g *testGame) requireTurnCounts(t *testing.T, api http.Handler, wants map[string]turnCount) {
	t.Helper()
	got := g.status(t, api)
	for name, w := range wants {
		p := got[name]
		have := turnCount{p.Turns, p.Skipped, -1}
		if p.TotalTurns != nil {
			have.total = *p.TotalTurns
		}
		if have != w {
			t.Errorf("%s: %+v, want %+v", name, have, w)
		}
	}
}

// A skipped turn is one written for the player: the host skipped them, or
// their timer ran out with nothing entered. Partial work at the timer is
// their own turn.
func TestPlayersCountTheirSkippedTurns(t *testing.T) {
	app := newTestApp(t)
	api := serveAPI(t, app)
	g := newGame(t, app, "ann", "ben", "cat", "dan").timed(t)
	for _, name := range []string{"ann", "ben", "cat", "dan"} {
		g.play(t, name, name)
	}
	if rec := g.timeout(api, "ann", "ben"); rec.Code != http.StatusOK {
		t.Fatalf("ben's timeout: %d %s", rec.Code, rec.Body)
	}
	if rec := g.hostAct(api, "skip", g.players["ann"], g.players["dan"]); rec.Code != http.StatusOK {
		t.Fatalf("skip dan: %d %s", rec.Code, rec.Body)
	}
	partial := g.nextTurn(t, "ben", "cat")
	partial["timed_out"] = true
	if rec := call(api, http.MethodPost, turnsPath, partial); rec.Code != http.StatusOK {
		t.Fatalf("cat's partial work: %d %s", rec.Code, rec.Body)
	}
	g.requireTurnCounts(t, api, map[string]turnCount{
		"ann": {turns: 1, skipped: 0, total: 4},
		"ben": {turns: 2, skipped: 1, total: 4},
		"cat": {turns: 2, skipped: 0, total: 4},
		"dan": {turns: 2, skipped: 1, total: 4},
	})
}

// Each player's total is a turn a round on every story, those still to be
// opened too, so it doesn't grow as the slowest players arrive. A dropped
// player's unopened story never will be, and every turn that reaches them
// is skipped. An endless game has no total.
func TestPlayersTotalTurns(t *testing.T) {
	app := newTestApp(t)
	api := serveAPI(t, app)

	g := newGame(t, app, "ann", "ben", "cat").withRounds(t, 2, false)
	if err := app.Delete(g.stories["cat"]); err != nil {
		t.Fatal(err)
	}
	delete(g.stories, "cat")
	g.requireTurnCounts(t, api, map[string]turnCount{
		"ann": {turns: 0, skipped: 0, total: 6},
		"cat": {turns: 0, skipped: 0, total: 6},
	})

	if rec := g.hostAct(api, "drop", g.players["ann"], g.players["cat"]); rec.Code != http.StatusOK {
		t.Fatalf("drop: %d %s", rec.Code, rec.Body)
	}
	g.play(t, "ann", "ann")
	g.play(t, "ann", "ben") // and on to cat: skipped
	g.requireTurnCounts(t, api, map[string]turnCount{
		"ann": {turns: 1, skipped: 0, total: 4},
		"ben": {turns: 1, skipped: 0, total: 4},
		"cat": {turns: 1, skipped: 1, total: 4},
	})

	endless := newGame(t, app, "ann", "ben").withRounds(t, 1, true)
	endless.play(t, "ann", "ann")
	endless.requireTurnCounts(t, api, map[string]turnCount{
		"ann": {turns: 1, skipped: 0, total: -1},
		"ben": {turns: 0, skipped: 0, total: -1},
	})
}
