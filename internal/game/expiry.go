package game

import (
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"
)

// Expiry: a public server keeps strangers' games only as long as they need
// them. A game is deleted, drawings and all,
//
//   - keepAfterFinish after it's over: every story has gone all the way round
//     (the last turn), or the host's End Game deadline has passed;
//   - keepIdle after anything last happened in it, finished or not: a turn, a
//     join, a player's device checking in. This is what clears an endless game
//     nobody ended;
//   - keepIdleLobby, for a game nobody has started, after anything last
//     happened in it. A device waiting in the lobby checks in every few
//     minutes (the waiting room's presence reports), so only a lobby left
//     behind goes; without this, empty lobbies would sit on the server's game
//     limit for a week.
//
// All of these are worked out from the game's own records, so nothing has to keep a
// timestamp up to date as the game goes. A job checks every 15 minutes, and
// the server's logs (which hold players' names and addresses) are kept for
// logDays. Home mode keeps everything, as before.
const (
	keepAfterFinish = 48 * time.Hour
	keepIdle        = 7 * 24 * time.Hour
	keepIdleLobby   = time.Hour
	logDays         = 2
	expirySchedule  = "*/15 * * * *"
)

// bindExpiry sets up expiry on a public server.
func bindExpiry(se *core.ServeEvent) error {
	settings := se.App.Settings()
	settings.Logs.MaxDays = logDays
	if err := se.App.Save(settings); err != nil {
		return err
	}
	app := se.App
	expire := func() {
		n, err := deleteExpiredGames(app, time.Now())
		if err != nil {
			app.Logger().Error("expiry: failed", "deleted", n, "error", err.Error())
		} else if n > 0 {
			app.Logger().Info("expiry: games deleted", "deleted", n)
		}
		// PocketBase's own log cleanup runs only at a few set hours a day,
		// which a machine that stops when idle can sleep through, so the
		// logs are cleared here too.
		if err := app.DeleteOldLogs(time.Now().AddDate(0, 0, -logDays)); err != nil {
			app.Logger().Error("expiry: deleting old logs failed", "error", err.Error())
		}
	}
	app.Cron().MustAdd("gameExpiry", expirySchedule, expire)
	// And once on starting: a host that stops the server while nobody plays
	// (Fly.io does) runs no job meanwhile, so games can have expired since.
	go expire()
	// So the review page can say how long the stories stay.
	se.Router.GET("/api/expiry", func(e *core.RequestEvent) error {
		return e.JSON(http.StatusOK, map[string]any{
			"after_finish_hours": int(keepAfterFinish.Hours()),
			"idle_days":          int(keepIdle.Hours() / 24),
		})
	})
	return nil
}

// deleteExpiredGames deletes every game expired at now, and reports how many.
// One that can't be deleted doesn't stop the rest.
func deleteExpiredGames(app core.App, now time.Time) (int, error) {
	var ids []string
	if err := app.DB().NewQuery("SELECT id FROM games").Column(&ids); err != nil {
		return 0, err
	}
	n := 0
	var errs []error
	for _, id := range ids {
		deleted, err := expireGame(app, id, now)
		if deleted {
			n++
		}
		if err != nil {
			errs = append(errs, fmt.Errorf("game %s: %w", id, err))
		}
	}
	return n, errors.Join(errs...)
}

// expireGame deletes gameID if it's past keeping at now, deciding inside the
// delete's own transaction: a lobby that's started (or a game that's moved on)
// while the job runs is kept, not deleted on what was read a moment before.
func expireGame(app core.App, gameID string, now time.Time) (bool, error) {
	return expireGameBy(app, gameID, now, gameExpired)
}

// expireGameBy is expireGame with rule deciding whether the game is past
// keeping, asked inside the delete's transaction.
func expireGameBy(app core.App, gameID string, now time.Time, rule func(core.App, string, time.Time) (bool, error)) (bool, error) {
	deleted := false
	err := app.RunInTransaction(func(tx core.App) error {
		expired, err := rule(tx, gameID, now)
		if err != nil || !expired {
			return err
		}
		if err := deleteGameRecords(tx, gameID); err != nil {
			return err
		}
		deleted = true
		return nil
	})
	return deleted && err == nil, err
}

