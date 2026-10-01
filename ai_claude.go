package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/anthropics/anthropic-sdk-go"
	"github.com/anthropics/anthropic-sdk-go/option"
	"github.com/anthropics/anthropic-sdk-go/shared/constant"
)

// Claude as an AI player, through the Anthropic Messages API. Each turn is one
// request with a structured-output schema, so the answer is always valid JSON
// in the shape we parse. Drawings come back as strokes (see ai_draw.go);
// guesses send the drawing as a PNG image.

// Offered when the config lists no models: the default first.
var defaultClaudeModels = []string{"claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-4-5"}

// Models that support server-side refusal fallbacks: a request their safety
// classifiers decline is retried on a suitable model instead of failing.
var claudeFallbackModels = map[string]bool{
	"claude-fable-5-1": true, "claude-opus-5-5": true, "claude-opus-5": true, "claude-sonnet-5-5": true,
}

// Models that reject the effort setting.
var claudeNoEffortModels = map[string]bool{"claude-haiku-4-5": true, "claude-sonnet-4-5": true}

type claudeProvider struct {
	client anthropic.Client
}

func newClaudeProvider(cfg aiProviderConfig) *claudeProvider {
	var opts []option.RequestOption
	if cfg.APIKey != "" {
		opts = append(opts, option.WithAPIKey(cfg.APIKey))
	} // else the SDK's usual chain: ANTHROPIC_API_KEY, `ant auth login` profile, ...
	if cfg.BaseURL != "" {
		opts = append(opts, option.WithBaseURL(cfg.BaseURL))
	}
	return &claudeProvider{client: anthropic.NewClient(opts...)}
}

func claudeSystemPrompt(persona string) string {
	var b strings.Builder
	b.WriteString(`You are a player in Telestrations, a drawing-and-guessing party game a family is playing on their phones. ` +
		`Each story passes from player to player: someone writes a word, the next player draws it, the next guesses ` +
		`what the drawing shows, the next draws that guess, and so on. The fun is in how the story drifts.

Keep everything family-friendly. Play honestly: never write letters, numbers or words inside a drawing.

Every answer includes a "note": one short, fun line about your thinking. Nobody sees it until the end of the game.`)
	if persona != "" {
		b.WriteString("\n\nThe host gave you this personality. Let it flavor your words, drawings and notes, " +
			"but still play the game properly:\n<personality>" + persona + "</personality>")
	}
	return b.String()
}

func objectSchema(props map[string]any) map[string]any {
	required := make([]string, 0, len(props))
	for k := range props {
		required = append(required, k)
	}
	return map[string]any{"type": "object", "additionalProperties": false, "required": required, "properties": props}
}

var noteSchema = map[string]any{"type": "string", "description": "One short, fun line about your thinking"}

func (c *claudeProvider) Play(ctx context.Context, model string, t botTurn) (botMove, error) {
	var (
		content []anthropic.BetaContentBlockParamUnion
		schema  map[string]any
		effort  = anthropic.BetaOutputConfigEffortLow // words and guesses: fast
	)
	switch t.Kind {
	case kindWord:
		content = append(content, anthropic.NewBetaTextBlock(
			"Start a new story: choose a word or short phrase (one to four words) for the next player to draw. "+
				"Pick something drawable that could get guessed wrong in a funny way."))
		schema = objectSchema(map[string]any{"word": map[string]any{"type": "string"}, "note": noteSchema})
	case kindDraw:
		content = append(content, anthropic.NewBetaTextBlock(fmt.Sprintf(
			"Draw this for the next player to guess: %q\n\n"+
				"The canvas is %d wide and %d tall, (0,0) at the top left, y growing downward, white background. "+
				"Make it %s. Each stroke is a polyline: a hex color, a brush width (2 to 20 pixels), and its points "+
				"as one flat list x1,y1,x2,y2,... Keep shapes big enough to make out on a phone, and remember: "+
				"no letters, numbers or words.", t.Word, canvasW, canvasH, stylePrompt(t.Style))))
		schema = objectSchema(map[string]any{"strokes": strokesSchema, "note": noteSchema})
		effort = anthropic.BetaOutputConfigEffortMedium // drawing needs a little planning
	case kindGuess:
		content = append(content,
			anthropic.NewBetaImageBlock(anthropic.BetaBase64ImageSourceParam{
				Data:      base64.StdEncoding.EncodeToString(t.Drawing),
				MediaType: anthropic.BetaBase64ImageSourceMediaTypeImagePNG,
			}),
			anthropic.NewBetaTextBlock("This is the previous player's drawing. What word or short phrase "+
				"(one to four words) were they drawing?"))
		schema = objectSchema(map[string]any{"guess": map[string]any{"type": "string"}, "note": noteSchema})
	default:
		return botMove{}, fmt.Errorf("unknown turn kind %q", t.Kind)
	}

	params := anthropic.BetaMessageNewParams{
		Model:     anthropic.Model(model),
		MaxTokens: 16000,
		System:    []anthropic.BetaTextBlockParam{{Text: claudeSystemPrompt(t.Persona)}},
		Messages:  []anthropic.BetaMessageParam{anthropic.NewBetaUserMessage(content...)},
		OutputConfig: anthropic.BetaOutputConfigParam{
			Format: anthropic.BetaJSONOutputFormatParam{Schema: schema},
		},
	}
	if !claudeNoEffortModels[model] {
		params.OutputConfig.Effort = effort
	}
	if claudeFallbackModels[model] {
		params.Betas = append(params.Betas, anthropic.AnthropicBetaServerSideFallback2026_07_01)
		params.Fallbacks = anthropic.BetaFallbacksParamUnion{OfDefault: constant.ValueOf[constant.Default]()}
	}

	resp, err := c.client.Beta.Messages.New(ctx, params)
	if err != nil {
		return botMove{}, err
	}
	switch resp.StopReason {
	case anthropic.BetaStopReasonRefusal:
		return botMove{}, errors.New("Claude declined this turn")
	case anthropic.BetaStopReasonMaxTokens:
		return botMove{}, errors.New("Claude's answer was cut off")
	}
	var text strings.Builder
	for _, block := range resp.Content {
		if b, ok := block.AsAny().(anthropic.BetaTextBlock); ok {
			text.WriteString(b.Text)
		}
	}
	var out struct {
		Word    string   `json:"word"`
		Guess   string   `json:"guess"`
		Strokes []stroke `json:"strokes"`
		Note    string   `json:"note"`
	}
	if err := json.Unmarshal([]byte(text.String()), &out); err != nil {
		return botMove{}, fmt.Errorf("unreadable answer: %w", err)
	}
	return botMove{
		Text:         out.Word + out.Guess,
		Strokes:      out.Strokes,
		Note:         out.Note,
		InputTokens:  resp.Usage.InputTokens,
		OutputTokens: resp.Usage.OutputTokens,
	}, nil
}
