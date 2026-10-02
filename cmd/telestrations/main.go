// Command telestrations is the game's server: PocketBase with the game's
// hooks, routes and migrations, serving the web app embedded from web/dist.
package main

import (
	"io/fs"
	"log"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/morleyd/telestrations/internal/game"
	_ "github.com/morleyd/telestrations/internal/migrations"
	"github.com/morleyd/telestrations/web"
	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
)

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
	game.BindHooks(app)

	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		// With no superuser yet, PocketBase's default installer opens the setup
		// page in the machine's default browser. That fires on every fresh data
		// dir (every E2E run), so print the link instead and never launch it.
		se.InstallerFunc = printInstallerLink

		game.BindRoutes(se)

		// The web app, last so it can't shadow the API routes above.
		staticFS, err := fs.Sub(web.Dist, "dist")
		if err != nil {
			log.Printf("warning: embedded web/dist not found: %v", err)
			return se.Next()
		}
		game.BindSPA(se, staticFS)

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
