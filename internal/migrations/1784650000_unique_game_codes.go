package migrations

import (
	"fmt"
	"math/rand"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// A game is found by its code, so no two games may share one. The server
// picks each code and checks it's free, and this makes the database say so
// too, closing the gap between that check and the save.
//
// Before codes were the server's, a browser made them up unchecked, so a
// database can already hold games sharing a code. The oldest of each keeps it
// (lookups found it first, so it's the one its players reached) and the
// others get fresh codes, so the index can build.

func init() {
	m.Register(func(app core.App) error {
		var dupes []string
		err := app.DB().NewQuery(`SELECT id FROM games WHERE rowid NOT IN (
			SELECT MIN(rowid) FROM games GROUP BY game_code
		)`).Column(&dupes)
		if err != nil {
			return fmt.Errorf("find shared codes: %w", err)
		}
		for _, id := range dupes {
			code, err := freeGameCode(app)
			if err != nil {
				return err
			}
			_, err = app.DB().NewQuery("UPDATE games SET game_code = {:code} WHERE id = {:id}").
				Bind(dbx.Params{"code": code, "id": id}).Execute()
			if err != nil {
				return fmt.Errorf("recode game %s: %w", id, err)
			}
		}

		games, err := app.FindCollectionByNameOrId("games")
		if err != nil {
			return fmt.Errorf("find games: %w", err)
		}
		games.AddIndex("idx_games_code", true, "game_code", "")
		return app.Save(games)
	}, func(app core.App) error {
		games, err := app.FindCollectionByNameOrId("games")
		if err != nil {
			return fmt.Errorf("find games: %w", err)
		}
		games.RemoveIndex("idx_games_code")
		return app.Save(games)
	})
}

// freeGameCode is five lowercase letters no game has, as newGameCode in
// internal/game makes them.
func freeGameCode(app core.App) (string, error) {
	const letters = "abcdefghijklmnopqrstuvwxyz"
	for range 20 {
		b := make([]byte, 5)
		for i := range b {
			b[i] = letters[rand.Intn(len(letters))]
		}
		var taken int
		err := app.DB().NewQuery("SELECT COUNT(*) FROM games WHERE game_code = {:c}").
			Bind(dbx.Params{"c": string(b)}).Row(&taken)
		if err != nil {
			return "", err
		}
		if taken == 0 {
			return string(b), nil
		}
	}
	return "", fmt.Errorf("no free game code")
}
