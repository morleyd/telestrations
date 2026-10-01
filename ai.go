package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/filesystem"
)

// AI players.
//
// A bot is an ordinary seat in `users` (is_bot) whose turns the server writes:
// whenever a story is waiting on a bot, the driver asks that bot's AI provider
// for a move and saves it as the bot's turn, the same way host skips are
// written (see host.go). Seating, rotation, skips, drops, and the review all
// work unchanged.
//
// Which providers and models are on offer is configured when the server starts,
// in ai.json (path override: TELESTRATIONS_AI_CONFIG); see ai.example.json. No
// file means no AI players. Keys live only in that file or the environment and
// never reach a browser.

// botTurn is what a bot is asked to do.
type botTurn struct {
	Kind    turnKind
	Persona string // the host's prompt addition, e.g. "a pirate who loves puns"
	Style   string // drawing style id (see drawingStyles)
	Word    string // kindDraw: what to draw
	Drawing []byte // kindGuess: PNG of the drawing to guess
}

type turnKind string

const (
	kindWord  turnKind = "word"  // the story's opening word
	kindDraw  turnKind = "draw"  // draw the previous word
	kindGuess turnKind = "guess" // guess the previous drawing
)

// botMove is a bot's answer.
type botMove struct {
	Text    string   // kindWord / kindGuess
	Strokes []stroke // kindDraw
	Note    string   // a one-line "thought", shown on the review page only

	InputTokens, OutputTokens int64 // for the logs: what the move cost
}

// aiProvider plays turns with one AI service. Adding ChatGPT, Gemini, Grok, ...
// means implementing this and adding a `kind` to newAIProvider.
type aiProvider interface {
	Play(ctx context.Context, model string, t botTurn) (botMove, error)
}

type aiProviderConfig struct {
	ID     string `json:"id"`      // referenced by bots; e.g. "claude"
	Kind   string `json:"kind"`    // "anthropic" | "fake"
	Label  string `json:"label"`   // shown to the host and used in bot names
	APIKey string `json:"api_key"` // optional; else the provider's usual env/credential chain
	// optional; e.g. a proxy. Mostly for tests.
	BaseURL string   `json:"base_url"`
	Models  []string `json:"models"` // offered to the host; the first is the default
}

type aiConfig struct {
	Providers []aiProviderConfig `json:"providers"`
}

type aiRegistry struct {
	order     []string
	providers map[string]aiProviderConfig
	impls     map[string]aiProvider
}

func (r *aiRegistry) get(id string) (aiProviderConfig, aiProvider, bool) {
	cfg, ok := r.providers[id]
	return cfg, r.impls[id], ok
}

func newAIProvider(cfg aiProviderConfig) (aiProvider, error) {
	switch cfg.Kind {
	case "anthropic":
		return newClaudeProvider(cfg), nil
	case "fake":
		return fakeProvider{}, nil
	default:
		return nil, fmt.Errorf("unknown kind %q", cfg.Kind)
	}
}

func loadAIConfig(app core.App) *aiRegistry {
	reg := &aiRegistry{providers: map[string]aiProviderConfig{}, impls: map[string]aiProvider{}}
	path := os.Getenv("TELESTRATIONS_AI_CONFIG")
	if path == "" {
		path = "ai.json"
	}
	raw, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		app.Logger().Info("ai: no config, AI players disabled", "path", path)
		return reg
	} else if err != nil {
		app.Logger().Error("ai: can't read config", "path", path, "error", err.Error())
		return reg
	}
	var cfg aiConfig
	if err := json.Unmarshal(raw, &cfg); err != nil {
		app.Logger().Error("ai: bad config", "path", path, "error", err.Error())
		return reg
	}
	for _, p := range cfg.Providers {
		if p.ID == "" {
			p.ID = p.Kind
		}
		if p.Label == "" {
			p.Label = p.ID
		}
		if len(p.Models) == 0 && p.Kind == "anthropic" {
			p.Models = defaultClaudeModels
		}
		impl, err := newAIProvider(p)
		if err != nil {
			app.Logger().Error("ai: skipping provider", "id", p.ID, "error", err.Error())
			continue
		}
		reg.order = append(reg.order, p.ID)
		reg.providers[p.ID] = p
		reg.impls[p.ID] = impl
	}
	app.Logger().Info("ai: providers ready", "providers", reg.order)
	return reg
}

