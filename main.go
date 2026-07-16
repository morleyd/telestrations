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
	// Serialize reads onto a single data.db connection.
	//
	// PocketBase's default read pool (DataMaxOpenConns: 120) let concurrent
	// clients read from different SQLite connections, and under the burst of
	// reads+writes when everyone joins/starts a game at once, some of those
	// connections served a stale WAL snapshot: a just-committed row (a game
	// looked up by code, a freshly created story) read back as missing for up to
	// a couple of seconds. That stranded players on the "Error..." screen, failed
	// joins, and deadlocked turns — reproducible in the browser, invisible to the
	// API-level simulator. Empirically the failure scales with the pool size (120
	// and even 4 fail; 1 is solid), so we cap the pool at a single connection.
	// Reads are sub-millisecond and the game is turn-based with small lobbies, so
	// serializing them is not a meaningful throughput cost. Writes are unaffected
	// (they already run through the separate single NonconcurrentDB connection).
	//
	// CAVEAT: this fix is empirical — WHY pooled connections served snapshots
	// that stale (seconds, not the instant of a WAL transition) is undiagnosed,
	// which is abnormal for SQLite in WAL mode and may be a driver/PocketBase
	// pooling bug. Re-verify with the full-game e2e test after any PocketBase
	// upgrade before assuming this cap still holds.
	app := pocketbase.NewWithConfig(pocketbase.Config{DataMaxOpenConns: 1, DataMaxIdleConns: 1})

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
