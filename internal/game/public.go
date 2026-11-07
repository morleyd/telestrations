package game

import (
	"errors"
	"fmt"
	"log"
	"strconv"
	"strings"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/hook"
)

// Public mode: the server on the internet rather than on a home network. A
// game on the Wi-Fi trusts the people in the room; a public one can't, so the
// stricter settings switch on together, from the environment:
//
//   - PUBLIC_MODE=1 turns it on (so do true, yes and on), and 0, false, no,
//     off or nothing leave it off. Any other value stops the server: a typo
//     would otherwise start home mode, setup link and dashboard open, on the
//     internet.
//   - ADMIN_EMAIL and ADMIN_PASSWORD are the only superuser. The server won't
//     start in public mode without them, makes or updates that superuser on
//     every start, and removes any other (a copied pb_data's, say). There's no
//     setup link: on a fresh database, whoever opened it first would own the
//     server.
//   - ADMIN_DASHBOARD=1 serves the dashboard (/_/) and lets the superuser sign
//     in. Without it both answer 404, so there's nothing to guess a password
//     against. Turn it on to look at the logs, then off again.
//   - The limits (see limits.go): TRUSTED_PROXY_HEADER names the header the
//     proxy in front puts the visitor's address in (Fly-Client-IP on
//     Fly.io); MAX_PLAYERS (default 30) caps a game's players, and MAX_GAMES
//     (default 1000) the games on the server.
//   - Games are deleted once they're no longer needed, and logs kept for two
//     days (see expiry.go).
//   - Security headers, and no cross-origin requests (see headers.go).
//
// Without PUBLIC_MODE nothing here applies, and the server is set up as for
// `make run`.
type Mode struct {
	Public        bool
	AdminEmail    string
	AdminPassword string
	Dashboard     bool
	ProxyHeader   string
	MaxPlayers    int
	MaxGames      int
}

// minAdminPassword is the shortest ADMIN_PASSWORD public mode accepts. Signing
// in is rate limited as well, but a long random password is what makes
// guessing it hopeless.
const minAdminPassword = 20

// ModeFromEnv reads the mode from the environment (getenv is os.Getenv). It
// refuses a PUBLIC_MODE it can't read, and a public mode without a usable
// superuser.
func ModeFromEnv(getenv func(string) string) (Mode, error) {
	m := Mode{
		AdminEmail:    strings.TrimSpace(getenv("ADMIN_EMAIL")),
		AdminPassword: getenv("ADMIN_PASSWORD"),
		Dashboard:     isOn(getenv("ADMIN_DASHBOARD")),
		ProxyHeader:   strings.TrimSpace(getenv("TRUSTED_PROXY_HEADER")),
	}
	public := getenv("PUBLIC_MODE")
	switch strings.ToLower(strings.TrimSpace(public)) {
	case "1", "true", "yes", "on":
		m.Public = true
	case "", "0", "false", "no", "off":
	default:
		return m, fmt.Errorf("PUBLIC_MODE=%q: want 1, true, yes or on for public mode, or 0, false, no, off or unset for home", public)
	}
	if !m.Public {
		return m, nil
	}
	if !strings.Contains(m.AdminEmail, "@") {
		return m, errors.New("public mode needs ADMIN_EMAIL, the superuser's email address")
	}
	if len(m.AdminPassword) < minAdminPassword {
		return m, fmt.Errorf("public mode needs ADMIN_PASSWORD, at least %d characters", minAdminPassword)
	}
	var err error
	if m.MaxPlayers, err = positiveInt(getenv, "MAX_PLAYERS", defaultMaxPlayers); err != nil {
		return m, err
	}
	if m.MaxGames, err = positiveInt(getenv, "MAX_GAMES", defaultMaxGames); err != nil {
		return m, err
	}
	return m, nil
}

// positiveInt is the environment variable name as a whole number above zero,
// or fallback if it's unset.
func positiveInt(getenv func(string) string, name string, fallback int) (int, error) {
	v := strings.TrimSpace(getenv(name))
	if v == "" {
		return fallback, nil
	}
	n, err := strconv.Atoi(v)
	if err != nil || n < 1 {
		return 0, fmt.Errorf("%s must be a whole number above zero, not %q", name, v)
	}
	return n, nil
}

func isOn(v string) bool {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "1", "true", "yes", "on":
		return true
	}
	return false
}

