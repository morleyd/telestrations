package main

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/security"
)

// The rotation lives in two SQL views (migrations/1757700000_robust_rotation
// and later rewrites of `results`). Each story passes seat to seat from its
// starter; a seat is a player's rank by (position, id), so whatever raw
// positions the users hold (duplicates, gaps, all zero) the seats come out a
// clean 0..N-1. These play whole games across player counts and position
// layouts and check both views at every step.

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
				checkRotation(t, app, n, position)
			})
		}
	}
}

func checkRotation(t *testing.T, app core.App, n int, position func(i, n int) int) {
	t.Helper()
	game := save(t, app, "games", map[string]any{"game_code": security.RandomString(8), "isStarted": true})
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
	for k := 0; k <= n; k++ {
		for _, story := range stories {
			starter := seat[story.GetString("starter_id")]
			s, err := loadStory(app, story.Id)
			if err != nil {
				t.Fatal(err)
			}
			wantPrev := seats[(starter+k-1+n)%n].Id
			if s.Taken != k || s.Total != n || s.PrevUser != wantPrev {
				t.Fatalf("seat %d's story at turn %d: taken %d of %d, prev seat %d; want %d of %d, prev seat %d",
					starter, k, s.Taken, s.Total, seat[s.PrevUser], k, n, seat[wantPrev])
			}
			if k == n {
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
			save(t, app, "turns", map[string]any{
				"story_id": story.Id, "user_id": want.Id, "game_id": game.Id,
				"is_drawing": k%2 == 1, "prompt": fmt.Sprintf("turn %d", k),
			})
		}
	}

	// results numbers each story's turns 0..N-1 from its starter.
	var rows []struct {
		Starter string `db:"starter_id"`
		User    string `db:"turn_user_id"`
		Number  int    `db:"turn_number"`
	}
	err := app.DB().NewQuery("SELECT starter_id, turn_user_id, turn_number FROM results WHERE game_id = {:g}").
		Bind(dbx.Params{"g": game.Id}).All(&rows)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != n*n {
		t.Fatalf("results has %d rows, want %d", len(rows), n*n)
	}
	numbers := map[string][]int{}
	for _, r := range rows {
		if want := (seat[r.User] - seat[r.Starter] + n) % n; r.Number != want {
			t.Errorf("seat %d's turn on seat %d's story is numbered %d, want %d",
				seat[r.User], seat[r.Starter], r.Number, want)
		}
		numbers[r.Starter] = append(numbers[r.Starter], r.Number)
	}
	for starter, got := range numbers {
		slices.Sort(got)
		for i, num := range got {
			if num != i {
				t.Fatalf("seat %d's story numbers its turns %v, want 0..%d", seat[starter], got, n-1)
			}
		}
	}
}
