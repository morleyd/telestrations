package game

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
)

// The limits on a public server (limits.go). Home mode has none of them but
// the text limits, which are the schema's.

func publicWith(change func(m *Mode)) Mode {
	m := publicMode(false)
	change(&m)
	return m
}

// servePublicAs is app's API in public mode, as the game's players send it
// (asPlayer).
func servePublicAs(t *testing.T, app core.App, m Mode) http.Handler {
	t.Helper()
	return asPlayer(app, servePublic(t, app, m))
}

func TestModeFromEnvReadsTheLimits(t *testing.T) {
	base := map[string]string{"PUBLIC_MODE": "1", "ADMIN_EMAIL": testAdminEmail, "ADMIN_PASSWORD": testAdminPassword}
	m, err := ModeFromEnv(env(base))
	if err != nil || m.MaxPlayers != defaultMaxPlayers || m.MaxGames != defaultMaxGames || m.ProxyHeader != "" {
		t.Fatalf("defaults: %+v, %v", m, err)
	}
	base["MAX_PLAYERS"], base["MAX_GAMES"], base["TRUSTED_PROXY_HEADER"] = "12", "50", "Fly-Client-IP"
	m, err = ModeFromEnv(env(base))
	if err != nil || m.MaxPlayers != 12 || m.MaxGames != 50 || m.ProxyHeader != "Fly-Client-IP" {
		t.Fatalf("set: %+v, %v", m, err)
	}
	for _, bad := range []string{"0", "-3", "lots"} {
		base["MAX_PLAYERS"] = bad
		if _, err := ModeFromEnv(env(base)); err == nil || !strings.Contains(err.Error(), "MAX_PLAYERS") {
			t.Errorf("MAX_PLAYERS=%q: %v, want refused", bad, err)
		}
	}
}

func join(api http.Handler, g *testGame, name string) *httptest.ResponseRecorder {
	return call(api, http.MethodPost, "/api/collections/users/records",
		map[string]any{"username": name, "game_id": g.game.Id})
}

func TestAGameHoldsAtMostMaxPlayers(t *testing.T) {
	app := newTestApp(t)
	api := servePublicAs(t, app, publicWith(func(m *Mode) { m.MaxPlayers = 3 }))
	lobby := newLobby(t, app, "ann", "ben")

	if rec := join(api, lobby, "cat"); rec.Code != http.StatusOK {
		t.Fatalf("third player: %d %s", rec.Code, rec.Body)
	}
	rec := join(api, lobby, "dan")
	if code, _ := refusal(rec); rec.Code != http.StatusBadRequest || code != codeGameFull {
		t.Fatalf("fourth player: %d %s, want refused as %s", rec.Code, rec.Body, codeGameFull)
	}
}

// The cap is public mode's: a home network trusts the room, and the soak
// simulator plays games of 50 and more.
func TestAtHomeAGameHasNoPlayerCap(t *testing.T) {
	app := newTestApp(t)
	api := serveAPI(t, app)
	lobby := newLobby(t, app, "ann")
	for i := range defaultMaxPlayers + 1 {
		if rec := join(api, lobby, "p"+strings.Repeat("x", i%5)+string(rune('a'+i%26))); rec.Code != http.StatusOK {
			t.Fatalf("player %d: %d %s", i+2, rec.Code, rec.Body)
		}
	}
}

func TestTheServerHoldsAtMostMaxGames(t *testing.T) {
	app := newTestApp(t)
	api := servePublicAs(t, app, publicWith(func(m *Mode) { m.MaxGames = 2 }))
	newLobby(t, app, "ann")
	newLobby(t, app, "ben")

	rec := call(api, http.MethodPost, gamesPath, map[string]any{"roundDuration": -1})
	if code, _ := refusal(rec); rec.Code != http.StatusServiceUnavailable || code != codeServerFull {
		t.Fatalf("third game: %d %s, want 503 %s", rec.Code, rec.Body, codeServerFull)
	}
}

// Everywhere, not only in public mode: they're the schema's.
func TestNamesAndWordsHaveALimit(t *testing.T) {
	app := newTestApp(t)
	api := serveAPI(t, app)
	lobby := newLobby(t, app, "ann")
	if rec := join(api, lobby, strings.Repeat("n", 25)); rec.Code != http.StatusBadRequest {
		t.Errorf("a 25-character name: %d, want refused", rec.Code)
	}
	if rec := join(api, lobby, strings.Repeat("é", 24)); rec.Code != http.StatusOK {
		t.Errorf("a 24-character name: %d %s, want let in", rec.Code, rec.Body)
	}

	g := newGame(t, app, "cat", "dan")
	word := g.nextTurn(t, "cat", "cat")
	word["prompt"] = strings.Repeat("w", 201)
	if rec := call(api, http.MethodPost, turnsPath, word); rec.Code != http.StatusBadRequest {
		t.Errorf("a 201-character word: %d, want refused", rec.Code)
	}
	word["prompt"] = strings.Repeat("w", 200)
	if rec := call(api, http.MethodPost, turnsPath, word); rec.Code != http.StatusOK {
		t.Errorf("a 200-character word: %d %s", rec.Code, rec.Body)
	}
}