// botDriver takes bots' turns in the background.
type botDriver struct {
	app      core.App
	ai       *aiRegistry
	mu       sync.Mutex
	inflight map[string]bool // story ids with a bot move in progress
	sem      chan struct{}   // caps concurrent AI calls
}

func newBotDriver(app core.App, ai *aiRegistry) *botDriver {
	return &botDriver{app: app, ai: ai, inflight: map[string]bool{}, sem: make(chan struct{}, 4)}
}

const botWaitingStories = `SELECT p.story_id FROM progress p
JOIN users u ON u.id = p.next_user_id
WHERE u.is_bot = TRUE AND u.dropped = FALSE`

// kickGame starts a move for every story in the game that's waiting on a bot.
// Called after every turn and when a game begins; cheap when there's nothing
// to do.
func (d *botDriver) kickGame(gameID string) {
	d.kick(botWaitingStories+" AND p.game_id = {:g}", dbx.Params{"g": gameID})
}

// kickAll resumes bots in every game, e.g. after a server restart.
func (d *botDriver) kickAll() {
	d.kick(botWaitingStories, nil)
}

func (d *botDriver) kick(query string, params dbx.Params) {
	var rows []struct {
		StoryID string `db:"story_id"`
	}
	if err := d.app.DB().NewQuery(query).Bind(params).All(&rows); err != nil {
		d.app.Logger().Error("ai: can't list bot turns", "error", err.Error())
		return
	}
	for _, r := range rows {
		d.mu.Lock()
		busy := d.inflight[r.StoryID]
		d.inflight[r.StoryID] = true
		d.mu.Unlock()
		if !busy {
			go d.move(r.StoryID)
		}
	}
}

// move takes the bot's turn on one story.
func (d *botDriver) move(storyID string) {
	defer func() {
		d.mu.Lock()
		delete(d.inflight, storyID)
		d.mu.Unlock()
	}()
	d.sem <- struct{}{}
	defer func() { <-d.sem }()

	app := d.app
	s, err := loadStory(app, storyID)
	if err != nil || s.NextUser == "" {
		return
	}
	bot, err := app.FindRecordById("users", s.NextUser)
	if err != nil || !bot.GetBool("is_bot") || bot.GetBool("dropped") {
		return
	}
	logger := app.Logger().With("source", "ai", "game_id", s.GameID, "story", storyID,
		"bot", bot.GetString("username"), "provider", bot.GetString("bot_provider"), "model", bot.GetString("bot_model"))

	_, provider, ok := d.ai.get(bot.GetString("bot_provider"))
	if !ok {
		d.giveUp(s, bot, fmt.Errorf("AI provider %q isn't set up on this server", bot.GetString("bot_provider")), logger)
		return
	}
	turn, err := buildBotTurn(app, s, bot)
	if err != nil {
		d.giveUp(s, bot, err, logger)
		return
	}

	started := time.Now()
	var move botMove
	for attempt := 1; attempt <= 2; attempt++ {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
		move, err = provider.Play(ctx, bot.GetString("bot_model"), turn)
		cancel()
		if err == nil {
			err = validateMove(turn.Kind, &move)
		}
		if err == nil {
			break
		}
		logger.Warn("ai: move failed", "kind", turn.Kind, "attempt", attempt, "error", err.Error())
	}
	if err != nil {
		d.giveUp(s, bot, err, logger)
		return
	}
	if err := writeBotTurn(app, s, bot, turn.Kind, move); err != nil {
		if !errors.Is(err, errNotTheirTurn) { // skipped or dropped meanwhile: fine
			logger.Error("ai: can't save move", "error", err.Error())
		}
		return
	}
	logger.Info("ai: move", "kind", turn.Kind, "ms", time.Since(started).Milliseconds(),
		"text", move.Text, "strokes", len(move.Strokes), "note", move.Note,
		"input_tokens", move.InputTokens, "output_tokens", move.OutputTokens)
}

// giveUp skips the bot's turn so the game doesn't stall; the note tells the
// review what happened.
func (d *botDriver) giveUp(s *storyState, bot *core.Record, cause error, logger interface {
	Error(msg string, args ...any)
}) {
	logger.Error("ai: giving up on turn, skipping it", "error", cause.Error())
	note := "🤖 couldn't take this turn: " + truncate(cause.Error(), 120)
	if err := skipTurn(d.app, s.StoryID, bot.Id, "bot error", false, note); err != nil && !errors.Is(err, errNotTheirTurn) {
		logger.Error("ai: skip failed", "error", err.Error())
	}
}

