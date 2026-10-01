package main

import (
	"bytes"
	"context"
	"encoding/json"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestCleanStrokesClampsAndLimits(t *testing.T) {
	got, err := cleanStrokes([]stroke{
		{Color: "red", Width: 99, Points: []int{-5, 10, 700, 500, 3}}, // bad color, too wide, off canvas, odd length
		{Color: "#00ff00", Width: 4, Points: []int{1}},                // not drawable
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 {
		t.Fatalf("want 1 stroke, got %d", len(got))
	}
	s := got[0]
	if s.Color != "#1a1a1a" || s.Width != maxStrokeWidth {
		t.Errorf("color/width not cleaned: %+v", s)
	}
	if want := []int{0, 10, canvasW - 1, canvasH - 1}; !equalInts(s.Points, want) {
		t.Errorf("points = %v, want %v", s.Points, want)
	}
	if _, err := cleanStrokes(nil); err == nil {
		t.Error("an empty drawing should be rejected")
	}
}

func TestRenderStrokesPaintsTheStroke(t *testing.T) {
	data, err := renderStrokes([]stroke{{Color: "#ff0000", Width: 10, Points: []int{100, 100, 200, 100}}})
	if err != nil {
		t.Fatal(err)
	}
	img, err := png.Decode(bytes.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	if b := img.Bounds(); b.Dx() != canvasW || b.Dy() != canvasH {
		t.Fatalf("size %v", b)
	}
	r, g, _, _ := img.At(150, 100).RGBA()
	if r>>8 != 0xff || g>>8 != 0 {
		t.Errorf("stroke pixel = %v, want red", img.At(150, 100))
	}
	r, g, _, _ = img.At(150, 130).RGBA()
	if r>>8 != 0xff || g>>8 != 0xff {
		t.Errorf("background pixel = %v, want white", img.At(150, 130))
	}
}

// fakeClaude answers like the Messages API and records the request body.
func fakeClaude(t *testing.T, answer string, got *map[string]any) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		if err := json.Unmarshal(body, got); err != nil {
			t.Errorf("request isn't JSON: %v", err)
		}
		(*got)["_beta_header"] = r.Header.Get("anthropic-beta")
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"id": "msg_1", "type": "message", "role": "assistant", "model": "claude-opus-5-5",
			"content":     []map[string]any{{"type": "text", "text": answer}},
			"stop_reason": "end_turn",
			"usage":       map[string]any{"input_tokens": 120, "output_tokens": 40},
		})
	}))
}

func TestClaudeGuessRequestAndAnswer(t *testing.T) {
	var req map[string]any
	srv := fakeClaude(t, `{"guess":"a cat","note":"pointy ears, so: cat"}`, &req)
	defer srv.Close()
	p := newClaudeProvider(aiProviderConfig{APIKey: "test", BaseURL: srv.URL})

	move, err := p.Play(context.Background(), "claude-opus-5-5", botTurn{Kind: kindGuess, Persona: "a pirate", Drawing: []byte("png")})
	if err != nil {
		t.Fatal(err)
	}
	if move.Text != "a cat" || move.Note != "pointy ears, so: cat" || move.InputTokens != 120 {
		t.Errorf("move = %+v", move)
	}

	if req["model"] != "claude-opus-5-5" {
		t.Errorf("model = %v", req["model"])
	}
	oc, _ := req["output_config"].(map[string]any)
	if oc["effort"] != "low" {
		t.Errorf("effort = %v, want low for a guess", oc["effort"])
	}
	if f, _ := oc["format"].(map[string]any); f["type"] != "json_schema" {
		t.Errorf("format = %v", oc["format"])
	}
	if req["fallbacks"] != "default" || !strings.Contains(req["_beta_header"].(string), "server-side-fallback-2026-07-01") {
		t.Errorf("fallbacks = %v, beta = %v", req["fallbacks"], req["_beta_header"])
	}
	msgs, _ := req["messages"].([]any)
	first, _ := msgs[0].(map[string]any)
	blocks, _ := first["content"].([]any)
	if img, _ := blocks[0].(map[string]any); img["type"] != "image" {
		t.Errorf("first block = %v, want the drawing", blocks[0])
	}
	if sys, _ := json.Marshal(req["system"]); !strings.Contains(string(sys), "a pirate") {
		t.Errorf("persona missing from system prompt: %s", sys)
	}
}

func TestClaudeDrawAnswerAndHaikuSkipsEffort(t *testing.T) {
	var req map[string]any
	srv := fakeClaude(t, `{"strokes":[{"color":"#000000","width":4,"points":[1,2,3,4]}],"note":"a sun"}`, &req)
	defer srv.Close()
	p := newClaudeProvider(aiProviderConfig{APIKey: "test", BaseURL: srv.URL})

	move, err := p.Play(context.Background(), "claude-haiku-4-5", botTurn{Kind: kindDraw, Word: "sun", Style: "doodle"})
	if err != nil {
		t.Fatal(err)
	}
	if len(move.Strokes) != 1 || move.Note != "a sun" {
		t.Errorf("move = %+v", move)
	}
	oc, _ := req["output_config"].(map[string]any)
	if _, ok := oc["effort"]; ok {
		t.Errorf("Haiku 4.5 rejects effort, but it was sent: %v", oc)
	}
	if _, ok := req["fallbacks"]; ok {
		t.Errorf("fallbacks sent for a model without them")
	}
}

func equalInts(a, b []int) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
