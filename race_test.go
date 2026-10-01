package main

import (
	"net/http"
	"net/http/httptest"
	"slices"
	"testing"

	"github.com/pocketbase/dbx"
)

// Write races: two requests that touch the same story (or game) fired at the
// same moment, through the real routes and guards, across many fresh games.
// Whichever order they land in, the game must stay whole: one turn per player
// per story, every refusal one the client can act on (see refusal), no story
// left waiting on a dropped player, and seats a clean 0..N-1.

// The same player in two tabs submits the same turn. The guard reads, then
// the insert writes, so both can pass the guard; the unique index on
// (user_id, story_id) is the real arbiter. Either way the loser must read as
// turn_taken, which the client treats as done and moves on.
func TestTwoTabsSubmittingTheSameTurn(t *testing.T) {
	soak(t)
	app := newTestApp(t)
	api := serveAPI(t, app)

	byIndex := 0
	for round := range soakRounds {
		g := newGame(t, app, "ann", "ben")
		word := g.nextTurn(t, "ann", "ann")
		var a, b *httptest.ResponseRecorder
		together(
			func() { a = call(api, http.MethodPost, turnsPath, word) },
			func() { b = call(api, http.MethodPost, turnsPath, word) },
		)
		won, lost := a, b
		if b.Code == http.StatusOK {
			won, lost = b, a
		}
		if won.Code != http.StatusOK || lost.Code != http.StatusBadRequest {
			t.Fatalf("round %d: want one 200 and one 400, got %d and %d (%s)", round, a.Code, b.Code, lost.Body)
		}
		code, index := refusal(lost)
		if code != "turn_taken" {
			t.Fatalf("round %d: the second tab reads as %q, want turn_taken: %s", round, code, lost.Body)
		}
		if index {
			byIndex++
		}
		if n := len(g.turnsBy(t, "ann", "ann")); n != 1 {
			t.Fatalf("round %d: ann has %d turns on her story", round, n)
		}
	}
	t.Logf("%d rounds: the unique index caught %d, the guard the rest", soakRounds, byIndex)
}

// The host skips a player in the same instant the player submits that turn.
// Exactly one of them writes it; the player's refused submit must read as
// skipped or taken, both of which move the client on.
func TestHostSkipRacingTheirSubmit(t *testing.T) {
	soak(t)
	app := newTestApp(t)
	api := serveAPI(t, app)

	hostWon := 0
	for round := range soakRounds {
		g := newGame(t, app, "ann", "ben", "cat")
		g.play(t, "ben", "ben")
		g.play(t, "ann", "ann") // ann's story now waits on ben, and nothing else does
		ann, ben := g.players["ann"], g.players["ben"]
		drawing := g.nextTurn(t, "ann", "ben")

		var skip, submit *httptest.ResponseRecorder
		together(
			func() { skip = g.hostAct(api, "skip", ann, ben) },
			func() { submit = call(api, http.MethodPost, turnsPath, drawing) },
		)
		if skip.Code != http.StatusOK {
			t.Fatalf("round %d: skip: %d %s", round, skip.Code, skip.Body)
		}
		turns := g.turnsBy(t, "ann", "ben")
		if len(turns) != 1 {
			t.Fatalf("round %d: ben has %d turns on ann's story", round, len(turns))
		}
		switch skipped := turns[0].GetBool("skipped"); {
		case submit.Code == http.StatusOK && skipped:
			t.Fatalf("round %d: ben's submit succeeded but his turn is the host's skip", round)
		case submit.Code != http.StatusOK && !skipped:
			t.Fatalf("round %d: ben's submit was refused but his turn isn't a skip", round)
		case submit.Code != http.StatusOK:
			hostWon++
			if code, _ := refusal(submit); code != "turn_skipped" && code != "turn_taken" {
				t.Fatalf("round %d: ben's refused submit reads as %q: %s", round, code, submit.Body)
			}
		}
		if s, _ := loadStory(app, g.stories["ann"].Id); s.Taken != 2 {
			t.Fatalf("round %d: ann's story has %d turns, want 2", round, s.Taken)
		}
	}
	t.Logf("%d rounds: the host's skip won %d", soakRounds, hostWon)
}

