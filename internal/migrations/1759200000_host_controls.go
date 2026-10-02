package migrations

import (
	"fmt"

	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Host controls: skipping and dropping players mid-game (see host.go).
//
//   - turns.skipped marks a turn the server wrote on a player's behalf. It
//     carries the previous turn's content forward, so the review hides it.
//   - users.dropped marks a player the host removed from a game in progress.
//     Their seat is kept (the rotation is derived from seats) and every turn
//     that reaches them is skipped.
//   - The results view gains `skipped` so the review can filter those turns.
//
// One turn per player per story (so a late submit racing a skip can't write a
// second one) is enforced by idx_turns_user_story in 1784200000_schema_indexes.

const resultsViewSkipped = `SELECT
    (ROW_NUMBER() OVER()) as id,
    stories.game_id,
    stories.starter_id,
    turns.id as turn_id,
    turns.user_id as turn_user_id,
    (
      (tu.rank - su.rank + su.total_players)
      % su.total_players
    ) AS turn_number,
    turns.prompt,
    turns.drawing,
    turns.skipped
FROM stories
JOIN turns ON turns.story_id = stories.id
LEFT JOIN (
  SELECT u.id AS id,
    (ROW_NUMBER() OVER (PARTITION BY u.game_id ORDER BY u.position, u.id) - 1) AS rank,
    (COUNT(*) OVER (PARTITION BY u.game_id)) AS total_players
  FROM users u
) AS su ON stories.starter_id = su.id
LEFT JOIN (
  SELECT u.id AS id,
    (ROW_NUMBER() OVER (PARTITION BY u.game_id ORDER BY u.position, u.id) - 1) AS rank
  FROM users u
) AS tu ON turns.user_id = tu.id
`

func init() {
	m.Register(func(app core.App) error {
		turns, err := app.FindCollectionByNameOrId("turns")
		if err != nil {
			return fmt.Errorf("find turns: %w", err)
		}
		turns.Fields.Add(&core.BoolField{Name: "skipped"})
		if err := app.Save(turns); err != nil {
			return fmt.Errorf("save turns: %w", err)
		}

		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return fmt.Errorf("find users: %w", err)
		}
		users.Fields.Add(&core.BoolField{Name: "dropped"})
		if err := app.Save(users); err != nil {
			return fmt.Errorf("save users: %w", err)
		}

		return setViewQuery(app, "results", resultsViewSkipped)
	}, func(app core.App) error {
		if err := setViewQuery(app, "results", resultsViewRanked); err != nil {
			return err
		}

		turns, err := app.FindCollectionByNameOrId("turns")
		if err != nil {
			return fmt.Errorf("find turns: %w", err)
		}
		turns.Fields.RemoveByName("skipped")
		if err := app.Save(turns); err != nil {
			return fmt.Errorf("save turns: %w", err)
		}

		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return fmt.Errorf("find users: %w", err)
		}
		users.Fields.RemoveByName("dropped")
		return app.Save(users)
	})
}
