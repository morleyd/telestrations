package game

import (
	"bytes"
	"encoding/json"
	"fmt"
	"hash/maphash"
	"io"
	"net/http"
	"net/netip"
	"sync"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/hook"
	"github.com/pocketbase/pocketbase/tools/router"
)

// Limits on a public server: what one visitor, or one game, can take of it.
// None of them apply on a home network, where everyone is in the room (and
// every browser in the Playwright suite shares one address).
//
//   - The visitor's address comes from the proxy in front of the server
//     (Mode.ProxyHeader, e.g. Fly-Client-IP). Without it every visitor looks
//     like the proxy, and each limit below would be shared by everyone.
//   - An IPv6 visitor counts by their /64 (addressKey): one home connection
//     is given a whole /64, and a client that moved around inside it would
//     otherwise have a fresh allowance on every request. The code-guess limit
//     always keys on it; the rate limits do behind a proxy header (see
//     keyByAddress), and the request logs then record the /64 too.
//   - Requests are rate limited per address, with PocketBase's own limiter
//     (publicRateLimits). A whole party behind one home router shares an
//     address, so the numbers are generous: they stop a script, not a game.
//   - Guessing codes: an address that keeps asking for different games that
//     don't exist is turned away for a while (codeGuesses).
//   - A game holds at most Mode.MaxPlayers players, and the server at most
//     Mode.MaxGames games. That bounds the games and players, not the disk:
//     turns and their drawings are limited per address by rate
//     (turns:create), not in total, so a long game can still take room.
//   - The client log only takes reports about a game that exists.

const (
	defaultMaxPlayers = 30
	defaultMaxGames   = 1000
)

// publicRateLimits are the per-address limits in public mode: PocketBase's
// defaults (sign-in, batch, and every API request), plus each kind of record
// the game creates and the client log. Each is MaxRequests per Duration
// seconds.
var publicRateLimits = []core.RateLimitRule{
	{Label: "*:auth", MaxRequests: 2, Duration: 3},
	{Label: "/api/batch", MaxRequests: 3, Duration: 1},
	{Label: "games:create", MaxRequests: 10, Duration: 60},
	{Label: "users:create", MaxRequests: 60, Duration: 60},
	{Label: "stories:create", MaxRequests: 60, Duration: 60},
	{Label: "turns:create", MaxRequests: 300, Duration: 60},
	{Label: "*:create", MaxRequests: 20, Duration: 5},
	{Label: "POST /api/client-log", MaxRequests: 600, Duration: 60},
	{Label: "/api/", MaxRequests: 300, Duration: 10},
}

// Refusal codes for the limits (see refuse).
const (
	codeGameFull     = "game_full"
	codeServerFull   = "server_full"
	codeTooManyCodes = "too_many_wrong_codes"
)

const (
	msgGameFull     = "This game is full."
	msgServerFull   = "There are too many games going right now. Please try again later."
	msgTooManyCodes = "Too many wrong game codes. Please wait a few minutes and try again."
)

// applyLimits sets up the limits above on a public server.
func applyLimits(se *core.ServeEvent, m Mode) error {
	settings := se.App.Settings()
	settings.TrustedProxy.Headers = nil
	if m.ProxyHeader != "" {
		settings.TrustedProxy.Headers = []string{m.ProxyHeader}
	}
	settings.RateLimits.Enabled = true
	settings.RateLimits.Rules = publicRateLimits
	if err := se.App.Save(settings); err != nil {
		return err
	}

	if m.ProxyHeader != "" {
		se.Router.Bind(&hook.Handler[*core.RequestEvent]{
			Id: "gameAddressKey",
			// Ahead of PocketBase's rate limiter, so it counts by the key too.
			Priority: apis.DefaultRateLimitMiddlewarePriority - 1,
			Func:     keyByAddress(m.ProxyHeader),
		})
	}
	guesses := newCodeGuesses(30, 10*time.Minute)
	se.Router.Bind(&hook.Handler[*core.RequestEvent]{
		Id:   "gameCodeGuesses",
		Func: guesses.middleware,
	})
	se.Router.Bind(&hook.Handler[*core.RequestEvent]{
		Id:   "gameClientLogForAGame",
		Func: clientLogForAGame,
	})

	// Bound after the guards in host.go, so these run inside their write
	// transactions: two joins racing for the last seat can't both get it.
	se.App.OnRecordCreateRequest("users").BindFunc(func(e *core.RecordRequestEvent) error {
		var n int
		err := e.App.DB().NewQuery("SELECT COUNT(*) FROM users WHERE game_id = {:g}").
			Bind(dbx.Params{"g": e.Record.GetString("game_id")}).Row(&n)
		if err != nil {
			return err
		}
		if n >= m.MaxPlayers {
			return refuse(codeGameFull, msgGameFull)
		}
		return e.Next()
	})
	se.App.OnRecordCreateRequest("games").BindFunc(func(e *core.RecordRequestEvent) error {
		n, err := e.App.CountRecords("games")
		if err != nil {
			return err
		}
		if int(n) >= m.MaxGames {
			e.App.Logger().Warn("limits: game refused, the server is full", "games", n)
			return refuseWith(http.StatusServiceUnavailable, codeServerFull, msgServerFull)
		}
		return e.Next()
	})
	return nil
}

// resetLimits turns off, at home, what applyLimits saved in the data
// directory: the rate limits and the trusted proxy header. Settings live in
// pb_data, so a data directory that once ran in public mode would otherwise
// keep rate limiting a home party, all on one address, and keep trusting a
// header anyone on the network can write.
func resetLimits(app core.App) error {
	settings := app.Settings()
	if !settings.RateLimits.Enabled && len(settings.TrustedProxy.Headers) == 0 {
		return nil
	}
	settings.RateLimits.Enabled = false
	settings.TrustedProxy.Headers = nil
	if err := app.Save(settings); err != nil {
		return fmt.Errorf("reset the public limits: %w", err)
	}
	return nil
}

