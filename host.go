package main

import (
	"database/sql"
	"errors"
	"math/rand"
	"net/http"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// Host controls: skipping a player's pending turns and dropping a player from a
// game in progress.
//
// Seating is fixed once a game begins: each story's next player is derived from
// (starter seat + turns taken) % players (see the progress view), so removing a
// player mid-game would reshuffle every story. Instead the roster stays put and
// the server writes the turns an absent player owes as "skipped" turns that
// carry the previous turn's content forward unchanged. The next player sees
// exactly what they would have if the absent player had passed it straight on,
// and the review hides skipped turns. A dropped player is skipped on every
// story that reaches them for the rest of the game.
//
// Like the rest of the game there are no accounts: the host proves who they
// are by sending their user id, which only their own tab knows.

// Client-visible messages. TakeTurn.vue matches on "skipped" and "removed", so
// keep those words if you reword these.
const (
	msgTurnSkipped    = "Your turn on this story was skipped by the host."
	msgPlayerRemoved  = "You were removed from this game by the host."
	msgNotYourTurn    = "It isn't your turn on this story."
	msgAlreadyTakenBy = "You already took your turn on this story."

	// Wrong kind of turn. Only an out-of-date page does this, so say how to fix it.
	msgWantWord    = "This story needs a starting word, not a drawing. Please refresh the page."
	msgWantGuess   = "This turn needs a guess, not a drawing. Please refresh the page."
	msgWantDrawing = "This turn needs a drawing, not a guess. Please refresh the page."
)

// Starting words for a player whose opening word is skipped.
var skipStartingWords = []string{
	"banana", "volcano", "penguin", "haunted house", "birthday cake", "robot",
	"treasure map", "snowman", "dragon", "rollercoaster", "pirate ship",
	"spaghetti", "unicorn", "thunderstorm", "sandcastle", "astronaut",
	"campfire", "octopus", "lighthouse", "magic trick", "bubble bath",
	"superhero", "cactus", "teapot", "dinosaur", "hot air balloon",
}

type storyState struct {
	StoryID  string `db:"story_id"`
	GameID   string `db:"game_id"`
	Starter  string `db:"starter_user_id"`
	Taken    int    `db:"turns_taken"`
	Total    int    `db:"total_players"`
	NextUser string `db:"next_user_id"`
	PrevUser string `db:"prev_user_id"`
	PrevTurn string `db:"prev_turn_id"`
}

const storyStateSelect = `SELECT story_id, game_id, starter_user_id, turns_taken, total_players,
  COALESCE(next_user_id, '') AS next_user_id, COALESCE(prev_user_id, '') AS prev_user_id,
  COALESCE(prev_turn_id, '') AS prev_turn_id
FROM progress`

func loadStory(app core.App, storyID string) (*storyState, error) {
	s := &storyState{}
	err := app.DB().NewQuery(storyStateSelect + " WHERE story_id = {:s}").
		Bind(dbx.Params{"s": storyID}).One(s)
	return s, err
}

func loadGameStories(app core.App, gameID string) ([]storyState, error) {
	var out []storyState
	err := app.DB().NewQuery(storyStateSelect + " WHERE game_id = {:g}").
		Bind(dbx.Params{"g": gameID}).All(&out)
	return out, err
}

var errNotTheirTurn = errors.New("not this player's turn")

// skipTurn writes the turn `userID` owes on `storyID` on their behalf, passing
// the previous turn on unchanged. timedOut marks it as the player's own round
// timer running out with nothing entered (the review says so) rather than the
// host skipping them. note, if any, is shown on the review page (e.g. why an
// AI player's turn was skipped). Returns errNotTheirTurn if that turn isn't
// theirs to take (anymore).
func skipTurn(app core.App, storyID, userID, reason string, timedOut bool, note string) error {
	return app.RunInTransaction(func(tx core.App) error {
		s, err := loadStory(tx, storyID)
		if err != nil {
			return err
		}
		if s.NextUser != userID {
			return errNotTheirTurn
		}

		col, err := tx.FindCollectionByNameOrId("turns")
		if err != nil {
			return err
		}
		turn := core.NewRecord(col)
		turn.Set("story_id", storyID)
		turn.Set("user_id", userID)
		turn.Set("game_id", s.GameID)
		turn.Set("skipped", true)
		turn.Set("timed_out", timedOut)
		turn.Set("note", note)

		if s.Taken == 0 {
			// Their own opening word: pick one so the story can start.
			turn.Set("is_drawing", false)
			turn.Set("prompt", skipStartingWords[rand.Intn(len(skipStartingWords))])
		} else {
			prev, err := tx.FindRecordById("turns", s.PrevTurn)
			if err != nil {
				return err
			}
			turn.Set("is_drawing", prev.GetBool("is_drawing"))
			turn.Set("prompt", prev.GetString("prompt"))
			if name := prev.GetString("drawing"); name != "" {
				fsys, err := tx.NewFilesystem()
				if err != nil {
					return err
				}
				defer fsys.Close()
				file, err := fsys.GetReuploadableFile(prev.BaseFilesPath()+"/"+name, false)
				if err != nil {
					return err
				}
				turn.Set("drawing", file)
			}
		}

		if err := tx.Save(turn); err != nil {
			return err
		}
		tx.Logger().Info("host: turn skipped",
			"game_id", s.GameID, "story", storyID, "user_id", userID, "index", s.Taken, "reason", reason)
		return nil
	})
}

// skipPendingTurns skips every turn `userID` owes right now. For a dropped
// player, an own story that never got its opening word is deleted instead: no
// one else has touched it, and there's nothing worth passing on.
func skipPendingTurns(app core.App, gameID, userID string, dropped bool) (int, error) {
	stories, err := loadGameStories(app, gameID)
	if err != nil {
		return 0, err
	}
	n := 0
	for _, s := range stories {
		if s.NextUser != userID {
			continue
		}
		if dropped && s.Taken == 0 {
			story, err := app.FindRecordById("stories", s.StoryID)
			if err == nil {
				err = app.Delete(story)
			}
			if err != nil {
				return n, err
			}
			app.Logger().Info("host: empty story removed", "game_id", gameID, "story", s.StoryID, "user_id", userID)
			n++
			continue
		}
		reason := "host skip"
		if dropped {
			reason = "dropped"
		}
		if err := skipTurn(app, s.StoryID, userID, reason, false, ""); err != nil {
			return n, err
		}
		n++
	}
	return n, nil
}

// skipIfNextIsDropped keeps a story moving past dropped players. It runs after
// every turn; a skip it writes is itself a turn, so consecutive dropped players
// are skipped one after another.
func skipIfNextIsDropped(app core.App, storyID string) {
	s, err := loadStory(app, storyID)
	if err != nil || s.NextUser == "" {
		return
	}
	next, err := app.FindRecordById("users", s.NextUser)
	if err != nil || !next.GetBool("dropped") {
		return
	}
	if err := skipTurn(app, storyID, s.NextUser, "dropped", false, ""); err != nil {
		app.Logger().Error("host: auto-skip failed", "story", storyID, "user_id", s.NextUser, "error", err.Error())
	}
}

// playerStatus is one row of GET /api/games/{gameId}/players.
type playerStatus struct {
	ID       string `json:"id"`
	Username string `json:"username"`
	Avatar   string `json:"avatar"`
	Color    string `json:"color"`
	IsHost   bool   `json:"is_host"`
	Dropped  bool   `json:"dropped"`
	HasStory bool   `json:"has_story"`
	Turns    int    `json:"turns"`
	// Stories waiting on this player right now.
	Owes int `json:"owes"`
	// Nothing left for this player to do in the game.
	Finished bool `json:"finished"`
}

// gamePlayers reports where every player stands. A player is finished once
// every active player has a story and they've taken a turn on each story. Both
// halves matter: until the slowest player opens the game their story doesn't
// exist yet, and a fast player must not be sent to the review before it does.
func gamePlayers(app core.App, gameID string) ([]playerStatus, error) {
	users, err := app.FindRecordsByFilter("users", "game_id = {:g}", "position,id", 0, 0, dbx.Params{"g": gameID})
	if err != nil {
		return nil, err
	}
	stories, err := loadGameStories(app, gameID)
	if err != nil {
		return nil, err
	}

	var turnCounts []struct {
		UserID string `db:"user_id"`
		N      int    `db:"n"`
	}
	err = app.DB().NewQuery("SELECT user_id, COUNT(*) AS n FROM turns WHERE game_id = {:g} GROUP BY user_id").
		Bind(dbx.Params{"g": gameID}).All(&turnCounts)
	if err != nil {
		return nil, err
	}
	turns := map[string]int{}
	for _, t := range turnCounts {
		turns[t.UserID] = t.N
	}

	hasStory := map[string]bool{}
	owes := map[string]int{}
	for _, s := range stories {
		hasStory[s.Starter] = true
		if s.NextUser != "" {
			owes[s.NextUser]++
		}
	}
	allStarted := true
	for _, u := range users {
		if !u.GetBool("dropped") && !hasStory[u.Id] {
			allStarted = false
		}
	}

	out := make([]playerStatus, 0, len(users))
	for _, u := range users {
		p := playerStatus{
			ID:       u.Id,
			Username: u.GetString("username"),
			Avatar:   u.GetString("avatar"),
			Color:    u.GetString("color"),
			IsHost:   u.GetBool("is_host"),
			Dropped:  u.GetBool("dropped"),
			HasStory: hasStory[u.Id],
			Turns:    turns[u.Id],
			Owes:     owes[u.Id],
		}
		p.Finished = p.Dropped || (allStarted && p.Turns >= len(stories))
		out = append(out, p)
	}
	return out, nil
}

// requireHost checks that hostID is the host of the started game gameID and
// returns the game and the target player (which must be in the same game).
func requireHost(e *core.RequestEvent, gameID, hostID, userID string) (*core.Record, *core.Record, error) {
	game, err := e.App.FindRecordById("games", gameID)
	if err != nil {
		return nil, nil, e.NotFoundError("Game not found.", nil)
	}
	if !game.GetBool("isStarted") {
		return nil, nil, e.BadRequestError("The game hasn't started yet.", nil)
	}
	host, err := e.App.FindRecordById("users", hostID)
	if err != nil || host.GetString("game_id") != gameID || !host.GetBool("is_host") {
		return nil, nil, e.ForbiddenError("Only the host can do that.", nil)
	}
	user, err := e.App.FindRecordById("users", userID)
	if err != nil || user.GetString("game_id") != gameID {
		return nil, nil, e.NotFoundError("Player not found in this game.", nil)
	}
	return game, user, nil
}

func bindHostRoutes(app core.App, se *core.ServeEvent) {
	se.Router.GET("/api/games/{gameId}/players", func(e *core.RequestEvent) error {
		players, err := gamePlayers(e.App, e.Request.PathValue("gameId"))
		if err != nil {
			return err
		}
		return e.JSON(http.StatusOK, map[string]any{"players": players})
	})

	hostAction := func(drop bool) func(e *core.RequestEvent) error {
		return func(e *core.RequestEvent) error {
			body := struct {
				HostID string `json:"host_id"`
			}{}
			if err := e.BindBody(&body); err != nil {
				return e.BadRequestError("Invalid body.", err)
			}
			gameID, userID := e.Request.PathValue("gameId"), e.Request.PathValue("userId")
			_, user, err := requireHost(e, gameID, body.HostID, userID)
			if err != nil {
				return err
			}
			if drop {
				if user.GetBool("is_host") {
					return e.BadRequestError("The host can't be dropped.", nil)
				}
				user.Set("dropped", true)
				if err := e.App.Save(user); err != nil {
					return err
				}
			}
			n, err := skipPendingTurns(e.App, gameID, userID, drop)
			if err != nil {
				return err
			}
			e.App.Logger().Info("host: action", "game_id", gameID, "user", user.GetString("username"),
				"user_id", userID, "drop", drop, "turns_skipped", n)
			return e.JSON(http.StatusOK, map[string]any{"skipped": n})
		}
	}
	se.Router.POST("/api/games/{gameId}/players/{userId}/skip", hostAction(false))
	se.Router.POST("/api/games/{gameId}/players/{userId}/drop", hostAction(true))

	// A player's round timer ran out with nothing entered: skip their turn on
	// that story the same way the host would, marked as a timeout. (With partial
	// work the client submits it as a normal turn, flagged timed_out.)
	se.Router.POST("/api/stories/{storyId}/timeout", func(e *core.RequestEvent) error {
		body := struct {
			UserID string `json:"user_id"`
		}{}
		if err := e.BindBody(&body); err != nil {
			return e.BadRequestError("Invalid body.", err)
		}
		storyID := e.Request.PathValue("storyId")
		if u, err := e.App.FindRecordById("users", body.UserID); err == nil && u.GetBool("dropped") {
			return e.BadRequestError(msgPlayerRemoved, nil)
		}
		err := skipTurn(e.App, storyID, body.UserID, "timed out", true, "")
		if errors.Is(err, errNotTheirTurn) {
			return e.BadRequestError(notYourTurnMessage(e.App, storyID, body.UserID), nil)
		} else if err != nil {
			return err
		}
		return e.JSON(http.StatusOK, map[string]any{"ok": true})
	})
}

// notYourTurnMessage explains why userID can't write to storyID right now.
func notYourTurnMessage(app core.App, storyID, userID string) string {
	existing, err := app.FindFirstRecordByFilter("turns", "story_id = {:s} && user_id = {:u}",
		dbx.Params{"s": storyID, "u": userID})
	switch {
	case err == nil && existing.GetBool("skipped") && !existing.GetBool("timed_out"):
		return msgTurnSkipped
	case err == nil:
		return msgAlreadyTakenBy
	default:
		return msgNotYourTurn
	}
}

// wrongTurnType refuses a turn of the wrong kind: a story opens with a word, then
// words and drawings alternate. (Only server-written skips repeat a type, and
// they don't come through here.) Pages from an out-of-date build have written
// both mistakes, and a bad turn garbles every turn after it in the story.
func wrongTurnType(app core.App, s *storyState, turn *core.Record) string {
	isDrawing := turn.GetBool("is_drawing")
	if s.Taken == 0 {
		if isDrawing {
			return msgWantWord
		}
		return ""
	}
	prev, err := app.FindRecordById("turns", s.PrevTurn)
	if err != nil {
		return "" // can't tell; let it through rather than block the game
	}
	switch prevDrawing := prev.GetBool("is_drawing"); {
	case prevDrawing && isDrawing:
		return msgWantGuess
	case !prevDrawing && !isDrawing:
		return msgWantDrawing
	}
	return ""
}

// bindTurnGuards enforces the rotation on writes from clients. Server-side
// writes (skips) go through app.Save and don't pass through these.
func bindTurnGuards(app core.App) {
	// A client may only write the turn the rotation is waiting on, and only if
	// they're still in the game. Also the one place a late submit learns its
	// turn was skipped in the meantime.
	app.OnRecordCreateRequest("turns").BindFunc(func(e *core.RecordRequestEvent) error {
		e.Record.Set("skipped", false)
		storyID, userID := e.Record.GetString("story_id"), e.Record.GetString("user_id")

		if u, err := e.App.FindRecordById("users", userID); err == nil && u.GetBool("dropped") {
			return e.BadRequestError(msgPlayerRemoved, nil)
		}
		s, err := loadStory(e.App, storyID)
		if errors.Is(err, sql.ErrNoRows) {
			return e.Next() // unknown story: let relation validation report it
		} else if err != nil {
			return err
		}
		if s.NextUser != userID {
			return e.BadRequestError(notYourTurnMessage(e.App, storyID, userID), nil)
		}
		if msg := wrongTurnType(e.App, s, e.Record); msg != "" {
			e.App.Logger().Warn("turn: refused wrong type", "game_id", s.GameID, "story", storyID,
				"user_id", userID, "index", s.Taken, "is_drawing", e.Record.GetBool("is_drawing"))
			return e.BadRequestError(msg, nil)
		}
		return e.Next()
	})

	// A dropped player's client mustn't start a fresh story.
	app.OnRecordCreateRequest("stories").BindFunc(func(e *core.RecordRequestEvent) error {
		if u, err := e.App.FindRecordById("users", e.Record.GetString("starter_id")); err == nil && u.GetBool("dropped") {
			return e.BadRequestError(msgPlayerRemoved, nil)
		}
		return e.Next()
	})

	// Only the host endpoints change `dropped`.
	app.OnRecordUpdateRequest("users").BindFunc(func(e *core.RecordRequestEvent) error {
		e.Record.Set("dropped", e.Record.Original().GetBool("dropped"))
		return e.Next()
	})
}
