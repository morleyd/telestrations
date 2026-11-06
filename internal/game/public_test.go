package game

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
)

const (
	testAdminEmail    = "admin@example.com"
	testAdminPassword = "correct-horse-battery-staple"
)

func env(vars map[string]string) func(string) string {
	return func(k string) string { return vars[k] }
}

func TestModeFromEnv(t *testing.T) {
	good := map[string]string{
		"PUBLIC_MODE": "1", "ADMIN_EMAIL": testAdminEmail, "ADMIN_PASSWORD": testAdminPassword,
	}
	with := func(k, v string) map[string]string {
		out := map[string]string{}
		for key, val := range good {
			out[key] = val
		}
		out[k] = v
		return out
	}
	tests := []struct {
		name    string
		vars    map[string]string
		public  bool
		wantErr string
	}{
		{name: "home network by default", vars: map[string]string{}},
		{name: "home network needs no admin", vars: map[string]string{"PUBLIC_MODE": "0"}},
		{name: "public", vars: good, public: true},
		{name: "public without an email", vars: with("ADMIN_EMAIL", ""), public: true, wantErr: "ADMIN_EMAIL"},
		{name: "public with a short password", vars: with("ADMIN_PASSWORD", "asdfasdfasdf"), public: true, wantErr: "ADMIN_PASSWORD"},
		{name: "public with no password", vars: with("ADMIN_PASSWORD", ""), public: true, wantErr: "ADMIN_PASSWORD"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			m, err := ModeFromEnv(env(tt.vars))
			if m.Public != tt.public {
				t.Errorf("Public = %v, want %v", m.Public, tt.public)
			}
			switch {
			case tt.wantErr == "" && err != nil:
				t.Fatalf("unexpected error: %v", err)
			case tt.wantErr != "" && (err == nil || !strings.Contains(err.Error(), tt.wantErr)):
				t.Fatalf("error = %v, want one naming %s", err, tt.wantErr)
			}
		})
	}
}

func TestModeFromEnvReadsTheDashboardSwitch(t *testing.T) {
	m, err := ModeFromEnv(env(map[string]string{
		"PUBLIC_MODE": "true", "ADMIN_EMAIL": testAdminEmail, "ADMIN_PASSWORD": testAdminPassword,
		"ADMIN_DASHBOARD": "yes",
	}))
	if err != nil || !m.Dashboard {
		t.Fatalf("Dashboard = %v (err %v), want on", m.Dashboard, err)
	}
}

func publicMode(dashboard bool) Mode {
	return Mode{Public: true, AdminEmail: testAdminEmail, AdminPassword: testAdminPassword, Dashboard: dashboard}
}

// servePublic is app's API in public mode, plus a stand-in for the
// dashboard's route (apis.Serve adds the real one, which the test router
// doesn't have).
func servePublic(t *testing.T, app core.App, m Mode) http.Handler {
	t.Helper()
	var err error
	api := serve(t, app, func(se *core.ServeEvent) {
		if err = ServePublic(se, m); err != nil {
			return
		}
		se.Router.GET("/_/{path...}", func(e *core.RequestEvent) error {
			return e.String(http.StatusOK, "dashboard")
		})
		BindRoutes(se)
	})
	if err != nil {
		t.Fatal(err)
	}
	return api
}

func superusers(t *testing.T, app core.App) []*core.Record {
	t.Helper()
	all, err := app.FindAllRecords(core.CollectionNameSuperusers)
	if err != nil {
		t.Fatal(err)
	}
	return all
}

func addSuperuser(t *testing.T, app core.App, email, password string) *core.Record {
	t.Helper()
	col, err := app.FindCollectionByNameOrId(core.CollectionNameSuperusers)
	if err != nil {
		t.Fatal(err)
	}
	su := core.NewRecord(col)
	su.SetEmail(email)
	su.SetPassword(password)
	if err := app.Save(su); err != nil {
		t.Fatal(err)
	}
	return su
}

