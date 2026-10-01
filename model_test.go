package main

import (
	"encoding/json"
	"fmt"
	"math/rand/v2"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"testing"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// A model-based test: random games, played one action at a time through the
// real routes, with the game's invariants checked after every action. It's
// the catch-all for combinations no hand-written test thinks of (a skip on
// the last seat, two dropped neighbours, a timeout right after a drop, ...).
//
// Each game comes from a seed; a failure names it, and MODEL_SEED=<n> replays
// just that game. -short plays fewer games.

func TestRandomGames(t *testing.T) {
	app := newTestApp(t)
	api := serveAPI(t, app)

	seeds := make([]uint64, 60)
	if testing.Short() {
		seeds = seeds[:8]
	}
	for i := range seeds {
		seeds[i] = uint64(i + 1)
	}
	if s := os.Getenv("MODEL_SEED"); s != "" {
		seed, err := strconv.ParseUint(s, 10, 64)
		if err != nil {
			t.Fatalf("MODEL_SEED: %v", err)
		}
		seeds = []uint64{seed}
	}
	played := map[string]int{}
	for _, seed := range seeds {
		t.Run(fmt.Sprintf("seed=%d", seed), func(t *testing.T) {
			playRandomGame(t, app, api, rand.New(rand.NewPCG(seed, 0)), played)
		})
	}
	t.Logf("%d games, actions played: %v", len(seeds), played)
}

// action is one thing a player or the host can do next, and what it must do.
type action struct {
	kind   string
	name   string
	weight int
	run    func(t *testing.T)
}

func playRandomGame(t *testing.T, app core.App, api http.Handler, rng *rand.Rand, played map[string]int) {
	n := 2 + rng.IntN(6)
	names := make([]string, n)
	for i := range names {
		names[i] = fmt.Sprintf("p%d", i)
	}
	g := newGame(t, app, names...).timed(t)
	host := g.players[names[0]]
	// Some players haven't opened their story when the game starts.
	for _, name := range names {
		if rng.IntN(3) == 0 {
			if err := app.Delete(g.stories[name]); err != nil {
				t.Fatal(err)
			}
			delete(g.stories, name)
		}
	}
	t.Logf("%d players; unopened: %v", n, unopened(g, names))

	var log []string
	fail := func(format string, args ...any) {
		t.Helper()
		t.Fatalf("after %v: "+format, append([]any{log}, args...)...)
	}
	expect := func(rec *httptest.ResponseRecorder, status int, what string) {
		t.Helper()
		if rec.Code != status {
			fail("%s: %d %s", what, rec.Code, rec.Body)
		}
	}

	for step := 0; ; step++ {
		if step > 20*n*n {
			fail("the game hasn't finished after %d actions", step)
		}
		dropped := g.droppedSet(t)
		stories, err := loadGameStories(app, g.game.Id)
		if err != nil {
			t.Fatal(err)
		}

		var actions []action
		owes := map[string]int{}
		for _, s := range stories {
			if s.NextUser == "" {
				continue
			}
			owes[s.NextUser]++
			starter, name := g.name(s.Starter), g.name(s.NextUser)
			actions = append(actions,
				action{"submit", "submit " + name + " on " + starter, 12, func(t *testing.T) {
					expect(g.submit(t, api, starter, name), http.StatusOK, "submit")
				}},
				action{"empty timeout", "empty timeout " + name + " on " + starter, 2, func(t *testing.T) {
					expect(g.timeout(api, starter, name), http.StatusOK, "timeout")
					if turn := g.turnsBy(t, starter, name)[0]; !turn.GetBool("skipped") || !turn.GetBool("timed_out") {
						fail("an empty timeout wrote a turn that isn't a timed-out skip")
					}
				}},
				action{"partial timeout", "partial timeout " + name + " on " + starter, 2, func(t *testing.T) {
					turn := g.nextTurn(t, starter, name)
					turn["timed_out"] = true
					expect(call(api, http.MethodPost, turnsPath, turn), http.StatusOK, "partial timeout")
					if turn := g.turnsBy(t, starter, name)[0]; turn.GetBool("skipped") || !turn.GetBool("timed_out") {
						fail("partial work on a timeout wasn't saved as the player's own timed-out turn")
					}
				}},
				action{"out-of-turn write", "out-of-turn write on " + starter, 1, func(t *testing.T) {
					other := names[rng.IntN(n)]
					if other == name {
						return
					}
					rec := call(api, http.MethodPost, turnsPath, g.turn(starter, other, rng.IntN(2) == 0))
					expect(rec, http.StatusBadRequest, other+"'s out-of-turn write")
					if code, _ := refusal(rec); code == "" {
						fail("%s's out-of-turn write was refused without a code: %s", other, rec.Body)
					}
				}},
			)
		}
		for _, name := range names {
			p := g.players[name]
			if dropped[p.Id] {
				continue
			}
			if owed := owes[p.Id]; owed > 0 {
				actions = append(actions, action{"host skip", "host skips " + name, 1, func(t *testing.T) {
					rec := g.hostAct(api, "skip", host, p)
					expect(rec, http.StatusOK, "skip")
					if got := skippedCount(t, rec); got != owed {
						fail("skipping %s skipped %d, want the %d they owed", name, got, owed)
					}
				}})
			}
			if p.Id != host.Id {
				actions = append(actions, action{"host drop", "host drops " + name, 1, func(t *testing.T) {
					rec := g.hostAct(api, "drop", host, p)
					expect(rec, http.StatusOK, "drop")
					if got := skippedCount(t, rec); got != owes[p.Id] {
						fail("dropping %s handled %d stories, want the %d they owed", name, got, owes[p.Id])
					}
				}})
			}
			if g.stories[name] == nil {
				actions = append(actions, action{"open story", name + " opens their story", 6, func(t *testing.T) {
					rec := call(api, http.MethodPost, "/api/collections/stories/records",
						map[string]any{"starter_id": p.Id, "game_id": g.game.Id})
					expect(rec, http.StatusOK, "open")
					var created struct {
						ID string `json:"id"`
					}
					if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil {
						t.Fatal(err)
					}
					story, err := app.FindRecordById("stories", created.ID)
					if err != nil {
						t.Fatal(err)
					}
					g.stories[name] = story
				}})
			}
		}

		if len(owes) == 0 && allOpened(g, names, dropped) {
			break // nothing left to do: the game is over
		}
		a := pick(rng, actions)
		played[a.kind]++
		log = append(log, a.name)
		if len(log) > 6 {
			log = log[1:]
		}
		a.run(t)
		g.checkInvariants(t, api, n, fail)
	}

	// The end: every story went round everyone, and everyone is done.
	stories, err := loadGameStories(app, g.game.Id)
	if err != nil {
		t.Fatal(err)
	}
	for _, s := range stories {
		if s.Taken != n {
			fail("%s's story ended with %d turns, want %d", g.name(s.Starter), s.Taken, n)
		}
	}
	for name, p := range g.status(t, api) {
		if !p.Finished {
			fail("the game is over but %s isn't finished: %+v", name, p)
		}
	}
}

func pick(rng *rand.Rand, actions []action) action {
	total := 0
	for _, a := range actions {
		total += a.weight
	}
	r := rng.IntN(total)
	for _, a := range actions {
		if r -= a.weight; r < 0 {
			return a
		}
	}
	panic("unreachable")
}

func skippedCount(t *testing.T, rec *httptest.ResponseRecorder) int {
	t.Helper()
	var resp struct {
		Skipped int `json:"skipped"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	return resp.Skipped
}

func unopened(g *testGame, names []string) []string {
	var out []string
	for _, name := range names {
		if g.stories[name] == nil {
			out = append(out, name)
		}
	}
	return out
}

// allOpened: every player still in the game has a story.
func allOpened(g *testGame, names []string, dropped map[string]bool) bool {
	for _, name := range names {
		if g.stories[name] == nil && !dropped[g.players[name].Id] {
			return false
		}
	}
	return true
}

func (g *testGame) droppedSet(t *testing.T) map[string]bool {
	t.Helper()
	out := map[string]bool{}
	for _, p := range g.players {
		fresh, err := g.app.FindRecordById("users", p.Id)
		if err != nil {
			t.Fatal(err)
		}
		out[p.Id] = fresh.GetBool("dropped")
	}
	return out
}

// checkInvariants is what must hold after any action, in any game.
func (g *testGame) checkInvariants(t *testing.T, api http.Handler, n int, fail func(string, ...any)) {
	t.Helper()
	dropped := g.droppedSet(t)
	if orphans := g.orphanTurns(t); orphans > 0 {
		fail("%d turns have no story", orphans)
	}

	stories, err := loadGameStories(g.app, g.game.Id)
	if err != nil {
		t.Fatal(err)
	}
	owes := map[string]int{}
	for _, s := range stories {
		if s.NextUser != "" {
			owes[s.NextUser]++
			if dropped[s.NextUser] {
				fail("%s's story is waiting on dropped %s", g.name(s.Starter), g.name(s.NextUser))
			}
		}

		// Seat order from the starter, an opening word, then alternating
		// kinds, a skip repeating the kind before it. (Seats are the join
		// order here: newGame seats players 0..n-1.)
		var turns []struct {
			User      string `db:"user_id"`
			IsDrawing bool   `db:"is_drawing"`
			Skipped   bool   `db:"skipped"`
		}
		err := g.app.DB().NewQuery("SELECT user_id, is_drawing, skipped FROM turns WHERE story_id = {:s} ORDER BY rowid").
			Bind(dbx.Params{"s": s.StoryID}).All(&turns)
		if err != nil {
			t.Fatal(err)
		}
		if len(turns) > n {
			fail("%s's story has %d turns, more than the %d players", g.name(s.Starter), len(turns), n)
		}
		start := g.players[g.name(s.Starter)].GetInt("position")
		for k, turn := range turns {
			if seat := g.players[g.name(turn.User)].GetInt("position"); seat != (start+k)%n {
				fail("turn %d of %s's story is by seat %d, want seat %d", k, g.name(s.Starter), seat, (start+k)%n)
			}
			want := false
			if k > 0 {
				want = !turns[k-1].IsDrawing
				if turn.Skipped {
					want = turns[k-1].IsDrawing
				}
			}
			if turn.IsDrawing != want {
				fail("turn %d of %s's story is_drawing=%v, want %v", k, g.name(s.Starter), turn.IsDrawing, want)
			}
		}
	}

	// /players agrees with the turns and stories.
	for name, st := range g.status(t, api) {
		p := g.players[name]
		var turns int
		if err := g.app.DB().NewQuery("SELECT COUNT(*) FROM turns WHERE user_id = {:u}").
			Bind(dbx.Params{"u": p.Id}).Row(&turns); err != nil {
			t.Fatal(err)
		}
		if st.Turns != turns || st.Owes != owes[p.Id] || st.Dropped != dropped[p.Id] {
			fail("/players says %s has %d turns, owes %d, dropped %v; the tables say %d, %d, %v",
				name, st.Turns, st.Owes, st.Dropped, turns, owes[p.Id], dropped[p.Id])
		}
	}
}
