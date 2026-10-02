package game

import (
	"fmt"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/security"
)

// The rotation lives in two SQL views (internal/migrations: first
// 1757700000_robust_rotation, most recently 1784300000_rounds). Each story
// passes seat to seat from its starter, round the table once per round; a
// seat is a player's rank by (position, id), so whatever raw positions the
// users hold (duplicates, gaps, all zero) the seats come out a clean 0..N-1.
// These play whole games across player counts, position layouts and rounds
// and check both views at every step.

// positionLayouts are raw `position` values for N players, in join order.
var positionLayouts = map[string]func(i, n int) int{
	"clean":      func(i, n int) int { return i },
	"all zero":   func(i, n int) int { return 0 },
	"gapped":     func(i, n int) int { return 10 * i },
	"one-based":  func(i, n int) int { return i + 1 },
	"duplicated": func(i, n int) int { return i / 2 },
	"reversed":   func(i, n int) int { return n - 1 - i },
}

func TestRotationViews(t *testing.T) {
	app := newTestApp(t)
	for _, n := range []int{2, 3, 5, 8} {
		for layout, position := range positionLayouts {
			t.Run(fmt.Sprintf("%d players, %s", n, layout), func(t *testing.T) {
				checkRotation(t, app, n, 1, position)
			})
		}
	}
}

// The same over more rounds. Seats and rounds are independent, so two layouts
// and up to five players are enough: every turn of a long game reads the
// views, which adds up under -race.
func TestRotationViewsOverRounds(t *testing.T) {
	app := newTestApp(t)
	for _, n := range []int{2, 3, 5} {
		for _, layout := range []string{"clean", "duplicated"} {
			for _, rounds := range []int{2, 3} {
				t.Run(fmt.Sprintf("%d players, %s, %d rounds", n, layout, rounds), func(t *testing.T) {
					checkRotation(t, app, n, rounds, positionLayouts[layout])
				})
			}
		}
	}
}

func checkRotation(t *testing.T, app core.App, n, rounds int, position func(i, n int) int) {
	t.Helper()
	game := save(t, app, "games", map[string]any{
		"game_code": security.RandomString(8), "isStarted": true, "rounds": rounds,
	})
	// Each layout gets the tables to itself: the views scan whole tables, so
	// games left behind would slow every one after them.
	t.Cleanup(func() { deleteGame(t, app, game.Id) })
	users := make([]*core.Record, n)
	stories := make([]*core.Record, n)
	for i := range n {
		users[i] = save(t, app, "users", map[string]any{
			"username": fmt.Sprintf("p%d", i), "game_id": game.Id, "position": position(i, n),
		})
		stories[i] = save(t, app, "stories", map[string]any{"starter_id": users[i].Id, "game_id": game.Id})
	}

	// The seating the views should derive: by position, then id.
	seats := slices.Clone(users)
	slices.SortFunc(seats, func(a, b *core.Record) int {
		if d := a.GetInt("position") - b.GetInt("position"); d != 0 {
			return d
		}
		return strings.Compare(a.Id, b.Id)
	})
	seat := map[string]int{}
	for i, u := range seats {
		seat[u.Id] = i
	}

	// Play every story one turn at a time, round-robin across stories, and
	// check progress before each turn and once the story is done.
	total := n * rounds
	written := map[string][]string{} // story id -> its turn ids, in order
	for k := 0; k <= total; k++ {
		for _, story := range stories {
			starter := seat[story.GetString("starter_id")]
			s, err := loadStory(app, story.Id)
			if err != nil {
				t.Fatal(err)
			}
			wantPrev := seats[(starter+k-1+n)%n].Id
			if s.Taken != k || s.Total != n || s.TotalTurns != total || s.PrevUser != wantPrev {
				t.Fatalf("seat %d's story at turn %d: taken %d of %d (%d players), prev seat %d; "+
					"want %d of %d (%d players), prev seat %d",
					starter, k, s.Taken, s.TotalTurns, s.Total, seat[s.PrevUser], k, total, n, seat[wantPrev])
			}
			// The previous turn is the one just before, not the same player's
			// turn from an earlier round.
			if k > 0 && s.PrevTurn != written[story.Id][k-1] {
				t.Fatalf("seat %d's story at turn %d: previous turn is %q, want the one written at %d",
					starter, k, s.PrevTurn, k-1)
			}
			if k == total {
				if s.NextUser != "" {
					t.Fatalf("seat %d's story is finished but waits on seat %d", starter, seat[s.NextUser])
				}
				continue
			}
			want := seats[(starter+k)%n]
			if s.NextUser != want.Id {
				t.Fatalf("seat %d's story at turn %d waits on seat %d, want seat %d",
					starter, k, seat[s.NextUser], seat[want.Id])
			}
			turn := save(t, app, "turns", map[string]any{
				"story_id": story.Id, "user_id": want.Id, "game_id": game.Id,
				"is_drawing": k%2 == 1, "prompt": fmt.Sprintf("turn %d", k),
			})
			written[story.Id] = append(written[story.Id], turn.Id)
		}
	}

	// results numbers each story's turns 0..total-1, in the order played.
	var rows []struct {
		Starter string `db:"starter_id"`
		Turn    string `db:"turn_id"`
		User    string `db:"turn_user_id"`
		Number  int    `db:"turn_number"`
	}
	err := app.DB().NewQuery("SELECT starter_id, turn_id, turn_user_id, turn_number FROM results WHERE game_id = {:g}").
		Bind(dbx.Params{"g": game.Id}).All(&rows)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != n*total {
		t.Fatalf("results has %d rows, want %d", len(rows), n*total)
	}
	place := map[string]int{}
	for _, ids := range written {
		for k, id := range ids {
			place[id] = k
		}
	}
	for _, r := range rows {
		if want := place[r.Turn]; r.Number != want {
			t.Errorf("seat %d's turn on seat %d's story is numbered %d, want %d",
				seat[r.User], seat[r.Starter], r.Number, want)
		}
		if want := (seat[r.Starter] + r.Number) % n; seat[r.User] != want {
			t.Errorf("turn %d of seat %d's story is by seat %d, want seat %d",
				r.Number, seat[r.Starter], seat[r.User], want)
		}
	}
}

