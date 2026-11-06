package game

import (
	"strings"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/hook"
)

// Security headers on a public server, on top of PocketBase's own (nosniff,
// and the opener policy):
//
//   - HSTS: the host serves HTTPS only, so browsers should never try plain
//     HTTP again.
//   - No framing (frame-ancestors, X-Frame-Options DENY in place of
//     PocketBase's SAMEORIGIN): nobody can put the game inside their page and
//     trick a player into clicking it.
//   - A referrer that never leaves the site: a game's address holds its code.
//   - A Content-Security-Policy that lets the page load only what it ships:
//     scripts from the site itself (the HEIC decoder's CSP build, see
//     web/src/services/uploadImage.js, plus the worker it starts from a blob),
//     styles from the site and inline (Vuetify sets them), and pictures from
//     the site, data: and blob: (previews and drawings).
//   - No CORS: PocketBase allows any origin by default, but the web app is
//     served from the same address as the API, so nothing else needs it.
//
// The dashboard (/_/) keeps PocketBase's own policy, which its UI needs.

const contentSecurityPolicy = "default-src 'self'; " +
	"script-src 'self'; " +
	"worker-src 'self' blob:; " +
	"style-src 'self' 'unsafe-inline'; " +
	"img-src 'self' data: blob:; " +
	"font-src 'self' data:; " +
	"connect-src 'self'; " +
	"object-src 'none'; " +
	"base-uri 'self'; " +
	"form-action 'self'; " +
	"frame-ancestors 'none'"

// bindSecurityHeaders sets up the headers above on a public server.
func bindSecurityHeaders(se *core.ServeEvent) {
	se.Router.Unbind(apis.DefaultCorsMiddlewareId)
	se.Router.Bind(&hook.Handler[*core.RequestEvent]{
		Id: "gameSecurityHeaders",
		// After PocketBase's own headers, so DENY replaces SAMEORIGIN.
		Priority: apis.DefaultSecurityHeadersMiddlewarePriority + 1,
		Func: func(e *core.RequestEvent) error {
			h := e.Response.Header()
			h.Set("Strict-Transport-Security", "max-age=31536000")
			h.Set("X-Frame-Options", "DENY")
			h.Set("Referrer-Policy", "same-origin")
			if p := e.Request.URL.Path; p != "/_" && !strings.HasPrefix(p, "/_/") {
				h.Set("Content-Security-Policy", contentSecurityPolicy)
			}
			return e.Next()
		},
	})
}
