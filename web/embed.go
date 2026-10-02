// Package web is the built web app (web/dist), embedded so the server binary
// serves it from wherever it runs. Build it first (make frontend); without a
// build, dist holds only a placeholder page.
package web

import "embed"

//go:embed dist/*
var Dist embed.FS
