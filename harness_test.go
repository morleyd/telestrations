package main

import (
	"bytes"
	"encoding/json"
	"math/rand/v2"
	"net/http"
	"net/http/httptest"
	"slices"
	"sync"
	"testing"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"github.com/pocketbase/pocketbase/tools/security"
)

// A Go harness for the server's game logic: a throwaway PocketBase with the
// real schema (every migration) and the game's hooks, set up like main() with
// a single read connection so reads serialize as they do in production. The
// Playwright specs cover what a browser sees; this is for server-side
// interleavings a browser test can't pin down.

func newTestApp(t *testing.T) *tests.TestApp {
	t.Helper()
	app, err := tests.NewTestAppWithConfig(core.BaseAppConfig{
		DataDir:          t.TempDir(), // empty: migrations build the schema
		DataMaxOpenConns: 1,
		DataMaxIdleConns: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(app.Cleanup)
	bindGameHooks(app)
	return app
}

// serveAPI is app's HTTP API (the built-in record routes plus the game's own,
// bindAPIRoutes), built the way `serve` builds it, so a test can send real
// requests through the request hooks without opening a port.
func serveAPI(t *testing.T, app core.App) http.Handler {
	t.Helper()
	return serve(t, app, bindAPIRoutes)
}

// serve builds app's handler the way `serve` does, with bind registering the
// game's routes on top of PocketBase's own.
func serve(t *testing.T, app core.App, bind func(se *core.ServeEvent)) http.Handler {
	t.Helper()
	router, err := apis.NewRouter(app)
	if err != nil {
		t.Fatal(err)
	}
	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		bind(se)
		return se.Next()
	})
	var handler http.Handler
	err = app.OnServe().Trigger(&core.ServeEvent{App: app, Router: router}, func(e *core.ServeEvent) error {
		mux, err := e.Router.BuildMux()
		handler = mux
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	return handler
}

func call(api http.Handler, method, path string, body any) *httptest.ResponseRecorder {
	data, _ := json.Marshal(body)
	req := httptest.NewRequest(method, path, bytes.NewReader(data))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	api.ServeHTTP(rec, req)
	return rec
}

func save(t *testing.T, app core.App, collection string, fields map[string]any) *core.Record {
	t.Helper()
	col, err := app.FindCollectionByNameOrId(collection)
	if err != nil {
		t.Fatal(err)
	}
	record := core.NewRecord(col)
	record.Load(fields)
	if err := app.Save(record); err != nil {
		t.Fatalf("save %s: %v", collection, err)
	}
	return record
}

// testGame is a started, untimed game: players seated in the order given (the
// first one hosts), each with their own story and nothing played yet.
type testGame struct {
	app     core.App
	game    *core.Record
	players map[string]*core.Record // by username
	stories map[string]*core.Record // by starter's username
}

func newGame(t *testing.T, app core.App, names ...string) *testGame {
	t.Helper()
	g := &testGame{app: app, players: map[string]*core.Record{}, stories: map[string]*core.Record{}}
	g.game = save(t, app, "games", map[string]any{
		"game_code": security.RandomString(8), "roundDuration": -1, "isStarted": true,
	})
	for i, name := range names {
		g.players[name] = save(t, app, "users", map[string]any{
			"username": name, "game_id": g.game.Id, "is_host": i == 0, "position": i,
		})
		g.stories[name] = save(t, app, "stories", map[string]any{
			"starter_id": g.players[name].Id, "game_id": g.game.Id,
		})
	}
	return g
}

// nextTurn is name's next turn on the story started by starter, as a client
// would send it: whatever the story needs next (an opening word, then
// drawings and guesses in turn). It fails the test if the story isn't
// waiting on name.
func (g *testGame) nextTurn(t *testing.T, starter, name string) map[string]any {
	t.Helper()
	story, player := g.stories[starter], g.players[name]
	s, err := loadStory(g.app, story.Id)
	if err != nil {
		t.Fatal(err)
	}
	if s.NextUser != player.Id {
		t.Fatalf("%s's story is waiting on %s, not %s", starter, g.name(s.NextUser), name)
	}
	isDrawing := false
	if s.Taken > 0 {
		prev, err := g.app.FindRecordById("turns", s.PrevTurn)
		if err != nil {
			t.Fatal(err)
		}
		isDrawing = !prev.GetBool("is_drawing")
	}
	prompt := ""
	if !isDrawing {
		prompt = name + "'s word"
	}
	return map[string]any{
		"story_id": story.Id, "user_id": player.Id, "game_id": g.game.Id,
		"is_drawing": isDrawing, "prompt": prompt,
	}
}

// newLobby is a game that hasn't begun: players joined in the order given
// (the first one hosts), not yet seated, no stories.
func newLobby(t *testing.T, app core.App, names ...string) *testGame {
	t.Helper()
	g := &testGame{app: app, players: map[string]*core.Record{}, stories: map[string]*core.Record{}}
	g.game = save(t, app, "games", map[string]any{"game_code": security.RandomString(8), "roundDuration": -1})
	for i, name := range names {
		g.players[name] = save(t, app, "users", map[string]any{
			"username": name, "game_id": g.game.Id, "is_host": i == 0,
		})
	}
	return g
}

// timed gives the game a round timer, so timeouts are allowed.
func (g *testGame) timed(t *testing.T) *testGame {
	t.Helper()
	g.game.Set("roundDuration", 60)
	if err := g.app.Save(g.game); err != nil {
		t.Fatal(err)
	}
	return g
}

// turn is a turn by name on starter's story, of the kind given, whether or not
// it's theirs to take: for testing what the guards refuse. A name not in the
// game sends an empty user_id.
func (g *testGame) turn(starter, name string, isDrawing bool) map[string]any {
	userID := ""
	if p := g.players[name]; p != nil {
		userID = p.Id
	}
	prompt := ""
	if !isDrawing {
		prompt = name + "'s word"
	}
	return map[string]any{
		"story_id": g.stories[starter].Id, "user_id": userID, "game_id": g.game.Id,
		"is_drawing": isDrawing, "prompt": prompt,
	}
}

// timeout sends name's round timer running out on starter's story.
func (g *testGame) timeout(api http.Handler, starter, name string) *httptest.ResponseRecorder {
	return call(api, http.MethodPost, "/api/stories/"+g.stories[starter].Id+"/timeout",
		map[string]any{"user_id": g.players[name].Id})
}

// play writes name's next turn on starter's story the way a submit lands:
// through app.Save, so the after-turn hooks run but the request guards in
// front of a real submit don't (submit below goes through them).
func (g *testGame) play(t *testing.T, starter, name string) {
	t.Helper()
	save(t, g.app, "turns", g.nextTurn(t, starter, name))
}

const turnsPath = "/api/collections/turns/records"

// submit sends name's next turn on starter's story as a real request. In a
// race, build the turn with nextTurn first and send it with call, so only the
// request itself races.
func (g *testGame) submit(t *testing.T, api http.Handler, starter, name string) *httptest.ResponseRecorder {
	t.Helper()
	return call(api, http.MethodPost, turnsPath, g.nextTurn(t, starter, name))
}

// hostAct sends host's "skip" or "drop" of player, as the Manage players
// dialog does.
func (g *testGame) hostAct(api http.Handler, action string, host, player *core.Record) *httptest.ResponseRecorder {
	return call(api, http.MethodPost, "/api/games/"+g.game.Id+"/players/"+player.Id+"/"+action,
		map[string]any{"host_id": host.Id})
}

func (g *testGame) name(userID string) string {
	for name, p := range g.players {
		if p.Id == userID {
			return name
		}
	}
	return "nobody"
}

// owes lists the starters of the stories waiting on name right now.
func (g *testGame) owes(t *testing.T, name string) []string {
	t.Helper()
	stories, err := loadGameStories(g.app, g.game.Id)
	if err != nil {
		t.Fatal(err)
	}
	var out []string
	for _, s := range stories {
		if s.NextUser == g.players[name].Id {
			out = append(out, g.name(s.Starter))
		}
	}
	slices.Sort(out)
	return out
}

// turnsBy is name's turns on the story started by starter.
func (g *testGame) turnsBy(t *testing.T, starter, name string) []*core.Record {
	t.Helper()
	turns, err := g.app.FindRecordsByFilter("turns", "story_id = {:s} && user_id = {:u}", "", 0, 0,
		dbx.Params{"s": g.stories[starter].Id, "u": g.players[name].Id})
	if err != nil {
		t.Fatal(err)
	}
	return turns
}

// requireSkippedOnce checks that name has exactly one turn on each story,
// written for them as a skip.
func (g *testGame) requireSkippedOnce(t *testing.T, name string, starters ...string) {
	t.Helper()
	for _, starter := range starters {
		turns := g.turnsBy(t, starter, name)
		if len(turns) != 1 || !turns[0].GetBool("skipped") {
			t.Errorf("%s's story: want one skipped turn by %s, got %d turns", starter, name, len(turns))
		}
	}
}

// danOwesThree seats ann, ben, cat and dan, and plays until three stories
// (ann's, ben's and cat's) are waiting on dan, who has written his own word.
func danOwesThree(t *testing.T, app core.App) *testGame {
	t.Helper()
	g := newGame(t, app, "ann", "ben", "cat", "dan")
	g.play(t, "dan", "dan")
	g.play(t, "cat", "cat")
	g.play(t, "ben", "ben")
	g.play(t, "ben", "cat")
	g.play(t, "ann", "ann")
	g.play(t, "ann", "ben")
	g.play(t, "ann", "cat")
	if owes := g.owes(t, "dan"); !slices.Equal(owes, []string{"ann", "ben", "cat"}) {
		t.Fatalf("fixture: dan owes %v", owes)
	}
	return g
}

// markDropped does the first half of the host's drop: the flag, which turns
// on the after-turn auto-skip for that player.
func markDropped(t *testing.T, app core.App, user *core.Record) {
	t.Helper()
	user.Set("dropped", true)
	if err := app.Save(user); err != nil {
		t.Fatal(err)
	}
}

func firstOwed(stories []storyState, userID string) storyState {
	for _, s := range stories {
		if s.NextUser == userID {
			return s
		}
	}
	panic("nothing owed")
}

// together runs fns at about the same moment, each on its own goroutine, and
// waits for all of them: the shape of every race below. Each starts after a
// random delay of up to a few milliseconds (about one request's work), so
// over a soak's rounds every order they can land in comes up; without it the
// scheduler tends to run them in the same order every time.
func together(fns ...func()) {
	var wg sync.WaitGroup
	start := make(chan struct{})
	for _, fn := range fns {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			time.Sleep(rand.N(3 * time.Millisecond))
			fn()
		}()
	}
	close(start)
	wg.Wait()
}

// soak skips a concurrent soak under -short.
func soak(t *testing.T) {
	t.Helper()
	if testing.Short() {
		t.Skip("concurrent soak")
	}
}

// soakRounds is how many fresh games each soak races through.
const soakRounds = 30

// refusal is a refused write as the client reads it (refusalCode in
// web/src/services/pocketbase): the code a guard attached, or "turn_taken"
// for a second turn on a story that got past the guard and hit the unique
// index. byIndex says which of the two it was.
func refusal(rec *httptest.ResponseRecorder) (code string, byIndex bool) {
	var body struct {
		Data map[string]struct {
			Code string `json:"code"`
		} `json:"data"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	if c := body.Data["code"].Code; c != "" {
		return c, false
	}
	if body.Data["user_id"].Code == "validation_not_unique" || body.Data["story_id"].Code == "validation_not_unique" {
		return "turn_taken", true
	}
	return "", false
}

// seats is every player's position in the game, sorted.
func (g *testGame) seats(t *testing.T) []int {
	t.Helper()
	users, err := g.app.FindRecordsByFilter("users", "game_id = {:g}", "", 0, 0, dbx.Params{"g": g.game.Id})
	if err != nil {
		t.Fatal(err)
	}
	var out []int
	for _, u := range users {
		out = append(out, u.GetInt("position"))
	}
	slices.Sort(out)
	return out
}

// isPermutation reports whether seats is exactly 0..len-1.
func isPermutation(seats []int) bool {
	for i, s := range seats {
		if s != i {
			return false
		}
	}
	return true
}

// orphanTurns counts the game's turns whose story is missing (blanked by a
// story delete, or pointing at one that's gone).
func (g *testGame) orphanTurns(t *testing.T) int {
	t.Helper()
	var n int
	err := g.app.DB().NewQuery(`SELECT COUNT(*) FROM turns WHERE game_id = {:g}
		AND (story_id = '' OR story_id NOT IN (SELECT id FROM stories))`).
		Bind(dbx.Params{"g": g.game.Id}).Row(&n)
	if err != nil {
		t.Fatal(err)
	}
	return n
}
