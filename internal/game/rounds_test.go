package game

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/security"
)

// Rounds, endless games and End Game (internal/migrations/1784300000_rounds): each
// story goes round the table once a round, or until the host ends the game,
// and End Game gives everyone endCountdown to finish the turn they're on.

const gamesPath = "/api/collections/games/records"

// A new game always goes round at least once, and a client can't create one
// already started or already ending.
func TestNewGameSettings(t *testing.T) {
	app := newTestApp(t)
	api := serveAPI(t, app)
	for _, c := range []struct {
		name       string
		body       map[string]any
		rounds     int
		endless    bool
		dropFields bool
	}{
		{"no rounds (an older page)", map[string]any{}, 1, false, false},
		{"zero rounds", map[string]any{"rounds": 0}, 1, false, false},
		{"negative rounds", map[string]any{"rounds": -3}, 1, false, false},
		{"three rounds", map[string]any{"rounds": 3}, 3, false, false},
		{"endless", map[string]any{"rounds": 1, "endless": true}, 1, true, false},
		{"started and ending", map[string]any{"rounds": 2, "isStarted": true, "ends_at": time.Now()}, 2, false, true},
	} {
		t.Run(c.name, func(t *testing.T) {
			c.body["game_code"] = security.RandomString(8)
			c.body["roundDuration"] = -1
			rec := call(api, http.MethodPost, gamesPath, c.body)
			if rec.Code != http.StatusOK {
				t.Fatalf("create: %d %s", rec.Code, rec.Body)
			}
			var created struct {
				ID string `json:"id"`
			}
			if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil {
				t.Fatal(err)
			}
			game, err := app.FindRecordById("games", created.ID)
			if err != nil {
				t.Fatal(err)
			}
			if game.GetInt("rounds") != c.rounds || game.GetBool("endless") != c.endless {
				t.Errorf("rounds %d, endless %v; want %d, %v",
					game.GetInt("rounds"), game.GetBool("endless"), c.rounds, c.endless)
			}
			if game.GetBool("isStarted") || !game.GetDateTime("ends_at").IsZero() {
				t.Errorf("a client created a game started %v, ending at %q",
					game.GetBool("isStarted"), game.GetString("ends_at"))
			}
		})
	}
}

