// Package web is the built web app (web/dist), embedded so the server binary
// serves it from wherever it runs. Build it first (make frontend); without a
// build, dist holds only a placeholder favicon.
package web

import (
	"embed"
	"io/fs"
	"path"
	"strings"
)

//go:embed dist/*
var Dist embed.FS

// The faces a player can pick for their avatar, which the app bundles.
//
//go:embed src/assets/avatars/*.svg
var faces embed.FS

// FaceNames are the faces' names, as a player's avatar holds one: each file's,
// without ".svg" (see web/src/services/faces.js).
func FaceNames() []string {
	files, _ := fs.Glob(faces, "src/assets/avatars/*.svg")
	names := make([]string, len(files))
	for i, f := range files {
		names[i] = strings.TrimSuffix(path.Base(f), ".svg")
	}
	return names
}
