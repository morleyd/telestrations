package game

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/cron"
)

// Expiry (expiry.go): a public server deletes a game keepAfterFinish after
// it's over, keepIdle after anything last happened in it, or, if nobody
// started it, keepIdleLobby after that. The tests run the cleanup at a time in
// the future rather than waiting.

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
		err := app.DB().NewQuery("SELECT COUNT(*) FROM " + col + " WHERE game_id = {:g}").
			Bind(dbx.Params{"g": g.game.Id}).Row(&left)
		if err != nil {
			t.Fatal(err)
		}
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

// A started game still being played isn't finished, however long it's been,
// until it's idle for a week.
func TestAGameInPlayIsKeptUntilAWeekIdle(t *testing.T) {
	app := newTestApp(t)
	endless := newGame(t, app, "ann", "ben").withRounds(t, 1, true)
	endless.play(t, "ann", "ann")
	unfinished := newGame(t, app, "cat", "dan")
	unfinished.play(t, "cat", "cat")

	if n := cleanUp(t, app, later(6*24*time.Hour)); n != 0 {
		t.Fatalf("6 days on: %d deleted", n)
	}
	if n := cleanUp(t, app, later(8*24*time.Hour)); n != 2 {
		t.Fatalf("8 days on: %d deleted, want both", n)
	}
	for _, g := range []*testGame{endless, unfinished} {
		if exists(t, app, "games", g.game.Id) {
			t.Errorf("game %s is still there", g.game.Id)
		}
	}
}

// A player's device checking in is activity: a game everyone still has open
// isn't idle.
func TestPresenceKeepsAGameAlive(t *testing.T) {
	app := newTestApp(t)
	g := newGame(t, app, "ann")
	seenAt(t, app, g, later(6*24*time.Hour))
	if n := cleanUp(t, app, later(8*24*time.Hour)); n != 0 {
		t.Fatalf("seen 2 days before: %d deleted", n)
	}
}

// seenAt records that g's players' devices last checked in at at.
func seenAt(t *testing.T, app core.App, g *testGame, at time.Time) {
	t.Helper()
	_, err := app.DB().NewQuery("UPDATE users SET seen_at = {:t} WHERE game_id = {:g}").
		Bind(dbx.Params{"t": at.UTC().Format("2006-01-02 15:04:05.000Z"), "g": g.game.Id}).Execute()
	if err != nil {
		t.Fatal(err)
	}
}

// A lobby nobody has started is kept an hour, not a week: one address could
// otherwise fill the server's game limit with empty lobbies.
func TestALobbyNobodyStartedIsKeptAnHour(t *testing.T) {
	app := newTestApp(t)
	g := newLobby(t, app, "ann")

	if n := cleanUp(t, app, later(59*time.Minute)); n != 0 || !exists(t, app, "games", g.game.Id) {
		t.Fatalf("59 min on: %d deleted", n)
	}
	if n := cleanUp(t, app, later(61*time.Minute)); n != 1 {
		t.Fatalf("61 min on: %d deleted, want 1", n)
	}
	if exists(t, app, "games", g.game.Id) || rowCount(t, app, "users", g.game.Id) != 0 {
		t.Error("the lobby is still there")
	}
}

// A host whose page is open keeps checking in, so a lobby they're still
// waiting in isn't idle however long they take to start it.
func TestAHostCheckingInKeepsALobby(t *testing.T) {
	app := newTestApp(t)
	g := newLobby(t, app, "ann", "ben")
	seenAt(t, app, g, later(50*time.Minute))

	if n := cleanUp(t, app, later(100*time.Minute)); n != 0 {
		t.Fatalf("50 min after the check-in: %d deleted", n)
	}
	if n := cleanUp(t, app, later(112*time.Minute)); n != 1 {
		t.Fatalf("62 min after the check-in: %d deleted, want 1", n)
	}
}