// gameExpired reports whether gameID is past keeping at now (see Expiry).
func gameExpired(app core.App, gameID string, now time.Time) (bool, error) {
	last, err := lastActivity(app, gameID)
	if err != nil {
		return false, err
	}
	idle := now.Sub(last)
	if idle > keepIdle {
		return true, nil
	}
	if idle > keepIdleLobby {
		game, err := app.FindRecordById("games", gameID)
		if err != nil {
			return false, err
		}
		if !game.GetBool("isStarted") {
			return true, nil
		}
	}
	at, finished, err := finishedAt(app, gameID)
	if err != nil {
		return false, err
	}
	return finished && now.Sub(at) > keepAfterFinish, nil
}

// lastActivity is when anything last happened in gameID: the game or any of
// its records written, or one of its players' devices checking in.
func lastActivity(app core.App, gameID string) (time.Time, error) {
	var last string
	err := app.DB().NewQuery(`SELECT MAX(t) FROM (
		SELECT updated AS t FROM games WHERE id = {:g}
		UNION ALL SELECT MAX(updated) FROM users WHERE game_id = {:g}
		UNION ALL SELECT MAX(seen_at) FROM users WHERE game_id = {:g}
		UNION ALL SELECT MAX(created) FROM stories WHERE game_id = {:g}
		UNION ALL SELECT MAX(created) FROM turns WHERE game_id = {:g}
	) WHERE t IS NOT NULL AND t != ''`).Bind(dbx.Params{"g": gameID}).Row(&last)
	if err != nil {
		return time.Time{}, err
	}
	return parseTime(last)
}

// finishedAt is when gameID was over, if it is: the End Game deadline, or the
// last turn once every player has finished (which an endless game never
// does on its own).
func finishedAt(app core.App, gameID string) (time.Time, bool, error) {
	game, err := app.FindRecordById("games", gameID)
	if err != nil {
		return time.Time{}, false, err
	}
	if gameOver(app, gameID) {
		return game.GetDateTime("ends_at").Time(), true, nil
	}
	if !game.GetBool("isStarted") || game.GetBool("endless") {
		return time.Time{}, false, nil
	}
	players, err := gamePlayers(app, gameID)
	if err != nil || len(players) == 0 {
		return time.Time{}, false, err
	}
	for _, p := range players {
		if !p.Finished {
			return time.Time{}, false, nil
		}
	}
	var last string
	err = app.DB().NewQuery("SELECT COALESCE(MAX(created), '') FROM turns WHERE game_id = {:g}").
		Bind(dbx.Params{"g": gameID}).Row(&last)
	if err != nil || last == "" {
		return time.Time{}, false, err
	}
	at, err := parseTime(last)
	return at, err == nil, err
}

func parseTime(s string) (time.Time, error) {
	dt, err := types.ParseDateTime(s)
	if err != nil {
		return time.Time{}, err
	}
	return dt.Time(), nil
}

// deleteGameRecords deletes gameID and everything in it, in one transaction:
// its turns (PocketBase removes their drawings once it commits), stories and
// players, then the game. Nothing cascades, so it goes child first. A game
// played again from this one keeps going; it just no longer points back.
func deleteGameRecords(app core.App, gameID string) error {
	return app.RunInTransaction(func(tx core.App) error {
		for _, collection := range []string{"turns", "stories", "users"} {
			records, err := tx.FindRecordsByFilter(collection, "game_id = {:g}", "", 0, 0, dbx.Params{"g": gameID})
			if err != nil {
				return err
			}
			for _, r := range records {
				if err := tx.Delete(r); err != nil {
					return fmt.Errorf("delete %s %s: %w", collection, r.Id, err)
				}
			}
		}
		// The game this one was played again from (if it's still here) no
		// longer has a next game to send its players to.
		_, err := tx.DB().NewQuery(`UPDATE games SET next_game = '', next_game_code = ''
			WHERE next_game = {:g}`).Bind(dbx.Params{"g": gameID}).Execute()
		if err != nil {
			return err
		}
		game, err := tx.FindRecordById("games", gameID)
		if err != nil {
			return err
		}
		return tx.Delete(game)
	})
}
