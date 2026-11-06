package game

import (
	"net/http"
	"testing"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// Expiry (expiry.go): a public server deletes a game keepAfterFinish after
// it's over, or keepIdle after anything last happened in it. The tests run the
// cleanup at a time in the future rather than waiting.

func later(d time.Duration) time.Time { return time.Now().Add(d) }

func exists(t *testing.T, app core.App, collection, id string) bool {
	t.Helper()
	_, err := app.FindRecordById(collection, id)
	return err == nil
}

func cleanUp(t *testing.T, app core.App, at time.Time) int {
	t.Helper()
	n, err := deleteExpiredGames(app, at)
	if err != nil {
		t.Fatal(err)
	}
	return n
}

// finishedGame is ann and ben's game, every story all the way round.
func finishedGame(t *testing.T, app core.App) *testGame {
	t.Helper()
	g := newGame(t, app, "ann", "ben")
	g.play(t, "ann", "ann")
	g.play(t, "ben", "ben")
	g.play(t, "ann", "ben")
	g.play(t, "ben", "ann")
	if _, finished, err := finishedAt(app, g.game.Id); err != nil || !finished {
		t.Fatalf("fixture: game not finished (%v)", err)
	}
	return g
}

func TestAFinishedGameIsKept48Hours(t *testing.T) {
	app := newTestApp(t)
	g := finishedGame(t, app)

	if n := cleanUp(t, app, later(47*time.Hour)); n != 0 || !exists(t, app, "games", g.game.Id) {
		t.Fatalf("47 h after: %d deleted", n)
	}
	if n := cleanUp(t, app, later(49*time.Hour)); n != 1 {
		t.Fatalf("49 h after: %d deleted, want 1", n)
	}
	for _, col := range []string{"turns", "stories", "users"} {
		var left int
		_ = app.DB().NewQuery("SELECT COUNT(*) FROM " + col + " WHERE game_id = {:g}").
			Bind(dbx.Params{"g": g.game.Id}).Row(&left)
		if left != 0 {
			t.Errorf("%d %s left", left, col)
		}
	}
	if exists(t, app, "games", g.game.Id) {
		t.Error("the game is still there")
	}
}

func TestAnEndedGameIsKept48HoursFromItsDeadline(t *testing.T) {
	app := newTestApp(t)
	g := newGame(t, app, "ann", "ben").withRounds(t, 1, true)
	g.play(t, "ann", "ann")
	g.endedAgo(t, time.Minute)

	if n := cleanUp(t, app, later(47*time.Hour)); n != 0 {
		t.Fatalf("47 h after: %d deleted", n)
	}
	if n := cleanUp(t, app, later(49*time.Hour)); n != 1 {
		t.Fatalf("49 h after: %d deleted, want 1", n)
	}
}

// A game still being played isn't finished, however long it's been, until
// it's idle for a week.
func TestAGameInPlayIsKeptUntilAWeekIdle(t *testing.T) {
	app := newTestApp(t)
	endless := newGame(t, app, "ann", "ben").withRounds(t, 1, true)
	endless.play(t, "ann", "ann")
	unfinished := newGame(t, app, "cat", "dan")
	unfinished.play(t, "cat", "cat")
	lobby := newLobby(t, app, "eve")

	if n := cleanUp(t, app, later(6*24*time.Hour)); n != 0 {
		t.Fatalf("6 days on: %d deleted", n)
	}
	if n := cleanUp(t, app, later(8*24*time.Hour)); n != 3 {
		t.Fatalf("8 days on: %d deleted, want all 3", n)
	}
	for _, g := range []*testGame{endless, unfinished, lobby} {
		if exists(t, app, "games", g.game.Id) {
			t.Errorf("game %s is still there", g.game.Id)
		}
	}
}

// A player's device checking in is activity: a game everyone still has open
// isn't idle.
func TestPresenceKeepsAGameAlive(t *testing.T) {
	app := newTestApp(t)
	g := newLobby(t, app, "ann")
	soon := time.Now().Add(6 * 24 * time.Hour).UTC().Format("2006-01-02 15:04:05.000Z")
	_, err := app.DB().NewQuery("UPDATE users SET seen_at = {:t} WHERE game_id = {:g}").
		Bind(dbx.Params{"t": soon, "g": g.game.Id}).Execute()
	if err != nil {
		t.Fatal(err)
	}
	if n := cleanUp(t, app, later(8*24*time.Hour)); n != 0 {
		t.Fatalf("seen 2 days before: %d deleted", n)
	}
}

func TestExpiryDeletesTheDrawings(t *testing.T) {
	app := newTestApp(t)
	g := newGame(t, app, "ann", "ben")
	g.play(t, "ann", "ann")
	turn := g.drawWithFile(t, "ann", "ben")
	key := turn.BaseFilesPath() + "/" + turn.GetString("drawing")
	fsys, err := app.NewFilesystem()
	if err != nil {
		t.Fatal(err)
	}
	defer fsys.Close()
	if ok, _ := fsys.Exists(key); !ok {
		t.Fatal("fixture: no drawing stored")
	}

	cleanUp(t, app, later(8*24*time.Hour))
	// PocketBase deletes a record's files in the background once the delete
	// succeeds.
	for deadline := time.Now().Add(5 * time.Second); ; time.Sleep(50 * time.Millisecond) {
		if ok, _ := fsys.Exists(key); !ok {
			return
		}
		if time.Now().After(deadline) {
			t.Fatal("the drawing outlived its game")
		}
	}
}

// Play again links the games; deleting one leaves the other whole.
func TestExpiryLeavesAPlayedAgainGameWhole(t *testing.T) {
	app := newTestApp(t)
	api := serveAPI(t, app)
	g := finishedGame(t, app)
	next := rematchedGame(t, app, g.rematch(api, g.players["ann"], map[string]any{}))

	// Keep the new game busy, so only the old one is past keeping.
	busy := time.Now().Add(49 * time.Hour).UTC().Format("2006-01-02 15:04:05.000Z")
	_, err := app.DB().NewQuery("UPDATE users SET seen_at = {:t} WHERE game_id = {:g}").
		Bind(dbx.Params{"t": busy, "g": next.Id}).Execute()
	if err != nil {
		t.Fatal(err)
	}
	if n := cleanUp(t, app, later(49*time.Hour)); n != 1 {
		t.Fatalf("%d deleted, want the old game only", n)
	}
	if exists(t, app, "games", g.game.Id) || !exists(t, app, "games", next.Id) {
		t.Fatal("wrong game deleted")
	}
	seats, err := app.FindRecordsByFilter("users", "game_id = {:g}", "", 0, 0, dbx.Params{"g": next.Id})
	if err != nil || len(seats) != 2 {
		t.Fatalf("the new game's players: %d (%v)", len(seats), err)
	}
}

func TestPublicModeSaysHowLongGamesAreKept(t *testing.T) {
	app := newTestApp(t)
	if rec := call(serveAPI(t, app), http.MethodGet, "/api/expiry", nil); rec.Code != http.StatusNotFound {
		t.Errorf("at home: %d, want 404 (nothing expires)", rec.Code)
	}

	app = newTestApp(t)
	rec := call(servePublic(t, app, publicMode(false)), http.MethodGet, "/api/expiry", nil)
	if rec.Code != http.StatusOK || rec.Body.String() != `{"after_finish_hours":48,"idle_days":7}` {
		t.Errorf("public: %d %s", rec.Code, rec.Body)
	}
	if days := app.Settings().Logs.MaxDays; days != logDays {
		t.Errorf("logs kept %d days, want %d", days, logDays)
	}
}
