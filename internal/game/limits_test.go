package game

import (
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

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
		req.RemoteAddr = net.JoinHostPort(ip, "40000")
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
		if rec := fromIP(api, "198.51.100.7", "", path, fmt.Sprintf("zz%03d", i)); rec.Code != http.StatusOK {
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

// Asking again about the same wrong code costs nothing more: a page retries,
// and polls a game that has gone. Only a new wrong code counts, so a party's
// typos don't lock it out of its own game; 30 different ones still do.
func TestOnlyDifferentWrongCodesCount(t *testing.T) {
	app := newTestApp(t)
	api := servePublic(t, app, publicMode(false))
	g := newLobby(t, app, "ann")
	path := "/api/collections/games/records"

	for range 3 {
		for i := range 29 {
			fromIP(api, "198.51.100.7", "", path, fmt.Sprintf("zz%03d", i))
		}
	}
	if rec := fromIP(api, "198.51.100.7", "", path, g.code()); rec.Code != http.StatusOK {
		t.Fatalf("after 29 wrong codes, each three times: %d, want 200", rec.Code)
	}
	fromIP(api, "198.51.100.7", "", path, "zz029")
	if rec := fromIP(api, "198.51.100.7", "", path, g.code()); rec.Code != http.StatusTooManyRequests {
		t.Fatalf("after the 30th different wrong code: %d, want 429", rec.Code)
	}
}

// guessesAt is a codeGuesses on a clock the test moves (*now).
func guessesAt(max int, window time.Duration, now *time.Time) *codeGuesses {
	c := newCodeGuesses(max, window)
	c.now = func() time.Time { return *now }
	return c
}

// A block lasts its window, and then the address starts again from nothing.
func TestACodeGuessBlockLiftsAfterItsWindow(t *testing.T) {
	now := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	c := guessesAt(3, time.Minute, &now)
	const ip = "198.51.100.7"

	if c.miss(ip, "aaaaa") || c.miss(ip, "bbbbb") || c.blocked(ip) {
		t.Fatal("blocked after two wrong codes of three")
	}
	if !c.miss(ip, "ccccc") || !c.blocked(ip) {
		t.Fatal("not blocked after the third wrong code")
	}
	now = now.Add(time.Minute - time.Second)
	if !c.blocked(ip) {
		t.Fatal("the block lifted before its window ran out")
	}
	now = now.Add(time.Second)
	if c.blocked(ip) {
		t.Fatal("still blocked once the window ran out")
	}
	if c.miss(ip, "ddddd") || c.miss(ip, "eeeee") || c.blocked(ip) {
		t.Fatal("the next window didn't count from nothing")
	}
}

// The windows that have run out are forgotten once there are more than
// 10000, so addresses that come and go can't grow the map without end.
func TestCodeGuessesForgetOldWindows(t *testing.T) {
	now := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	c := guessesAt(30, time.Minute, &now)
	for i := range 10001 {
		c.miss(fmt.Sprintf("10.%d.%d.%d", i>>16, i>>8&255, i&255), "zzzzz")
	}
	now = now.Add(30 * time.Second)
	c.miss("198.51.100.7", "zzzzz") // half way through its window
	now = now.Add(30 * time.Second)
	c.miss("198.51.100.8", "zzzzz")

	if len(c.misses) != 2 || c.misses["198.51.100.7"] == nil || c.misses["198.51.100.8"] == nil {
		t.Fatalf("%d windows kept, want the 2 still running", len(c.misses))
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

	for i := range 30 {
		fromIP(api, "203.0.113.1", "Fly-Client-IP", path, fmt.Sprintf("qq%03d", i))
	}
	if rec := fromIP(api, "203.0.113.1", "Fly-Client-IP", path, g.code()); rec.Code != http.StatusTooManyRequests {
		t.Errorf("the guesser: %d, want 429", rec.Code)
	}
	if rec := fromIP(api, "203.0.113.2", "Fly-Client-IP", path, g.code()); rec.Code != http.StatusOK {
		t.Errorf("another visitor through the same proxy: %d, want 200", rec.Code)
	}
}

func TestAnAddressKeyIsTheSlash64OfAnIPv6Address(t *testing.T) {
	for _, tc := range []struct{ ip, want string }{
		{"198.51.100.7", "198.51.100.7"},
		{"::ffff:198.51.100.7", "198.51.100.7"},
		{"2001:db8:1:2:aaaa:bbbb:cccc:dddd", "2001:db8:1:2::"},
		{"2001:0db8:0001:0002:0000:0000:0000:0001", "2001:db8:1:2::"},
		{"2001:db8:1:3::1", "2001:db8:1:3::"},
		{"fe80::1%eth0", "fe80::"},
		{"", ""},
		{"not an address", "not an address"},
	} {
		if got := addressKey(tc.ip); got != tc.want {
			t.Errorf("addressKey(%q) = %q, want %q", tc.ip, got, tc.want)
		}
	}
}

// One home connection holds a whole IPv6 /64, so a guesser moving around in
// it is still one guesser, with or without a proxy in front; the next /64 is
// someone else.
func TestGuessingCodesFromOneSlash64IsOneGuesser(t *testing.T) {
	for _, header := range []string{"", "Fly-Client-IP"} {
		t.Run("header="+header, func(t *testing.T) {
			app := newTestApp(t)
			api := servePublic(t, app, publicWith(func(m *Mode) { m.ProxyHeader = header }))
			g := newLobby(t, app, "ann")
			path := "/api/collections/games/records"

			for i := range 30 {
				ip := fmt.Sprintf("2001:db8:1:2::%x", i+1)
				if rec := fromIP(api, ip, header, path, fmt.Sprintf("zz%03d", i)); rec.Code != http.StatusOK {
					t.Fatalf("wrong code %d: %d, want an empty list", i+1, rec.Code)
				}
			}
			if rec := fromIP(api, "2001:db8:1:2:ffff:ffff:ffff:ffff", header, path, g.code()); rec.Code != http.StatusTooManyRequests {
				t.Errorf("another address in the same /64: %d, want 429", rec.Code)
			}
			if rec := fromIP(api, "2001:db8:1:3::1", header, path, g.code()); rec.Code != http.StatusOK {
				t.Errorf("the next /64: %d, want 200", rec.Code)
			}
		})
	}
}

// createGameFrom asks api for a new game from the address ip, given by the
// proxy in header.
func createGameFrom(api http.Handler, ip, header string) int {
	req := httptest.NewRequest(http.MethodPost, gamesPath, strings.NewReader(`{"roundDuration":-1}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(header, ip)
	rec := httptest.NewRecorder()
	api.ServeHTTP(rec, req)
	return rec.Code
}

// PocketBase's rate limiter counts a /64 behind the proxy as one visitor too,
// and an IPv4 address as itself.
func TestBehindAProxyTheRateLimitsCountASlash64AsOne(t *testing.T) {
	const header = "Fly-Client-IP"
	app := newTestApp(t)
	api := servePublicAs(t, app, publicWith(func(m *Mode) { m.ProxyHeader = header }))

	// games:create allows 10 a minute from one address.
	for i := range 10 {
		if code := createGameFrom(api, fmt.Sprintf("2001:db8:1:2::%x", i+1), header); code != http.StatusOK {
			t.Fatalf("game %d: %d", i+1, code)
		}
	}
	if code := createGameFrom(api, "2001:db8:1:2:ffff::1", header); code != http.StatusTooManyRequests {
		t.Errorf("game 11 from the same /64: %d, want 429", code)
	}
	if code := createGameFrom(api, "2001:db8:1:3::1", header); code != http.StatusOK {
		t.Errorf("a game from the next /64: %d, want 200", code)
	}

	for i := range 10 {
		if code := createGameFrom(api, "203.0.113.1", header); code != http.StatusOK {
			t.Fatalf("IPv4 game %d: %d", i+1, code)
		}
	}
	if code := createGameFrom(api, "203.0.113.1", header); code != http.StatusTooManyRequests {
		t.Errorf("IPv4 game 11: %d, want 429", code)
	}
	if code := createGameFrom(api, "203.0.113.2", header); code != http.StatusOK {
		t.Errorf("a game from the next IPv4 address: %d, want 200", code)
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

// A party behind one router shares an address, and each of its browsers
// posts its log every couple of seconds while turns come in: the client log
// takes 600 posts a minute from one address before it says no.
func TestTheClientLogTakesAPartysPosts(t *testing.T) {
	app := newTestApp(t)
	api := servePublic(t, app, publicMode(false))
	g := newLobby(t, app, "ann")
	body, _ := json.Marshal(map[string]any{"game": g.code(), "gameId": g.game.Id, "entries": []map[string]any{}})

	for i := range 600 {
		if rec := postLog(api, "text/plain", body); rec.Code != http.StatusNoContent {
			t.Fatalf("post %d: %d, want 204", i+1, rec.Code)
		}
	}
	if rec := postLog(api, "text/plain", body); rec.Code != http.StatusTooManyRequests {
		t.Fatalf("post 601 in a minute: %d, want 429", rec.Code)
	}
}

// The limits are saved in the data directory, so a server started at home on
// one that ran in public mode turns them off again.
func TestAtHomeTheSavedLimitsAreTurnedOff(t *testing.T) {
	app := newTestApp(t)
	servePublic(t, app, publicWith(func(m *Mode) { m.ProxyHeader = "Fly-Client-IP" }))
	if err := app.ReloadSettings(); err != nil {
		t.Fatal(err)
	}
	if s := app.Settings(); !s.RateLimits.Enabled || len(s.TrustedProxy.Headers) == 0 {
		t.Fatalf("public mode saved rate limits %v, proxy headers %v", s.RateLimits.Enabled, s.TrustedProxy.Headers)
	}

	// The same data dir, started at home.
	if err := ConfigureServe(&core.ServeEvent{App: app}, Mode{}); err != nil {
		t.Fatal(err)
	}
	if err := app.ReloadSettings(); err != nil {
		t.Fatal(err)
	}
	if s := app.Settings(); s.RateLimits.Enabled || len(s.TrustedProxy.Headers) != 0 {
		t.Errorf("at home: rate limits %v, proxy headers %v, want both off", s.RateLimits.Enabled, s.TrustedProxy.Headers)
	}
	if err := resetLimits(app); err != nil {
		t.Errorf("again, with nothing to turn off: %v", err)
	}
}
