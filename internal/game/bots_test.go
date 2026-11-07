package game

import (
	"bytes"
	"encoding/json"
	"image/png"
	"math/rand/v2"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// Bots (bots.go, doodles.go): players the server plays.

func TestEveryDoodleDrawsAPicture(t *testing.T) {
	rng := rand.New(rand.NewPCG(1, 2))
	for _, d := range doodles {
		pic, err := drawDoodle(d, rng)
		if err != nil {
			t.Fatalf("%s: %v", d.name, err)
		}
		img, err := png.Decode(bytes.NewReader(pic))
		if err != nil {
			t.Fatalf("%s: %v", d.name, err)
		}
		if b := img.Bounds(); b.Dx() != paperWidth || b.Dy() != paperHeight {
			t.Errorf("%s: %v, want %d × %d", d.name, b, paperWidth, paperHeight)
		}
		drawn := 0
		for y := 0; y < paperHeight; y += 4 {
			for x := 0; x < paperWidth; x += 4 {
				if r, g, b, _ := img.At(x, y).RGBA(); r != 0xffff || g != 0xffff || b != 0xffff {
					drawn++
				}
			}
		}
		if total := (paperWidth / 4) * (paperHeight / 4); drawn < total/50 {
			t.Errorf("%s: %d of %d sampled pixels drawn, want a picture", d.name, drawn, total)
		}
	}
}

func TestABotDrawsWhatItsToldWhenItKnowsHow(t *testing.T) {
	rng := rand.New(rand.NewPCG(3, 4))
	if d := doodleFor("a very sleepy KITTEN", rng); d.name != "cat" {
		t.Errorf("a sleepy kitten: drew %s", d.name)
	}
	if d := doodleFor("quantum chromodynamics", rng); d.name == "" {
		t.Error("an unknown word: drew nothing")
	}
	if d, ok := doodleNamed("bot_boat_x7k2p9q1zz.png"); !ok || d.name != "boat" {
		t.Errorf("a stored bot boat: %v %v", d.name, ok)
	}
	if _, ok := doodleNamed("img_0001_x7k2p9q1zz.jpg"); ok {
		t.Error("a person's photo read as a bot's doodle")
	}
}

func TestOnlyTheHostAddsBots(t *testing.T) {
	app := newTestApp(t)
	api := bareAPI(t, app)
	lobby := newLobby(t, app, "ann", "ben")
	path := "/api/games/" + lobby.game.Id + "/bots"

	if rec := callWithCode(api, http.MethodPost, path, "", map[string]any{"host_id": lobby.players["ann"].Id}); rec.Code != http.StatusNotFound {
		t.Errorf("without the code: %d, want 404", rec.Code)
	}
	if rec := callWithCode(api, http.MethodPost, path, lobby.code(), map[string]any{"host_id": lobby.players["ben"].Id}); rec.Code != http.StatusForbidden {
		t.Errorf("by a player: %d, want 403", rec.Code)
	}
	rec := callWithCode(api, http.MethodPost, path, lobby.code(), map[string]any{"host_id": lobby.players["ann"].Id})
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"added":3`) {
		t.Fatalf("by the host: %d %s, want 3 added", rec.Code, rec.Body)
	}
	rec = callWithCode(api, http.MethodPost, path, lobby.code(), map[string]any{"host_id": lobby.players["ann"].Id, "count": 3})
	if code, _ := refusal(rec); code != codeTooManyBots {
		t.Errorf("past %d bots: %d %s, want %s", maxBots, rec.Code, rec.Body, codeTooManyBots)
	}
	if n := countBots(t, app, lobby.game.Id); n != 3 {
		t.Errorf("%d bots, want 3", n)
	}

	if rec := callWithCode(api, http.MethodPost, "/api/games/"+lobby.game.Id+"/begin", lobby.code(), lobby.beginBody("ann", "ben")); rec.Code != http.StatusOK {
		t.Fatalf("begin: %d %s", rec.Code, rec.Body)
	}
	rec = callWithCode(api, http.MethodPost, path, lobby.code(), map[string]any{"host_id": lobby.players["ann"].Id, "count": 1})
	if rec.Code != http.StatusBadRequest {
		t.Errorf("once started: %d, want 400", rec.Code)
	}
}

// On a public server, bots take seats under MAX_PLAYERS like anyone else:
// the game gets as many as there are seats left, and a full game none.
func TestBotsTakeOnlyTheFreeSeats(t *testing.T) {
	app := newTestApp(t)
	api := servePublicAs(t, app, publicWith(func(m *Mode) { m.MaxPlayers = 4 }))
	lobby := newLobby(t, app, "ann", "ben")
	path := "/api/games/" + lobby.game.Id + "/bots"
	host := lobby.players["ann"].Id

	for _, tc := range []struct {
		name         string
		count, added int
	}{
		{"two seats left", 3, 2},
		{"none left", 1, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rec := call(api, http.MethodPost, path, map[string]any{"host_id": host, "count": tc.count})
			var got struct{ Added int }
			if err := json.Unmarshal(rec.Body.Bytes(), &got); rec.Code != http.StatusOK || err != nil || got.Added != tc.added {
				t.Errorf("%d bots asked for: %d %s, want %d added", tc.count, rec.Code, rec.Body, tc.added)
			}
		})
	}
	if n := countBots(t, app, lobby.game.Id); n != 2 {
		t.Errorf("%d bots, want 2: ann, ben and two bots fill 4 seats", n)
	}
}

// At home there's no player cap, so nothing limits the bots but maxBots.
func TestAtHomeBotsHaveNoSeatCap(t *testing.T) {
	app := newTestApp(t)
	serveAPI(t, app)
	lobby := newLobby(t, app, "ann", "ben", "cat", "dan")
	var added int
	err := app.RunInTransaction(func(tx core.App) error {
		var err error
		added, err = addBots(tx, lobby.game.Id, maxBots)
		return err
	})
	if err != nil || added != maxBots {
		t.Errorf("added %d (%v), want %d", added, err, maxBots)
	}
}

// The route checks the game hasn't started before its transaction; /begin
// can land in between, so addBots checks again inside it.
func TestBotsCantJoinAStartedGame(t *testing.T) {
	app := newTestApp(t)
	lobby := newLobby(t, app, "ann")
	lobby.game.Set("isStarted", true)
	if err := app.Save(lobby.game); err != nil {
		t.Fatal(err)
	}
	err := app.RunInTransaction(func(tx core.App) error {
		_, err := addBots(tx, lobby.game.Id, 2)
		return err
	})
	if err == nil || !strings.Contains(err.Error(), msgGameStarted) {
		t.Errorf("addBots on a started game: %v, want %q", err, msgGameStarted)
	}
	if n := countBots(t, app, lobby.game.Id); n != 0 {
		t.Errorf("%d bots seated in a started game", n)
	}
}

func countBots(t *testing.T, app core.App, gameID string) int {
	t.Helper()
	var n int
	err := app.DB().NewQuery("SELECT COUNT(*) FROM users WHERE game_id = {:g} AND is_bot = 1").
		Bind(dbx.Params{"g": gameID}).Row(&n)
	if err != nil {
		t.Fatal(err)
	}
	return n
}

// A bot is the server's: a client can't join as one or turn itself into one
// (it would be played for them, and kept a game alive).
func TestAClientCantBeABot(t *testing.T) {
	app := newTestApp(t)
	api := serveAPI(t, app)
	lobby := newLobby(t, app, "ann")
	rec := call(api, http.MethodPost, "/api/collections/users/records",
		map[string]any{"username": "eve", "game_id": lobby.game.Id, "is_bot": true})
	if rec.Code != http.StatusOK {
		t.Fatalf("join: %d %s", rec.Code, rec.Body)
	}
	var eve struct {
		ID string `json:"id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &eve)
	call(api, http.MethodPatch, "/api/collections/users/records/"+eve.ID, map[string]any{"is_bot": true})
	if n := countBots(t, app, lobby.game.Id); n != 0 {
		t.Errorf("%d bots, want none", n)
	}
}

// botGame is ann's game with n bots, seated in join order and started through
// api (serveAPI's).
func botGame(t *testing.T, app core.App, api http.Handler, n int) *testGame {
	t.Helper()
	g := newLobby(t, app, "ann")
	if _, err := addBots(app, g.game.Id, n); err != nil {
		t.Fatal(err)
	}
	rec := call(api, http.MethodPost, "/api/games/"+g.game.Id+"/begin",
		map[string]any{"host_id": g.players["ann"].Id})
	if rec.Code != http.StatusOK {
		t.Fatalf("begin: %d %s", rec.Code, rec.Body)
	}
	g.stories["ann"] = save(t, app, "stories", map[string]any{"starter_id": g.players["ann"].Id, "game_id": g.game.Id})
	return g
}

// annPlays writes every turn waiting on ann, as her page would.
func (g *testGame) annPlays(t *testing.T) {
	t.Helper()
	stories, err := loadGameStories(g.app, g.game.Id)
	if err != nil {
		t.Fatal(err)
	}
	for _, s := range stories {
		if s.NextUser != g.players["ann"].Id {
			continue
		}
		isDrawing := false
		if s.Taken > 0 {
			prev, err := g.app.FindRecordById("turns", s.PrevTurn)
			if err != nil {
				t.Fatal(err)
			}
			isDrawing = !prev.GetBool("is_drawing")
		}
		save(t, g.app, "turns", map[string]any{
			"story_id": s.StoryID, "user_id": g.players["ann"].Id, "game_id": g.game.Id,
			"is_drawing": isDrawing, "prompt": map[bool]string{false: "a red boat"}[isDrawing],
		})
	}
}

func TestBotsPlayAWholeGameWithAPerson(t *testing.T) {
	app := newTestApp(t)
	g := botGame(t, app, serveAPI(t, app), 2)
	later := time.Now().Add(time.Minute) // past every bot's pause

	for range 12 {
		g.annPlays(t)
		if err := playBots(app, later); err != nil {
			t.Fatal(err)
		}
		if _, finished, _ := finishedAt(app, g.game.Id); finished {
			break
		}
	}
	if _, finished, err := finishedAt(app, g.game.Id); !finished {
		t.Fatalf("the game didn't finish (%v)", err)
	}

	turns, err := app.FindRecordsByFilter("turns", "game_id = {:g}", "turn_index", 0, 0, dbx.Params{"g": g.game.Id})
	if err != nil {
		t.Fatal(err)
	}
	if len(turns) != 9 {
		t.Fatalf("%d turns, want 3 stories × 3 players", len(turns))
	}
	byStory := map[string][]*core.Record{}
	for _, turn := range turns {
		byStory[turn.GetString("story_id")] = append(byStory[turn.GetString("story_id")], turn)
	}
	for story, list := range byStory {
		for i, turn := range list {
			if turn.GetBool("is_drawing") != (i%2 == 1) {
				t.Errorf("story %s, turn %d: drawing %v", story, i, turn.GetBool("is_drawing"))
			}
			if turn.GetBool("is_drawing") && turn.GetString("drawing") == "" && turn.GetString("user_id") != g.players["ann"].Id {
				t.Errorf("story %s, turn %d: a bot's drawing with no picture", story, i)
			}
			if !turn.GetBool("is_drawing") && turn.GetString("prompt") == "" {
				t.Errorf("story %s, turn %d: an empty word", story, i)
			}
		}
	}
}

// A bot's guess at another bot's doodle is one of that doodle's guesses.
func TestABotKnowsABotsDoodle(t *testing.T) {
	rng := rand.New(rand.NewPCG(5, 6))
	for _, d := range doodles {
		guess := botGuess("bot_"+d.name+"_abc123.png", rng)
		found := false
		for _, g := range d.guesses {
			found = found || g == guess
		}
		if !found {
			t.Errorf("%s: guessed %q", d.name, guess)
		}
	}
}

func TestBotsTakeTheirTime(t *testing.T) {
	app := newTestApp(t)
	g := botGame(t, app, serveAPI(t, app), 2)
	if err := playBots(app, time.Now()); err != nil {
		t.Fatal(err)
	}
	var n int
	_ = app.DB().NewQuery("SELECT COUNT(*) FROM turns WHERE game_id = {:g}").Bind(dbx.Params{"g": g.game.Id}).Row(&n)
	if n != 0 {
		t.Errorf("%d turns the moment their stories opened, want none yet", n)
	}
}

// With nobody else around, bots stop, so the game goes quiet and expires.
func TestBotsWaitForAPerson(t *testing.T) {
	app := newTestApp(t)
	g := botGame(t, app, serveAPI(t, app), 2)
	if err := playBots(app, time.Now().Add(20*time.Minute)); err != nil {
		t.Fatal(err)
	}
	var stories int
	_ = app.DB().NewQuery("SELECT COUNT(*) FROM stories WHERE game_id = {:g}").Bind(dbx.Params{"g": g.game.Id}).Row(&stories)
	if stories != 1 {
		t.Errorf("%d stories, want only ann's: the bots played to an empty room", stories)
	}
}

// Play again brings the bots along.
func TestPlayAgainKeepsTheBots(t *testing.T) {
	app := newTestApp(t)
	api := serveAPI(t, app)
	g := botGame(t, app, api, 2)
	g.endedAgo(t, time.Minute)
	next := rematchedGame(t, app, g.rematch(api, g.players["ann"], map[string]any{}))
	if n := countBots(t, app, next.Id); n != 2 {
		t.Errorf("%d bots in the new game, want 2", n)
	}
}
