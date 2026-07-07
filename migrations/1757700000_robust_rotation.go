package migrations

import (
	"fmt"

	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Robust rotation fix.
//
// The original `progress` and `results` views route turns by matching
// users.position directly against (starter.position +/- turns_taken) % total_players.
// That is only correct when users.position is a clean contiguous 0..N-1
// permutation matching total_players. Nothing guarantees that invariant:
// users are created without a position (defaulting to 0) and positions are only
// ever assigned by a racy client-side loop at "Begin", so a late/straggling
// joiner (far more likely with 5-10 players) keeps position 0 -> duplicate 0 +
// a missing slot -> the modulo mapping collides/orphans stories and players get
// "random" content whose text doesn't line up with the images.
//
// This migration rewrites both views to route on a DERIVED rank computed with
// ROW_NUMBER() OVER (PARTITION BY game_id ORDER BY position, id), which always
// collapses any set of raw positions (duplicated, gapped, 1-based, NULL, or all
// zero) into a clean 0..N-1 permutation. total_players is taken from the same
// window (COUNT(*) OVER) so rank and count are always internally consistent.
// prev_user is also changed from an INNER to a LEFT JOIN (with a +total_players
// guard against SQLite's sign-following modulo) so a story is never dropped from
// the view. Output column aliases are kept byte-identical so PocketBase re-derives
// the same field schema and the client keeps working unchanged.
//
// It also locks the roster once a game starts (users create/delete rejected when
// the game isStarted) so total_players cannot drift mid-game.

const progressViewRanked = `SELECT
  (ROW_NUMBER() OVER()) as id,
  stories.game_id AS game_id,
  stories.id AS story_id,
  users_starter.id AS starter_user_id,
  users_starter.rank AS starter_position,
  COALESCE(turn_counts.taken, 0) AS turns_taken,
  users_starter.total_players AS total_players,
  next_user.id AS next_user_id,
  next_user.rank AS next_user_position,
  prev_user.id AS prev_user_id,
  prev_user.rank AS prev_user_position,
  turns.prompt AS prev_prompt,
  turns.drawing AS prev_drawing,
  turns.id AS prev_turn_id
FROM stories
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
    (ROW_NUMBER() OVER (PARTITION BY u.game_id ORDER BY u.position, u.id) - 1) AS rank,
    (COUNT(*) OVER (PARTITION BY u.game_id)) AS total_players
  FROM users u
) AS next_user
  ON next_user.game_id = stories.game_id
 AND COALESCE(turn_counts.taken, 0) < users_starter.total_players
 AND next_user.rank = (
   (users_starter.rank + COALESCE(turn_counts.taken, 0))
   % users_starter.total_players
 )
LEFT JOIN (
  SELECT u.id AS id, u.game_id AS game_id,
    (ROW_NUMBER() OVER (PARTITION BY u.game_id ORDER BY u.position, u.id) - 1) AS rank,
    (COUNT(*) OVER (PARTITION BY u.game_id)) AS total_players
  FROM users u
) AS prev_user
  ON prev_user.game_id = stories.game_id
 AND prev_user.rank = (
   (users_starter.rank + COALESCE(turn_counts.taken, 0) - 1 + users_starter.total_players)
   % users_starter.total_players
 )
LEFT JOIN turns
  ON turns.story_id = stories.id
 AND turns.user_id = prev_user.id;
`

const resultsViewRanked = `SELECT
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
    turns.drawing
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

// original view queries, restored by down()
const progressViewOriginal = `SELECT
  (ROW_NUMBER() OVER()) as id,
  stories.game_id AS game_id,
  stories.id AS story_id,
  users_starter.id AS starter_user_id,
  users_starter.position AS starter_position,
  COALESCE(turn_counts.taken, 0) AS turns_taken,
  player_counts.total_players AS total_players,
  next_user.id AS next_user_id,
  next_user.position AS next_user_position,
  prev_user.id AS prev_user_id,
  prev_user.position AS prev_user_position,
  turns.prompt AS prev_prompt,
  turns.drawing AS prev_drawing,
  turns.id AS prev_turn_id
FROM stories
JOIN users AS users_starter
  ON users_starter.id = stories.starter_id
JOIN (
  SELECT users.game_id AS game_id, COUNT(*) AS total_players
  FROM users
  GROUP BY users.game_id
) AS player_counts
  ON player_counts.game_id = stories.game_id
LEFT JOIN (
  SELECT turns.story_id AS story_id, COUNT(*) AS taken
  FROM turns
  GROUP BY turns.story_id
) AS turn_counts
  ON turn_counts.story_id = stories.id
LEFT JOIN users AS next_user
  ON next_user.game_id = stories.game_id
 AND COALESCE(turn_counts.taken, 0) < player_counts.total_players
 AND next_user.position = (
   (users_starter.position + COALESCE(turn_counts.taken, 0))
   % player_counts.total_players
 )
JOIN users AS prev_user
  ON prev_user.game_id = stories.game_id
 AND prev_user.position = (
   (users_starter.position + COALESCE(turn_counts.taken, 0) - 1)
   % player_counts.total_players
 )
LEFT JOIN turns
  ON turns.story_id = stories.id
 AND turns.user_id = prev_user.id;
`

const resultsViewOriginal = `SELECT
    (ROW_NUMBER() OVER()) as id,
    stories.game_id,
    stories.starter_id,
    turns.id as turn_id,
    turns.user_id as turn_user_id,
    (
      (turn_number.position - starter_position.position + player_counts.total_players)
      % player_counts.total_players
    ) AS turn_number,
    turns.prompt,
    turns.drawing
FROM stories
JOIN turns ON turns.story_id = stories.id
LEFT JOIN (
  SELECT users.id, users.position
  From users
) AS starter_position ON stories.starter_id = starter_position.id
LEFT JOIN (
  SELECT users.id, users.position
  From users
) AS turn_number ON turns.user_id = turn_number.id
JOIN (
  SELECT users.game_id AS game_id, COUNT(*) AS total_players
  FROM users
  GROUP BY users.game_id
) AS player_counts
  ON player_counts.game_id = stories.game_id
`

func setViewQuery(app core.App, name, query string) error {
	col, err := app.FindCollectionByNameOrId(name)
	if err != nil {
		return fmt.Errorf("find %q: %w", name, err)
	}
	col.ViewQuery = query
	if err := app.Save(col); err != nil {
		return fmt.Errorf("save %q: %w", name, err)
	}
	return nil
}

func setUsersRosterLock(app core.App, rule string) error {
	col, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		return fmt.Errorf("find users: %w", err)
	}
	col.CreateRule = &rule
	col.DeleteRule = &rule
	if err := app.Save(col); err != nil {
		return fmt.Errorf("save users: %w", err)
	}
	return nil
}

func init() {
	m.Register(func(app core.App) error {
		if err := setViewQuery(app, "progress", progressViewRanked); err != nil {
			return err
		}
		if err := setViewQuery(app, "results", resultsViewRanked); err != nil {
			return err
		}
		// Lock the roster once a game has started so total_players can't drift.
		return setUsersRosterLock(app, "game_id.isStarted = false")
	}, func(app core.App) error {
		if err := setViewQuery(app, "progress", progressViewOriginal); err != nil {
			return err
		}
		if err := setViewQuery(app, "results", resultsViewOriginal); err != nil {
			return err
		}
		return setUsersRosterLock(app, "")
	})
}
