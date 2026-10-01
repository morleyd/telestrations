package main

import (
	"fmt"
	"reflect"
	"slices"
	"strings"
	"testing"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// The app's migrations (core.AppMigrations; PocketBase's own live in
// core.SystemMigrations): that every one reverts cleanly and re-applies to
// the same schema, and that the upgrades a running server actually goes
// through keep its data.

var gameCollections = []string{"games", "users", "stories", "turns", "progress", "results"}

// collectionShape is what a test compares about a collection.
type collectionShape struct {
	Fields  []string
	Indexes []string
	Rules   string
	View    string
}

func schemaOf(t *testing.T, app core.App) map[string]collectionShape {
	t.Helper()
	out := map[string]collectionShape{}
	for _, name := range gameCollections {
		col, err := app.FindCollectionByNameOrId(name)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		var shape collectionShape
		for _, f := range col.Fields {
			shape.Fields = append(shape.Fields, f.GetName()+":"+f.Type())
		}
		slices.Sort(shape.Fields)
		shape.Indexes = slices.Sorted(slices.Values(col.Indexes))
		shape.View = col.ViewQuery
		rule := func(r *string) string {
			if r == nil {
				return "superusers only"
			}
			return fmt.Sprintf("%q", *r)
		}
		shape.Rules = fmt.Sprintf("list %s, view %s, create %s, update %s, delete %s",
			rule(col.ListRule), rule(col.ViewRule), rule(col.CreateRule), rule(col.UpdateRule), rule(col.DeleteRule))
		out[name] = shape
	}
	return out
}

func hasField(t *testing.T, app core.App, collection, field string) bool {
	t.Helper()
	col, err := app.FindCollectionByNameOrId(collection)
	if err != nil {
		t.Fatal(err)
	}
	return col.Fields.GetByName(field) != nil
}

// migrationsExcept is core.AppMigrations without the files starting with
// any of the given prefixes.
func migrationsExcept(prefixes ...string) core.MigrationsList {
	var list core.MigrationsList
	for _, m := range core.AppMigrations.Items() {
		if !slices.ContainsFunc(prefixes, func(p string) bool { return strings.HasPrefix(m.File, p) }) {
			list.Add(m)
		}
	}
	return list
}

// Every migration's down undoes its up, and applying them all again gives the
// same schema, on which a game still plays. (The first migration is a
// collections snapshot: its down is a no-op, and its up re-imports the
// collections as they were.)
func TestMigrationsRevertAndReapply(t *testing.T) {
	app := newTestApp(t)
	before := schemaOf(t, app)
	runner := core.NewMigrationsRunner(app, core.AppMigrations)

	n := len(core.AppMigrations.Items())
	reverted, err := runner.Down(n)
	if err != nil {
		t.Fatal(err)
	}
	if len(reverted) != n {
		t.Fatalf("reverted %v, want all %d", reverted, n)
	}
	for _, f := range []struct{ collection, field string }{
		{"turns", "skipped"}, {"turns", "timed_out"}, {"users", "dropped"}, {"results", "skipped"},
	} {
		if hasField(t, app, f.collection, f.field) {
			t.Errorf("%s.%s survived its migration's down", f.collection, f.field)
		}
	}
	if turns := schemaOf(t, app)["turns"]; len(turns.Indexes) != 0 {
		t.Errorf("turns indexes survived their migration's down: %v", turns.Indexes)
	}

	if _, err := runner.Up(); err != nil {
		t.Fatal(err)
	}
	if after := schemaOf(t, app); !reflect.DeepEqual(before, after) {
		for name := range before {
			if !reflect.DeepEqual(before[name], after[name]) {
				t.Errorf("%s after re-applying:\n got %+v\nwant %+v", name, after[name], before[name])
			}
		}
	}

	g := newGame(t, app, "ann", "ben")
	g.play(t, "ann", "ann")
	g.play(t, "ben", "ben")
	g.play(t, "ann", "ben")
	g.play(t, "ben", "ann")
	if owes := g.owes(t, "ann"); len(owes) != 0 {
		t.Fatalf("after a full game on the re-applied schema, ann still owes %v", owes)
	}
}

// The schema-index migration's clean-up of legacy rows from before the
// unique indexes existed: it keeps each player's first story and first turn
// per story, and drops turns on a story it removed, so the indexes can build.
func TestSchemaIndexMigrationCleansUpDuplicates(t *testing.T) {
	app := newTestApp(t)
	runner := core.NewMigrationsRunner(app, core.AppMigrations)
	reverted, err := runner.Down(1)
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(reverted, []string{"1784200000_schema_indexes.go"}) {
		t.Fatalf("reverted %v, want the schema-index migration (the last one applied)", reverted)
	}

	g := newGame(t, app, "ann", "ben")
	g.play(t, "ann", "ann")
	firstTurn := g.turnsBy(t, "ann", "ann")[0]
	save(t, app, "turns", g.turn("ann", "ann", true)) // a second turn by ann on her story
	extra := save(t, app, "stories", map[string]any{"starter_id": g.players["ann"].Id, "game_id": g.game.Id})
	save(t, app, "turns", map[string]any{
		"story_id": extra.Id, "user_id": g.players["ben"].Id, "game_id": g.game.Id, "prompt": "on the duplicate",
	})

	if _, err := runner.Up(); err != nil {
		t.Fatal(err)
	}
	stories, err := app.FindRecordsByFilter("stories", "starter_id = {:s}", "", 0, 0, dbx.Params{"s": g.players["ann"].Id})
	if err != nil {
		t.Fatal(err)
	}
	if len(stories) != 1 || stories[0].Id != g.stories["ann"].Id {
		t.Errorf("ann's stories after the clean-up: %d, want only her first", len(stories))
	}
	if turns := g.turnsBy(t, "ann", "ann"); len(turns) != 1 || turns[0].Id != firstTurn.Id {
		t.Errorf("ann's turns on her story after the clean-up: %d, want only her first", len(turns))
	}
	if g.orphanTurns(t) != 0 {
		t.Error("a turn on the removed duplicate story survived the clean-up")
	}
	col, err := app.FindCollectionByNameOrId("turns")
	if err != nil {
		t.Fatal(err)
	}
	dup := core.NewRecord(col)
	dup.Load(g.turn("ann", "ann", true))
	if err := app.Save(dup); err == nil {
		t.Error("the unique index didn't come back: a second turn by ann was saved")
	}
}

// A server that ran master before PR #5 already had the schema-index
// migration (1784200000) but not the PR's own two, which are numbered earlier
// and merged later. Upgrading applies them out of order onto a database with
// a game in it; the game's rows must survive and read as ordinary turns, and
// the game must carry on under the new host controls.
func TestHostControlMigrationsApplyOntoAnExistingDatabase(t *testing.T) {
	app := newTestApp(t)
	all := core.NewMigrationsRunner(app, core.AppMigrations)
	if _, err := all.Down(len(core.AppMigrations.Items())); err != nil {
		t.Fatal(err)
	}
	if _, err := core.NewMigrationsRunner(app, migrationsExcept("1759200000", "1759300000")).Up(); err != nil {
		t.Fatal(err)
	}
	if hasField(t, app, "turns", "skipped") || hasField(t, app, "users", "dropped") {
		t.Fatal("the pre-#5 schema already has the host-control fields")
	}
	g := newGame(t, app, "ann", "ben", "cat")
	g.play(t, "ann", "ann")

	applied, err := all.Up()
	if err != nil {
		t.Fatal(err)
	}
	if want := []string{"1759200000_host_controls.go", "1759300000_timeouts.go"}; !slices.Equal(applied, want) {
		t.Fatalf("the upgrade applied %v, want %v", applied, want)
	}
	var rows []struct {
		Skipped  bool `db:"skipped"`
		TimedOut bool `db:"timed_out"`
	}
	if err := app.DB().NewQuery("SELECT skipped, timed_out FROM results WHERE game_id = {:g}").
		Bind(dbx.Params{"g": g.game.Id}).All(&rows); err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || rows[0].Skipped || rows[0].TimedOut {
		t.Fatalf("the pre-upgrade turn reads as %+v in results, want one ordinary turn", rows)
	}

	api := serveAPI(t, app)
	if rec := g.hostAct(api, "drop", g.players["ann"], g.players["ben"]); rec.Code != 200 {
		t.Fatalf("drop after the upgrade: %d %s", rec.Code, rec.Body)
	}
	if owes := g.owes(t, "ben"); len(owes) != 0 {
		t.Fatalf("after the upgrade, dropped ben still owes %v", owes)
	}
	if s, _ := loadStory(app, g.stories["ann"].Id); s.NextUser != g.players["cat"].Id {
		t.Fatalf("ann's story should have passed ben by, but waits on %s", g.name(s.NextUser))
	}
}
