package game

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

// The security headers and CORS on a public server (headers.go).

// serveLikeServe is app's API with the middleware `serve` adds on top of the
// router (CORS for any origin, PocketBase's default) and a stand-in for the
// dashboard, then public mode if public.
func serveLikeServe(t *testing.T, app core.App, public bool) http.Handler {
	t.Helper()
	var err error
	api := serve(t, app, func(se *core.ServeEvent) {
		se.Router.Bind(apis.CORS(apis.CORSConfig{AllowOrigins: []string{"*"}}))
		se.Router.GET("/_/{path...}", func(e *core.RequestEvent) error {
			return e.String(http.StatusOK, "dashboard")
		})
		if public {
			if err = ServePublic(se, publicMode(true)); err != nil {
				return
			}
		}
		BindRoutes(se)
	})
	if err != nil {
		t.Fatal(err)
	}
	return api
}

func get(api http.Handler, path string, header map[string]string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, path, nil)
	for k, v := range header {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	api.ServeHTTP(rec, req)
	return rec
}

func TestPublicModeSendsSecurityHeaders(t *testing.T) {
	api := serveLikeServe(t, newTestApp(t), true)
	h := get(api, "/health", nil).Header()

	want := map[string]string{
		"Strict-Transport-Security": "max-age=31536000",
		"X-Frame-Options":           "DENY",
		"Referrer-Policy":           "same-origin",
		"X-Content-Type-Options":    "nosniff",
	}
	for k, v := range want {
		if got := h.Get(k); got != v {
			t.Errorf("%s = %q, want %q", k, got, v)
		}
	}
	csp := h.Get("Content-Security-Policy")
	for _, directive := range []string{"default-src 'self'", "script-src 'self';", "frame-ancestors 'none'", "object-src 'none'"} {
		if !strings.Contains(csp, directive) {
			t.Errorf("CSP %q lacks %q", csp, directive)
		}
	}
	if strings.Contains(csp, "unsafe-eval") {
		t.Errorf("CSP allows eval: %q", csp)
	}
}

// The dashboard's UI needs PocketBase's own policy.
func TestTheDashboardKeepsItsOwnPolicy(t *testing.T) {
	api := serveLikeServe(t, newTestApp(t), true)
	if csp := get(api, "/_/", nil).Header().Get("Content-Security-Policy"); csp != "" {
		t.Errorf("the dashboard got the game's CSP: %q", csp)
	}
}

func TestAtHomeTheHeadersAreAsBefore(t *testing.T) {
	api := serveLikeServe(t, newTestApp(t), false)
	h := get(api, "/health", map[string]string{"Origin": "http://192.168.1.20:3000"}).Header()
	for _, k := range []string{"Strict-Transport-Security", "Content-Security-Policy", "Referrer-Policy"} {
		if v := h.Get(k); v != "" {
			t.Errorf("%s = %q at home", k, v)
		}
	}
	// The dev server (another port) still reaches the API.
	if got := h.Get("Access-Control-Allow-Origin"); got == "" {
		t.Error("at home, cross-origin requests lost CORS")
	}
}

// The web app comes from the API's own address, so no other site's page
// gets to read the API from a visitor's browser.
func TestPublicModeAllowsNoOtherOrigin(t *testing.T) {
	api := serveLikeServe(t, newTestApp(t), true)
	rec := get(api, "/health", map[string]string{"Origin": "https://evil.example"})
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Errorf("Access-Control-Allow-Origin = %q, want none", got)
	}
	req := httptest.NewRequest(http.MethodOptions, "/api/collections/games/records", nil)
	req.Header.Set("Origin", "https://evil.example")
	req.Header.Set("Access-Control-Request-Method", http.MethodGet)
	req.Header.Set("Access-Control-Request-Headers", gameCodeHeader)
	pre := httptest.NewRecorder()
	api.ServeHTTP(pre, req)
	if got := pre.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Errorf("preflight allowed %q", got)
	}
}