// Once created, a game's settings are fixed, and only the server starts or
// ends it.
func TestGameSettingsLockedAfterCreate(t *testing.T) {
	app := newTestApp(t)
	api := serveAPI(t, app)
	g := newLobby(t, app, "ann", "ben").withRounds(t, 2, false)
	rec := call(api, http.MethodPatch, gamesPath+"/"+g.game.Id, map[string]any{
		"rounds": 5, "endless": true, "isStarted": true, "ends_at": time.Now(), "roundDuration": 30,
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("update: %d %s", rec.Code, rec.Body)
	}
	game, err := app.FindRecordById("games", g.game.Id)
	if err != nil {
		t.Fatal(err)
	}
	if game.GetInt("rounds") != 2 || game.GetBool("endless") || game.GetBool("isStarted") ||
		!game.GetDateTime("ends_at").IsZero() || game.GetInt("roundDuration") != -1 {
		t.Errorf("a client update changed the game: rounds %d, endless %v, started %v, ends_at %q, duration %d",
			game.GetInt("rounds"), game.GetBool("endless"), game.GetBool("isStarted"),
			game.GetString("ends_at"), game.GetInt("roundDuration"))
	}
}

// With two rounds the story comes back to each player, so "already took this
// turn" is about the place in the story, not the player: a page still showing
// last round's turn is refused with the code that moves it on, and the turn
// that's really due is accepted.
func TestLastRoundsTurnIsNotThisRounds(t *testing.T) {
	app := newTestApp(t)
	api := serveAPI(t, app)
	g := newGame(t, app, "ann", "ben").withRounds(t, 2, false)
	g.play(t, "ann", "ann") // 0
	g.play(t, "ann", "ben") // 1; round two: back to ann

	word := g.turn("ann", "ann", false)
	word["turn_index"] = 0
	rec := call(api, http.MethodPost, turnsPath, word)
	if code, _ := refusal(rec); code != codeTurnTaken {
		t.Fatalf("ann resending her opening word: %d %s, want %s", rec.Code, rec.Body, codeTurnTaken)
	}
	if s, _ := loadStory(app, g.stories["ann"].Id); s.Taken != 2 {
		t.Fatalf("ann's story has %d turns after the refused resend, want 2", s.Taken)
	}

	// The host skips ann's round-two turn; her page, still on it, submits.
	if rec := g.hostAct(api, "skip", g.players["ann"], g.players["ann"]); rec.Code != http.StatusOK {
		t.Fatalf("skip: %d %s", rec.Code, rec.Body)
	}
	late := g.turn("ann", "ann", false)
	late["turn_index"] = 2
	if code, _ := refusal(call(api, http.MethodPost, turnsPath, late)); code != codeTurnSkipped {
		t.Errorf("ann's submit of the turn the host skipped: refused as %q, want %s", code, codeTurnSkipped)
	}

	// The turn that's due, from a current page and from an older one (no index).
	if rec := g.submit(t, api, "ann", "ben"); rec.Code != http.StatusOK {
		t.Fatalf("ben's round-two turn: %d %s", rec.Code, rec.Body)
	}
	old := g.nextTurn(t, "ben", "ben")
	delete(old, "turn_index")
	if rec := call(api, http.MethodPost, turnsPath, old); rec.Code != http.StatusOK {
		t.Fatalf("ben's word from a page that sends no index: %d %s", rec.Code, rec.Body)
	}
	if got := g.lastTurnBy(t, "ann", "ben").GetInt("turn_index"); got != 3 {
		t.Errorf("ben's round-two turn on ann's story is numbered %d, want 3", got)
	}
}

// A player is finished after their turn on every story in every round; in an
// endless game, only once the host has ended it and time is up.
func TestPlayersFinishAfterEveryRound(t *testing.T) {
	app := newTestApp(t)
	api := serveAPI(t, app)
	g := newGame(t, app, "ann", "ben").withRounds(t, 2, false)
	playRound := func(k int) {
		t.Helper()
		g.play(t, "ann", []string{"ann", "ben"}[k%2])
		g.play(t, "ben", []string{"ben", "ann"}[k%2])
	}
	playRound(0)
	playRound(1)
	g.requireStatus(t, api, map[string]want{
		"ann": {finished: false, owes: 1, turns: 2, hasStory: true},
		"ben": {finished: false, owes: 1, turns: 2, hasStory: true},
	})
	playRound(2)
	playRound(3)
	g.requireStatus(t, api, map[string]want{
		"ann": {finished: true, owes: 0, turns: 4, hasStory: true},
		"ben": {finished: true, owes: 0, turns: 4, hasStory: true},
	})

	e := newGame(t, app, "cat", "dan").withRounds(t, 1, true)
	for k := range 6 {
		e.play(t, "cat", []string{"cat", "dan"}[k%2])
	}
	if e.status(t, api)["cat"].Finished {
		t.Error("cat is finished in an endless game nobody ended")
	}
	if rec := e.end(api, e.players["cat"]); rec.Code != http.StatusOK {
		t.Fatalf("end: %d %s", rec.Code, rec.Body)
	}
	if e.status(t, api)["cat"].Finished {
		t.Error("cat is finished before the end countdown ran out")
	}
	e.timeUp(t)
	e.requireStatus(t, api, map[string]want{
		"cat": {finished: true, owes: 0, turns: 3, hasStory: true},
		"dan": {finished: true, owes: 0, turns: 3, hasStory: true},
	})
}

// End Game: only the host, once the game has started; the deadline is
// endCountdown away and a second End keeps it. Until it (and its grace) has
// passed, players can finish their turns; after, every write is refused as
// game_over and nobody owes anything.
func TestEndGame(t *testing.T) {
	app := newTestApp(t)
	api := serveAPI(t, app)

	lobby := newLobby(t, app, "ann", "ben")
	if rec := lobby.end(api, lobby.players["ann"]); rec.Code != http.StatusBadRequest {
		t.Errorf("ending a game that hasn't started: %d %s", rec.Code, rec.Body)
	}

	g := newGame(t, app, "ann", "ben", "cat").withRounds(t, 1, true)
	g.play(t, "ann", "ann")
	g.play(t, "ben", "ben")
	if rec := g.end(api, g.players["ben"]); rec.Code != http.StatusForbidden {
		t.Errorf("a player who isn't the host ending the game: %d %s", rec.Code, rec.Body)
	}

	before := time.Now()
	rec := g.end(api, g.players["ann"])
	if rec.Code != http.StatusOK {
		t.Fatalf("end: %d %s", rec.Code, rec.Body)
	}
	game, err := app.FindRecordById("games", g.game.Id)
	if err != nil {
		t.Fatal(err)
	}
	endsAt := game.GetDateTime("ends_at").Time()
	if d := endsAt.Sub(before); d < endCountdown-time.Second || d > endCountdown+time.Second {
		t.Errorf("ends_at is %v after End, want about %v", d, endCountdown)
	}
	if rec := g.end(api, g.players["ann"]); rec.Code != http.StatusOK {
		t.Fatalf("second end: %d %s", rec.Code, rec.Body)
	}
	if again, _ := app.FindRecordById("games", g.game.Id); !again.GetDateTime("ends_at").Time().Equal(endsAt) {
		t.Errorf("a second End moved the deadline from %v to %v", endsAt, again.GetDateTime("ends_at"))
	}

	// The countdown: the turn on screen still goes in.
	if rec := g.submit(t, api, "ann", "ben"); rec.Code != http.StatusOK {
		t.Fatalf("ben finishing his turn during the countdown: %d %s", rec.Code, rec.Body)
	}

	g.timeUp(t)
	g.timed(t) // so the timeout below is refused for the game being over, not untimed
	turn := g.turn("ann", "cat", false)
	turn["turn_index"] = 2
	for what, rec := range map[string]*httptest.ResponseRecorder{
		"a turn":    call(api, http.MethodPost, turnsPath, turn),
		"a timeout": g.timeout(api, "ann", "cat"),
		"opening a story": call(api, http.MethodPost, "/api/collections/stories/records",
			map[string]any{"starter_id": g.players["cat"].Id, "game_id": g.game.Id}),
	} {
		if code, _ := refusal(rec); code != codeGameOver {
			t.Errorf("%s after the game is over: %d %s, want %s", what, rec.Code, rec.Body, codeGameOver)
		}
	}
	if rec := g.hostAct(api, "skip", g.players["ann"], g.players["cat"]); rec.Code != http.StatusOK ||
		skippedCount(t, rec) != 0 {
		t.Errorf("skipping cat after the game is over: %d %s, want nothing skipped", rec.Code, rec.Body)
	}
	for name, p := range g.status(t, api) {
		if !p.Finished || p.Owes != 0 {
			t.Errorf("%s after the game is over: finished %v, owes %d", name, p.Finished, p.Owes)
		}
	}
}

// The grace after End Game's deadline is written twice: in the progress view,
// which the rotation and the turn guard read, and in gameOver here, which
// decides who's finished and guards new stories. The view's copy is stored in
// the database by its migration, so nothing shared keeps them together; this
// checks they agree just inside the grace and just past it.
func TestEndGameGraceIsTheSameInTheViewAndTheGuards(t *testing.T) {
	app := newTestApp(t)
	g := newGame(t, app, "ann", "ben").withRounds(t, 1, true)
	g.play(t, "ann", "ann")
	for _, c := range []struct {
		ago  time.Duration
		over bool
	}{
		{3 * time.Second, false},
		{7 * time.Second, true},
	} {
		g.endedAgo(t, c.ago)
		s, err := loadStory(app, g.stories["ann"].Id)
		if err != nil {
			t.Fatal(err)
		}
		if over := gameOver(app, g.game.Id); s.GameOver != c.over || over != c.over {
			t.Errorf("deadline %v ago: the view says over %v, gameOver %v; want %v", c.ago, s.GameOver, over, c.over)
		}
		if waiting := s.NextUser != ""; waiting == c.over {
			t.Errorf("deadline %v ago: the story waits on someone: %v, want %v", c.ago, waiting, !c.over)
		}
	}
}

// The upgrade a running server goes through: a game in progress when the
// rounds migration runs keeps its turns, numbered in the order they were
// written, is a one-round game, and plays on.
func TestRoundsMigrationUpgradesAGameInProgress(t *testing.T) {
	app := newTestApp(t)
	runner := core.NewMigrationsRunner(app, core.AppMigrations)
	revertThrough(t, app, "1784300000_rounds.go")
	if hasField(t, app, "turns", "turn_index") || hasField(t, app, "games", "rounds") {
		t.Fatal("the pre-rounds schema already has the rounds fields")
	}
	g := newGame(t, app, "ann", "ben", "cat")
	// (g.play needs the current views, so these are written directly.)
	save(t, app, "turns", g.turn("ann", "ann", false))
	save(t, app, "turns", g.turn("ann", "ben", true))
	save(t, app, "turns", g.turn("ben", "ben", false))

	if _, err := runner.Up(); err != nil {
		t.Fatal(err)
	}
	var indexes []struct {
		User  string `db:"user_id"`
		Index int    `db:"turn_index"`
	}
	if err := app.DB().NewQuery("SELECT user_id, turn_index FROM turns WHERE story_id = {:s} ORDER BY rowid").
		Bind(dbx.Params{"s": g.stories["ann"].Id}).All(&indexes); err != nil {
		t.Fatal(err)
	}
	if len(indexes) != 2 || indexes[0].Index != 0 || indexes[1].Index != 1 {
		t.Fatalf("ann's story's turns after the upgrade: %+v, want numbered 0 and 1", indexes)
	}
	game, err := app.FindRecordById("games", g.game.Id)
	if err != nil {
		t.Fatal(err)
	}
	if game.GetInt("rounds") != 1 || game.GetBool("endless") {
		t.Errorf("the game in progress has rounds %d, endless %v; want one round",
			game.GetInt("rounds"), game.GetBool("endless"))
	}
	s, err := loadStory(app, g.stories["ann"].Id)
	if err != nil {
		t.Fatal(err)
	}
	if s.NextUser != g.players["cat"].Id || s.TotalTurns != 3 {
		t.Fatalf("ann's story after the upgrade: %+v, want 3 turns in all, waiting on cat", s)
	}
	g.play(t, "ann", "cat")
	g.play(t, "ben", "cat")
	if s, _ := loadStory(app, g.stories["ann"].Id); s.NextUser != "" || s.Taken != 3 {
		t.Errorf("ann's story should be done after the upgrade: %+v", s)
	}
	requireRoundsPlay(t, app, serveAPI(t, app))
}

// requireRoundsPlay starts a three-player, two-round game on app and plays it
// to the end through the real routes: every player takes a turn on every story
// twice, and everyone finishes. The tests that upgrade or re-apply the schema
// end with it: a schema can look right and still refuse a player's second
// turn on a story, which is how round two once never started on an upgraded
// server (see TestALeftoverOneTurnPerPlayerIndexIsDropped).
// api is app's (see serveAPI), which can only be built once per app.
func requireRoundsPlay(t *testing.T, app core.App, api http.Handler) {
	t.Helper()
	g := newGame(t, app, "xia", "yon", "zed").withRounds(t, 2, false)
	for played := true; played; {
		played = false
		for starter := range g.stories {
			s, err := loadStory(app, g.stories[starter].Id)
			if err != nil {
				t.Fatal(err)
			}
			if s.NextUser == "" {
				continue
			}
			name := g.name(s.NextUser)
			if rec := g.submit(t, api, starter, name); rec.Code != http.StatusOK {
				t.Fatalf("a two-round game: %s's turn %d on %s's story: %d %s", name, s.Taken, starter, rec.Code, rec.Body)
			}
			played = true
		}
	}
	for starter, story := range g.stories {
		if s, err := loadStory(app, story.Id); err != nil || s.Taken != 6 {
			t.Errorf("a two-round game: %s's story ended with %d turns, want 6 (%v)", starter, s.Taken, err)
		}
	}
	for name, p := range g.status(t, api) {
		if !p.Finished {
			t.Errorf("a two-round game is over but %s isn't finished: %+v", name, p)
		}
	}
}

// A database that ran an early draft of the host-controls migration still had
// turns unique by player and story, as idx_turns_story_user, a name the rounds
// migration didn't know. It refused every turn after a player's first on a
// story: round two never started, and a one-player game stuck at its first
// drawing. The 1784500000 migration drops it, whatever it's called.
func TestALeftoverOneTurnPerPlayerIndexIsDropped(t *testing.T) {
	app := newTestApp(t)
	revertThrough(t, app, "1784500000_turns_per_player.go")
	turns, err := app.FindCollectionByNameOrId("turns")
	if err != nil {
		t.Fatal(err)
	}
	turns.AddIndex("idx_turns_story_user", true, "story_id, user_id", "")
	if err := app.Save(turns); err != nil {
		t.Fatal(err)
	}
	g := newGame(t, app, "ann").withRounds(t, 1, true)
	g.play(t, "ann", "ann")
	if err := app.Save(func() *core.Record {
		r := core.NewRecord(turns)
		r.Load(g.nextTurn(t, "ann", "ann"))
		return r
	}()); err == nil {
		t.Fatal("the leftover index didn't refuse ann's drawing: this test no longer reproduces the bug")
	}

	if _, err := core.NewMigrationsRunner(app, core.AppMigrations).Up(); err != nil {
		t.Fatal(err)
	}
	turns, err = app.FindCollectionByNameOrId("turns")
	if err != nil {
		t.Fatal(err)
	}
	if turns.GetIndex("idx_turns_story_user") != "" {
		t.Error("the leftover index is still there")
	}
	if turns.GetIndex("idx_turns_story_index") == "" {
		t.Error("the migration dropped the place-in-story index too")
	}
	api := serveAPI(t, app)
	for range 3 { // her drawing, guess and drawing on her own story
		if rec := g.submit(t, api, "ann", "ann"); rec.Code != http.StatusOK {
			t.Fatalf("ann's next turn on her own story: %d %s", rec.Code, rec.Body)
		}
	}
	requireRoundsPlay(t, app, api)
}
