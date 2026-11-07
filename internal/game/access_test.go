package game

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// A game's code is the key to the game (migration 1784800000, access.go).
// These tests send requests as a stranger would: through bareAPI, with only
// the headers each one names.

func (g *testGame) code() string { return g.game.GetString("game_code") }

// callWithCode is call with the X-Game-Code header set to code ("" for none).
func callWithCode(api http.Handler, method, path, code string, body any) *httptest.ResponseRecorder {
	data, _ := json.Marshal(body)
	req := httptest.NewRequest(method, path, bytes.NewReader(data))
	req.Header.Set("Content-Type", "application/json")
	if code != "" {
		req.Header.Set(gameCodeHeader, code)
	}
	rec := httptest.NewRecorder()
	api.ServeHTTP(rec, req)
	return rec
}

// listed is the ids a list request returns, failing the test on anything but
// a 200.
func listed(t *testing.T, api http.Handler, collection, code string) []string {
	t.Helper()
	rec := callWithCode(api, http.MethodGet, "/api/collections/"+collection+"/records?perPage=500", code, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("list %s: %d %s", collection, rec.Code, rec.Body)
	}
	var body struct {
		Items []struct {
			ID     string `json:"id"`
			GameID string `json:"game_id"`
		} `json:"items"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	var games []string
	for _, item := range body.Items {
		games = append(games, item.GameID)
	}
	return games
}

// twoGames is two started games, each with a turn played, so every
// collection and view has something from each.
func twoGames(t *testing.T, app core.App) (mine, other *testGame) {
	t.Helper()
	mine = newGame(t, app, "ann", "ben")
	other = newGame(t, app, "cat", "dan")
	mine.play(t, "ann", "ann")
	other.play(t, "cat", "cat")
	return mine, other
}

var everyCollection = []string{"users", "stories", "turns", "progress", "results"}

func TestWithoutTheCodeNothingIsListed(t *testing.T) {
	app := newTestApp(t)
	api := bareAPI(t, app)
	mine, _ := twoGames(t, app)

	for _, code := range []string{"", "zzzzz"} {
		if games := listed(t, api, "games", code); len(games) != 0 {
			t.Errorf("games with code %q: %d listed, want none", code, len(games))
		}
		for _, col := range everyCollection {
			if items := listed(t, api, col, code); len(items) != 0 {
				t.Errorf("%s with code %q: %d listed, want none", col, code, len(items))
			}
		}
	}
	// A game's code shows that game alone, whatever the filter asks for.
	rec := callWithCode(api, http.MethodGet, "/api/collections/games/records", mine.code(), nil)
	if !strings.Contains(rec.Body.String(), mine.game.Id) || strings.Count(rec.Body.String(), `"game_code"`) != 1 {
		t.Errorf("games with mine's code: %s, want only mine", rec.Body)
	}
}

func TestACodeListsOnlyItsOwnGame(t *testing.T) {
	app := newTestApp(t)
	api := bareAPI(t, app)
	mine, _ := twoGames(t, app)

	for _, col := range everyCollection {
		games := listed(t, api, col, mine.code())
		if len(games) == 0 {
			t.Errorf("%s with mine's code: nothing listed", col)
		}
		for _, id := range games {
			if id != mine.game.Id {
				t.Errorf("%s with mine's code lists a record from game %s", col, id)
			}
		}
	}
}

func TestARecordIsntViewableWithoutItsGamesCode(t *testing.T) {
	app := newTestApp(t)
	api := bareAPI(t, app)
	mine, other := twoGames(t, app)
	turn := mine.lastTurnBy(t, "ann", "ann")

	paths := map[string]string{
		"game":   "/api/collections/games/records/" + mine.game.Id,
		"player": "/api/collections/users/records/" + mine.players["ann"].Id,
		"story":  "/api/collections/stories/records/" + mine.stories["ann"].Id,
		"turn":   "/api/collections/turns/records/" + turn.Id,
	}
	for what, path := range paths {
		for _, code := range []string{"", other.code()} {
			if rec := callWithCode(api, http.MethodGet, path, code, nil); rec.Code != http.StatusNotFound {
				t.Errorf("view %s with code %q: %d, want 404", what, code, rec.Code)
			}
		}
		if rec := callWithCode(api, http.MethodGet, path, mine.code(), nil); rec.Code != http.StatusOK {
			t.Errorf("view %s with its code: %d %s, want 200", what, rec.Code, rec.Body)
		}
	}
}

// Changing or deleting a game, story or turn is the server's alone, even for
// the game's own players.
func TestOnlyTheServerChangesGamesStoriesAndTurns(t *testing.T) {
	app := newTestApp(t)
	api := bareAPI(t, app)
	mine, _ := twoGames(t, app)
	turn := mine.lastTurnBy(t, "ann", "ann")

	records := map[string]string{
		"games":   mine.game.Id,
		"stories": mine.stories["ann"].Id,
		"turns":   turn.Id,
	}
	for col, id := range records {
		path := "/api/collections/" + col + "/records/" + id
		if rec := callWithCode(api, http.MethodPatch, path, mine.code(), map[string]any{}); rec.Code != http.StatusForbidden {
			t.Errorf("update %s: %d %s, want 403", col, rec.Code, rec.Body)
		}
		if rec := callWithCode(api, http.MethodDelete, path, mine.code(), nil); rec.Code != http.StatusForbidden {
			t.Errorf("delete %s: %d %s, want 403", col, rec.Code, rec.Body)
		}
		if _, err := app.FindRecordById(col, id); err != nil {
			t.Errorf("%s %s is gone: %v", col, id, err)
		}
	}
}

func TestJoiningRenamingAndLeavingTakeTheCode(t *testing.T) {
	app := newTestApp(t)
	api := bareAPI(t, app)
	lobby := newLobby(t, app, "ann", "ben")
	other := newLobby(t, app, "cat")
	join := map[string]any{"username": "eve", "game_id": lobby.game.Id}
	ben := "/api/collections/users/records/" + lobby.players["ben"].Id

	for _, code := range []string{"", other.code()} {
		if rec := callWithCode(api, http.MethodPost, "/api/collections/users/records", code, join); rec.Code == http.StatusOK {
			t.Errorf("join with code %q: let in", code)
		}
		if rec := callWithCode(api, http.MethodPatch, ben, code, map[string]any{"username": "mallory"}); rec.Code != http.StatusNotFound {
			t.Errorf("rename with code %q: %d, want 404", code, rec.Code)
		}
		if rec := callWithCode(api, http.MethodDelete, ben, code, nil); rec.Code != http.StatusNotFound {
			t.Errorf("remove with code %q: %d, want 404", code, rec.Code)
		}
	}
	if rec := callWithCode(api, http.MethodPost, "/api/collections/users/records", lobby.code(), join); rec.Code != http.StatusOK {
		t.Errorf("join with the code: %d %s", rec.Code, rec.Body)
	}
	if rec := callWithCode(api, http.MethodPatch, ben, lobby.code(), map[string]any{"username": "benny"}); rec.Code != http.StatusOK {
		t.Errorf("rename with the code: %d %s", rec.Code, rec.Body)
	}
	if rec := callWithCode(api, http.MethodDelete, ben, lobby.code(), nil); rec.Code != http.StatusNoContent {
		t.Errorf("remove with the code: %d %s", rec.Code, rec.Body)
	}
}

// One game's code can't be used to write into another: a story goes in its
// starter's game, and a turn in its story's (whatever game_id it claims).
func TestACodeCantWriteIntoAnotherGame(t *testing.T) {
	app := newTestApp(t)
	api := bareAPI(t, app)
	mine := newGame(t, app, "ann", "ben")
	other := newGame(t, app, "cat", "dan")

	rec := callWithCode(api, http.MethodPost, "/api/collections/stories/records", mine.code(),
		map[string]any{"starter_id": other.players["cat"].Id, "game_id": mine.game.Id})
	if rec.Code == http.StatusOK {
		t.Error("a story for another game's player went into mine")
	}
	// A story that names the other game and a player of it, sent with my code or
	// no code at all, is refused by the code clause alone. The player is new, so
	// the starter-in-game check and the one story per starter and game both
	// allow it.
	eve := save(t, app, "users", map[string]any{"username": "eve", "game_id": other.game.Id, "position": 2})
	storiesInOther := func() int {
		t.Helper()
		n, err := app.CountRecords("stories", dbx.HashExp{"game_id": other.game.Id})
		if err != nil {
			t.Fatal(err)
		}
		return int(n)
	}
	before := storiesInOther()
	intoOther := map[string]any{"starter_id": eve.Id, "game_id": other.game.Id}
	for name, code := range map[string]string{"mine's code": mine.code(), "no code": ""} {
		if rec := callWithCode(api, http.MethodPost, "/api/collections/stories/records", code, intoOther); rec.Code == http.StatusOK {
			t.Errorf("a story for the other game went in with %s", name)
		}
	}
	if n := storiesInOther(); n != before {
		t.Errorf("the other game has %d stories, want its %d unchanged", n, before)
	}
	if rec := callWithCode(api, http.MethodPost, "/api/collections/stories/records", other.code(), intoOther); rec.Code != http.StatusOK {
		t.Errorf("the same story with its own game's code: %d %s", rec.Code, rec.Body)
	}
	turn := other.nextTurn(t, "cat", "cat")
	turn["game_id"] = mine.game.Id
	if rec := callWithCode(api, http.MethodPost, turnsPath, mine.code(), turn); rec.Code == http.StatusOK {
		t.Error("a turn on another game's story went in with mine's code")
	}
	if n := len(other.turnsBy(t, "cat", "cat")); n != 0 {
		t.Errorf("cat's story has %d turns, want none", n)
	}
	if rec := callWithCode(api, http.MethodPost, turnsPath, other.code(), turn); rec.Code != http.StatusOK {
		t.Errorf("the same turn with its own game's code: %d %s", rec.Code, rec.Body)
	}
}

// Every one of the game's own routes answers a missing or wrong code the way
// it answers a game that doesn't exist.
func TestTheGamesRoutesTakeTheCode(t *testing.T) {
	app := newTestApp(t)
	api := bareAPI(t, app)
	g := newGame(t, app, "ann", "ben").timed(t)
	lobby := newLobby(t, app, "cat", "dan")
	other := newLobby(t, app, "eve")
	host := map[string]any{"host_id": g.players["ann"].Id}
	routes := []struct {
		method, path string
		body         any
	}{
		{http.MethodGet, "/api/games/" + g.game.Id + "/players", nil},
		{http.MethodPost, "/api/games/" + g.game.Id + "/players/" + g.players["ben"].Id + "/presence", map[string]any{"working_on": ""}},
		{http.MethodPost, "/api/games/" + g.game.Id + "/players/" + g.players["ben"].Id + "/skip", host},
		{http.MethodPost, "/api/games/" + g.game.Id + "/players/" + g.players["ben"].Id + "/drop", host},
		{http.MethodPost, "/api/games/" + g.game.Id + "/end", host},
		{http.MethodPost, "/api/games/" + g.game.Id + "/rematch", host},
		{http.MethodPost, "/api/stories/" + g.stories["ben"].Id + "/timeout", map[string]any{"user_id": g.players["ben"].Id}},
		{http.MethodPost, "/api/games/" + lobby.game.Id + "/begin", lobby.beginBody("cat", "dan")},
	}
	for _, r := range routes {
		for _, code := range []string{"", other.code()} {
			if rec := callWithCode(api, r.method, r.path, code, r.body); rec.Code != http.StatusNotFound {
				t.Errorf("%s %s with code %q: %d %s, want 404", r.method, r.path, code, rec.Code, rec.Body)
			}
		}
	}
	if g.isOver(t) || lobby.isStarted(t) || isDropped(app, g.players["ben"].Id) {
		t.Error("a request without the code changed a game")
	}
	if rec := callWithCode(api, http.MethodGet, "/api/games/"+g.game.Id+"/players", g.code(), nil); rec.Code != http.StatusOK {
		t.Errorf("players with the code: %d %s", rec.Code, rec.Body)
	}
}

func (g *testGame) isOver(t *testing.T) bool {
	t.Helper()
	game, err := g.app.FindRecordById("games", g.game.Id)
	if err != nil {
		t.Fatal(err)
	}
	return !game.GetDateTime("ends_at").IsZero()
}

func (g *testGame) isStarted(t *testing.T) bool {
	t.Helper()
	return gameStarted(g.app, g.game.Id)
}

// Starting the game is the host's, like ending it and playing again.
func TestOnlyTheHostBegins(t *testing.T) {
	app := newTestApp(t)
	api := bareAPI(t, app)
	lobby := newLobby(t, app, "ann", "ben")
	other := newLobby(t, app, "cat")
	path := "/api/games/" + lobby.game.Id + "/begin"

	for name, hostID := range map[string]string{
		"a player":            lobby.players["ben"].Id,
		"another game's host": other.players["cat"].Id,
		"nobody":              "",
	} {
		body := map[string]any{"host_id": hostID}
		if rec := callWithCode(api, http.MethodPost, path, lobby.code(), body); rec.Code != http.StatusForbidden {
			t.Errorf("begin by %s: %d %s, want 403", name, rec.Code, rec.Body)
		}
	}
	if lobby.isStarted(t) {
		t.Fatal("someone other than the host started the game")
	}
	if rec := callWithCode(api, http.MethodPost, path, lobby.code(), lobby.beginBody("ann", "ben")); rec.Code != http.StatusOK {
		t.Errorf("begin by the host: %d %s", rec.Code, rec.Body)
	}
}

// Drawings show in <img> tags, which send no headers: a drawing's address
// (which holds its turn's id, readable only with the code) is enough.
func TestADrawingLoadsWithoutTheCode(t *testing.T) {
	app := newTestApp(t)
	api := bareAPI(t, app)
	g := newGame(t, app, "ann", "ben")
	g.play(t, "ann", "ann")
	turn := g.drawWithFile(t, "ann", "ben")

	path := "/api/files/turns/" + turn.Id + "/" + turn.GetString("drawing")
	if rec := callWithCode(api, http.MethodGet, path, "", nil); rec.Code != http.StatusOK {
		t.Fatalf("drawing without the code: %d", rec.Code)
	}
}

// Play again's new game has a new code; the old game passes it on to its
// players (and nobody else, since reading the old game takes its code).
func TestTheOldGameCarriesTheNextGamesCode(t *testing.T) {
	app := newTestApp(t)
	api := serveAPI(t, app)
	g := newGame(t, app, "ann", "ben")
	g.endedAgo(t, time.Minute)
	rec := g.rematch(api, g.players["ann"], map[string]any{})
	if rec.Code != http.StatusOK {
		t.Fatalf("rematch: %d %s", rec.Code, rec.Body)
	}
	var next struct {
		GameCode string `json:"game_code"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &next)
	old, err := app.FindRecordById("games", g.game.Id)
	if err != nil {
		t.Fatal(err)
	}
	if next.GameCode == "" || old.GetString("next_game_code") != next.GameCode {
		t.Errorf("next_game_code = %q, want the new game's %q", old.GetString("next_game_code"), next.GameCode)
	}
}

