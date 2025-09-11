package main

import (
	"embed"
	"io/fs"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	_ "github.com/morleyd/telestrations/migrations"
	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

//go:embed web/dist/*
var embeddedFiles embed.FS

func main() {
	app := pocketbase.New()

	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		staticFS, err := fs.Sub(embeddedFiles, "web/dist")
		if err != nil {
			log.Printf("warning: embedded web/dist not found: %v", err)
			return se.Next()
		}

		// Health endpoint
		se.Router.GET("/health", func(e *core.RequestEvent) error {
			e.Response.Header().Set("Content-Type", "application/json")
			_, _ = e.Response.Write([]byte(`{"ok":true}`))
			return nil
		})

		// Single catch-all for SPA: serves files if present, else falls back to index.html
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