// buildBotTurn works out what the bot has to do on this story.
func buildBotTurn(app core.App, s *storyState, bot *core.Record) (botTurn, error) {
	t := botTurn{Persona: bot.GetString("bot_persona"), Style: styleOrDefault(bot.GetString("bot_style"))}
	if s.Taken == 0 {
		t.Kind = kindWord
		return t, nil
	}
	prev, err := app.FindRecordById("turns", s.PrevTurn)
	if err != nil {
		return t, err
	}
	if !prev.GetBool("is_drawing") {
		t.Kind = kindDraw
		t.Word = prev.GetString("prompt")
		return t, nil
	}
	t.Kind = kindGuess
	fsys, err := app.NewFilesystem()
	if err != nil {
		return t, err
	}
	defer fsys.Close()
	r, err := fsys.GetReader(prev.BaseFilesPath() + "/" + prev.GetString("drawing"))
	if err != nil {
		return t, err
	}
	defer r.Close()
	t.Drawing, err = io.ReadAll(r)
	return t, err
}

// validateMove cleans up a provider's answer, or rejects it.
func validateMove(kind turnKind, m *botMove) error {
	m.Note = truncate(strings.TrimSpace(m.Note), 200)
	if kind == kindDraw {
		strokes, err := cleanStrokes(m.Strokes)
		m.Strokes = strokes
		return err
	}
	m.Text = truncate(strings.TrimSpace(m.Text), 60)
	if m.Text == "" {
		return errors.New("empty answer")
	}
	return nil
}

// writeBotTurn saves the move as the bot's turn, unless it isn't the bot's turn
// anymore (the host skipped or dropped it meanwhile).
func writeBotTurn(app core.App, s *storyState, bot *core.Record, kind turnKind, m botMove) error {
	var drawing *filesystem.File
	if kind == kindDraw {
		pngData, err := renderStrokes(m.Strokes)
		if err != nil {
			return err
		}
		if drawing, err = filesystem.NewFileFromBytes(pngData, "drawing.png"); err != nil {
			return err
		}
	}
	return app.RunInTransaction(func(tx core.App) error {
		now, err := loadStory(tx, s.StoryID)
		if err != nil {
			return err
		}
		if now.NextUser != bot.Id {
			return errNotTheirTurn
		}
		col, err := tx.FindCollectionByNameOrId("turns")
		if err != nil {
			return err
		}
		turn := core.NewRecord(col)
		turn.Set("story_id", s.StoryID)
		turn.Set("user_id", bot.Id)
		turn.Set("game_id", s.GameID)
		turn.Set("is_drawing", kind == kindDraw)
		turn.Set("note", m.Note)
		if drawing != nil {
			turn.Set("drawing", drawing)
		} else {
			turn.Set("prompt", m.Text)
		}
		return tx.Save(turn)
	})
}

// startGame gives every bot its own story when a game begins (humans' pages
// create theirs), then sets the bots to work on their opening words.
func (d *botDriver) startGame(gameID string) {
	bots, err := d.app.FindRecordsByFilter("users", "game_id = {:g} && is_bot = true", "", 0, 0, dbx.Params{"g": gameID})
	if err != nil {
		d.app.Logger().Error("ai: can't list bots", "game_id", gameID, "error", err.Error())
		return
	}
	stories, err := d.app.FindCollectionByNameOrId("stories")
	if err != nil {
		return
	}
	for _, bot := range bots {
		if _, err := d.app.FindFirstRecordByFilter("stories", "starter_id = {:u} && game_id = {:g}",
			dbx.Params{"u": bot.Id, "g": gameID}); err == nil {
			continue
		}
		story := core.NewRecord(stories)
		story.Set("starter_id", bot.Id)
		story.Set("game_id", gameID)
		if err := d.app.Save(story); err != nil {
			d.app.Logger().Error("ai: can't create bot story", "bot", bot.GetString("username"), "error", err.Error())
		}
	}
	d.kickGame(gameID)
}

const botAvatar = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36"><text x="18" y="26" ` +
	`text-anchor="middle" font-size="24">🤖</text></svg>`

