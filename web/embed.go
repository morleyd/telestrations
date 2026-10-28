// Package web is the built web app (web/dist), embedded so the server binary
// serves it from wherever it runs. Build it first (make frontend); without a
// build, dist holds only a placeholder favicon.
package web

import (
	"embed"
	"io/fs"
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
	files, err := fs.ReadDir(faces, "src/assets/avatars")
	if err != nil {
		// Only if this path and the embed's have drifted apart: fail rather
		// than refuse every face.
		panic(err)
	}
	names := make([]string, len(files))
	for i, f := range files {
		names[i] = strings.TrimSuffix(f.Name(), ".svg")
	}
	return names
}
