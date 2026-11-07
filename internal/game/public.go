package game

import (
	"errors"
	"fmt"
	"strings"

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
//
// Without PUBLIC_MODE nothing here applies, and the server is set up as for
// `make run`.
type Mode struct {
	Public        bool
	AdminEmail    string
	AdminPassword string
	Dashboard     bool
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
	return m, nil
}

func isOn(v string) bool {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "1", "true", "yes", "on":
		return true
	}
	return false
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
			Id:       "gameHideAdmin",
			Priority: -1000, // ahead of every other middleware: nothing about it should show
			Func:     hideAdmin,
		})
	}
	se.App.Logger().Info("public mode", "dashboard", m.Dashboard)
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
	if p == "/_" || strings.HasPrefix(p, "/_/") || isSuperusersAPI(e.App, p) {
		return e.NotFoundError("", nil)
	}
	return e.Next()
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
