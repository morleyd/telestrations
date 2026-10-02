package game

import (
	"io/fs"
	"strings"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

// BindSPA serves the single-page app from dist: a file if there is one, else
// index.html, so the client router can take the path (a game code, /draw,
// /review). Bind it after every API route: it matches everything.
func BindSPA(se *core.ServeEvent, dist fs.FS) {
	spa := apis.Static(dist, true)
	se.Router.GET("/{path...}", func(e *core.RequestEvent) error {
		// A missing build asset is a real 404, not a page route. Without this
		// the fallback answers a stale tab's request for an old build's chunk
		// with index.html (200, text/html), which fails confusingly on the
		// client instead of plainly (the router then reloads; see router.js).
		if p := e.Request.PathValue("path"); strings.HasPrefix(p, "assets/") {
			if _, err := fs.Stat(dist, p); err != nil {
				return e.NotFoundError("", nil)
			}
		}
		return spa(e)
	})
}