// An endless game goes round and round: every story always has a next player
// and no total. Once the host has ended it and the grace after the deadline
// is up, nobody is next anywhere; until then, everyone can still finish.
func TestRotationEndlessUntilTheGameIsOver(t *testing.T) {
	app := newTestApp(t)
	g := newGame(t, app, "ann", "ben", "cat").withRounds(t, 1, true)
	names := []string{"ann", "ben", "cat"}
	for k := range 7 { // more than two rounds
		for i, starter := range names {
			g.play(t, starter, names[(i+k)%3])
		}
	}
	for _, starter := range names {
		s, err := loadStory(app, g.stories[starter].Id)
		if err != nil {
			t.Fatal(err)
		}
		if s.Taken != 7 || s.TotalTurns != -1 || s.GameOver || s.NextUser == "" {
			t.Fatalf("%s's story in an endless game: %+v", starter, s)
		}
	}

	// Ended, deadline still to come: the story still waits on its player.
	g.game.Set("ends_at", time.Now().Add(endCountdown))
	if err := app.Save(g.game); err != nil {
		t.Fatal(err)
	}
	if s, _ := loadStory(app, g.stories["ann"].Id); s.GameOver || s.NextUser != g.players["ben"].Id {
		t.Fatalf("before the deadline: %+v, want ann's story still waiting on ben", s)
	}
	// Just past the deadline, within the grace: still accepted.
	g.game.Set("ends_at", time.Now().Add(-time.Second))
	if err := app.Save(g.game); err != nil {
		t.Fatal(err)
	}
	if s, _ := loadStory(app, g.stories["ann"].Id); s.GameOver || s.NextUser == "" {
		t.Fatalf("within the grace: %+v, want ann's story still waiting on ben", s)
	}

	g.timeUp(t)
	for _, starter := range names {
		s, err := loadStory(app, g.stories[starter].Id)
		if err != nil {
			t.Fatal(err)
		}
		if !s.GameOver || s.NextUser != "" {
			t.Fatalf("%s's story after the game is over: %+v, want nobody next", starter, s)
		}
	}
}
