package migrations

import (
	"fmt"

	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Names and words had no limit of their own, so PocketBase's default (5,000
// characters) let one turn or one name fill a screen, a stored story image
// or the disk. A name is now at most 24 characters and a word or guess at
// most 200; the web app stops the typing at the same lengths.
//
// A longer name already saved is cut to fit: a player's record is saved again
// when they rename themselves or change their look, and validation would
// refuse it. Turns are never saved again, so their words are left as they are.

const (
	maxUsername = 24
	maxPrompt   = 200
)

func setTextMax(app core.App, collection, field string, max int) error {
	col, err := app.FindCollectionByNameOrId(collection)
	if err != nil {
		return fmt.Errorf("find %s: %w", collection, err)
	}
	f, ok := col.Fields.GetByName(field).(*core.TextField)
	if !ok {
		return fmt.Errorf("%s.%s isn't a text field", collection, field)
	}
	f.Max = max
	if err := app.Save(col); err != nil {
		return fmt.Errorf("save %s: %w", collection, err)
	}
	return nil
}

func init() {
	m.Register(func(app core.App) error {
		_, err := app.DB().NewQuery(fmt.Sprintf(
			"UPDATE users SET username = substr(username, 1, %d) WHERE length(username) > %d",
			maxUsername, maxUsername)).Execute()
		if err != nil {
			return fmt.Errorf("shorten long names: %w", err)
		}
		if err := setTextMax(app, "users", "username", maxUsername); err != nil {
			return err
		}
		return setTextMax(app, "turns", "prompt", maxPrompt)
	}, func(app core.App) error {
		if err := setTextMax(app, "users", "username", 0); err != nil {
			return err
		}
		return setTextMax(app, "turns", "prompt", 0)
	})
}
