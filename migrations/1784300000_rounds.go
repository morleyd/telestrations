package migrations

import (
	"fmt"

	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Rounds, endless games, and the host ending a game.
//
//   - games.rounds is how many times each story goes round the table (the
//     server makes it at least 1), and games.endless keeps them going round
//     until the host ends the game.
//   - games.ends_at is set by the host's End Game: players have until then to
//     finish the turn they're on, plus endGraceSeconds for a submit still in
//     flight. After that the game is over and nobody is next on any story.
//   - turns.turn_index is a turn's place in its story, set by the server. With
//     more than one round a player takes several turns on each story, so the
//     story's previous turn and the one-write-per-turn rule can't be keyed on
//     the player any more: the views find the previous turn by its index, and
//     the unique index moves from (user_id, story_id) to (story_id, turn_index).
//
// The progress view gains total_turns (null for an endless game) and
// game_over; the results view numbers turns by turn_index.

// endGraceSeconds is how long after ends_at a turn is still accepted: time
// for the submit the player's countdown fired to reach the server.
const endGraceSeconds = 5

var gameOverSQL = fmt.Sprintf(
	`(games.ends_at != '' AND games.ends_at < strftime('%%Y-%%m-%%d %%H:%%M:%%fZ', 'now', '-%d seconds'))`,
	endGraceSeconds)

var progressViewRounds = `SELECT
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
  turns.id AS prev_turn_id
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

const resultsViewRounds = `SELECT
    (ROW_NUMBER() OVER()) as id,
    stories.game_id,
    stories.starter_id,
    turns.id as turn_id,
    turns.user_id as turn_user_id,
    turns.turn_index AS turn_number,
    turns.prompt,
    turns.drawing,
    turns.skipped,
    turns.timed_out
FROM stories
JOIN turns ON turns.story_id = stories.id
`

func init() {
	m.Register(func(app core.App) error {
		games, err := app.FindCollectionByNameOrId("games")
		if err != nil {
			return fmt.Errorf("find games: %w", err)
		}
		games.Fields.Add(
			&core.NumberField{Name: "rounds", OnlyInt: true},
			&core.BoolField{Name: "endless"},
			&core.DateField{Name: "ends_at"},
		)
		if err := app.Save(games); err != nil {
			return fmt.Errorf("save games: %w", err)
		}
		if _, err := app.DB().NewQuery(`UPDATE games SET rounds = 1 WHERE rounds < 1`).Execute(); err != nil {
			return fmt.Errorf("backfill rounds: %w", err)
		}

		turns, err := app.FindCollectionByNameOrId("turns")
		if err != nil {
			return fmt.Errorf("find turns: %w", err)
		}
		turns.Fields.Add(&core.NumberField{Name: "turn_index", OnlyInt: true})
		if err := app.Save(turns); err != nil {
			return fmt.Errorf("save turns: %w", err)
		}
		// Every story so far was one round, written in order.
		if _, err := app.DB().NewQuery(`UPDATE turns SET turn_index = (
			SELECT COUNT(*) FROM turns AS earlier
			WHERE earlier.story_id = turns.story_id AND earlier.rowid < turns.rowid
		)`).Execute(); err != nil {
			return fmt.Errorf("backfill turn_index: %w", err)
		}
		turns.RemoveIndex("idx_turns_user_story")
		turns.AddIndex("idx_turns_story_index", true, "story_id, turn_index", "")
		if err := app.Save(turns); err != nil {
			return fmt.Errorf("save turns indexes: %w", err)
		}

		if err := setViewQuery(app, "progress", progressViewRounds); err != nil {
			return err
		}
		return setViewQuery(app, "results", resultsViewRounds)
	}, func(app core.App) error {
		if err := setViewQuery(app, "progress", progressViewRanked); err != nil {
			return err
		}
		if err := setViewQuery(app, "results", resultsViewTimeouts); err != nil {
			return err
		}

		// Fails on a database with a multi-round game in it (a player with two
		// turns on one story): reverting would have to throw those turns away.
		turns, err := app.FindCollectionByNameOrId("turns")
		if err != nil {
			return fmt.Errorf("find turns: %w", err)
		}
		turns.RemoveIndex("idx_turns_story_index")
		turns.AddIndex("idx_turns_user_story", true, "user_id, story_id", "")
		turns.Fields.RemoveByName("turn_index")
		if err := app.Save(turns); err != nil {
			return fmt.Errorf("save turns: %w", err)
		}

		games, err := app.FindCollectionByNameOrId("games")
		if err != nil {
			return fmt.Errorf("find games: %w", err)
		}
		for _, name := range []string{"rounds", "endless", "ends_at"} {
			games.Fields.RemoveByName(name)
		}
		return app.Save(games)
	})
}