func TestGameCodesAreFiveLowercaseLetters(t *testing.T) {
	seen := map[string]bool{}
	for range 1000 {
		code := randomCode()
		if !regexp.MustCompile(`^[a-z]{5}$`).MatchString(code) {
			t.Fatalf("code %q", code)
		}
		seen[code] = true
	}
	// 1,000 draws from 26^5 codes almost never repeat; many repeats would
	// mean a broken source.
	if len(seen) < 990 {
		t.Errorf("%d distinct codes in 1000", len(seen))
	}
}

// Realtime: PocketBase checks each subscription against the rules with the
// headers it was made with, so a browser hears only about its own game.
func TestRealtimeSendsAGamesEventsOnlyToItsCode(t *testing.T) {
	app := newTestApp(t)
	srv := httptest.NewServer(bareAPI(t, app))
	t.Cleanup(srv.Close)
	mine := newGame(t, app, "ann", "ben")
	other := newGame(t, app, "cat", "dan")

	withCode := subscribe(t, srv.URL, "turns", mine.code())
	without := subscribe(t, srv.URL, "turns", "")
	wrongCode := subscribe(t, srv.URL, "turns", other.code())

	mine.play(t, "ann", "ann")

	select {
	case ev := <-withCode:
		if !strings.Contains(ev, mine.game.Id) {
			t.Errorf("event for another game: %s", ev)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the game's own subscriber heard nothing")
	}
	select {
	case ev := <-without:
		t.Errorf("a subscriber without a code heard: %s", ev)
	case ev := <-wrongCode:
		t.Errorf("another game's subscriber heard: %s", ev)
	case <-time.After(500 * time.Millisecond):
	}
}

// subscribe opens a realtime connection to base and subscribes it to topic,
// sending code the way the web app does ("" for none). It returns each
// record event's data as it arrives.
func subscribe(t *testing.T, base, topic, code string) <-chan string {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, base+"/api/realtime", nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { resp.Body.Close() })
	events := bufio.NewReader(resp.Body)

	name, data := readEvent(t, events)
	if name != "PB_CONNECT" {
		t.Fatalf("first event %q", name)
	}
	var connect struct {
		ClientID string `json:"clientId"`
	}
	_ = json.Unmarshal([]byte(data), &connect)

	sub := topic
	if code != "" {
		opts, _ := json.Marshal(map[string]any{"headers": map[string]string{gameCodeHeader: code}})
		sub += "?options=" + url.QueryEscape(string(opts))
	}
	body, _ := json.Marshal(map[string]any{"clientId": connect.ClientID, "subscriptions": []string{sub}})
	set, err := http.Post(base+"/api/realtime", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	set.Body.Close()
	if set.StatusCode != http.StatusNoContent {
		t.Fatalf("subscribe: %d", set.StatusCode)
	}

	out := make(chan string, 10)
	go func() {
		for {
			name, data, err := nextEvent(events)
			if err != nil {
				return
			}
			if name != "PB_CONNECT" {
				out <- data
			}
		}
	}()
	return out
}

func readEvent(t *testing.T, r *bufio.Reader) (name, data string) {
	t.Helper()
	name, data, err := nextEvent(r)
	if err != nil {
		t.Fatal(err)
	}
	return name, data
}

// nextEvent reads one server-sent event: its name and its data.
func nextEvent(r *bufio.Reader) (name, data string, err error) {
	for {
		line, err := r.ReadString('\n')
		if err != nil {
			return "", "", err
		}
		line = strings.TrimRight(line, "\r\n")
		switch {
		case line == "" && name != "":
			return name, data, nil
		case strings.HasPrefix(line, "event:"):
			name = strings.TrimSpace(strings.TrimPrefix(line, "event:"))
		case strings.HasPrefix(line, "data:"):
			data += strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		}
	}
}