// codeGuesses turns away an address that has asked for too many games that
// don't exist: max different wrong codes per window. A request about a game
// names its code in the X-Game-Code header, so that's where a miss shows,
// whichever API it comes through. Only different codes count: the page asks
// again about the same code (a retry, a poll, every request of a page left
// open on a game that has since gone), and a party behind one router can make
// a few typos between them. A guessing script, which has to try new codes,
// stops.
type codeGuesses struct {
	max    int
	window time.Duration

	mu     sync.Mutex
	misses map[string]*guessWindow
	seed   maphash.Seed
	now    func() time.Time
}

type guessWindow struct {
	start time.Time
	// The wrong codes tried in the window, hashed: a code is whatever the
	// header says, and a long one shouldn't take room.
	codes map[uint64]bool
}

func newCodeGuesses(max int, window time.Duration) *codeGuesses {
	return &codeGuesses{max: max, window: window, misses: map[string]*guessWindow{}, seed: maphash.MakeSeed(), now: time.Now}
}

func (c *codeGuesses) middleware(e *core.RequestEvent) error {
	code := e.Request.Header.Get(gameCodeHeader)
	if code == "" {
		return e.Next()
	}
	ip := addressKey(e.RealIP())
	if c.blocked(ip) {
		return refuseWith(http.StatusTooManyRequests, codeTooManyCodes, msgTooManyCodes)
	}
	var found int
	err := e.App.DB().NewQuery("SELECT COUNT(*) FROM games WHERE game_code = {:c}").
		Bind(dbx.Params{"c": code}).Row(&found)
	if err == nil && found == 0 && c.miss(ip, code) {
		e.App.Logger().Warn("limits: too many wrong game codes", "ip", ip)
	}
	return e.Next()
}

// current is ip's window, a fresh one if its last has run out. Call with mu
// held.
func (c *codeGuesses) current(ip string) *guessWindow {
	w := c.misses[ip]
	if w == nil || c.now().Sub(w.start) >= c.window {
		w = &guessWindow{start: c.now(), codes: map[uint64]bool{}}
		c.misses[ip] = w
	}
	return w
}

func (c *codeGuesses) blocked(ip string) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return len(c.current(ip).codes) >= c.max
}

// miss counts the wrong code from ip, unless ip has tried it already in this
// window, and reports whether that was the one that used up its allowance.
func (c *codeGuesses) miss(ip, code string) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	w := c.current(ip)
	h := maphash.String(c.seed, code)
	if w.codes[h] {
		return false
	}
	w.codes[h] = true
	// Forget windows that have run out, so the map can't grow without end.
	if len(c.misses) > 10000 {
		for k, v := range c.misses {
			if c.now().Sub(v.start) >= c.window {
				delete(c.misses, k)
			}
		}
	}
	return len(w.codes) == c.max
}

// addressKey is the key the per-address limits count ip under: an IPv6
// address by its /64, the block one connection is given, and an IPv4 address
// as it is. Anything that doesn't parse is its own key.
func addressKey(ip string) string {
	a, err := netip.ParseAddr(ip)
	if err != nil {
		return ip
	}
	a = a.Unmap() // an IPv4 address written as IPv6 is still that one address
	if a.Is4() {
		return a.String()
	}
	p, err := a.Prefix(64)
	if err != nil {
		return ip
	}
	return p.Addr().String()
}

// keyByAddress rewrites the proxy's address header (the trusted one, header)
// to the visitor's addressKey, so that everything after it that asks
// e.RealIP(), PocketBase's rate limiter included, counts a /64 as one
// visitor. Without a proxy header there's nothing to rewrite: PocketBase's
// limiter then counts the connection's own address (RemoteAddr), each IPv6
// address apart, and only codeGuesses, which keys on addressKey itself,
// counts the /64.
func keyByAddress(header string) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		// An IPv4 key is the address itself, so only IPv6 needs rewriting.
		if ip := e.RealIP(); addressKey(ip) != ip {
			e.Request.Header.Set(header, addressKey(ip))
		}
		return e.Next()
	}
}

// clientLogForAGame drops a client log that isn't about an existing game:
// the game's id and code must match. The browser posts it with sendBeacon,
// which can't set headers, so the code comes in the body. It answers as the
// log route would (204), so a page never notices.
func clientLogForAGame(e *core.RequestEvent) error {
	if e.Request.Method != http.MethodPost || e.Request.URL.Path != "/api/client-log" {
		return e.Next()
	}
	data, err := io.ReadAll(http.MaxBytesReader(e.Response, e.Request.Body, maxClientLogBytes))
	if err != nil {
		return e.BadRequestError("Invalid log payload.", err)
	}
	e.Request.Body = io.NopCloser(bytes.NewReader(data))
	var body clientLogGame
	// A body that doesn't parse names no game, and is dropped below like any
	// other; the log route would refuse it anyway.
	_ = json.Unmarshal(data, &body)
	var n int
	err = e.App.DB().NewQuery("SELECT COUNT(*) FROM games WHERE id = {:id} AND game_code = {:c}").
		Bind(dbx.Params{"id": body.GameID, "c": body.Game}).Row(&n)
	if err != nil || n == 0 || body.Game == "" {
		return e.NoContent(http.StatusNoContent)
	}
	return e.Next()
}

// refuseWith is refuse with another status than 400.
func refuseWith(status int, code, msg string) error {
	return router.NewApiError(status, msg, map[string]error{"code": refusalCode(code)})
}
