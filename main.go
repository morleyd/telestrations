package main

import (
	"embed"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	_ "github.com/morleyd/telestrations/migrations"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

//go:embed web/dist/*
var embeddedFiles embed.FS

func main() {
	app := pocketbase.New()

	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		// Health endpoint
		se.Router.GET("/health", func(e *core.RequestEvent) error {
			e.Response.Header().Set("Content-Type", "application/json")
			_, _ = e.Response.Write([]byte(`{"ok":true}`))
			return nil
		})

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

			err := app.RunInTransaction(func(txApp core.App) error {
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

				for i, u := range ordered {
					u.Set("position", i)
					if err := txApp.Save(u); err != nil {
						return err
					}
				}

				game.Set("isStarted", true)
				return txApp.Save(game)
			})
			if err != nil {
				return err
			}

			return e.JSON(http.StatusOK, map[string]any{"ok": true})
		})

		// Single catch-all for SPA: serves files if present, else falls back to
		// index.html. Registered last so it can't shadow the API routes above.
		staticFS, err := fs.Sub(embeddedFiles, "web/dist")
		if err != nil {
			log.Printf("warning: embedded web/dist not found: %v", err)
			return se.Next()
		}
		se.Router.GET("/{path...}", apis.Static(staticFS, true))

		return se.Next()
	})

	// Run PocketBase server
	go func() {
		if err := app.Start(); err != nil {
			log.Fatalf("pocketbase start error: %v", err)
		}
	}()

	// Graceful shutdown on signal
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
	s := <-sig
	log.Printf("received signal %s - shutting down", s.String())

	time.Sleep(500 * time.Millisecond)
	log.Println("exit")
}
