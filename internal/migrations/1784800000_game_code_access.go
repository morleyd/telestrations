package migrations

import (
	"fmt"

	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// A game's code is the key to the game. Until now every rule was "" (anyone),
// so anyone who could reach the server could list every game's code, prompts
// and drawings, read every player's id (the host's included, which the host
// controls trust), and change or delete any game's records.
//
// Now a request sees a game, and anything in it, only if it carries the game's
// code in the X-Game-Code header (PocketBase reads it as
// @request.headers.x_game_code). That holds for realtime too: PocketBase checks
// each subscription against these rules with the headers it was made with.
//
//   - Reading needs the code.
//   - Creating a game needs nothing (the server picks its code). Joining,
//     renaming and leaving need the code; joining and leaving also need the
//     game not to have started, as before. A story or a turn needs the code
//     of the game its starter or story is in: a turn's game_id is the
//     server's to set, so the rule goes by its story.
//   - Changing or deleting a game, a story or a turn is the server's alone.
//     The web app never does either.
//
// Drawings aren't affected: PocketBase serves an unprotected file to anyone
// with its address, and the address holds the turn's id, which only the
// game's players can now read.
//
// Play again moves everyone to a game with a different code, so the old game
// now carries it too (games.next_game_code, set by the server with
// next_game): its players can read it with the old code, and nobody else can.

const codeMatches = `@request.headers.x_game_code != "" && `

type rules struct {
	list, view, create, update, delete *string
}

func rule(s string) *string { return &s }

var gameCodeRules = map[string]rules{
	"games": {
		list:   rule(codeMatches + `game_code = @request.headers.x_game_code`),
		view:   rule(codeMatches + `game_code = @request.headers.x_game_code`),
		create: rule(""),
	},
	"users": {
		list:   rule(codeMatches + `game_id.game_code = @request.headers.x_game_code`),
		view:   rule(codeMatches + `game_id.game_code = @request.headers.x_game_code`),
		create: rule(codeMatches + `game_id.game_code = @request.headers.x_game_code && game_id.isStarted = false`),
		update: rule(codeMatches + `game_id.game_code = @request.headers.x_game_code`),
		delete: rule(codeMatches + `game_id.game_code = @request.headers.x_game_code && game_id.isStarted = false`),
	},
	"stories": {
		list:   rule(codeMatches + `game_id.game_code = @request.headers.x_game_code`),
		view:   rule(codeMatches + `game_id.game_code = @request.headers.x_game_code`),
		create: rule(codeMatches + `game_id.game_code = @request.headers.x_game_code && starter_id.game_id = game_id`),
	},
	"turns": {
		list:   rule(codeMatches + `game_id.game_code = @request.headers.x_game_code`),
		view:   rule(codeMatches + `game_id.game_code = @request.headers.x_game_code`),
		create: rule(codeMatches + `story_id.game_id.game_code = @request.headers.x_game_code`),
	},
	"progress": {
		list: rule(codeMatches + `game_id.game_code = @request.headers.x_game_code`),
		view: rule(codeMatches + `game_id.game_code = @request.headers.x_game_code`),
	},
	"results": {
		list: rule(codeMatches + `game_id.game_code = @request.headers.x_game_code`),
		view: rule(codeMatches + `game_id.game_code = @request.headers.x_game_code`),
	},
}

// The rules before: open to anyone, but for the roster lock (migration
// 1757700000) and the views, which nobody writes to.
var openRules = map[string]rules{
	"games": {list: rule(""), view: rule(""), create: rule(""), update: rule(""), delete: rule("")},
	"users": {
		list: rule(""), view: rule(""), update: rule(""),
		create: rule("game_id.isStarted = false"), delete: rule("game_id.isStarted = false"),
	},
	"stories":  {list: rule(""), view: rule(""), create: rule(""), update: rule(""), delete: rule("")},
	"turns":    {list: rule(""), view: rule(""), create: rule(""), update: rule(""), delete: rule("")},
	"progress": {list: rule(""), view: rule("")},
	"results":  {list: rule(""), view: rule("")},
}

func setRules(app core.App, all map[string]rules) error {
	for name, r := range all {
		col, err := app.FindCollectionByNameOrId(name)
		if err != nil {
			return fmt.Errorf("find %q: %w", name, err)
		}
		col.ListRule, col.ViewRule = r.list, r.view
		if !col.IsView() {
			col.CreateRule, col.UpdateRule, col.DeleteRule = r.create, r.update, r.delete
		}
		if err := app.Save(col); err != nil {
			return fmt.Errorf("save %q: %w", name, err)
		}
	}
	return nil
}

func init() {
	m.Register(func(app core.App) error {
		games, err := app.FindCollectionByNameOrId("games")
		if err != nil {
			return fmt.Errorf("find games: %w", err)
		}
		games.Fields.Add(&core.TextField{Name: "next_game_code", Max: 20})
		if err := app.Save(games); err != nil {
			return fmt.Errorf("save games: %w", err)
		}
		// Games played again before this have no code to pass on yet.
		_, err = app.DB().NewQuery(`UPDATE games SET next_game_code = COALESCE(
			(SELECT next.game_code FROM games AS next WHERE next.id = games.next_game), '')`).Execute()
		if err != nil {
			return fmt.Errorf("backfill next_game_code: %w", err)
		}
		return setRules(app, gameCodeRules)
	}, func(app core.App) error {
		if err := setRules(app, openRules); err != nil {
			return err
		}
		games, err := app.FindCollectionByNameOrId("games")
		if err != nil {
			return fmt.Errorf("find games: %w", err)
		}
		games.Fields.RemoveByName("next_game_code")
		return app.Save(games)
	})
}
