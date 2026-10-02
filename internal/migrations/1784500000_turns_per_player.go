package migrations

import (
	"fmt"
	"slices"
	"strings"

	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/dbutils"
)

// With rounds a player takes several turns on each story, so turns can't be
// unique by player and story. The rounds migration dropped the released index
// that made them so (idx_turns_user_story), but databases that ran an early
// draft of the host-controls migration carry the same rule under another name
// (idx_turns_story_user). There it refused every turn after a player's first
// on a story: round two never started, and a one-player game stuck at its
// first drawing. This drops any unique index on exactly those two columns,
// whatever it's called. Down restores nothing: the index was never meant to
// outlive rounds.

func init() {
	m.Register(func(app core.App) error {
		turns, err := app.FindCollectionByNameOrId("turns")
		if err != nil {
			return fmt.Errorf("find turns: %w", err)
		}
		var dropped []string
		for _, raw := range slices.Clone(turns.Indexes) {
			idx := dbutils.ParseIndex(raw)
			if idx.Unique && onlyColumns(idx, "story_id", "user_id") {
				turns.RemoveIndex(idx.IndexName)
				dropped = append(dropped, idx.IndexName)
			}
		}
		if len(dropped) == 0 {
			return nil
		}
		if err := app.Save(turns); err != nil {
			return fmt.Errorf("save turns: %w", err)
		}
		app.Logger().Info("migration: dropped one-turn-per-player index", "indexes", dropped)
		return nil
	}, nil)
}

// onlyColumns reports whether idx is on exactly the given columns, in any order.
func onlyColumns(idx dbutils.Index, names ...string) bool {
	if len(idx.Columns) != len(names) {
		return false
	}
	for _, c := range idx.Columns {
		if !slices.Contains(names, strings.Trim(c.Name, "`\"[] ")) {
			return false
		}
	}
	return true
}