// The hour is for lobbies only: once the game has begun, it's kept as long as
// any game in play.
func TestAStartedGameIgnoresTheLobbyHour(t *testing.T) {
	app := newTestApp(t)
	g := newGame(t, app, "ann", "ben")
	g.play(t, "ann", "ann")

	if n := cleanUp(t, app, later(3*time.Hour)); n != 0 || !exists(t, app, "games", g.game.Id) {
		t.Fatalf("3 h on: %d deleted", n)
	}
	if n := cleanUp(t, app, later(3*24*time.Hour)); n != 0 {
		t.Fatalf("3 days on: %d deleted", n)
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

// rowCount is how many records of collection belong to gameID.
func rowCount(t *testing.T, app core.App, collection, gameID string) int {
	t.Helper()
	var n int
	err := app.DB().NewQuery("SELECT COUNT(*) FROM " + collection + " WHERE game_id = {:g}").
		Bind(dbx.Params{"g": gameID}).Row(&n)
	if err != nil {
		t.Fatal(err)
	}
	return n
}

// One game that can't be deleted doesn't stop the games after it, and its own
// delete is all or nothing: the turns and stories that go before the failing
// player are put back.
func TestOneUndeletableGameLeavesTheRestToExpire(t *testing.T) {
	app := newTestApp(t)
	// Made first, so the sweep reaches it first.
	stuck := newGame(t, app, "ann", "ben")
	stuck.play(t, "ann", "ann")
	stuck.play(t, "ben", "ben")
	fine := newGame(t, app, "cat", "dan")
	fine.play(t, "cat", "cat")

	app.OnRecordDelete("users").BindFunc(func(e *core.RecordEvent) error {
		if e.Record.GetString("game_id") == stuck.game.Id {
			return errors.New("refused")
		}
		return e.Next()
	})
	before := map[string]int{}
	for _, col := range []string{"turns", "stories", "users"} {
		before[col] = rowCount(t, app, col, stuck.game.Id)
		if before[col] == 0 {
			t.Fatalf("fixture: no %s in the stuck game", col)
		}
	}

	n, err := deleteExpiredGames(app, later(8*24*time.Hour))
	if n != 1 {
		t.Errorf("%d deleted, want 1", n)
	}
	if err == nil || !strings.Contains(err.Error(), stuck.game.Id) || strings.Contains(err.Error(), fine.game.Id) {
		t.Errorf("error %v, want one naming only the stuck game", err)
	}
	if exists(t, app, "games", fine.game.Id) {
		t.Error("the other game didn't expire")
	}
	if !exists(t, app, "games", stuck.game.Id) {
		t.Error("the stuck game was deleted anyway")
	}
	for col, want := range before {
		if got := rowCount(t, app, col, stuck.game.Id); got != want {
			t.Errorf("stuck game's %s: %d left, want %d (rolled back)", col, got, want)
		}
	}
}

// expiryJob is the scheduled expiry sweep, or nil if app has none.
func expiryJob(app core.App) *cron.Job {
	for _, job := range app.Cron().Jobs() {
		if job.Id() == "gameExpiry" {
			return job
		}
	}
	return nil
}

func TestPublicModeSaysHowLongGamesAreKept(t *testing.T) {
	app := newTestApp(t)
	if rec := call(serveAPI(t, app), http.MethodGet, "/api/expiry", nil); rec.Code != http.StatusNotFound {
		t.Errorf("at home: %d, want 404 (nothing expires)", rec.Code)
	}
	if job := expiryJob(app); job != nil {
		t.Errorf("at home: scheduled %q, want no expiry job", job.Expression())
	}

	app = newTestApp(t)
	rec := call(servePublic(t, app, publicMode(false)), http.MethodGet, "/api/expiry", nil)
	// Decoded, not compared as text: Go's JSON encoder doesn't sort map keys.
	var got struct {
		AfterFinishHours int `json:"after_finish_hours"`
		IdleDays         int `json:"idle_days"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &got)
	if rec.Code != http.StatusOK || got.AfterFinishHours != 48 || got.IdleDays != 7 {
		t.Errorf("public: %d %s", rec.Code, rec.Body)
	}
	if job := expiryJob(app); job == nil || job.Expression() != expirySchedule {
		t.Errorf("public: job %v, want gameExpiry on %q", job, expirySchedule)
	}
	if days := app.Settings().Logs.MaxDays; days != logDays {
		t.Errorf("logs kept %d days, want %d", days, logDays)
	}
}
