package migrations

import (
	"fmt"

	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// AI players (see ai.go). A bot is an ordinary seat in `users` whose turns the
// server writes:
//   - users.is_bot plus the bot's provider, model, persona (a short prompt
//     addition from the host) and drawing style.
//   - turns.note is a bot's one-line "thought" behind a turn (or why a bot turn
//     was skipped). Shown on the review page only, so the results view gains it.

const resultsViewNotes = `SELECT
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
    turns.timed_out,
    turns.note
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

var botUserFields = []string{"bot_provider", "bot_model", "bot_persona", "bot_style"}

func init() {
	m.Register(func(app core.App) error {
		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return fmt.Errorf("find users: %w", err)
		}
		users.Fields.Add(&core.BoolField{Name: "is_bot"})
		for _, name := range botUserFields {
			users.Fields.Add(&core.TextField{Name: name})
		}
		if err := app.Save(users); err != nil {
			return fmt.Errorf("save users: %w", err)
		}

		turns, err := app.FindCollectionByNameOrId("turns")
		if err != nil {
			return fmt.Errorf("find turns: %w", err)
		}
		turns.Fields.Add(&core.TextField{Name: "note"})
		if err := app.Save(turns); err != nil {
			return fmt.Errorf("save turns: %w", err)
		}
		return setViewQuery(app, "results", resultsViewNotes)
	}, func(app core.App) error {
		if err := setViewQuery(app, "results", resultsViewTimeouts); err != nil {
			return err
		}
		turns, err := app.FindCollectionByNameOrId("turns")
		if err != nil {
			return fmt.Errorf("find turns: %w", err)
		}
		turns.Fields.RemoveByName("note")
		if err := app.Save(turns); err != nil {
			return fmt.Errorf("save turns: %w", err)
		}
		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return fmt.Errorf("find users: %w", err)
		}
		users.Fields.RemoveByName("is_bot")
		for _, name := range botUserFields {
			users.Fields.RemoveByName(name)
		}
		return app.Save(users)
	})
}
