package game

import (
	"crypto/rand"
	"database/sql"
	"errors"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// A game's code is the key to the game (see migration 1784800000). The
// collections' API rules want it in this header on every read and write, and
// the game's own routes below check it the same way.
const gameCodeHeader = "X-Game-Code"

// msgNoGame is the answer to a missing game and to a wrong code alike, so a
// wrong code says nothing about whether the game exists.
const msgNoGame = "Game not found."

// requireGameCode returns gameID's game if the request carries its code, and
// a 404 otherwise.
func requireGameCode(e *core.RequestEvent, gameID string) (*core.Record, error) {
	code := e.Request.Header.Get(gameCodeHeader)
	if gameID == "" || code == "" {
		return nil, e.NotFoundError(msgNoGame, nil)
	}
	game, err := e.App.FindRecordById("games", gameID)
	if err != nil || game.GetString("game_code") != code {
		return nil, e.NotFoundError(msgNoGame, nil)
	}
	return game, nil
}

// codeLetters are what a game code is made of. Lowercase only: the database
// compares codes exactly, and the web app lowercases what players type.
const codeLetters = "abcdefghijklmnopqrstuvwxyz"

// randomCode is five letters from crypto/rand. A guessable sequence would let
// someone who saw a few codes work out the next ones.
func randomCode() string {
	b := make([]byte, 5)
	// 26 × 9 = 234: a byte at or above that is redrawn, so every letter is
	// equally likely.
	buf := make([]byte, 1)
	for i := range b {
		for {
			rand.Read(buf) // never fails (see crypto/rand)
			if buf[0] < 234 {
				b[i] = codeLetters[buf[0]%26]
				break
			}
		}
	}
	return string(b)
}

// newGameCode is a game code nobody's using.
func newGameCode(app core.App) (string, error) {
	for range 20 {
		code := randomCode()
		_, err := app.FindFirstRecordByFilter("games", "game_code = {:c}", dbx.Params{"c": code})
		switch {
		case errors.Is(err, sql.ErrNoRows):
			return code, nil
		case err != nil:
			return "", err
		}
	}
	return "", errors.New("no free game code")
}