// A player's round timer runs out (an empty turn: the server skips it) just
// as they submit. Exactly one turn lands, and whichever request loses reads
// as already taken.
func TestTimeoutRacingTheirSubmit(t *testing.T) {
	soak(t)
	app := newTestApp(t)
	api := serveAPI(t, app)

	timeoutWon := 0
	for round := range soakRounds {
		g := newGame(t, app, "ann", "ben", "cat").timed(t)
		g.play(t, "ben", "ben")
		g.play(t, "ann", "ann")
		ben := g.players["ben"]
		drawing := g.nextTurn(t, "ann", "ben")

		var timeout, submit *httptest.ResponseRecorder
		together(
			func() {
				timeout = call(api, http.MethodPost, "/api/stories/"+g.stories["ann"].Id+"/timeout",
					map[string]any{"user_id": ben.Id})
			},
			func() { submit = call(api, http.MethodPost, turnsPath, drawing) },
		)
		turns := g.turnsBy(t, "ann", "ben")
		if len(turns) != 1 {
			t.Fatalf("round %d: ben has %d turns on ann's story", round, len(turns))
		}
		if (timeout.Code == http.StatusOK) == (submit.Code == http.StatusOK) {
			t.Fatalf("round %d: want exactly one of timeout (%d) and submit (%d) to succeed", round, timeout.Code, submit.Code)
		}
		loser := submit
		if submit.Code == http.StatusOK {
			loser = timeout
		} else {
			timeoutWon++
		}
		if code, _ := refusal(loser); code != "turn_taken" {
			t.Fatalf("round %d: the losing request reads as %q, want turn_taken: %s", round, code, loser.Body)
		}
		if got, want := turns[0].GetBool("timed_out"), timeout.Code == http.StatusOK; got != want {
			t.Fatalf("round %d: ben's turn timed_out=%v, want %v", round, got, want)
		}
	}
	t.Logf("%d rounds: the timeout won %d", soakRounds, timeoutWon)
}

// The host drops a player just as that player writes the opening word of
// their own story. The drop deletes a dropped player's never-opened story,
// so it must not delete one that has just been opened: that would leave the
// word behind as a turn with no story.
func TestDropRacingTheirOpeningWord(t *testing.T) {
	soak(t)
	app := newTestApp(t)
	api := serveAPI(t, app)

	storyKept := 0
	for round := range soakRounds {
		g := newGame(t, app, "ann", "ben", "cat")
		ann, ben := g.players["ann"], g.players["ben"]
		word := g.nextTurn(t, "ben", "ben")

		var drop, submit *httptest.ResponseRecorder
		together(
			func() { drop = g.hostAct(api, "drop", ann, ben) },
			func() { submit = call(api, http.MethodPost, turnsPath, word) },
		)
		if drop.Code != http.StatusOK {
			t.Fatalf("round %d: drop: %d %s", round, drop.Code, drop.Body)
		}
		if orphans := g.orphanTurns(t); orphans > 0 {
			t.Fatalf("round %d: ben's word survived its story's deletion as a turn with no story (submit %d)",
				round, submit.Code)
		}
		_, err := app.FindRecordById("stories", g.stories["ben"].Id)
		storyGone := err != nil
		switch {
		case submit.Code == http.StatusOK && storyGone:
			t.Fatalf("round %d: ben's word was accepted but his story is gone", round)
		case submit.Code != http.StatusOK && !storyGone:
			t.Fatalf("round %d: ben's word was refused but his story is still waiting: %s", round, submit.Body)
		case !storyGone:
			storyKept++
		}
		if owes := g.owes(t, "ben"); len(owes) != 0 {
			t.Fatalf("round %d: stories still waiting on dropped ben: %v", round, owes)
		}
	}
	t.Logf("%d rounds: ben's word landed first in %d (his story stays, skipped from then on)", soakRounds, storyKept)
}

