package game

import (
	"net/http"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// BindRoutes registers the game's own API routes: health, the client log,
// the host controls and the atomic game start. The Go tests serve the same set.
func BindRoutes(se *core.ServeEvent) {
	// Health endpoint
	se.Router.GET("/health", func(e *core.RequestEvent) error {
		e.Response.Header().Set("Content-Type", "application/json")
		_, _ = e.Response.Write([]byte(`{"ok":true}`))
		return nil
	})

	// Client event log. Browsers batch their events here (see
	// web/src/services/log.js) so a multi-device game can be traced from the
	// dashboard's Logs view. Unauthenticated like the rest of the game, so
	// size-capped.
	se.Router.POST("/api/client-log", handleClientLog)

	// Host-only mid-game controls: skip or drop a player (see host.go).
	bindHostRoutes(se)

	// Atomic game start. Assigning player positions and flipping isStarted
	// from the client was racy: positions were written one-by-one over the
	// host's live (realtime-mutated) roster, so a late joiner could keep the
	// default position 0 and scramble the whole rotation. Doing it here in a
	// single transaction, from the authoritative DB roster, removes that race.
	se.Router.POST("/api/games/{gameId}/begin", func(e *core.RequestEvent) error {
		gameID := e.Request.PathValue("gameId")
		if gameID == "" {
			return e.BadRequestError("Missing game id.", nil)
		}

		// Optional explicit seating order (the host's drag order). Absent/empty
		// body is fine — we fall back to join order.
		body := struct {
			Order []string `json:"order"`
		}{}
		_ = e.BindBody(&body)

		err := e.App.RunInTransaction(func(txApp core.App) error {
			game, err := txApp.FindRecordById("games", gameID)
			if err != nil {
				return e.BadRequestError("Invalid game.", err)
			}
			if game.GetBool("isStarted") {
				return e.BadRequestError("Game has already been started.", nil)
			}

			// Authoritative roster, deterministic join order as the fallback.
			users, err := txApp.FindRecordsByFilter(
				"users", "game_id = {:g}", "created,id", 0, 0, dbx.Params{"g": gameID})
			if err != nil {
				return err
			}
			if len(users) == 0 {
				return e.BadRequestError("No players in this game.", nil)
			}

			// Seat by the requested order where valid, then append anyone the
			// host's snapshot missed (e.g. a straggler) in join order. This
			// always yields a full 0..N-1 permutation of the real roster.
			byID := make(map[string]*core.Record, len(users))
			for _, u := range users {
				byID[u.Id] = u
			}
			ordered := make([]*core.Record, 0, len(users))
			placed := make(map[string]bool, len(users))
			for _, id := range body.Order {
				if u, ok := byID[id]; ok && !placed[id] {
					placed[id] = true
					ordered = append(ordered, u)
				}
			}
			for _, u := range users {
				if !placed[u.Id] {
					placed[u.Id] = true
					ordered = append(ordered, u)
				}
			}

			seating := make([]string, 0, len(ordered))
			for i, u := range ordered {
				u.Set("position", i)
				if err := txApp.Save(u); err != nil {
					return err
				}
				seating = append(seating, u.GetString("username"))
			}
			txApp.Logger().Info("game: begin",
				"game", game.GetString("game_code"), "game_id", game.Id,
				"seating", seating, "requested_order", len(body.Order))

			game.Set("isStarted", true)
			return txApp.Save(game)
		})
		if err != nil {
			return err
		}

		return e.JSON(http.StatusOK, map[string]any{"ok": true})
	})
}
