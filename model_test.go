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
// the last seat, two dropped neighbours, a timeout right after a drop, a
// stale page resubmitting last round's turn, the host ending the game, ...).
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
	// Mostly one round: the invariants re-read every turn after every action,
	// so long games cost the square of their length.
	rounds, endless := []int{1, 1, 1, 2, 2, 3}[rng.IntN(6)], rng.IntN(4) == 0
	g := newGame(t, app, names...).timed(t).withRounds(t, rounds, endless)
	// Each game gets the tables to itself, as in a MODEL_SEED replay; the
	// views scan whole tables, so games left behind would slow every later one.
	t.Cleanup(func() { deleteGame(t, app, g.game.Id) })
	host := g.players[names[0]]
	// Endless games end when the host says; some others are cut short too.
	endAfter := -1
	if endless || rng.IntN(4) == 0 {
		endAfter = rng.IntN(3 * n * n)
	}
	maxTurns := n * rounds
	if endless {
		maxTurns = -1
	}
	ending, over := false, false
	// Some players haven't opened their story when the game starts.
	for _, name := range names {
		if rng.IntN(3) == 0 {
			if err := app.Delete(g.stories[name]); err != nil {
				t.Fatal(err)
			}
			delete(g.stories, name)
		}
	}
	t.Logf("%d players, %d rounds, endless %v, ends after %d actions; unopened: %v",
		n, rounds, endless, endAfter, unopened(g, names))

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
		if step > 20*n*n*rounds+endAfter {
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
					body := map[string]any{"user_id": g.players[name].Id}
					if rng.IntN(2) == 0 {
						body["turn_index"] = s.Taken // as a current page sends it
					}
					rec := call(api, http.MethodPost, "/api/stories/"+s.StoryID+"/timeout", body)
					expect(rec, http.StatusOK, "timeout")
					if turn := g.lastTurnBy(t, starter, name); !turn.GetBool("skipped") || !turn.GetBool("timed_out") {
						fail("an empty timeout wrote a turn that isn't a timed-out skip")
					}
				}},
				action{"partial timeout", "partial timeout " + name + " on " + starter, 2, func(t *testing.T) {
					turn := g.nextTurn(t, starter, name)
					turn["timed_out"] = true
					expect(call(api, http.MethodPost, turnsPath, turn), http.StatusOK, "partial timeout")
					if turn := g.lastTurnBy(t, starter, name); turn.GetBool("skipped") || !turn.GetBool("timed_out") {
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

		// A page still showing a turn its player already took (another tab, a
		// lost response, last round's screen) sends it again: refused with the
		// code that moves the page on.
		for _, s := range stories {
			if s.Taken == 0 {
				continue
			}
			starter := g.name(s.Starter)
			actions = append(actions, action{"stale resubmit", "stale resubmit on " + starter, 2, func(t *testing.T) {
				k := rng.IntN(s.Taken)
				old, err := app.FindRecordsByFilter("turns", "story_id = {:s} && turn_index = {:k}", "", 1, 0,
					dbx.Params{"s": s.StoryID, "k": k})
				if err != nil || len(old) != 1 {
					fail("no turn %d on %s's story (%v)", k, starter, err)
				}
				turn := old[0]
				writer := turn.GetString("user_id")
				want := codeTurnTaken
				switch {
				case dropped[writer]:
					want = codePlayerRemoved
				case over:
					want = codeGameOver
				case turn.GetBool("skipped") && !turn.GetBool("timed_out"):
					want = codeTurnSkipped
				}
				rec := call(api, http.MethodPost, turnsPath, map[string]any{
					"story_id": s.StoryID, "user_id": writer, "game_id": g.game.Id,
					"is_drawing": turn.GetBool("is_drawing"), "prompt": turn.GetString("prompt"), "turn_index": k,
				})
				expect(rec, http.StatusBadRequest, g.name(writer)+"'s resubmit of turn "+strconv.Itoa(k))
				if code, _ := refusal(rec); code != want {
					fail("%s's resubmit of turn %d on %s's story refused as %q, want %q: %s",
						g.name(writer), k, starter, code, want, rec.Body)
				}
			}})
		}
		if endAfter >= 0 && step >= endAfter && !ending {
			actions = append(actions, action{"host ends", "host ends the game", 4, func(t *testing.T) {
				expect(g.end(api, host), http.StatusOK, "end")
				ending = true
			}})
		}
		if ending && !over {
			actions = append(actions, action{"time's up", "the end countdown runs out", 3, func(t *testing.T) {
				g.timeUp(t)
				over = true
			}})
		}

		if over || len(owes) == 0 && allOpened(g, names, dropped) && !ending {
			break // nothing left to do: the game is over
		}
		a := pick(rng, actions)
		played[a.kind]++
		log = append(log, a.name)
		if len(log) > 6 {
			log = log[1:]
		}
		a.run(t)
		g.checkInvariants(t, api, n, maxTurns, fail)
	}

	// The end: unless the host cut it short, every story went round everyone
	// once a round. Either way everyone is done.
	stories, err := loadGameStories(app, g.game.Id)
	if err != nil {
		t.Fatal(err)
	}
	for _, s := range stories {
		if !over && s.Taken != maxTurns {
			fail("%s's story ended with %d turns, want %d", g.name(s.Starter), s.Taken, maxTurns)
		}
		if over && s.NextUser != "" {
			fail("the game is over but %s's story waits on %s", g.name(s.Starter), g.name(s.NextUser))
		}
	}
	for name, p := range g.status(t, api) {
		if !p.Finished {
			fail("the game is over but %s isn't finished: %+v", name, p)
		}
	}
	if !over {
		return
	}
	// Once it's over, nothing more is written, and every write says so.
	for _, s := range stories {
		if s.Taken == 0 {
			continue
		}
		starter := g.name(s.Starter)
		for _, p := range g.players {
			if g.droppedSet(t)[p.Id] {
				continue
			}
			rec := call(api, http.MethodPost, turnsPath, g.turn(starter, g.name(p.Id), rng.IntN(2) == 0))
			if code, _ := refusal(rec); code != codeGameOver {
				fail("a turn by %s on %s's story after the game is over: %d %s", g.name(p.Id), starter, rec.Code, rec.Body)
			}
			rec = g.timeout(api, starter, g.name(p.Id))
			if code, _ := refusal(rec); code != codeGameOver {
				fail("a timeout for %s on %s's story after the game is over: %d %s", g.name(p.Id), starter, rec.Code, rec.Body)
			}
		}
	}
	for _, name := range unopened(g, names) {
		rec := call(api, http.MethodPost, "/api/collections/stories/records",
			map[string]any{"starter_id": g.players[name].Id, "game_id": g.game.Id})
		if code, _ := refusal(rec); code != codeGameOver && code != codePlayerRemoved {
			fail("%s opened their story after the game is over: %d %s", name, rec.Code, rec.Body)
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

// checkInvariants is what must hold after any action, in any game. maxTurns
// is how many turns a story gets in all, or -1 in an endless game.
func (g *testGame) checkInvariants(t *testing.T, api http.Handler, n, maxTurns int, fail func(string, ...any)) {
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

		// Numbered 0, 1, 2, ... in the order written; seat order from the
		// starter, round and round; an opening word, then alternating kinds,
		// a skip repeating the kind before it. (Seats are the join order here:
		// newGame seats players 0..n-1.)
		var turns []struct {
			User      string `db:"user_id"`
			Index     int    `db:"turn_index"`
			IsDrawing bool   `db:"is_drawing"`
			Skipped   bool   `db:"skipped"`
		}
		err := g.app.DB().NewQuery("SELECT user_id, turn_index, is_drawing, skipped FROM turns WHERE story_id = {:s} ORDER BY rowid").
			Bind(dbx.Params{"s": s.StoryID}).All(&turns)
		if err != nil {
			t.Fatal(err)
		}
		if maxTurns >= 0 && len(turns) > maxTurns {
			fail("%s's story has %d turns, more than its %d", g.name(s.Starter), len(turns), maxTurns)
		}
		start := g.players[g.name(s.Starter)].GetInt("position")
		for k, turn := range turns {
			if turn.Index != k {
				fail("turn %d of %s's story is numbered %d", k, g.name(s.Starter), turn.Index)
			}
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