// A late joiner's request lands as the host starts the game. Either they're
// in before the start (and seated) or refused by the roster lock; the seats
// must be a clean 0..N-1 of whoever is in the game.
func TestBeginRacingALateJoin(t *testing.T) {
	soak(t)
	app := newTestApp(t)
	api := serveAPI(t, app)

	joined := 0
	for round := range soakRounds {
		g := newLobby(t, app, "ann", "ben")
		order := []string{g.players["ann"].Id, g.players["ben"].Id}
		var begin, join *httptest.ResponseRecorder
		together(
			func() {
				begin = call(api, http.MethodPost, "/api/games/"+g.game.Id+"/begin", map[string]any{"order": order})
			},
			func() {
				join = call(api, http.MethodPost, "/api/collections/users/records", map[string]any{
					"username": "cat", "game_id": g.game.Id,
				})
			},
		)
		if begin.Code != http.StatusOK {
			t.Fatalf("round %d: begin: %d %s", round, begin.Code, begin.Body)
		}
		want := 2
		if join.Code == http.StatusOK {
			joined++
			want = 3
		}
		if seats := g.seats(t); len(seats) != want || !isPermutation(seats) {
			t.Fatalf("round %d: seats %v, want 0..%d (join %d)", round, seats, want-1, join.Code)
		}
	}
	t.Logf("%d rounds: the late joiner got in first %d times", soakRounds, joined)
}

// A player leaves the lobby (the host removes them) as the host starts the
// game. Either they're gone before the start or the leave is refused; never
// gone from a game that's already seated, which would shift every story's
// rotation.
func TestBeginRacingALeave(t *testing.T) {
	soak(t)
	app := newTestApp(t)
	api := serveAPI(t, app)

	left := 0
	for round := range soakRounds {
		g := newLobby(t, app, "ann", "ben", "cat")
		var begin, leave *httptest.ResponseRecorder
		together(
			func() { begin = call(api, http.MethodPost, "/api/games/"+g.game.Id+"/begin", nil) },
			func() {
				leave = call(api, http.MethodDelete, "/api/collections/users/records/"+g.players["cat"].Id, nil)
			},
		)
		if begin.Code != http.StatusOK {
			t.Fatalf("round %d: begin: %d %s", round, begin.Code, begin.Body)
		}
		want := 3
		if leave.Code == http.StatusNoContent {
			left++
			want = 2
		}
		if seats := g.seats(t); len(seats) != want || !isPermutation(seats) {
			t.Fatalf("round %d: seats %v, want 0..%d (leave %d)", round, seats, want-1, leave.Code)
		}
	}
	t.Logf("%d rounds: the leave got in first %d times", soakRounds, left)
}

// A dropped player's client opens their story (TakeTurn creates it on first
// load) as the host drops them. Either the story exists before the drop's
// snapshot (and the drop deletes it, still empty) or the create is refused;
// a story created after the snapshot would wait on the dropped player for
// good, and nobody would ever finish.
func TestDropRacingTheirStoryCreate(t *testing.T) {
	soak(t)
	app := newTestApp(t)
	api := serveAPI(t, app)

	for round := range soakRounds {
		g := newGame(t, app, "ann", "ben", "cat")
		ann, ben := g.players["ann"], g.players["ben"]
		if err := app.Delete(g.stories["ben"]); err != nil {
			t.Fatal(err)
		}
		var drop, create *httptest.ResponseRecorder
		together(
			func() { drop = g.hostAct(api, "drop", ann, ben) },
			func() {
				create = call(api, http.MethodPost, "/api/collections/stories/records",
					map[string]any{"starter_id": ben.Id, "game_id": g.game.Id})
			},
		)
		if drop.Code != http.StatusOK {
			t.Fatalf("round %d: drop: %d %s", round, drop.Code, drop.Body)
		}
		if owes := g.owes(t, "ben"); len(owes) != 0 {
			t.Fatalf("round %d: stories still waiting on dropped ben: %v (create %d)", round, owes, create.Code)
		}
	}
}

