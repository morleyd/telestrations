package game

import (
	"context"
	"errors"
	"fmt"
	"hash/fnv"
	"math/rand/v2"
	"net/http"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/filesystem"
)

// Bots: players the server plays, so one visitor can play a whole game. The
// host adds them in the waiting room (POST /api/games/{gameId}/bots); they're
// seated like anyone else, and RunBots plays their turns: an opening word,
// doodles (doodles.go) and guesses, each after a pause a person might take.
//
// Bots only play while a person in the game has been around lately
// (botsWaitFor): a game everyone has left goes quiet, and expires like any
// other (expiry.go).

const (
	maxBots     = 5
	botTick     = time.Second
	botsWaitFor = 10 * time.Minute
)

var bots = []struct{ name, avatar, color string }{
	{"Botticelli", "grin", "hsl(28, 85%, 62%)"},
	{"Pablo Pixel", "goofy", "hsl(205, 80%, 62%)"},
	{"Frida Circuit", "snarky", "hsl(330, 75%, 70%)"},
	{"Vincent van Bot", "happy", "hsl(52, 90%, 58%)"},
	{"Doodlebot", "glee", "hsl(140, 60%, 55%)"},
}

const codeTooManyBots = "too_many_bots"

func bindBotRoutes(se *core.ServeEvent) {
	// POST /api/games/{gameId}/bots {host_id, count}: the host adds count
	// bots (3 if unsaid) to their game before it starts.
	se.Router.POST("/api/games/{gameId}/bots", func(e *core.RequestEvent) error {
		body := struct {
			HostID string `json:"host_id"`
			Count  int    `json:"count"`
		}{}
		if err := e.BindBody(&body); err != nil {
			return e.BadRequestError("Invalid body.", err)
		}
		gameID := e.Request.PathValue("gameId")
		game, err := requireGameCode(e, gameID)
		if err != nil {
			return err
		}
		host, err := e.App.FindRecordById("users", body.HostID)
		if err != nil || host.GetString("game_id") != gameID || !host.GetBool("is_host") {
			return e.ForbiddenError("Only the host can do that.", nil)
		}
		if game.GetBool("isStarted") {
			return e.BadRequestError(msgGameStarted, nil)
		}
		count := body.Count
		if count == 0 {
			count = 3
		}
		var added int
		err = e.App.RunInTransaction(func(tx core.App) error {
			n, err := addBots(tx, gameID, count)
			added = n
			return err
		})
		if err != nil {
			return err
		}
		return e.JSON(http.StatusOK, map[string]any{"added": added})
	})
}

// addBots seats count more bots in gameID, up to maxBots in all, and reports
// how many it added.
func addBots(app core.App, gameID string, count int) (int, error) {
	existing, err := app.FindRecordsByFilter("users", "game_id = {:g}", "", 0, 0, dbx.Params{"g": gameID})
	if err != nil {
		return 0, err
	}
	taken, botsIn := map[string]bool{}, 0
	for _, u := range existing {
		taken[u.GetString("username")] = true
		if u.GetBool("is_bot") {
			botsIn++
		}
	}
	if count < 1 || botsIn+count > maxBots {
		return 0, refuse(codeTooManyBots, fmt.Sprintf("A game can have at most %d bots.", maxBots))
	}
	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		return 0, err
	}
	added := 0
	for _, b := range bots {
		if added == count {
			break
		}
		if taken[b.name] {
			continue
		}
		bot := core.NewRecord(users)
		bot.Set("username", b.name)
		bot.Set("avatar", b.avatar)
		bot.Set("color", b.color)
		bot.Set("game_id", gameID)
		bot.Set("is_bot", true)
		if err := app.Save(bot); err != nil {
			return added, err
		}
		added++
	}
	return added, nil
}

// RunBots plays every game's bots, once a second, until the app stops. Call
// it from OnServe.
func RunBots(app core.App) {
	ctx, cancel := context.WithCancel(context.Background())
	app.OnTerminate().BindFunc(func(e *core.TerminateEvent) error {
		cancel()
		return e.Next()
	})
	go func() {
		tick := time.NewTicker(botTick)
		defer tick.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case now := <-tick.C:
				if err := playBots(app, now); err != nil {
					app.Logger().Error("bots: failed", "error", err.Error())
				}
			}
		}
	}()
}

// playBots does what every bot due to move at now does: opens its story,
// writes the turns it's held long enough, and shows it's here.
func playBots(app core.App, now time.Time) error {
	var games []string
	err := app.DB().NewQuery(`SELECT DISTINCT users.game_id FROM users
		JOIN games ON games.id = users.game_id
		WHERE users.is_bot = 1 AND games.isStarted = 1 AND NOT ` + gameOverSQL).Column(&games)
	if err != nil {
		return err
	}
	var errs []error
	for _, gameID := range games {
		if err := playGameBots(app, gameID, now); err != nil {
			errs = append(errs, fmt.Errorf("game %s: %w", gameID, err))
		}
	}
	return errors.Join(errs...)
}