// fromIP is callWithCode from the address ip, given the way a proxy does
// when header is set, else as the connection's own.
func fromIP(api http.Handler, ip, header, path, code string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, path, nil)
	req.Header.Set(gameCodeHeader, code)
	if header != "" {
		req.Header.Set(header, ip)
	} else {
		req.RemoteAddr = ip + ":40000"
	}
	rec := httptest.NewRecorder()
	api.ServeHTTP(rec, req)
	return rec
}

// An address that keeps asking for games that aren't there is turned away,
// even for a real code, while everyone else carries on.
func TestGuessingCodesIsCutOff(t *testing.T) {
	app := newTestApp(t)
	api := servePublic(t, app, publicMode(false))
	g := newLobby(t, app, "ann")
	path := "/api/collections/games/records"

	for i := range 30 {
		if rec := fromIP(api, "198.51.100.7", "", path, "zz"+string(rune('a'+i%26))+"zz"); rec.Code != http.StatusOK {
			t.Fatalf("wrong code %d: %d, want an empty list", i+1, rec.Code)
		}
	}
	rec := fromIP(api, "198.51.100.7", "", path, g.code())
	if code, _ := refusal(rec); rec.Code != http.StatusTooManyRequests || code != codeTooManyCodes {
		t.Fatalf("after 30 wrong codes: %d %s, want 429 %s", rec.Code, rec.Body, codeTooManyCodes)
	}
	if rec := fromIP(api, "198.51.100.8", "", path, g.code()); rec.Code != http.StatusOK {
		t.Fatalf("another address: %d, want 200", rec.Code)
	}
}

// Behind a proxy, the visitor is the address in its header: without that,
// every visitor would share the proxy's, and one guesser would lock everyone
// out.
func TestBehindAProxyEachVisitorHasTheirOwnAllowance(t *testing.T) {
	app := newTestApp(t)
	api := servePublic(t, app, publicWith(func(m *Mode) { m.ProxyHeader = "Fly-Client-IP" }))
	g := newLobby(t, app, "ann")
	path := "/api/collections/games/records"

	for range 30 {
		fromIP(api, "203.0.113.1", "Fly-Client-IP", path, "qqqqq")
	}
	if rec := fromIP(api, "203.0.113.1", "Fly-Client-IP", path, g.code()); rec.Code != http.StatusTooManyRequests {
		t.Errorf("the guesser: %d, want 429", rec.Code)
	}
	if rec := fromIP(api, "203.0.113.2", "Fly-Client-IP", path, g.code()); rec.Code != http.StatusOK {
		t.Errorf("another visitor through the same proxy: %d, want 200", rec.Code)
	}
}

func TestPublicModeTurnsOnTheRateLimits(t *testing.T) {
	app := newTestApp(t)
	api := servePublicAs(t, app, publicMode(false))

	if !app.Settings().RateLimits.Enabled {
		t.Fatal("rate limits are off")
	}
	// games:create allows 10 a minute from one address.
	for i := range 10 {
		if rec := call(api, http.MethodPost, gamesPath, map[string]any{"roundDuration": -1}); rec.Code != http.StatusOK {
			t.Fatalf("game %d: %d %s", i+1, rec.Code, rec.Body)
		}
	}
	if rec := call(api, http.MethodPost, gamesPath, map[string]any{"roundDuration": -1}); rec.Code != http.StatusTooManyRequests {
		t.Fatalf("game 11 in a minute: %d, want 429", rec.Code)
	}
}

// In public mode the client log only takes reports about a game that exists,
// named by its id and code.
func TestPublicClientLogNeedsARealGame(t *testing.T) {
	app, read := loggedApp(t, func(msg string) bool { return strings.HasPrefix(msg, "client: ") })
	api := servePublic(t, app, publicMode(false))
	g := newLobby(t, app, "ann")

	batch := func(game, gameID string) []byte {
		body, _ := json.Marshal(map[string]any{
			"game": game, "gameId": gameID,
			"entries": []map[string]any{{"seq": 1, "level": "info", "event": "hello"}},
		})
		return body
	}
	for _, b := range [][]byte{batch("", ""), batch("zzzzz", g.game.Id), batch(g.code(), "nosuchgame")} {
		if rec := postLog(api, "text/plain", b); rec.Code != http.StatusNoContent {
			t.Fatalf("status %d", rec.Code)
		}
	}
	if n := len(read()); n != 0 {
		t.Fatalf("logged %d entries about no game", n)
	}
	if rec := postLog(api, "text/plain", batch(g.code(), g.game.Id)); rec.Code != http.StatusNoContent {
		t.Fatalf("status %d", rec.Code)
	}
	if n := len(read()); n != 1 {
		t.Fatalf("logged %d entries about the game, want 1", n)
	}
}
