package main

import (
	"context"
	"embed"
	"encoding/json"
	"io/fs"
	"log"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
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

	// Audit every turn as it lands. The rotation is only visible across devices,
	// so the server is the one place that can check each write against the
	// game's shape and flag the first bad turn, rather than finding a garbled
	// story at the review screen.
	// AI players (ai.go): providers come from ai.json at startup.
	bots := newBotDriver(app, loadAIConfig(app))
	app.RootCmd.AddCommand(aiSmokeCommand(app))

	app.OnRecordAfterCreateSuccess("turns").BindFunc(func(e *core.RecordEvent) error {
		auditTurn(e.App, e.Record)
		skipIfNextIsDropped(e.App, e.Record.GetString("story_id"))
		bots.kickGame(e.Record.GetString("game_id")) // a bot may be up next
		return e.Next()
	})
	bindTurnGuards(app)

	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		// With no superuser yet, PocketBase's default installer opens the setup
		// page in the machine's default browser. That fires on every fresh data
		// dir (every E2E run), so print the link instead and never launch it.
		se.InstallerFunc = printInstallerLink

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
		// Client event log. Browsers batch their events here (see
		// web/src/services/log.js) so a multi-device game can be traced from the
		// dashboard's Logs view. Unauthenticated like the rest of the game, so
		// size-capped.
		se.Router.POST("/api/client-log", func(e *core.RequestEvent) error {
			return handleClientLog(e)
		})

		// Host-only mid-game controls: skip or drop a player (see host.go).
		bindHostRoutes(app, se)
		bindAIRoutes(se, bots)
		// Pick up bot turns left waiting by a restart.
		go bots.kickAll()

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

			// AI players get their stories now (humans' pages create their own).
			go bots.startGame(gameID)

			return e.JSON(http.StatusOK, map[string]any{"ok": true})
		})

		// Single catch-all for SPA: serves files if present, else falls back to
		// index.html. Registered last so it can't shadow the API routes above.
		staticFS, err := fs.Sub(embeddedFiles, "web/dist")
		if err != nil {
			log.Printf("warning: embedded web/dist not found: %v", err)
			return se.Next()
		}
		spa := apis.Static(staticFS, true)
		se.Router.GET("/{path...}", func(e *core.RequestEvent) error {
			// A missing build asset is a real 404, not a page route. Without this
			// the fallback answers a stale tab's request for an old build's chunk
			// with index.html (200, text/html), which fails confusingly on the
			// client instead of plainly (the router then reloads; see router.js).
			if p := e.Request.PathValue("path"); strings.HasPrefix(p, "assets/") {
				if _, err := fs.Stat(staticFS, p); err != nil {
					return e.NotFoundError("", nil)
				}
			}
			return spa(e)
		})

		return se.Next()
	})

	// Run PocketBase. Start() runs whichever command was given: `serve` blocks
	// until the server stops; one-shot commands (`superuser`, `ai-smoke`, ...)
	// return when done, and then we exit instead of waiting for a signal.
	done := make(chan struct{})
	go func() {
		if err := app.Start(); err != nil {
			log.Fatalf("pocketbase start error: %v", err)
		}
		close(done)
	}()

	// Graceful shutdown on signal
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
	select {
	case <-done:
		return
	case s := <-sig:
		log.Printf("received signal %s - shutting down", s.String())
	}

	time.Sleep(500 * time.Millisecond)
	log.Println("exit")
}

// clientLogEntry is one event from web/src/services/log.js.
type clientLogEntry struct {
	Seq   int            `json:"seq"`
	T     string         `json:"t"`
	Level string         `json:"level"`
	Event string         `json:"event"`
	Attrs map[string]any `json:"attrs"`
}

const maxClientLogBytes = 256 << 10
const maxClientLogEntries = 200