// The host's Begin is double-clicked: two starts race. One wins, the other is
// refused, and the seating is the winner's.
func TestDoubleBegin(t *testing.T) {
	soak(t)
	app := newTestApp(t)
	api := serveAPI(t, app)

	for round := range soakRounds {
		g := newLobby(t, app, "ann", "ben", "cat")
		path := "/api/games/" + g.game.Id + "/begin"
		var a, b *httptest.ResponseRecorder
		together(
			func() { a = call(api, http.MethodPost, path, nil) },
			func() { b = call(api, http.MethodPost, path, nil) },
		)
		codes := []int{a.Code, b.Code}
		slices.Sort(codes)
		if !slices.Equal(codes, []int{http.StatusOK, http.StatusBadRequest}) {
			t.Fatalf("round %d: begin twice: %v, want one 200 and one 400", round, codes)
		}
		if seats := g.seats(t); !isPermutation(seats) || len(seats) != 3 {
			t.Fatalf("round %d: seats %v", round, seats)
		}
	}
}

// Two tabs of the same player open their story at once (TakeTurn creates it
// on first load). The unique (starter_id, game_id) index keeps it to one.
func TestTwoTabsOpeningTheSameStory(t *testing.T) {
	soak(t)
	app := newTestApp(t)
	api := serveAPI(t, app)

	for round := range soakRounds {
		g := newGame(t, app, "ann", "ben")
		if err := app.Delete(g.stories["ann"]); err != nil {
			t.Fatal(err)
		}
		story := map[string]any{"starter_id": g.players["ann"].Id, "game_id": g.game.Id}
		var a, b *httptest.ResponseRecorder
		together(
			func() { a = call(api, http.MethodPost, "/api/collections/stories/records", story) },
			func() { b = call(api, http.MethodPost, "/api/collections/stories/records", story) },
		)
		codes := []int{a.Code, b.Code}
		slices.Sort(codes)
		if !slices.Equal(codes, []int{http.StatusOK, http.StatusBadRequest}) {
			t.Fatalf("round %d: two story creates: %v, want one 200 and one 400", round, codes)
		}
		stories, err := app.FindRecordsByFilter("stories", "starter_id = {:s}", "", 0, 0,
			dbx.Params{"s": g.players["ann"].Id})
		if err != nil {
			t.Fatal(err)
		}
		if len(stories) != 1 {
			t.Fatalf("round %d: ann has %d stories", round, len(stories))
		}
	}
}

// The host drops two neighbours at once while a story is about to reach the
// first. Whichever drop lands first, the story must end up past both: a drop
// sets the flag before taking its snapshot, so the other drop's auto-skip
// always sees it.
func TestTwoDropsAtOnce(t *testing.T) {
	soak(t)
	app := newTestApp(t)
	api := serveAPI(t, app)

	for round := range soakRounds {
		g := newGame(t, app, "ann", "ben", "cat", "dan")
		g.play(t, "ann", "ann") // ann's story now waits on ben, then cat
		ann, ben, cat := g.players["ann"], g.players["ben"], g.players["cat"]

		var dropBen, dropCat *httptest.ResponseRecorder
		together(
			func() { dropBen = g.hostAct(api, "drop", ann, ben) },
			func() { dropCat = g.hostAct(api, "drop", ann, cat) },
		)
		if dropBen.Code != http.StatusOK || dropCat.Code != http.StatusOK {
			t.Fatalf("round %d: drops: %d %s / %d %s", round, dropBen.Code, dropBen.Body, dropCat.Code, dropCat.Body)
		}
		for _, name := range []string{"ben", "cat"} {
			if owes := g.owes(t, name); len(owes) != 0 {
				t.Fatalf("round %d: stories still waiting on dropped %s: %v", round, name, owes)
			}
		}
		g.requireSkippedOnce(t, "ben", "ann")
		g.requireSkippedOnce(t, "cat", "ann")
		if s, _ := loadStory(app, g.stories["ann"].Id); s.NextUser != g.players["dan"].Id {
			t.Fatalf("round %d: ann's story waits on %s, want dan", round, g.name(s.NextUser))
		}
	}
}
