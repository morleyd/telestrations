package migrations

import (
	"fmt"

	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Timed-out turns: turns.timed_out marks a turn whose round timer ran out. With
// partial work it's the player's own turn, submitted as-is; with nothing it's a
// server-written skip (see skipTurn in host.go). The review shows both with a
// "ran out of time" banner; during play they look like any other turn. The
// results view gains the column so the review can tell.

const resultsViewTimeouts = `SELECT
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
    turns.skipped,
    turns.timed_out
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
		turns.Fields.Add(&core.BoolField{Name: "timed_out"})
		if err := app.Save(turns); err != nil {
			return fmt.Errorf("save turns: %w", err)
		}
		return setViewQuery(app, "results", resultsViewTimeouts)
	}, func(app core.App) error {
		if err := setViewQuery(app, "results", resultsViewSkipped); err != nil {
			return err
		}
		turns, err := app.FindCollectionByNameOrId("turns")
		if err != nil {
			return fmt.Errorf("find turns: %w", err)
		}
		turns.Fields.RemoveByName("timed_out")
		return app.Save(turns)
	})
}
