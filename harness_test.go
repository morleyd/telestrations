package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"slices"
	"testing"

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

// serveAPI is app's HTTP API (the built-in record routes plus the host
// routes), built the way `serve` builds it, so a test can send real requests
// through the request hooks without opening a port.
func serveAPI(t *testing.T, app core.App) http.Handler {
	t.Helper()
	router, err := apis.NewRouter(app)
	if err != nil {
		t.Fatal(err)
	}
	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		bindHostRoutes(se)
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

// play writes name's next turn on starter's story the way a submit lands:
// through app.Save, so the after-turn hooks run but the request guards in
// front of a real submit don't (submit below goes through them).
func (g *testGame) play(t *testing.T, starter, name string) {
	t.Helper()
	save(t, g.app, "turns", g.nextTurn(t, starter, name))
}

// submit sends name's next turn on starter's story as a real request.
func (g *testGame) submit(t *testing.T, api http.Handler, starter, name string) *httptest.ResponseRecorder {
	t.Helper()
	return call(api, http.MethodPost, "/api/collections/turns/records", g.nextTurn(t, starter, name))
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