// ConfigureServe sets the server up for m. Call it from OnServe, before the
// game's own routes.
func ConfigureServe(se *core.ServeEvent, m Mode) error {
	// With no superuser yet, PocketBase's default installer opens the setup
	// page in the machine's default browser. That fires on every fresh data
	// dir (every E2E run), so print the link instead and never launch it.
	se.InstallerFunc = printInstallerLink

	// On the internet: the superuser from the environment, no setup link,
	// and the dashboard hidden unless it's switched on.
	if m.Public {
		return ServePublic(se, m)
	}
	// At home, nothing a public run saved into the settings still applies.
	return resetLimits(se.App)
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

// ServePublic sets up a server in public mode (see Mode): no setup link, the
// superuser from the environment, and the dashboard hidden unless it's on.
// Call it from OnServe, before the game's own routes.
func ServePublic(se *core.ServeEvent, m Mode) error {
	se.InstallerFunc = nil
	if err := ensureAdmin(se.App, m.AdminEmail, m.AdminPassword); err != nil {
		return fmt.Errorf("public mode: %w", err)
	}
	if !m.Dashboard {
		se.Router.Bind(&hook.Handler[*core.RequestEvent]{
			Id: "gameHideAdmin",
			// Ahead of every other middleware, the rate limiter (-1000) included:
			// nothing about it should show.
			Priority: -1001,
			Func:     hideAdmin,
		})
	}
	if err := applyLimits(se, m); err != nil {
		return fmt.Errorf("public mode: %w", err)
	}
	if err := bindExpiry(se); err != nil {
		return fmt.Errorf("public mode: %w", err)
	}
	bindSecurityHeaders(se)
	se.App.Logger().Info("public mode", "dashboard", m.Dashboard, "proxy_header", m.ProxyHeader,
		"max_players", m.MaxPlayers, "max_games", m.MaxGames)
	return nil
}

// ensureAdmin makes email the one superuser, with password. A password that
// already matches is left alone: saving it again would sign the superuser out
// of the dashboard on every restart.
func ensureAdmin(app core.App, email, password string) error {
	return app.RunInTransaction(func(tx core.App) error {
		col, err := tx.FindCachedCollectionByNameOrId(core.CollectionNameSuperusers)
		if err != nil {
			return err
		}
		admin, err := tx.FindAuthRecordByEmail(col, email)
		if err != nil {
			admin = core.NewRecord(col)
			admin.SetEmail(email)
		}
		if admin.IsNew() || !admin.ValidatePassword(password) {
			admin.SetPassword(password)
			if err := tx.Save(admin); err != nil {
				return fmt.Errorf("save the superuser: %w", err)
			}
		}
		others, err := tx.FindAllRecords(col, dbx.Not(dbx.HashExp{"id": admin.Id}))
		if err != nil {
			return err
		}
		for _, other := range others {
			if err := tx.Delete(other); err != nil {
				return fmt.Errorf("remove superuser %s: %w", other.Email(), err)
			}
			tx.Logger().Warn("public mode: removed a superuser not in ADMIN_EMAIL", "email", other.Email())
		}
		return nil
	})
}

// hideAdmin answers 404 for the dashboard and for the superusers' own API
// (signing in, password resets and the rest), as if neither existed.
func hideAdmin(e *core.RequestEvent) error {
	p := e.Request.URL.Path
	if isDashboardPath(p) || isSuperusersAPI(e.App, p) {
		return e.NotFoundError("", nil)
	}
	return e.Next()
}

// isDashboardPath reports whether path is PocketBase's dashboard (/_/).
func isDashboardPath(path string) bool {
	return path == "/_" || strings.HasPrefix(path, "/_/")
}

// isSuperusersAPI reports whether path is under /api/collections/{c}/ for the
// superusers collection. PocketBase finds {c} by id or by name in any case,
// so this looks it up the same way rather than comparing strings.
func isSuperusersAPI(app core.App, path string) bool {
	rest, ok := strings.CutPrefix(path, "/api/collections/")
	if !ok {
		return false
	}
	name, _, _ := strings.Cut(rest, "/")
	if name == "" {
		return false
	}
	col, err := app.FindCachedCollectionByNameOrId(name)
	return err == nil && col.Name == core.CollectionNameSuperusers
}