func playGameBots(app core.App, gameID string, now time.Time) error {
	around, err := personAround(app, gameID, now)
	if err != nil || !around {
		return err
	}
	botIDs := map[string]bool{}
	var ids []string
	err = app.DB().NewQuery("SELECT id FROM users WHERE game_id = {:g} AND is_bot = 1 AND dropped = 0").
		Bind(dbx.Params{"g": gameID}).Column(&ids)
	if err != nil {
		return err
	}
	for _, id := range ids {
		botIDs[id] = true
	}
	// Here, as far as the waiting screen can tell.
	_, err = app.DB().NewQuery(`UPDATE users SET seen_at = {:t}, working_on = ''
		WHERE game_id = {:g} AND is_bot = 1`).
		Bind(dbx.Params{"t": now.UTC().Format("2006-01-02 15:04:05.000Z"), "g": gameID}).Execute()
	if err != nil {
		return err
	}

	stories, err := loadGameStories(app, gameID)
	if err != nil {
		return err
	}
	hasStory := map[string]bool{}
	for _, s := range stories {
		hasStory[s.Starter] = true
	}
	var errs []error
	for id := range botIDs {
		if !hasStory[id] {
			errs = append(errs, openBotStory(app, gameID, id))
		}
	}
	for _, s := range stories {
		if !botIDs[s.NextUser] {
			continue
		}
		since, err := heldSince(app, s)
		if err != nil {
			errs = append(errs, err)
			continue
		}
		if now.Sub(since) >= botPause(s.StoryID, s.Taken) {
			errs = append(errs, botTurn(app, s.StoryID, s.NextUser))
		}
	}
	return errors.Join(errs...)
}

// personAround reports whether anyone who isn't a bot has been in gameID
// lately: their device checked in, they joined, or the game changed.
func personAround(app core.App, gameID string, now time.Time) (bool, error) {
	var last string
	err := app.DB().NewQuery(`SELECT COALESCE(MAX(t), '') FROM (
		SELECT updated AS t FROM games WHERE id = {:g}
		UNION ALL SELECT MAX(seen_at) FROM users WHERE game_id = {:g} AND is_bot = 0
		UNION ALL SELECT MAX(created) FROM users WHERE game_id = {:g} AND is_bot = 0
	) WHERE t IS NOT NULL AND t != ''`).Bind(dbx.Params{"g": gameID}).Row(&last)
	if err != nil || last == "" {
		return false, err
	}
	at, err := parseTime(last)
	return err == nil && now.Sub(at) < botsWaitFor, err
}

// heldSince is when story s came to the player it's waiting on: its last
// turn, or its start.
func heldSince(app core.App, s storyState) (time.Time, error) {
	if s.Taken > 0 {
		prev, err := app.FindRecordById("turns", s.PrevTurn)
		if err != nil {
			return time.Time{}, err
		}
		return prev.GetDateTime("created").Time(), nil
	}
	story, err := app.FindRecordById("stories", s.StoryID)
	if err != nil {
		return time.Time{}, err
	}
	return story.GetDateTime("created").Time(), nil
}

// botPause is how long a bot takes over a turn: 3 to 7 seconds, the same for
// the same turn every time it's asked.
func botPause(storyID string, index int) time.Duration {
	h := fnv.New32a()
	fmt.Fprintf(h, "%s:%d", storyID, index)
	return 3*time.Second + time.Duration(h.Sum32()%4000)*time.Millisecond
}

func openBotStory(app core.App, gameID, botID string) error {
	stories, err := app.FindCollectionByNameOrId("stories")
	if err != nil {
		return err
	}
	story := core.NewRecord(stories)
	story.Set("starter_id", botID)
	story.Set("game_id", gameID)
	return app.Save(story)
}

// botTurn writes botID's turn on storyID, if it's still theirs: an opening
// word, a doodle of the word before, or a guess at the doodle before.
func botTurn(app core.App, storyID, botID string) error {
	return app.RunInTransaction(func(tx core.App) error {
		s, err := loadStory(tx, storyID)
		if err != nil {
			return err
		}
		if s.GameOver || s.NextUser != botID {
			return nil // someone (a host's skip) got there first
		}
		col, err := tx.FindCollectionByNameOrId("turns")
		if err != nil {
			return err
		}
		rng := rand.New(rand.NewPCG(rand.Uint64(), rand.Uint64()))
		turn := core.NewRecord(col)
		turn.Set("story_id", storyID)
		turn.Set("user_id", botID)
		turn.Set("game_id", s.GameID)
		switch {
		case s.Taken == 0:
			turn.Set("prompt", doodles[rng.IntN(len(doodles))].guesses[0])
		default:
			prev, err := tx.FindRecordById("turns", s.PrevTurn)
			if err != nil {
				return err
			}
			if prev.GetBool("is_drawing") {
				turn.Set("prompt", botGuess(prev.GetString("drawing"), rng))
				break
			}
			d := doodleFor(prev.GetString("prompt"), rng)
			pic, err := drawDoodle(d, rng)
			if err != nil {
				return err
			}
			file, err := filesystem.NewFileFromBytes(pic, "bot_"+d.name+".png")
			if err != nil {
				return err
			}
			turn.Set("is_drawing", true)
			turn.Set("drawing", file)
		}
		return tx.Save(turn)
	})
}

// botGuess is a bot's guess at the drawing in file: one of a doodle's
// guesses if a bot drew it, a wild one if a person did.
func botGuess(file string, rng *rand.Rand) string {
	if d, ok := doodleNamed(file); ok {
		return d.guesses[rng.IntN(len(d.guesses))]
	}
	return wildGuesses[rng.IntN(len(wildGuesses))]
}
