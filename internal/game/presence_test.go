package game

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
	"testing"

	"github.com/pocketbase/dbx"
)

// How long notebooks are held (the progress view's held_seconds) and who's at
// their turn screen (presence), as the waiting screen reads them.

// heldSeconds reads each story's held_seconds through the records API, as the
// client does, keyed by starter's username. It fails the test unless every
// one arrives as a JSON number.
func (g *testGame) heldSeconds(t *testing.T, api http.Handler) map[string]float64 {
	t.Helper()
	filter := url.QueryEscape(`game_id="` + g.game.Id + `"`)
	rec := call(api, http.MethodGet, "/api/collections/progress/records?filter="+filter, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("progress: %d %s", rec.Code, rec.Body)
	}
	var body struct {
		Items []map[string]any `json:"items"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	out := map[string]float64{}
	for _, row := range body.Items {
		n, ok := row["held_seconds"].(float64)
		if !ok {
			t.Fatalf("held_seconds is %T (%v), want a number", row["held_seconds"], row["held_seconds"])
		}
		out[g.name(row["starter_user_id"].(string))] = n
	}
	return out
}

// backdate moves a record's created time back by seconds, by the database's
// clock.
func backdate(t *testing.T, g *testGame, table, id string, seconds int) {
	t.Helper()
	_, err := g.app.DB().NewQuery(`UPDATE ` + table + ` SET created =
	  strftime('%Y-%m-%d %H:%M:%fZ', 'now', '-' || {:s} || ' seconds') WHERE id = {:id}`).
		Bind(dbx.Params{"s": seconds, "id": id}).Execute()
	if err != nil {
		t.Fatal(err)
	}
}

func requireAbout(t *testing.T, what string, got float64, want int) {
	t.Helper()
	if got < float64(want) || got > float64(want+3) {
		t.Errorf("%s = %v, want about %d", what, got, want)
	}
}

// A story is held from when the turn before the one waiting was written; its
// opening word, from when the story was created. PocketBase types a view's
// columns from the query, so held_seconds must be cast to reach the client as
// a number.
func TestHeldSecondsCountFromThePreviousTurn(t *testing.T) {
	app := newTestApp(t)
	api := serveAPI(t, app)
	g := newGame(t, app, "ann", "ben")

	progress, err := app.FindCollectionByNameOrId("progress")
	if err != nil {
		t.Fatal(err)
	}
	if f := progress.Fields.GetByName("held_seconds"); f == nil || f.Type() != "number" {
		t.Fatalf("progress.held_seconds: %v, want a number field", f)
	}

	backdate(t, g, "stories", g.stories["ann"].Id, 90)
	backdate(t, g, "stories", g.stories["ben"].Id, 200)
	held := g.heldSeconds(t, api)
	requireAbout(t, "ann's opening word", held["ann"], 90)
	requireAbout(t, "ben's opening word", held["ben"], 200)

	// ann writes her word: her story is now ben's, held from that turn.
	g.play(t, "ann", "ann")
	backdate(t, g, "turns", g.lastTurnBy(t, "ann", "ann").Id, 30)
	held = g.heldSeconds(t, api)
	requireAbout(t, "ann's story with ben", held["ann"], 30)
	requireAbout(t, "ben's opening word", held["ben"], 200)
}

func (g *testGame) presence(api http.Handler, name, workingOn string) int {
	path := "/api/games/" + g.game.Id + "/players/" + g.players[name].Id + "/presence"
	return call(api, http.MethodPost, path, map[string]any{"working_on": workingOn}).Code
}

// A presence report sets the player's working_on and resets their idle time,
// which the players endpoint returns: -1 until they're first seen. It's
// written without saving the record, so no hooks run and `updated` stays put.
func TestPresenceReportsWhatsOnScreenAndWhenSeen(t *testing.T) {
	app := newTestApp(t)
	api := serveAPI(t, app)
	g := newGame(t, app, "ann", "ben")

	got := g.status(t, api)
	if got["ann"].IdleSeconds != -1 || got["ann"].WorkingOn != "" {
		t.Fatalf("before any report: %+v, want idle -1 and working on nothing", got["ann"])
	}

	updated := g.players["ann"].GetDateTime("updated")
	turn := g.stories["ann"].Id + ":0"
	if code := g.presence(api, "ann", turn); code != http.StatusNoContent {
		t.Fatalf("presence: %d", code)
	}
	got = g.status(t, api)
	if got["ann"].WorkingOn != turn {
		t.Errorf("after a report: %+v, want working on %s", got["ann"], turn)
	}
	requireAbout(t, "ann's idle seconds just after a report", float64(got["ann"].IdleSeconds), 0)
	if got["ben"].IdleSeconds != -1 {
		t.Errorf("ben, who never reported: idle %d, want -1", got["ben"].IdleSeconds)
	}
	ann, err := app.FindRecordById("users", g.players["ann"].Id)
	if err != nil {
		t.Fatal(err)
	}
	if ann.GetDateTime("updated").String() != updated.String() {
		t.Errorf("a presence report saved the record: updated %v, was %v", ann.GetDateTime("updated"), updated)
	}

	// Gone quiet for a while: the idle time is by the database's clock.
	_, err = app.DB().NewQuery(`UPDATE users SET seen_at =
	  strftime('%Y-%m-%d %H:%M:%fZ', 'now', '-75 seconds') WHERE id = {:id}`).
		Bind(dbx.Params{"id": g.players["ann"].Id}).Execute()
	if err != nil {
		t.Fatal(err)
	}
	requireAbout(t, "ann's idle seconds", float64(g.status(t, api)["ann"].IdleSeconds), 75)

	// Off the turn screen: working on nothing.
	if code := g.presence(api, "ann", ""); code != http.StatusNoContent {
		t.Fatalf("presence: %d", code)
	}
	got = g.status(t, api)
	if got["ann"].WorkingOn != "" {
		t.Errorf("after reporting nothing on screen: %+v", got["ann"])
	}
	requireAbout(t, "ann's idle seconds after reporting nothing on screen", float64(got["ann"].IdleSeconds), 0)
}

// Only a player in the game can report, and only something turn-sized.
func TestPresenceRefusesStrangers(t *testing.T) {
	app := newTestApp(t)
	api := serveAPI(t, app)
	g := newGame(t, app, "ann", "ben")
	other := newGame(t, app, "cat")

	path := func(gameID, userID string) string {
		return "/api/games/" + gameID + "/players/" + userID + "/presence"
	}
	for _, c := range []struct {
		name, path string
		body       any
		want       int
	}{
		{"a player in another game", path(g.game.Id, other.players["cat"].Id), map[string]any{"working_on": ""}, http.StatusNotFound},
		{"an unknown player", path(g.game.Id, "nobody"), map[string]any{"working_on": ""}, http.StatusNotFound},
		{"too long a turn", path(g.game.Id, g.players["ann"].Id), map[string]any{"working_on": strings.Repeat("x", 101)}, http.StatusBadRequest},
	} {
		if rec := call(api, http.MethodPost, c.path, c.body); rec.Code != c.want {
			t.Errorf("%s: %d %s, want %d", c.name, rec.Code, rec.Body, c.want)
		}
	}
	if got := g.status(t, api)["ann"]; got.IdleSeconds != -1 {
		t.Errorf("a refused report counted: %+v", got)
	}
}
