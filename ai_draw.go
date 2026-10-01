package main

import (
	"bytes"
	"errors"
	"image"
	"image/color"
	"image/png"
	"regexp"
	"strconv"
)

// AI drawings are strokes, not images: the model returns polylines on the same
// 600x400 grid as the human canvas, and the server paints them with a round
// brush. They come out looking like the humans' doodles, which keeps guessing
// fair (an image-generation model's art would give the word away).

const (
	canvasW = 600
	canvasH = 400

	maxStrokes      = 60
	maxStrokePoints = 200
	maxStrokeWidth  = 30
)

// drawingStyles are the per-bot drawing styles the host can pick. Each is a
// prompt for the same stroke format; the first is the default.
var drawingStyles = []struct {
	ID, Label, Prompt string
}{
	{"doodle", "Doodle", "a quick doodle, like a person with a mouse in under a minute: simple outlines, " +
		"1 to 3 colors, at most 15 strokes"},
	{"sketch", "Sketch", "a careful sketch with more detail: outlines, a few details and some color, " +
		"at most 40 strokes"},
}

func styleOrDefault(id string) string {
	for _, s := range drawingStyles {
		if s.ID == id {
			return id
		}
	}
	return drawingStyles[0].ID
}

func stylePrompt(id string) string {
	for _, s := range drawingStyles {
		if s.ID == id {
			return s.Prompt
		}
	}
	return drawingStyles[0].Prompt
}

// stroke is one polyline: Points is flat, x1,y1,x2,y2,... (structured outputs
// can't express tuples, and this is also the cheapest form in tokens).
type stroke struct {
	Color  string `json:"color"`
	Width  int    `json:"width"`
	Points []int  `json:"points"`
}

// strokesSchema is the JSON schema fragment for a list of strokes.
var strokesSchema = map[string]any{
	"type": "array",
	"items": map[string]any{
		"type":                 "object",
		"additionalProperties": false,
		"required":             []string{"color", "width", "points"},
		"properties": map[string]any{
			"color":  map[string]any{"type": "string", "description": "Hex color like #1a1a1a"},
			"width":  map[string]any{"type": "integer", "description": "Brush width in pixels, 2 to 20"},
			"points": map[string]any{"type": "array", "items": map[string]any{"type": "integer"}, "description": "Flat list x1,y1,x2,y2,... with 0<=x<600, 0<=y<400"},
		},
	},
}

var hexColorRE = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

// cleanStrokes clamps a model's strokes to the canvas and limits: the schema
// can't express numeric bounds, so out-of-range values are fixed here rather
// than rejected. Errors only if nothing drawable is left.
func cleanStrokes(in []stroke) ([]stroke, error) {
	out := make([]stroke, 0, len(in))
	for _, s := range in {
		if len(out) == maxStrokes {
			break
		}
		if !hexColorRE.MatchString(s.Color) {
			s.Color = "#1a1a1a"
		}
		s.Width = min(max(s.Width, 1), maxStrokeWidth)
		pts := s.Points
		if len(pts)%2 == 1 {
			pts = pts[:len(pts)-1]
		}
		if len(pts) > 2*maxStrokePoints {
			pts = pts[:2*maxStrokePoints]
		}
		clamped := make([]int, len(pts))
		for i, v := range pts {
			limit := canvasW - 1
			if i%2 == 1 {
				limit = canvasH - 1
			}
			clamped[i] = min(max(v, 0), limit)
		}
		if len(clamped) < 2 {
			continue
		}
		s.Points = clamped
		out = append(out, s)
	}
	if len(out) == 0 {
		return nil, errors.New("drawing has no strokes")
	}
	return out, nil
}

// renderStrokes paints strokes onto a white canvas and returns a PNG.
func renderStrokes(strokes []stroke) ([]byte, error) {
	img := image.NewRGBA(image.Rect(0, 0, canvasW, canvasH))
	for i := range img.Pix {
		img.Pix[i] = 0xff
	}
	for _, s := range strokes {
		c := parseHex(s.Color)
		r := max(s.Width/2, 1)
		if len(s.Points) == 2 {
			stamp(img, s.Points[0], s.Points[1], r, c)
			continue
		}
		for i := 0; i+3 < len(s.Points); i += 2 {
			line(img, s.Points[i], s.Points[i+1], s.Points[i+2], s.Points[i+3], r, c)
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// line stamps the brush along a segment, closely enough to look continuous.
func line(img *image.RGBA, x0, y0, x1, y1, r int, c color.RGBA) {
	dx, dy := float64(x1-x0), float64(y1-y0)
	steps := int(max(abs(dx), abs(dy))/max(float64(r)/2, 1)) + 1
	for i := 0; i <= steps; i++ {
		t := float64(i) / float64(steps)
		stamp(img, x0+int(dx*t+0.5), y0+int(dy*t+0.5), r, c)
	}
}

// stamp paints a filled disc: a round brush, so lines get round caps and joins
// like the human canvas.
func stamp(img *image.RGBA, cx, cy, r int, c color.RGBA) {
	for y := cy - r; y <= cy+r; y++ {
		for x := cx - r; x <= cx+r; x++ {
			if (x-cx)*(x-cx)+(y-cy)*(y-cy) <= r*r && image.Pt(x, y).In(img.Rect) {
				img.SetRGBA(x, y, c)
			}
		}
	}
}

func parseHex(s string) color.RGBA {
	if !hexColorRE.MatchString(s) {
		return color.RGBA{0x1a, 0x1a, 0x1a, 0xff}
	}
	v, _ := strconv.ParseUint(s[1:], 16, 32)
	return color.RGBA{uint8(v >> 16), uint8(v >> 8), uint8(v), 0xff}
}

func abs(f float64) float64 {
	if f < 0 {
		return -f
	}
	return f
}
