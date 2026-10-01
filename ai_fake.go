package main

import (
	"context"
	"fmt"
	"sync/atomic"
)

// fakeProvider is a stand-in AI for tests (`"kind": "fake"` in ai.json): instant,
// free, and predictable. Words and guesses are numbered so tests can tell them
// apart; drawings are a small house.
type fakeProvider struct{}

var fakeMoves atomic.Int64

func (fakeProvider) Play(_ context.Context, model string, t botTurn) (botMove, error) {
	n := fakeMoves.Add(1)
	switch t.Kind {
	case kindWord:
		return botMove{Text: fmt.Sprintf("robot word %d", n), Note: "fake: picked a word"}, nil
	case kindGuess:
		return botMove{Text: fmt.Sprintf("robot guess %d", n), Note: "fake: squinted at it"}, nil
	default:
		return botMove{Note: "fake: drew a house for " + t.Word, Strokes: []stroke{
			{Color: "#1a1a1a", Width: 6, Points: []int{200, 300, 200, 180, 400, 180, 400, 300, 200, 300}},
			{Color: "#c0392b", Width: 6, Points: []int{180, 190, 300, 90, 420, 190}},
			{Color: "#2980b9", Width: 10, Points: []int{280, 300, 280, 240, 320, 240, 320, 300}},
		}}, nil
	}
}
