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
	"github.com/pocketbase/pocketbase/tools/types"
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

// The waiting room reports in every few minutes, so a lobby people are still
// waiting in isn't idle however long they take to start it.
func TestAHostCheckingInKeepsALobby(t *testing.T) {
	app := newTestApp(t)
	api := serveAPI(t, app)
	g := newLobby(t, app, "ann", "ben")
	// Everything in the lobby happened two hours ago...
	old := later(-2 * time.Hour).UTC().Format("2006-01-02 15:04:05.000Z")
	for _, q := range []string{
		"UPDATE games SET created = {:t}, updated = {:t} WHERE id = {:g}",
		"UPDATE users SET created = {:t}, updated = {:t} WHERE game_id = {:g}",
	} {
		if _, err := app.DB().NewQuery(q).Bind(dbx.Params{"t": old, "g": g.game.Id}).Execute(); err != nil {
			t.Fatal(err)
		}
	}
	// ...but the host's waiting-room page reports in, as it does every few minutes.
	if code := g.presence(api, "ann", ""); code != http.StatusNoContent {
		t.Fatalf("presence in the lobby: %d", code)
	}

	if n := cleanUp(t, app, later(50*time.Minute)); n != 0 {
		t.Fatalf("50 min after the report: %d deleted", n)
	}
	if n := cleanUp(t, app, later(62*time.Minute)); n != 1 {
		t.Fatalf("62 min after the report: %d deleted, want 1", n)
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
	a := newGame(t, app, "ann", "ben")
	a.play(t, "ann", "ann")
	a.play(t, "ben", "ben")
	b := newGame(t, app, "cat", "dan")
	b.play(t, "cat", "cat")

	// The sweep's order isn't fixed, so the stuck game is whichever it reaches
	// first: a sweep that stopped at the first failure would leave the other.
	stuck := ""
	app.OnRecordDelete("users").BindFunc(func(e *core.RecordEvent) error {
		if stuck == "" {
			stuck = e.Record.GetString("game_id")
		}
		if e.Record.GetString("game_id") == stuck {
			return errors.New("refused")
		}
		return e.Next()
	})
	before := map[string]map[string]int{}
	for _, id := range []string{a.game.Id, b.game.Id} {
		before[id] = map[string]int{}
		for _, col := range []string{"turns", "stories", "users"} {
			before[id][col] = rowCount(t, app, col, id)
			if before[id][col] == 0 {
				t.Fatalf("fixture: no %s in game %s", col, id)
			}
		}
	}

	n, err := deleteExpiredGames(app, later(8*24*time.Hour))
	fine := a.game.Id
	if stuck == a.game.Id {
		fine = b.game.Id
	}
	if n != 1 {
		t.Errorf("%d deleted, want 1", n)
	}
	if err == nil || stuck == "" || !strings.Contains(err.Error(), stuck) || strings.Contains(err.Error(), fine) {
		t.Errorf("error %v, want one naming only the stuck game", err)
	}
	if exists(t, app, "games", fine) {
		t.Error("the other game didn't expire")
	}
	if !exists(t, app, "games", stuck) {
		t.Error("the stuck game was deleted anyway")
	}
	for col, want := range before[stuck] {
		if got := rowCount(t, app, col, stuck); got != want {
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

// The job decides inside the delete's own transaction, so a game that's moved
// on since the job listed it (a lobby just started, a turn just taken) is
// judged on what it is now and kept.
func TestExpiryDecidesInsideTheDelete(t *testing.T) {
	app := newTestApp(t)
	g := newLobby(t, app, "ann")
	asked := false
	rule := func(tx core.App, gameID string, now time.Time) (bool, error) {
		asked = true
		if !tx.IsTransactional() {
			t.Error("the rule was asked outside the delete's transaction")
		}
		return gameExpired(tx, gameID, now)
	}
	if deleted, err := expireGameBy(app, g.game.Id, later(2*time.Hour), rule); err != nil || !deleted || !asked {
		t.Fatalf("an hour idle: deleted %v, rule asked %v (%v)", deleted, asked, err)
	}

	g = newLobby(t, app, "ann")
	deleted, err := expireGame(app, g.game.Id, time.Now())
	if err != nil || deleted || !exists(t, app, "games", g.game.Id) {
		t.Fatalf("a live lobby: deleted %v (%v)", deleted, err)
	}
	deleted, err = expireGame(app, g.game.Id, later(2*time.Hour))
	if err != nil || !deleted || exists(t, app, "games", g.game.Id) {
		t.Fatalf("an hour idle: deleted %v (%v)", deleted, err)
	}
}

// The expiry job clears logs older than logDays itself, rather than relying on
// PocketBase's own cleanup, which a stopped machine can miss.
func TestExpiryDeletesOldLogs(t *testing.T) {
	app := newTestApp(t)
	servePublic(t, app, publicMode(false))
	old := &core.Log{Created: types.NowDateTime().AddDate(0, 0, -logDays-1), Message: "old"}
	recent := &core.Log{Created: types.NowDateTime(), Message: "recent"}
	for _, l := range []*core.Log{old, recent} {
		l.Id = core.GenerateDefaultRandomId()
		if err := app.AuxSave(l); err != nil {
			t.Fatal(err)
		}
	}
	var job *cron.Job
	for _, j := range app.Cron().Jobs() {
		if j.Id() == "gameExpiry" {
			job = j
		}
	}
	if job == nil {
		t.Fatal("no gameExpiry job")
	}
	job.Run()
	if _, err := app.FindLogById(old.Id); err == nil {
		t.Errorf("a log older than %d days is still there", logDays)
	}
	if _, err := app.FindLogById(recent.Id); err != nil {
		t.Errorf("a recent log was deleted: %v", err)
	}
}
