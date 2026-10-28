package migrations

import (
	"fmt"

	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// How long notebooks are held, and who's at their turn screen, for the
// waiting screen.
//
//   - The progress view gains held_seconds: how long the story has been with
//     whoever it's waiting on, since the previous turn was written (or, for its
//     opening word, since the story was created). Worked out by the database's
//     clock, so a device whose clock is off still shows the right time. A CAST
//     makes PocketBase type the column as a number; it would read a bare
//     expression as JSON.
//   - users gains working_on, the turn a player has on screen ("storyId:index",
//     or empty), and seen_at, when their device last said so. The presence
//     route (see presence.go) writes both straight to the database, firing no
//     record hooks or realtime events: they change every few seconds.

// progressViewHeld is progressViewRounds with held_seconds: seconds since the
// turn before the one waiting (its `turns` join), or since the story was
// created.
var progressViewHeld = `SELECT
  (ROW_NUMBER() OVER()) as id,
  stories.game_id AS game_id,
  stories.id AS story_id,
  users_starter.id AS starter_user_id,
  users_starter.rank AS starter_position,
  COALESCE(turn_counts.taken, 0) AS turns_taken,
  users_starter.total_players AS total_players,
  (CASE WHEN games.endless THEN NULL
    ELSE users_starter.total_players * MAX(games.rounds, 1) END) AS total_turns,
  ` + gameOverSQL + ` AS game_over,
  next_user.id AS next_user_id,
  next_user.rank AS next_user_position,
  prev_user.id AS prev_user_id,
  prev_user.rank AS prev_user_position,
  turns.prompt AS prev_prompt,
  turns.drawing AS prev_drawing,
  turns.id AS prev_turn_id,
  CAST(ROUND((julianday('now') - julianday(COALESCE(turns.created, stories.created))) * 86400) AS INTEGER) AS held_seconds
FROM stories
JOIN games ON games.id = stories.game_id
JOIN (
  SELECT u.id AS id, u.game_id AS game_id,
    (ROW_NUMBER() OVER (PARTITION BY u.game_id ORDER BY u.position, u.id) - 1) AS rank,
    (COUNT(*) OVER (PARTITION BY u.game_id)) AS total_players
  FROM users u
) AS users_starter
  ON users_starter.id = stories.starter_id
LEFT JOIN (
  SELECT turns.story_id AS story_id, COUNT(*) AS taken
  FROM turns
  GROUP BY turns.story_id
) AS turn_counts
  ON turn_counts.story_id = stories.id
LEFT JOIN (
  SELECT u.id AS id, u.game_id AS game_id,
    (ROW_NUMBER() OVER (PARTITION BY u.game_id ORDER BY u.position, u.id) - 1) AS rank
  FROM users u
) AS next_user
  ON next_user.game_id = stories.game_id
 AND (games.endless OR COALESCE(turn_counts.taken, 0) < users_starter.total_players * MAX(games.rounds, 1))
 AND NOT ` + gameOverSQL + `
 AND next_user.rank = (
   (users_starter.rank + COALESCE(turn_counts.taken, 0))
   % users_starter.total_players
 )
LEFT JOIN (
  SELECT u.id AS id, u.game_id AS game_id,
    (ROW_NUMBER() OVER (PARTITION BY u.game_id ORDER BY u.position, u.id) - 1) AS rank
  FROM users u
) AS prev_user
  ON prev_user.game_id = stories.game_id
 AND prev_user.rank = (
   (users_starter.rank + COALESCE(turn_counts.taken, 0) - 1 + users_starter.total_players)
   % users_starter.total_players
 )
LEFT JOIN turns
  ON turns.story_id = stories.id
 AND turns.turn_index = COALESCE(turn_counts.taken, 0) - 1;
`

func init() {
	m.Register(func(app core.App) error {
		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return fmt.Errorf("find users: %w", err)
		}
		users.Fields.Add(
			&core.TextField{Name: "working_on", Max: 100},
			&core.DateField{Name: "seen_at"},
		)
		if err := app.Save(users); err != nil {
			return fmt.Errorf("save users: %w", err)
		}
		return setViewQuery(app, "progress", progressViewHeld)
	}, func(app core.App) error {
		if err := setViewQuery(app, "progress", progressViewRounds); err != nil {
			return err
		}
		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return fmt.Errorf("find users: %w", err)
		}
		users.Fields.RemoveByName("working_on")
		users.Fields.RemoveByName("seen_at")
		return app.Save(users)
	})
}