func handleClientLog(e *core.RequestEvent) error {
	body := struct {
		Session  string           `json:"session"`
		Browser  string           `json:"browser"`
		UA       string           `json:"ua"`
		Game     string           `json:"game"`
		GameID   string           `json:"gameId"`
		Username string           `json:"username"`
		UserID   string           `json:"userId"`
		Entries  []clientLogEntry `json:"entries"`
	}{}
	// Decoded by hand rather than BindBody: sendBeacon posts as text/plain.
	r := http.MaxBytesReader(e.Response, e.Request.Body, maxClientLogBytes)
	if err := json.NewDecoder(r).Decode(&body); err != nil {
		return e.BadRequestError("Invalid log payload.", err)
	}
	if len(body.Entries) > maxClientLogEntries {
		body.Entries = body.Entries[len(body.Entries)-maxClientLogEntries:]
	}

	logger := e.App.Logger().With(
		"source", "client",
		"game", body.Game, "game_id", body.GameID,
		"user", body.Username, "user_id", body.UserID,
		"browser", body.Browser, "session", body.Session,
		"ip", e.RealIP(), "ua", body.UA,
	)
	for _, entry := range body.Entries {
		level := slog.LevelInfo
		switch entry.Level {
		case "warn":
			level = slog.LevelWarn
		case "error":
			level = slog.LevelError
		}
		logger.Log(context.Background(), level, "client: "+entry.Event,
			"seq", entry.Seq, "client_time", entry.T, "attrs", entry.Attrs)
	}
	return e.NoContent(http.StatusNoContent)
}

// auditTurn logs a just-created turn with its place in the story, and warns when
// it breaks the game's invariants: a story opens with a word and then alternates
// word/drawing (a skipped turn instead repeats the type before it, since it
// carries that turn forward), each player writes at most one turn per story,
// and the writer must be the player the rotation expected.
func auditTurn(app core.App, turn *core.Record) {
	storyID := turn.GetString("story_id")
	userID := turn.GetString("user_id")

	var info struct {
		Taken    int    `db:"turns_taken"`
		Total    int    `db:"total_players"`
		PrevUser string `db:"prev_user_id"`
	}
	err := app.DB().NewQuery(
		"SELECT turns_taken, total_players, prev_user_id FROM progress WHERE story_id = {:s}").
		Bind(dbx.Params{"s": storyID}).One(&info)
	if err != nil {
		app.Logger().Error("turn: audit failed", "story", storyID, "turn", turn.Id, "error", err.Error())
		return
	}

	var mine int
	_ = app.DB().NewQuery("SELECT COUNT(*) FROM turns WHERE story_id = {:s} AND user_id = {:u}").
		Bind(dbx.Params{"s": storyID, "u": userID}).Row(&mine)

	username := userID
	if u, err := app.FindRecordById("users", userID); err == nil {
		username = u.GetString("username")
	}

	index := info.Taken - 1 // this turn is already counted
	isDrawing := turn.GetBool("is_drawing")
	skipped := turn.GetBool("skipped")
	wantDrawing := false
	if index > 0 {
		var prevDrawing bool
		_ = app.DB().NewQuery(`SELECT is_drawing FROM turns WHERE story_id = {:s}
			AND rowid < (SELECT rowid FROM turns WHERE id = {:t}) ORDER BY rowid DESC LIMIT 1`).
			Bind(dbx.Params{"s": storyID, "t": turn.Id}).Row(&prevDrawing)
		wantDrawing = !prevDrawing
		if skipped {
			wantDrawing = prevDrawing // carried forward unchanged
		}
	}
	logger := app.Logger().With(
		"source", "server",
		"game_id", turn.GetString("game_id"), "story", storyID, "turn", turn.Id,
		"user", username, "user_id", userID,
		"index", index, "of", info.Total,
		"is_drawing", isDrawing, "has_file", turn.GetString("drawing") != "",
		"skipped", skipped, "timed_out", turn.GetBool("timed_out"),
	)
	logger.Info("turn: created")

	switch {
	case mine > 1:
		logger.Warn("turn: player wrote to this story twice", "count", mine)
	case info.PrevUser != "" && info.PrevUser != userID:
		logger.Warn("turn: out of rotation", "expected_user_id", info.PrevUser)
	case index >= info.Total:
		logger.Warn("turn: story has more turns than players")
	}
	if isDrawing != wantDrawing {
		logger.Warn("turn: wrong type for position", "want_drawing", wantDrawing)
	}
}

// printInstallerLink is apis.DefaultInstallerFunc minus the browser launch.
func printInstallerLink(app core.App, systemSuperuser *core.Record, baseURL string) error {
	token, err := systemSuperuser.NewStaticAuthToken(30 * time.Minute)
	if err != nil {
		return err
	}
	log.Printf("no superuser yet: create one at %s/_/#/pbinstal/%s (or run: superuser upsert EMAIL PASS)",
		strings.TrimRight(baseURL, "/"), token)
	return nil
}
