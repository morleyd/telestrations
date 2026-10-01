package migrations

import (
	"fmt"

	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Play again: the host starts a new game with the same players straight from
// the review (POST /api/games/{gameId}/rematch in host.go).
//
//   - games.next_game is the game that followed this one. Pages still on this
//     game see it set and move their player across.
//   - users.from_user is the player, in the game before, that this seat
//     continues. It's how a page finds its player's new seat.

func init() {
	m.Register(func(app core.App) error {
		games, err := app.FindCollectionByNameOrId("games")
		if err != nil {
			return fmt.Errorf("find games: %w", err)
		}
		games.Fields.Add(&core.RelationField{Name: "next_game", CollectionId: games.Id, MaxSelect: 1})
		if err := app.Save(games); err != nil {
			return fmt.Errorf("save games: %w", err)
		}

		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return fmt.Errorf("find users: %w", err)
		}
		users.Fields.Add(&core.RelationField{Name: "from_user", CollectionId: users.Id, MaxSelect: 1})
		users.AddIndex("idx_users_from_user", false, "from_user", "")
		return app.Save(users)
	}, func(app core.App) error {
		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return fmt.Errorf("find users: %w", err)
		}
		users.RemoveIndex("idx_users_from_user")
		users.Fields.RemoveByName("from_user")
		if err := app.Save(users); err != nil {
			return fmt.Errorf("save users: %w", err)
		}

		games, err := app.FindCollectionByNameOrId("games")
		if err != nil {
			return fmt.Errorf("find games: %w", err)
		}
		games.Fields.RemoveByName("next_game")
		return app.Save(games)
	})
}