// A copied pb_data can bring the old README's superuser along; public mode
// leaves only the one from the environment.
func TestPublicModeMakesTheOnlySuperuserFromTheEnvironment(t *testing.T) {
	app := newTestApp(t)
	addSuperuser(t, app, "asdf@asdf.asdf", "asdfasdfasdf")

	servePublic(t, app, publicMode(false))

	all := superusers(t, app)
	if len(all) != 1 || all[0].Email() != testAdminEmail {
		t.Fatalf("superusers = %v, want only %s", emails(all), testAdminEmail)
	}
	if !all[0].ValidatePassword(testAdminPassword) {
		t.Error("the superuser doesn't have ADMIN_PASSWORD")
	}
}

func TestPublicModeChangesTheSuperusersPassword(t *testing.T) {
	app := newTestApp(t)
	addSuperuser(t, app, testAdminEmail, "an-old-password-of-some-length")

	servePublic(t, app, publicMode(false))

	all := superusers(t, app)
	if len(all) != 1 || !all[0].ValidatePassword(testAdminPassword) {
		t.Fatalf("want %s with the new password, got %v", testAdminEmail, emails(all))
	}
}

// Every restart sets the superuser up again; one whose password already
// matches is left as it is, so it isn't signed out of the dashboard each time.
func TestPublicModeLeavesAnUpToDateSuperuserAlone(t *testing.T) {
	app := newTestApp(t)
	before := addSuperuser(t, app, testAdminEmail, testAdminPassword)

	servePublic(t, app, publicMode(false))

	after, err := app.FindAuthRecordByEmail(core.CollectionNameSuperusers, testAdminEmail)
	if err != nil {
		t.Fatal(err)
	}
	if after.TokenKey() != before.TokenKey() {
		t.Error("the superuser was saved again, which signs them out")
	}
}

func signIn(api http.Handler, collection string) *httptest.ResponseRecorder {
	return call(api, http.MethodPost, "/api/collections/"+collection+"/auth-with-password",
		map[string]any{"identity": testAdminEmail, "password": testAdminPassword})
}

func TestPublicModeHidesTheDashboardAndTheSuperuserSignIn(t *testing.T) {
	app := newTestApp(t)
	api := servePublic(t, app, publicMode(false))

	col, err := app.FindCollectionByNameOrId(core.CollectionNameSuperusers)
	if err != nil {
		t.Fatal(err)
	}
	// PocketBase finds a collection by id, or by name in any case.
	for _, name := range []string{"_superusers", "_SuperUsers", col.Id} {
		if rec := signIn(api, name); rec.Code != http.StatusNotFound {
			t.Errorf("sign in via %q: %d %s, want 404", name, rec.Code, rec.Body)
		}
	}
	for _, path := range []string{"/_/", "/_/index.html", "/api/collections/_superusers/records"} {
		if rec := call(api, http.MethodGet, path, nil); rec.Code != http.StatusNotFound {
			t.Errorf("GET %s: %d, want 404", path, rec.Code)
		}
	}
	// The game itself is unaffected.
	if rec := call(api, http.MethodGet, "/health", nil); rec.Code != http.StatusOK {
		t.Errorf("GET /health: %d, want 200", rec.Code)
	}
	if rec := call(api, http.MethodPost, "/api/collections/games/records", map[string]any{"roundDuration": -1}); rec.Code != http.StatusOK {
		t.Errorf("create a game: %d %s, want 200", rec.Code, rec.Body)
	}
}

func TestPublicModeWithTheDashboardOnLetsTheSuperuserSignIn(t *testing.T) {
	app := newTestApp(t)
	api := servePublic(t, app, publicMode(true))

	if rec := signIn(api, "_superusers"); rec.Code != http.StatusOK {
		t.Errorf("sign in: %d %s, want 200", rec.Code, rec.Body)
	}
	if rec := call(api, http.MethodGet, "/_/", nil); rec.Code != http.StatusOK {
		t.Errorf("GET /_/: %d, want 200", rec.Code)
	}
}

func emails(records []*core.Record) []string {
	out := make([]string, len(records))
	for i, r := range records {
		out[i] = r.Email()
	}
	return out
}
