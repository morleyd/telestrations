package game

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// POST /api/stories/{id}/timeout: a player's round timer ran out with nothing
// entered, so the server skips their turn, marked timed out. (Partial work
// is sent as an ordinary turn flagged timed_out instead.) The refusals that
// carry a code TakeTurn acts on are in TestRefusalCodes; these are the rest.

func TestTimeoutRefusals(t *testing.T) {
	app := newTestApp(t)
	api := serveAPI(t, app)
	timeout := func(storyID string, body any) *httptest.ResponseRecorder {
		return call(api, http.MethodPost, "/api/stories/"+storyID+"/timeout", body)
	}

	cases := []struct {
		name   string
		timed  bool
		do     func(g *testGame) *httptest.ResponseRecorder
		status int
		says   string // in the message
		code   string
	}{
		{"an untimed game", false, func(g *testGame) *httptest.ResponseRecorder {
			return timeout(g.stories["ann"].Id, map[string]any{"user_id": g.players["ann"].Id})
		}, http.StatusBadRequest, "no round timer", ""},
		{"no player", true, func(g *testGame) *httptest.ResponseRecorder {
			return timeout(g.stories["ann"].Id, map[string]any{"user_id": ""})
		}, http.StatusBadRequest, "", codeNotYourTurn},
		{"an unknown player", true, func(g *testGame) *httptest.ResponseRecorder {
			return timeout(g.stories["ann"].Id, map[string]any{"user_id": "nobody123456789"})
		}, http.StatusBadRequest, "", codeNotYourTurn},
		{"an unknown story", true, func(g *testGame) *httptest.ResponseRecorder {
			return timeout("nostory12345678", map[string]any{"user_id": g.players["ann"].Id})
		}, http.StatusNotFound, "", ""},
		{"a malformed body", true, func(g *testGame) *httptest.ResponseRecorder {
			req := httptest.NewRequest(http.MethodPost, "/api/stories/"+g.stories["ann"].Id+"/timeout",
				bytes.NewReader([]byte("{not json")))
			req.Header.Set("Content-Type", "application/json")
			rec := httptest.NewRecorder()
			api.ServeHTTP(rec, req)
			return rec
		}, http.StatusBadRequest, "", ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			g := newGame(t, app, "ann", "ben")
			if c.timed {
				g.timed(t)
			}
			rec := c.do(g)
			if rec.Code != c.status {
				t.Fatalf("status %d, want %d: %s", rec.Code, c.status, rec.Body)
			}
			if !strings.Contains(rec.Body.String(), c.says) {
				t.Errorf("message %s doesn't say %q", rec.Body, c.says)
			}
			if code, _ := refusal(rec); code != c.code {
				t.Errorf("code %q, want %q", code, c.code)
			}
			if n := len(g.turnsBy(t, "ann", "ann")); n != 0 {
				t.Errorf("a refused timeout wrote %d turns", n)
			}
		})
	}
}

// An expired drawing turn passes the word on; an expired guess passes the
// drawing on. Both are skips marked timed out, and the story moves to the
// next seat.
func TestTimeoutPassesThePreviousTurnOn(t *testing.T) {
	app := newTestApp(t)
	api := serveAPI(t, app)
	g := newGame(t, app, "ann", "ben", "cat", "dan").timed(t)
	g.play(t, "ann", "ann")

	if rec := g.timeout(api, "ann", "ben"); rec.Code != http.StatusOK {
		t.Fatalf("ben's timeout: %d %s", rec.Code, rec.Body)
	}
	word := g.turnsBy(t, "ann", "ben")[0]
	if !word.GetBool("skipped") || !word.GetBool("timed_out") || word.GetBool("is_drawing") ||
		word.GetString("prompt") != "ann's word" {
		t.Fatalf("ben's expired drawing turn: skipped=%v timed_out=%v is_drawing=%v prompt=%q",
			word.GetBool("skipped"), word.GetBool("timed_out"), word.GetBool("is_drawing"), word.GetString("prompt"))
	}

	g.drawWithFile(t, "ann", "cat") // cat draws ann's word
	if rec := g.timeout(api, "ann", "dan"); rec.Code != http.StatusOK {
		t.Fatalf("dan's timeout: %d %s", rec.Code, rec.Body)
	}
	drawing := g.turnsBy(t, "ann", "dan")[0]
	if !drawing.GetBool("skipped") || !drawing.GetBool("timed_out") || !drawing.GetBool("is_drawing") ||
		drawing.GetString("drawing") == "" {
		t.Fatalf("dan's expired guess: skipped=%v timed_out=%v is_drawing=%v drawing=%q",
			drawing.GetBool("skipped"), drawing.GetBool("timed_out"), drawing.GetBool("is_drawing"),
			drawing.GetString("drawing"))
	}
	if s, _ := loadStory(app, g.stories["ann"].Id); s.NextUser != "" || s.Taken != 4 {
		t.Fatalf("ann's story: %d turns, waiting on %s; want done after 4", s.Taken, g.name(s.NextUser))
	}
}

// Partial work at the timer is the player's own turn, flagged timed out. A
// client can't pass it off as a skip (which the review would hide): only the
// server writes skips.
func TestPartialWorkAtTimeoutIsTheirOwnTurn(t *testing.T) {
	app := newTestApp(t)
	api := serveAPI(t, app)
	g := newGame(t, app, "ann", "ben").timed(t)

	turn := g.nextTurn(t, "ann", "ann")
	turn["timed_out"] = true
	turn["skipped"] = true
	if rec := call(api, http.MethodPost, turnsPath, turn); rec.Code != http.StatusOK {
		t.Fatalf("partial work: %d %s", rec.Code, rec.Body)
	}
	saved := g.turnsBy(t, "ann", "ann")[0]
	if saved.GetBool("skipped") || !saved.GetBool("timed_out") || saved.GetString("prompt") != "ann's word" {
		t.Fatalf("ann's partial turn: skipped=%v timed_out=%v prompt=%q, want her own word, timed out",
			saved.GetBool("skipped"), saved.GetBool("timed_out"), saved.GetString("prompt"))
	}
}
