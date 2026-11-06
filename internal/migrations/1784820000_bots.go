package migrations

import (
	"fmt"

	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Bots: players the server plays (see bots.go in internal/game), so one
// visitor can play a whole game. users.is_bot marks them; only the server sets
// it.

func init() {
	m.Register(func(app core.App) error {
		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return fmt.Errorf("find users: %w", err)
		}
		users.Fields.Add(&core.BoolField{Name: "is_bot"})
		return app.Save(users)
	}, func(app core.App) error {
		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return fmt.Errorf("find users: %w", err)
		}
		users.Fields.RemoveByName("is_bot")
		return app.Save(users)
	})
}
