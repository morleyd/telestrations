package main

import (
	"database/sql"
	"errors"
	"fmt"
	"math/rand"
	"net/http"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"
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
// are by sending their user id. That id isn't a secret (the roster is public,
// and so are the collections' API rules), so these checks keep honest clients
// on the rails; they don't stop a determined player on your network.

// Client-visible messages. Clients act on the refusal codes below, not on the
// wording, so these can be reworded freely.
const (
	msgTurnSkipped    = "Your turn on this story was skipped by the host."
	msgPlayerRemoved  = "You were removed from this game by the host."
	msgNotYourTurn    = "It isn't your turn on this story."
	msgGameStarted    = "This game has already started."
	msgAlreadyTakenBy = "You already took your turn on this story."

	// Wrong kind of turn. Only an out-of-date page does this, so say how to fix it.
	msgWantWord    = "This story needs a starting word, not a drawing. Please refresh the page."
	msgWantGuess   = "This turn needs a guess, not a drawing. Please refresh the page."
	msgWantDrawing = "This turn needs a drawing, not a guess. Please refresh the page."
)

// Refusal codes: a refused write carries one as data.code.code (see refuse), and
// TakeTurn.vue switches on it via services/pocketbase.
const (
	codeTurnSkipped   = "turn_skipped"   // the host skipped this turn meanwhile
	codePlayerRemoved = "player_removed" // the host dropped this player
	codeTurnTaken     = "turn_taken"     // this player already wrote this turn
	codeNotYourTurn   = "not_your_turn"  // the story is waiting on someone else
	codeWrongTurnType = "wrong_turn_type"
)

// refusalCode is a PocketBase safe error item, so it reaches the client intact
// as data.code = {code, message}.
type refusalCode string

func (c refusalCode) Code() string  { return string(c) }
func (c refusalCode) Error() string { return string(c) }

// refuse is a 400 with a message for people and a code for the client.
func refuse(code, msg string) error {
	return router.NewBadRequestError(msg, map[string]error{"code": refusalCode(code)})
}

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
// host skipping them. Returns errNotTheirTurn if that turn isn't theirs to
// take (anymore).
func skipTurn(app core.App, storyID, userID, reason string, timedOut bool) error {
	return app.RunInTransaction(func(tx core.App) error {
		s, err := loadStory(tx, storyID)
		if err != nil {
			return err
		}
		// A finished story waits on no one (NextUser ""), so "" never matches.
		if userID == "" || s.NextUser != userID {
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
//
// It works from one snapshot of the game, and carries on past any story it
// can't skip: a dropped player is already marked dropped, so a story left
// behind here would wait on them for good. A story that moved on since the
// snapshot (the player submitted, or a dropped player's auto-skip got there
// first) is simply done.
func skipPendingTurns(app core.App, gameID, userID string, dropped bool) (int, error) {
	stories, err := loadGameStories(app, gameID)
	if err != nil {
		return 0, err
	}
	return skipOwedTurns(app, stories, gameID, userID, dropped)
}

// skipOwedTurns is skipPendingTurns over a given snapshot of the game's
// stories, which may be stale by the time each one is skipped.
func skipOwedTurns(app core.App, stories []storyState, gameID, userID string, dropped bool) (int, error) {
	reason := "host skip"
	if dropped {
		reason = "dropped"
	}
	n := 0
	var errs []error
	for _, s := range stories {
		if s.NextUser != userID {
			continue
		}
		var err error
		if dropped && s.Taken == 0 {
			err = deleteEmptyStory(app, gameID, s.StoryID, userID)
		} else {
			err = skipTurn(app, s.StoryID, userID, reason, false)
		}
		switch {
		case errors.Is(err, errNotTheirTurn):
		case err != nil:
			errs = append(errs, fmt.Errorf("story %s: %w", s.StoryID, err))
		default:
			n++
		}
	}
	return n, errors.Join(errs...)
}

// deleteEmptyStory removes a dropped player's own story that never got its
// opening word. The turn guard already refuses a dropped player's word, so
// one can't land after the snapshot; the check here, inside the delete's own
// transaction, keeps it that way for any writer that skips the guard, since
// deleting a story with a word would leave the word as a turn with no story.
func deleteEmptyStory(app core.App, gameID, storyID, userID string) error {
	return app.RunInTransaction(func(tx core.App) error {
		s, err := loadStory(tx, storyID)
		if err != nil {
			return err
		}
		if s.Taken != 0 || s.NextUser != userID {
			return errNotTheirTurn
		}
		story, err := tx.FindRecordById("stories", storyID)
		if err != nil {
			return err
		}
		if err := tx.Delete(story); err != nil {
			return err
		}
		tx.Logger().Info("host: empty story removed", "game_id", gameID, "story", storyID, "user_id", userID)
		return nil
	})
}

// isDropped reports whether the host dropped userID from their game. An
// unknown user isn't dropped; relation validation reports those.
func isDropped(app core.App, userID string) bool {
	u, err := app.FindRecordById("users", userID)
	return err == nil && u.GetBool("dropped")
}

// skipIfNextIsDropped keeps a story moving past dropped players. It runs after
// every turn; a skip it writes is itself a turn, so consecutive dropped players
// are skipped one after another.
func skipIfNextIsDropped(app core.App, s *storyState) {
	if s.NextUser == "" || !isDropped(app, s.NextUser) {
		return
	}
	// errNotTheirTurn: someone (the host's own skip) got there first.
	if err := skipTurn(app, s.StoryID, s.NextUser, "dropped", false); err != nil && !errors.Is(err, errNotTheirTurn) {
		app.Logger().Error("host: auto-skip failed", "story", s.StoryID, "user_id", s.NextUser, "error", err.Error())
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
// returns the target player (which must be in the same game).
func requireHost(e *core.RequestEvent, gameID, hostID, userID string) (*core.Record, error) {
	game, err := e.App.FindRecordById("games", gameID)
	if err != nil {
		return nil, e.NotFoundError("Game not found.", nil)
	}
	if !game.GetBool("isStarted") {
		return nil, e.BadRequestError("The game hasn't started yet.", nil)
	}
	host, err := e.App.FindRecordById("users", hostID)
	if err != nil || host.GetString("game_id") != gameID || !host.GetBool("is_host") {
		return nil, e.ForbiddenError("Only the host can do that.", nil)
	}
	user, err := e.App.FindRecordById("users", userID)
	if err != nil || user.GetString("game_id") != gameID {
		return nil, e.NotFoundError("Player not found in this game.", nil)
	}
	return user, nil
}

func bindHostRoutes(se *core.ServeEvent) {
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
			user, err := requireHost(e, gameID, body.HostID, userID)
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
			// Skipping a dropped player again (the dialog offers it while stories
			// still wait on them) is a retry of the drop.
			n, err := skipPendingTurns(e.App, gameID, userID, user.GetBool("dropped"))
			if err != nil {
				return e.InternalServerError(
					fmt.Sprintf("Skipped %d, but some of their turns couldn't be skipped. Please try again.", n), err)
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
		story, err := e.App.FindRecordById("stories", storyID)
		if err != nil {
			return e.NotFoundError("Story not found.", nil)
		}
		// Untimed games show no timer (CountdownTimer needs duration >= 0), so
		// a timeout there can only be someone skipping another player's turn.
		if game, err := e.App.FindRecordById("games", story.GetString("game_id")); err != nil || game.GetInt("roundDuration") < 0 {
			return e.BadRequestError("This game has no round timer.", nil)
		}
		if isDropped(e.App, body.UserID) {
			return refuse(codePlayerRemoved, msgPlayerRemoved)
		}
		err = skipTurn(e.App, storyID, body.UserID, "timed out", true)
		if errors.Is(err, errNotTheirTurn) {
			return notYourTurn(e.App, storyID, body.UserID)
		} else if err != nil {
			return err
		}
		return e.JSON(http.StatusOK, map[string]any{"ok": true})
	})
}

// notYourTurn is the refusal for userID writing to storyID out of turn, saying
// why: the host skipped them, they already took it (from another tab, or a
// retry whose first response got lost), or it's simply someone else's turn.
func notYourTurn(app core.App, storyID, userID string) error {
	if userID == "" {
		return refuse(codeNotYourTurn, msgNotYourTurn)
	}
	existing, err := app.FindFirstRecordByFilter("turns", "story_id = {:s} && user_id = {:u}",
		dbx.Params{"s": storyID, "u": userID})
	switch {
	case err == nil && existing.GetBool("skipped") && !existing.GetBool("timed_out"):
		return refuse(codeTurnSkipped, msgTurnSkipped)
	case err == nil:
		return refuse(codeTurnTaken, msgAlreadyTakenBy)
	default:
		return refuse(codeNotYourTurn, msgNotYourTurn)
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

// inWriteTx runs a request guard's checks and the write they guard (e.Next())
// in one transaction on the single write connection. PocketBase checks a
// collection's API rules, and a guard does its reads, on a read connection
// before the write happens; without this, another write can land in between:
// a game starting under a join, or a drop under a turn.
func inWriteTx(guard func(e *core.RecordRequestEvent) error) func(e *core.RecordRequestEvent) error {
	return func(e *core.RecordRequestEvent) error {
		app := e.App
		err := app.RunInTransaction(func(tx core.App) error {
			e.App = tx
			return guard(e)
		})
		// The event belongs to the whole request, so hand back the app the
		// rest of it expects, not a finished transaction.
		e.App = app
		return err
	}
}

// gameStarted reports whether gameID has begun. An unknown game hasn't;
// relation validation reports that.
func gameStarted(app core.App, gameID string) bool {
	game, err := app.FindRecordById("games", gameID)
	return err == nil && game.GetBool("isStarted")
}

// bindTurnGuards enforces the rotation on writes from clients. Server-side
// writes (skips) go through app.Save and don't pass through these.
func bindTurnGuards(app core.App) {
	// A client may only write the turn the rotation is waiting on, and only if
	// they're still in the game. Also the one place a late submit learns its
	// turn was skipped in the meantime.
	app.OnRecordCreateRequest("turns").BindFunc(inWriteTx(func(e *core.RecordRequestEvent) error {
		e.Record.Set("skipped", false)
		storyID, userID := e.Record.GetString("story_id"), e.Record.GetString("user_id")

		if isDropped(e.App, userID) {
			return refuse(codePlayerRemoved, msgPlayerRemoved)
		}
		s, err := loadStory(e.App, storyID)
		if errors.Is(err, sql.ErrNoRows) {
			return e.Next() // unknown story: let relation validation report it
		} else if err != nil {
			return err
		}
		// A finished story waits on no one (NextUser ""), so "" never matches.
		if userID == "" || s.NextUser != userID {
			return notYourTurn(e.App, storyID, userID)
		}
		if msg := wrongTurnType(e.App, s, e.Record); msg != "" {
			e.App.Logger().Warn("turn: refused wrong type", "game_id", s.GameID, "story", storyID,
				"user_id", userID, "index", s.Taken, "is_drawing", e.Record.GetBool("is_drawing"))
			return refuse(codeWrongTurnType, msg)
		}
		// The story decides the game; gamePlayers counts turns by game_id.
		e.Record.Set("game_id", s.GameID)
		return e.Next()
	}))

	// A dropped player's client mustn't start a fresh story.
	app.OnRecordCreateRequest("stories").BindFunc(inWriteTx(func(e *core.RecordRequestEvent) error {
		if isDropped(e.App, e.Record.GetString("starter_id")) {
			return refuse(codePlayerRemoved, msgPlayerRemoved)
		}
		return e.Next()
	}))

	// The roster is fixed once a game starts (the seats are). The users API
	// rules say so too, but PocketBase checks those before the write, so a join
	// or a leave could still land just after /begin seated everyone; checking
	// again inside the write closes that gap.
	//
	// A game's host is the player who created it: a later join can't claim it
	// (requireHost trusts is_host), and nobody joins already dropped.
	app.OnRecordCreateRequest("users").BindFunc(inWriteTx(func(e *core.RecordRequestEvent) error {
		if gameStarted(e.App, e.Record.GetString("game_id")) {
			return e.BadRequestError(msgGameStarted, nil)
		}
		e.Record.Set("dropped", false)
		if e.Record.GetBool("is_host") {
			_, err := e.App.FindFirstRecordByFilter("users", "game_id = {:g} && is_host = true",
				dbx.Params{"g": e.Record.GetString("game_id")})
			if err == nil {
				e.Record.Set("is_host", false)
			}
		}
		return e.Next()
	}))
	app.OnRecordDeleteRequest("users").BindFunc(inWriteTx(func(e *core.RecordRequestEvent) error {
		if gameStarted(e.App, e.Record.GetString("game_id")) {
			return e.BadRequestError(msgGameStarted, nil)
		}
		return e.Next()
	}))

	// Clients may rename themselves and change their look. Everything else
	// about a player is the server's: `dropped` (the host endpoints), hosting
	// (game creation), the seat (/begin) and the game.
	app.OnRecordUpdateRequest("users").BindFunc(func(e *core.RecordRequestEvent) error {
		orig := e.Record.Original()
		for _, field := range []string{"dropped", "is_host", "position", "game_id"} {
			e.Record.Set(field, orig.Get(field))
		}
		return e.Next()
	})
}
