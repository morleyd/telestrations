package game

import (
	"database/sql"
	"errors"
	"net/http"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// Presence: which turn each player has on screen, and when their device last
// said so, for the waiting screen's Working / Not started / Away. TakeTurn
// reports it whenever the turn on screen changes and every ~20s besides, so a
// phone that's gone to sleep stops reporting.
//
// Both fields are written straight to the database rather than saved as a
// record: a report every few seconds from every player mustn't run the record
// hooks or send everyone a realtime event. GET /api/games/{gameId}/players
// returns them (working_on, idle_seconds).

// maxWorkingOn caps what a client can store as its turn ("storyId:index").
const maxWorkingOn = 100

// presence is a player's presence as the players endpoint reports it.
type presence struct {
	WorkingOn string
	// Seconds since their device last reported, by the database's clock, or
	// -1 if it never has.
	IdleSeconds int
}

// gamePresence is every player in gameID's presence, by user id.
func gamePresence(app core.App, gameID string) (map[string]presence, error) {
	var rows []struct {
		ID        string `db:"id"`
		WorkingOn string `db:"working_on"`
		Idle      int    `db:"idle"`
	}
	err := app.DB().NewQuery(`SELECT id, COALESCE(working_on, '') AS working_on,
	  CASE WHEN COALESCE(seen_at, '') = '' THEN -1
	    ELSE CAST(ROUND((julianday('now') - julianday(seen_at)) * 86400) AS INTEGER) END AS idle
	FROM users WHERE game_id = {:g}`).Bind(dbx.Params{"g": gameID}).All(&rows)
	if err != nil {
		return nil, err
	}
	out := make(map[string]presence, len(rows))
	for _, r := range rows {
		out[r.ID] = presence{WorkingOn: r.WorkingOn, IdleSeconds: r.Idle}
	}
	return out, nil
}

func bindPresenceRoutes(se *core.ServeEvent) {
	// POST /api/games/{gameId}/players/{userId}/presence {working_on}: the
	// player's device is here, with that turn on screen ("" for none).
	se.Router.POST("/api/games/{gameId}/players/{userId}/presence", func(e *core.RequestEvent) error {
		body := struct {
			WorkingOn string `json:"working_on"`
		}{}
		if err := e.BindBody(&body); err != nil {
			return e.BadRequestError("Invalid body.", err)
		}
		if len(body.WorkingOn) > maxWorkingOn {
			return e.BadRequestError("working_on is too long.", nil)
		}
		gameID, userID := e.Request.PathValue("gameId"), e.Request.PathValue("userId")
		var id string
		err := e.App.DB().NewQuery("SELECT id FROM users WHERE id = {:u} AND game_id = {:g}").
			Bind(dbx.Params{"u": userID, "g": gameID}).Row(&id)
		if errors.Is(err, sql.ErrNoRows) {
			return e.NotFoundError("Player not found in this game.", nil)
		}
		if err != nil {
			return err
		}
		_, err = e.App.DB().NewQuery(`UPDATE users SET working_on = {:w},
		  seen_at = strftime('%Y-%m-%d %H:%M:%fZ', 'now') WHERE id = {:u}`).
			Bind(dbx.Params{"w": body.WorkingOn, "u": userID}).Execute()
		if err != nil {
			return err
		}
		return e.NoContent(http.StatusNoContent)
	})
}
