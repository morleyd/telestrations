package main

import (
	"io/fs"
	"net/http"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/pocketbase/pocketbase/core"
)

// The web app's catch-all route (bindSPA). A tab still running an old build
// asks for chunk files that no longer exist; those must be plain 404s (the
// client router then reloads into the new build), while every page route
// still gets index.html.

func TestSPAServesFilesPagesAndRealMisses(t *testing.T) {
	app := newTestApp(t)
	dist := fstest.MapFS{
		"index.html":           {Data: []byte("<html>app</html>")},
		"version.json":         {Data: []byte(`{"build":"b2"}`)},
		"favicon.ico":          {Data: []byte("icon")},
		"assets/index-new.js":  {Data: []byte("console.log('new')")},
		"assets/index-new.css": {Data: []byte("body{}")},
	}
	h := serve(t, app, func(se *core.ServeEvent) {
		bindAPIRoutes(se)
		bindSPA(se, dist)
	})

	cases := []struct {
		path   string
		status int
		body   string
	}{
		{"/", http.StatusOK, "<html>app</html>"},
		{"/abcde", http.StatusOK, "<html>app</html>"},        // a game's waiting room
		{"/abcde/draw", http.StatusOK, "<html>app</html>"},   // a turn
		{"/abcde/review", http.StatusOK, "<html>app</html>"}, // the review
		{"/robots.txt", http.StatusOK, "<html>app</html>"},   // only assets/ misses are 404s
		{"/version.json", http.StatusOK, `{"build":"b2"}`},
		{"/favicon.ico", http.StatusOK, "icon"},
		{"/assets/index-new.js", http.StatusOK, "console.log('new')"},
		{"/assets/index-old.js", http.StatusNotFound, ""}, // an old build's chunk
		{"/assets/index-old.css", http.StatusNotFound, ""},
		{"/health", http.StatusOK, `{"ok":true}`},
		{"/api/games/nogame/players", http.StatusOK, `{"players":[]}`},
	}
	for _, c := range cases {
		rec := call(h, http.MethodGet, c.path, nil)
		if rec.Code != c.status {
			t.Errorf("GET %s: %d, want %d", c.path, rec.Code, c.status)
			continue
		}
		if body := strings.TrimSpace(rec.Body.String()); c.body != "" && body != c.body {
			t.Errorf("GET %s: %q, want %q", c.path, body, c.body)
		}
		if c.status == http.StatusNotFound && strings.Contains(rec.Body.String(), "<html>") {
			t.Errorf("GET %s: a missing asset was answered with the page", c.path)
		}
	}
}

// The binary embeds the built app (go:embed web/dist/*); a change to that
// pattern or the build output path would ship a server with no UI.
func TestTheBinaryEmbedsTheBuiltApp(t *testing.T) {
	dist, err := fs.Sub(embeddedFiles, "web/dist")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := fs.Stat(dist, "index.html"); err != nil {
		t.Fatalf("web/dist/index.html isn't embedded: %v", err)
	}
}