func bindAIRoutes(se *core.ServeEvent, bots *botDriver) {
	// What the host can choose from when adding AI players. No keys here.
	se.Router.GET("/api/ai/options", func(e *core.RequestEvent) error {
		type option struct {
			ID     string   `json:"id"`
			Label  string   `json:"label"`
			Models []string `json:"models"`
		}
		providers := []option{}
		for _, id := range bots.ai.order {
			p := bots.ai.providers[id]
			providers = append(providers, option{ID: p.ID, Label: p.Label, Models: p.Models})
		}
		type style struct {
			ID    string `json:"id"`
			Label string `json:"label"`
		}
		styles := []style{}
		for _, s := range drawingStyles {
			styles = append(styles, style{s.ID, s.Label})
		}
		return e.JSON(http.StatusOK, map[string]any{"providers": providers, "styles": styles})
	})

	// The host adds AI players to a game that hasn't started yet.
	se.Router.POST("/api/games/{gameId}/bots", func(e *core.RequestEvent) error {
		body := struct {
			HostID   string `json:"host_id"`
			Provider string `json:"provider"`
			Model    string `json:"model"`
			Persona  string `json:"persona"`
			Style    string `json:"style"`
			Count    int    `json:"count"`
		}{}
		if err := e.BindBody(&body); err != nil {
			return e.BadRequestError("Invalid body.", err)
		}
		gameID := e.Request.PathValue("gameId")
		game, err := e.App.FindRecordById("games", gameID)
		if err != nil {
			return e.NotFoundError("Game not found.", nil)
		}
		if game.GetBool("isStarted") {
			return e.BadRequestError("The game has already started.", nil)
		}
		host, err := e.App.FindRecordById("users", body.HostID)
		if err != nil || host.GetString("game_id") != gameID || !host.GetBool("is_host") {
			return e.ForbiddenError("Only the host can add AI players.", nil)
		}
		cfg, _, ok := bots.ai.get(body.Provider)
		if !ok {
			return e.BadRequestError("That AI isn't set up on this server.", nil)
		}
		if body.Model == "" && len(cfg.Models) > 0 {
			body.Model = cfg.Models[0]
		}
		if len(cfg.Models) > 0 && !contains(cfg.Models, body.Model) {
			return e.BadRequestError("That model isn't offered on this server.", nil)
		}
		if body.Count < 1 || body.Count > 8 {
			return e.BadRequestError("Add between 1 and 8 AI players at a time.", nil)
		}
		persona := strings.TrimSpace(body.Persona)
		if utf8.RuneCountInString(persona) > 200 {
			return e.BadRequestError("Keep the personality under 200 characters.", nil)
		}

		users, err := e.App.FindCollectionByNameOrId("users")
		if err != nil {
			return err
		}
		added := []string{}
		for i := 0; i < body.Count; i++ {
			name, err := uniqueBotName(e.App, gameID, cfg.Label)
			if err != nil {
				return err
			}
			bot := core.NewRecord(users)
			bot.Set("username", name)
			bot.Set("game_id", gameID)
			bot.Set("is_bot", true)
			bot.Set("bot_provider", cfg.ID)
			bot.Set("bot_model", body.Model)
			bot.Set("bot_persona", persona)
			bot.Set("bot_style", styleOrDefault(body.Style))
			bot.Set("avatar", botAvatar)
			bot.Set("color", fmt.Sprintf("hsl(%d, 60%%, 75%%)", rand.Intn(360)))
			if err := e.App.Save(bot); err != nil {
				return err
			}
			added = append(added, name)
		}
		e.App.Logger().Info("ai: bots added", "game_id", gameID, "bots", added, "model", body.Model, "persona", persona)
		return e.JSON(http.StatusOK, map[string]any{"added": added})
	})
}

func uniqueBotName(app core.App, gameID, label string) (string, error) {
	base := "🤖 " + label
	for n := 1; n < 100; n++ {
		name := base
		if n > 1 {
			name = fmt.Sprintf("%s %d", base, n)
		}
		_, err := app.FindFirstRecordByFilter("users", "game_id = {:g} && username = {:n}", dbx.Params{"g": gameID, "n": name})
		if err != nil {
			return name, nil
		}
	}
	return "", errors.New("too many AI players")
}

func contains(list []string, s string) bool {
	for _, v := range list {
		if v == s {
			return true
		}
	}
	return false
}

func truncate(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	return string([]rune(s)[:n-1]) + "…"
}
