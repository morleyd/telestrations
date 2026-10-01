package main

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/spf13/cobra"
)

// `telestrations-server ai-smoke` plays one round with a real AI before game
// night: an opening word, a drawing of it, and a guess of that drawing. It
// uses the same ai.json as the server, writes the drawing to a PNG, and prints
// the tokens each step used.
func aiSmokeCommand(app core.App) *cobra.Command {
	var providerID, model, persona, style, out string
	cmd := &cobra.Command{
		Use:   "ai-smoke",
		Short: "Play one word -> drawing -> guess round with a configured AI player",
		RunE: func(cmd *cobra.Command, _ []string) error {
			reg := loadAIConfig(app)
			if len(reg.order) == 0 {
				return fmt.Errorf("no AI providers configured; copy ai.example.json to ai.json")
			}
			if providerID == "" {
				providerID = reg.order[0]
			}
			cfg, provider, ok := reg.get(providerID)
			if !ok {
				return fmt.Errorf("no provider %q in ai.json", providerID)
			}
			if model == "" && len(cfg.Models) > 0 {
				model = cfg.Models[0]
			}
			fmt.Printf("%s / %s\n", cfg.Label, model)

			play := func(t botTurn) (botMove, error) {
				t.Persona, t.Style = persona, styleOrDefault(style)
				ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
				defer cancel()
				started := time.Now()
				m, err := provider.Play(ctx, model, t)
				if err == nil {
					err = validateMove(t.Kind, &m)
				}
				if err != nil {
					return m, fmt.Errorf("%s: %w", t.Kind, err)
				}
				fmt.Printf("  %-5s %5.1fs  in=%d out=%d tokens  note: %s\n",
					t.Kind, time.Since(started).Seconds(), m.InputTokens, m.OutputTokens, m.Note)
				return m, nil
			}

			word, err := play(botTurn{Kind: kindWord})
			if err != nil {
				return err
			}
			fmt.Printf("  word:  %q\n", word.Text)
			drawing, err := play(botTurn{Kind: kindDraw, Word: word.Text})
			if err != nil {
				return err
			}
			pngData, err := renderStrokes(drawing.Strokes)
			if err != nil {
				return err
			}
			if err := os.WriteFile(out, pngData, 0o644); err != nil {
				return err
			}
			fmt.Printf("  drew:  %d strokes -> %s\n", len(drawing.Strokes), out)
			guess, err := play(botTurn{Kind: kindGuess, Drawing: pngData})
			if err != nil {
				return err
			}
			fmt.Printf("  guess: %q\n", guess.Text)
			return nil
		},
	}
	cmd.Flags().StringVar(&providerID, "provider", "", "provider id from ai.json (default: the first)")
	cmd.Flags().StringVar(&model, "model", "", "model (default: the provider's first)")
	cmd.Flags().StringVar(&persona, "persona", "", "personality, e.g. \"a pirate who loves puns\"")
	cmd.Flags().StringVar(&style, "style", "doodle", "drawing style: doodle or sketch")
	cmd.Flags().StringVar(&out, "out", "ai-smoke.png", "where to write the drawing")
	return cmd
}
