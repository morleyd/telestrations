package migrations

import (
	"fmt"

	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Enforce the game's core invariants in the schema instead of trusting the
// client:
//
//   - a player starts exactly ONE story per game
//   - a player takes exactly ONE turn per story
//
// Until now nothing server-side prevented duplicates — the collections were
// created with no indexes at all, and the only guards were component-local
// latches in TakeTurn.vue that reset on page reload and don't exist across a
// second tab. A duplicate story or turn silently corrupts the rotation views
// (turns_taken is a COUNT(*) per story), ending stories early and stranding
// players. With the unique indexes below a duplicate create fails with a 400,
// which the client already treats as a non-retryable error.
//
// The plain indexes back the hottest lookups (roster by game, turns by
// story/user, story by game), which otherwise scan whole tables inside the
// views' window functions as the database accumulates games.
func init() {
	m.Register(func(app core.App) error {
		// Best-effort dedupe of any legacy duplicates so the unique indexes
		// can build: keep the earliest row of each group, and drop turns that
		// pointed at a removed duplicate story.
		dedupe := []string{
			`DELETE FROM stories WHERE rowid NOT IN (
				SELECT MIN(rowid) FROM stories GROUP BY starter_id, game_id
			)`,
			`DELETE FROM turns WHERE story_id NOT IN (SELECT id FROM stories)`,
			`DELETE FROM turns WHERE rowid NOT IN (
				SELECT MIN(rowid) FROM turns GROUP BY user_id, story_id
			)`,
		}
		for _, q := range dedupe {
			if _, err := app.DB().NewQuery(q).Execute(); err != nil {
				return fmt.Errorf("dedupe before indexing: %w", err)
			}
		}

		stories, err := app.FindCollectionByNameOrId("stories")
		if err != nil {
			return fmt.Errorf("find stories: %w", err)
		}
		stories.AddIndex("idx_stories_starter_game", true, "starter_id, game_id", "")
		stories.AddIndex("idx_stories_game", false, "game_id", "")
		if err := app.Save(stories); err != nil {
			return fmt.Errorf("save stories: %w", err)
		}

		turns, err := app.FindCollectionByNameOrId("turns")
		if err != nil {
			return fmt.Errorf("find turns: %w", err)
		}
		turns.AddIndex("idx_turns_user_story", true, "user_id, story_id", "")
		turns.AddIndex("idx_turns_story", false, "story_id", "")
		turns.AddIndex("idx_turns_user", false, "user_id", "")
		if err := app.Save(turns); err != nil {
			return fmt.Errorf("save turns: %w", err)
		}

		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return fmt.Errorf("find users: %w", err)
		}
		users.AddIndex("idx_users_game", false, "game_id", "")
		if err := app.Save(users); err != nil {
			return fmt.Errorf("save users: %w", err)
		}

		return nil
	}, func(app core.App) error {
		type colIndexes struct {
			name    string
			indexes []string
		}
		for _, c := range []colIndexes{
			{"stories", []string{"idx_stories_starter_game", "idx_stories_game"}},
			{"turns", []string{"idx_turns_user_story", "idx_turns_story", "idx_turns_user"}},
			{"users", []string{"idx_users_game"}},
		} {
			col, err := app.FindCollectionByNameOrId(c.name)
			if err != nil {
				return fmt.Errorf("find %q: %w", c.name, err)
			}
			for _, idx := range c.indexes {
				col.RemoveIndex(idx)
			}
			if err := app.Save(col); err != nil {
				return fmt.Errorf("save %q: %w", c.name, err)
			}
		}
		return nil
	})
}
