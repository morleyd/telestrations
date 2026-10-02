package game

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"slices"
	"testing"

	"github.com/pocketbase/pocketbase/core"
)

// The drop race. Dropping a player marks them dropped, takes one snapshot of
// the stories waiting on them, and skips those one by one. The after-turn
// auto-skip can get to one of them in between (it fires for a dropped player
// as soon as the flag is set), and then the host's own skip of that story
// finds it already moved on. That used to abort the loop and leave every
// later story in the snapshot waiting on the dropped player for good: the
// guards refuse their writes, and nothing else would ever skip them.
//
// This replays that interleaving exactly: snapshot, then the racing
// auto-skip on the story the loop reaches first, then the loop.
func TestDropCarriesOnPastAStoryThatMovedOn(t *testing.T) {
	app := newTestApp(t)
	g := danOwesThree(t, app)
	dan := g.players["dan"]

	markDropped(t, app, dan)
	snapshot, err := loadGameStories(app, g.game.Id)
	if err != nil {
		t.Fatal(err)
	}
	raced, err := loadStory(app, firstOwed(snapshot, dan.Id).StoryID)
	if err != nil {
		t.Fatal(err)
	}
	skipIfNextIsDropped(app, raced) // the after-turn hook, landing late

	n, err := skipOwedTurns(app, snapshot, g.game.Id, dan.Id, true)
	if err != nil {
		t.Fatalf("drop: %v", err)
	}
	if n != 2 {
		t.Errorf("drop skipped %d stories, want the 2 the auto-skip didn't", n)
	}
	if owes := g.owes(t, "dan"); len(owes) != 0 {
		t.Fatalf("stories still waiting on dropped dan: %v", owes)
	}
	g.requireSkippedOnce(t, "dan", "ann", "ben", "cat")
}

// The other half of the same fix: a story whose skip fails (an injected error
// here; a storage hiccup copying a drawing in real life) is reported, but the
// stories after it still get skipped, and the host can retry the one that
// failed. For a dropped player that retry is the dialog's Skip button, which
// runs the drop again.
func TestDropCarriesOnPastAFailedSkipAndCanBeRetried(t *testing.T) {
	app := newTestApp(t)
	g := danOwesThree(t, app)
	dan := g.players["dan"]

	markDropped(t, app, dan)
	snapshot, err := loadGameStories(app, g.game.Id)
	if err != nil {
		t.Fatal(err)
	}
	failing := firstOwed(snapshot, dan.Id)
	broken := true
	app.OnRecordCreate("turns").BindFunc(func(e *core.RecordEvent) error {
		if broken && e.Record.GetString("story_id") == failing.StoryID && e.Record.GetBool("skipped") {
			return errors.New("injected failure")
		}
		return e.Next()
	})

	n, err := skipOwedTurns(app, snapshot, g.game.Id, dan.Id, true)
	if err == nil {
		t.Fatal("drop: want the failed story reported")
	}
	if n != 2 {
		t.Errorf("drop skipped %d stories, want the 2 that didn't fail", n)
	}
	if owes := g.owes(t, "dan"); !slices.Equal(owes, []string{g.name(failing.Starter)}) {
		t.Fatalf("waiting on dan: %v, want only the story that failed", owes)
	}

	broken = false
	if n, err := skipPendingTurns(app, g.game.Id, dan.Id, true); err != nil || n != 1 {
		t.Fatalf("retry: skipped %d, err %v; want the 1 left", n, err)
	}
	if owes := g.owes(t, "dan"); len(owes) != 0 {
		t.Fatalf("after the retry, still waiting on dan: %v", owes)
	}
	g.requireSkippedOnce(t, "dan", "ann", "ben", "cat")
}

// The drop deletes a dropped player's story that never got its opening word.
// The turn guard refuses that word once they're dropped, but a write that
// skips the guard can still land after the drop's snapshot; the story must
// then stay, or the word is left as a turn with no story. This replays it:
// the flag, the snapshot, the late word, then the loop.
func TestDropKeepsAStoryOpenedAfterItsSnapshot(t *testing.T) {
	app := newTestApp(t)
	g := newGame(t, app, "ann", "ben", "cat")
	ben := g.players["ben"]

	markDropped(t, app, ben)
	snapshot, err := loadGameStories(app, g.game.Id)
	if err != nil {
		t.Fatal(err)
	}
	g.play(t, "ben", "ben") // his opening word, landing late

	if _, err := skipOwedTurns(app, snapshot, g.game.Id, ben.Id, true); err != nil {
		t.Fatalf("drop: %v", err)
	}
	if _, err := app.FindRecordById("stories", g.stories["ben"].Id); err != nil {
		t.Fatalf("ben's story was deleted with his word in it: %v", err)
	}
	if n := g.orphanTurns(t); n != 0 {
		t.Fatalf("%d turns have no story", n)
	}
}

// The drop race for real: the host's drop and the submit that hands the
// dropped player another story arrive together, as requests through the
// actual routes and request guards. Whichever lands first, the drop must
// succeed and no story may be left waiting on the dropped player. A fresh
// game each round; -short skips this soak.
//
// The raced story (cat's) sits after two others dan owes in the drop's loop,
// which gives the after-turn auto-skip room to land between the drop's
// snapshot and its skip of that story, and dan's own story (never opened, so
// the drop deletes it) comes after it, so losing the race strands something.
func TestDropRacingASubmitOverHTTP(t *testing.T) {
	const rounds = 50
	hostSkipped := map[int]int{} // rounds by how many stories the drop itself handled
	soakGames(t, rounds, func(round int, app core.App, api http.Handler) {
		// dan owes ann's and ben's stories; cat's opening word hands him cat's.
		g := newGame(t, app, "ann", "ben", "cat", "dan")
		g.play(t, "ann", "ann")
		g.play(t, "ann", "ben")
		g.play(t, "ann", "cat")
		g.play(t, "ben", "ben")
		g.play(t, "ben", "cat")
		ann, dan := g.players["ann"], g.players["dan"]

		catsWord := g.nextTurn(t, "cat", "cat")
		var drop, submit *httptest.ResponseRecorder
		together(
			func() { drop = g.hostAct(api, "drop", ann, dan) },
			func() { submit = call(api, http.MethodPost, turnsPath, catsWord) },
		)

		if drop.Code != http.StatusOK {
			t.Fatalf("round %d: drop: %d %s", round, drop.Code, drop.Body)
		}
		if submit.Code != http.StatusOK {
			t.Fatalf("round %d: cat's submit: %d %s", round, submit.Code, submit.Body)
		}
		if owes := g.owes(t, "dan"); len(owes) != 0 {
			t.Fatalf("round %d: stories still waiting on dropped dan: %v", round, owes)
		}
		g.requireSkippedOnce(t, "dan", "ann", "ben", "cat")
		if _, err := app.FindRecordById("stories", g.stories["dan"].Id); err == nil {
			t.Fatalf("round %d: dan's unopened story survived the drop", round)
		}

		var resp struct {
			Skipped int `json:"skipped"`
		}
		if err := json.Unmarshal(drop.Body.Bytes(), &resp); err != nil {
			t.Fatal(err)
		}
		hostSkipped[resp.Skipped]++
	})
	t.Logf("%d rounds: the drop handled all 4 of dan's stories in %d, 3 in %d (the after-turn auto-skip took cat's)",
		rounds, hostSkipped[4], hostSkipped[3])
}
