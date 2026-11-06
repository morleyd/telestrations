package game

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"math"
	"math/rand/v2"
	"slices"
	"strings"
)

// Doodles: the pictures bots draw (see bots.go). Each is a few shapes on the
// game's 1200 × 800 paper, a little different every time it's drawn, with the
// words that make a bot draw it and the guesses a bot makes when it sees one.
// The guesses drift on purpose: that's the game.

const (
	paperWidth  = 1200
	paperHeight = 800
)

var (
	ink    = color.RGBA{31, 27, 22, 255}
	white  = color.RGBA{255, 255, 255, 255}
	yellow = color.RGBA{247, 179, 43, 255}
	orange = color.RGBA{232, 120, 30, 255}
	red    = color.RGBA{214, 54, 48, 255}
	green  = color.RGBA{42, 125, 69, 255}
	blue   = color.RGBA{51, 85, 209, 255}
	sky    = color.RGBA{140, 190, 240, 255}
	brown  = color.RGBA{130, 82, 45, 255}
	beige  = color.RGBA{240, 220, 180, 255}
	pink   = color.RGBA{238, 150, 200, 255}
	gray   = color.RGBA{150, 150, 150, 255}
	light  = color.RGBA{225, 228, 235, 255}
)

type doodle struct {
	name     string   // as a bot's drawing is named: bot_<name>.png
	keywords []string // words in a prompt that make a bot draw this
	guesses  []string // what a bot guesses on seeing it; the first is also an opening word
	draw     func(c *paper)
}

// paper is a drawing in progress, with the randomness that makes each one
// its own.
type paper struct {
	img *image.RGBA
	rng *rand.Rand
}

func newPaper(rng *rand.Rand) *paper {
	img := image.NewRGBA(image.Rect(0, 0, paperWidth, paperHeight))
	for i := range img.Pix {
		img.Pix[i] = 255
	}
	return &paper{img: img, rng: rng}
}

// j is v moved by up to spread/2 either way.
func (p *paper) j(v, spread float64) float64 { return v + (p.rng.Float64()-0.5)*spread }

func (p *paper) set(x, y int, c color.RGBA) {
	if x >= 0 && y >= 0 && x < paperWidth && y < paperHeight {
		p.img.SetRGBA(x, y, c)
	}
}

func (p *paper) disc(cx, cy, r float64, c color.RGBA) {
	for y := int(cy - r); y <= int(cy+r); y++ {
		for x := int(cx - r); x <= int(cx+r); x++ {
			dx, dy := float64(x)-cx, float64(y)-cy
			if dx*dx+dy*dy <= r*r {
				p.set(x, y, c)
			}
		}
	}
}

// outlinedDisc is a disc with an ink edge.
func (p *paper) outlinedDisc(cx, cy, r float64, c color.RGBA) {
	p.disc(cx, cy, r+5, ink)
	p.disc(cx, cy, r, c)
}

func (p *paper) ellipse(cx, cy, rx, ry float64, c color.RGBA) {
	for y := int(cy - ry); y <= int(cy+ry); y++ {
		for x := int(cx - rx); x <= int(cx+rx); x++ {
			dx, dy := (float64(x)-cx)/rx, (float64(y)-cy)/ry
			if dx*dx+dy*dy <= 1 {
				p.set(x, y, c)
			}
		}
	}
}

func (p *paper) outlinedEllipse(cx, cy, rx, ry float64, c color.RGBA) {
	p.ellipse(cx, cy, rx+5, ry+5, ink)
	p.ellipse(cx, cy, rx, ry, c)
}

// line is a stroke w wide, round at both ends.
func (p *paper) line(x0, y0, x1, y1, w float64, c color.RGBA) {
	n := int(math.Max(1, math.Hypot(x1-x0, y1-y0)))
	for i := 0; i <= n; i++ {
		t := float64(i) / float64(n)
		p.disc(x0+(x1-x0)*t, y0+(y1-y0)*t, w/2, c)
	}
}

type pt struct{ x, y float64 }

// polygon fills pts (even-odd) and gives it an ink edge.
func (p *paper) polygon(pts []pt, c color.RGBA) {
	minY, maxY := pts[0].y, pts[0].y
	for _, q := range pts {
		minY, maxY = math.Min(minY, q.y), math.Max(maxY, q.y)
	}
	for y := int(minY); y <= int(maxY); y++ {
		fy := float64(y) + 0.5
		var xs []float64
		for i := range pts {
			a, b := pts[i], pts[(i+1)%len(pts)]
			if (a.y <= fy) != (b.y <= fy) {
				xs = append(xs, a.x+(fy-a.y)*(b.x-a.x)/(b.y-a.y))
			}
		}
		slices.Sort(xs)
		for i := 0; i+1 < len(xs); i += 2 {
			for x := int(math.Ceil(xs[i])); x <= int(xs[i+1]); x++ {
				p.set(x, y, c)
			}
		}
	}
	for i := range pts {
		a, b := pts[i], pts[(i+1)%len(pts)]
		p.line(a.x, a.y, b.x, b.y, 8, ink)
	}
}

func (p *paper) rect(x0, y0, x1, y1 float64, c color.RGBA) {
	p.polygon([]pt{{x0, y0}, {x1, y0}, {x1, y1}, {x0, y1}}, c)
}

func (p *paper) png() ([]byte, error) {
	var buf bytes.Buffer
	err := png.Encode(&buf, p.img)
	return buf.Bytes(), err
}

var doodles = []doodle{
	{name: "sun", keywords: []string{"sun", "lemon", "summer", "hot"},
		guesses: []string{"the sun", "a sunny day", "a lemon slice"},
		draw: func(p *paper) {
			cx, cy := p.j(600, 80), p.j(400, 60)
			for i := range 12 {
				a := float64(i)*math.Pi/6 + p.j(0, 0.2)
				p.line(cx+190*math.Cos(a), cy+190*math.Sin(a), cx+p.j(280, 40)*math.Cos(a), cy+p.j(280, 40)*math.Sin(a), 14, orange)
			}
			p.outlinedDisc(cx, cy, p.j(150, 30), yellow)
		}},
	{name: "house", keywords: []string{"house", "home", "barn", "cabin", "building"},
		guesses: []string{"a house", "home sweet home", "a barn"},
		draw: func(p *paper) {
			x, y := p.j(600, 80), p.j(430, 40)
			p.rect(x-190, y-40, x+190, y+240, beige)
			p.polygon([]pt{{x - 240, y - 30}, {p.j(x, 60), y - p.j(250, 40)}, {x + 240, y - 30}}, red)
			p.rect(x-45, y+110, x+45, y+240, brown)
			p.rect(x+80, y+30, x+150, y+100, sky)
		}},
	{name: "tree", keywords: []string{"tree", "forest", "oak", "broccoli", "wood"},
		guesses: []string{"a tree", "broccoli", "a big oak"},
		draw: func(p *paper) {
			x := p.j(600, 80)
			p.rect(x-45, 430, x+45, 700, brown)
			for _, c := range []pt{{x, 300}, {x - 120, 390}, {x + 120, 390}, {x, 420}} {
				p.outlinedDisc(p.j(c.x, 30), p.j(c.y, 30), p.j(130, 30), green)
			}
			p.line(200, 700, 1000, 700, 10, green)
		}},
	{name: "cat", keywords: []string{"cat", "kitten", "kitty", "owl"},
		guesses: []string{"a cat", "a grumpy kitten", "an owl?"},
		draw: func(p *paper) {
			x, y := p.j(600, 60), p.j(430, 40)
			p.polygon([]pt{{x - 160, y - 60}, {x - 140, y - 250}, {x - 40, y - 150}}, gray)
			p.polygon([]pt{{x + 160, y - 60}, {x + 140, y - 250}, {x + 40, y - 150}}, gray)
			p.outlinedDisc(x, y, 180, gray)
			p.disc(x-70, y-30, 22, ink)
			p.disc(x+70, y-30, 22, ink)
			p.polygon([]pt{{x - 22, y + 30}, {x + 22, y + 30}, {x, y + 55}}, pink)
			for _, s := range []float64{-1, 1} {
				for _, dy := range []float64{40, 70} {
					p.line(x+s*60, y+dy, x+s*p.j(240, 40), y+dy+p.j(0, 40), 6, ink)
				}
			}
		}},
	{name: "fish", keywords: []string{"fish", "shark", "whale", "sea", "ocean"},
		guesses: []string{"a fish", "a goldfish", "a tiny whale"},
		draw: func(p *paper) {
			x, y := p.j(560, 80), p.j(400, 60)
			p.polygon([]pt{{x + 200, y}, {x + 360, y - p.j(140, 40)}, {x + 360, y + p.j(140, 40)}}, orange)
			p.outlinedEllipse(x, y, 240, 140, orange)
			p.disc(x-140, y-30, 22, ink)
			p.line(x-60, y-90, x-60, y+90, 6, ink)
		}},
	{name: "car", keywords: []string{"car", "truck", "bus", "taxi", "drive"},
		guesses: []string{"a car", "a red truck", "a taxi"},
		draw: func(p *paper) {
			x, y := p.j(600, 80), p.j(460, 40)
			p.polygon([]pt{{x - 150, y - 80}, {x - 90, y - 190}, {x + 110, y - 190}, {x + 170, y - 80}}, sky)
			p.rect(x-280, y-80, x+280, y+90, red)
			for _, wx := range []float64{x - 160, x + 160} {
				p.outlinedDisc(wx, y+100, 70, ink)
				p.disc(wx, y+100, 30, gray)
			}
		}},
	{name: "flower", keywords: []string{"flower", "rose", "daisy", "garden", "tulip", "spring"},
		guesses: []string{"a flower", "a daisy", "spring!"},
		draw: func(p *paper) {
			x, y := p.j(600, 80), p.j(330, 40)
			p.line(x, y, p.j(x, 40), 720, 16, green)
			p.outlinedEllipse(x+70, 560, 70, 30, green)
			for i := range 6 {
				a := float64(i) * math.Pi / 3
				p.outlinedDisc(x+110*math.Cos(a), y+110*math.Sin(a), p.j(70, 14), pink)
			}
			p.outlinedDisc(x, y, 70, yellow)
		}},
	{name: "star", keywords: []string{"star", "sheriff", "night", "space"},
		guesses: []string{"a star", "a starfish", "a gold sticker"},
		draw: func(p *paper) {
			x, y := p.j(600, 80), p.j(410, 40)
			spin := p.j(0, 0.3)
			var pts []pt
			for i := range 10 {
				r := 270.0
				if i%2 == 1 {
					r = 115
				}
				a := -math.Pi/2 + spin + float64(i)*math.Pi/5
				pts = append(pts, pt{x + r*math.Cos(a), y + r*math.Sin(a)})
			}
			p.polygon(pts, yellow)
		}},
	{name: "smiley", keywords: []string{"smile", "happy", "face", "emoji", "joy"},
		guesses: []string{"a smiley face", "happiness", "an emoji"},
		draw: func(p *paper) {
			x, y := p.j(600, 60), p.j(400, 40)
			p.outlinedDisc(x, y, 260, yellow)
			p.disc(x-90, y-70, 30, ink)
			p.disc(x+90, y-70, 30, ink)
			prev := pt{x - 150, y + 60}
			for i := 1; i <= 20; i++ {
				a := math.Pi * (1 - float64(i)/20)
				next := pt{x + 150*math.Cos(a), y + 60 + p.j(110, 10)*math.Sin(a)}
				p.line(prev.x, prev.y, next.x, next.y, 14, ink)
				prev = next
			}
		}},
	{name: "cloud", keywords: []string{"cloud", "rain", "storm", "weather", "sheep"},
		guesses: []string{"a rain cloud", "a stormy day", "a sheep?"},
		draw: func(p *paper) {
			x, y := p.j(600, 80), p.j(330, 40)
			bumps := []pt{{x - 200, y + 40}, {x - 90, y - 50}, {x + 50, y - 70}, {x + 180, y + 10}, {x, y + 60}}
			for _, b := range bumps {
				p.disc(b.x, b.y, 125, ink)
			}
			for _, b := range bumps {
				p.disc(b.x, b.y, 120, light)
			}
			for i := range 6 {
				dx := -220 + float64(i)*90 + p.j(0, 30)
				p.line(x+dx, y+190, x+dx-20, y+260, 10, blue)
			}
		}},
	{name: "boat", keywords: []string{"boat", "ship", "sail", "pirate", "sea"},
		guesses: []string{"a sailboat", "a pirate ship", "going to sea"},
		draw: func(p *paper) {
			x, y := p.j(600, 80), p.j(520, 30)
			p.line(x, y, x, y-380, 12, ink)
			p.polygon([]pt{{x + 10, y - 370}, {x + 10, y - 40}, {x + p.j(230, 40), y - 40}}, white)
			p.polygon([]pt{{x - 280, y}, {x + 280, y}, {x + 190, y + 120}, {x - 190, y + 120}}, brown)
			for i := range 4 {
				wx := 220 + float64(i)*220
				p.line(wx, 700, wx+100, 680, 10, blue)
				p.line(wx+100, 680, wx+200, 700, 10, blue)
			}
		}},
	{name: "balloon", keywords: []string{"balloon", "party", "birthday", "lollipop"},
		guesses: []string{"a balloon", "a birthday party", "a red lollipop"},
		draw: func(p *paper) {
			x, y := p.j(600, 80), p.j(320, 40)
			p.outlinedEllipse(x, y, 150, 190, red)
			p.polygon([]pt{{x - 20, y + 210}, {x + 20, y + 210}, {x, y + 185}}, red)
			prev := pt{x, y + 210}
			for i := 1; i <= 10; i++ {
				next := pt{x + 30*math.Sin(float64(i)*0.9), y + 210 + float64(i)*28}
				p.line(prev.x, prev.y, next.x, next.y, 6, ink)
				prev = next
			}
		}},
}

// Guesses for a drawing a bot doesn't recognise (a person's).
var wildGuesses = []string{
	"modern art", "a very confused cat", "my uncle Steve", "abstract feelings",
	"a potato with dreams", "something wonderful", "the void, but cute",
	"a map of my kitchen", "a dragon (probably)", "spaghetti at midnight",
}

// doodleFor is the doodle a bot draws for prompt: one whose words appear in
// it, or else any, which is how a story drifts.
func doodleFor(prompt string, rng *rand.Rand) doodle {
	words := strings.ToLower(prompt)
	for _, i := range rng.Perm(len(doodles)) {
		for _, k := range doodles[i].keywords {
			if strings.Contains(words, k) {
				return doodles[i]
			}
		}
	}
	return doodles[rng.IntN(len(doodles))]
}

// doodleNamed is the doodle a bot's drawing file is named after
// ("bot_cat_x7k2p9q1zz.png" once stored), if it's one.
func doodleNamed(filename string) (doodle, bool) {
	rest, ok := strings.CutPrefix(filename, "bot_")
	if !ok {
		return doodle{}, false
	}
	name, _, _ := strings.Cut(rest, "_")
	name = strings.TrimSuffix(name, ".png")
	for _, d := range doodles {
		if d.name == name {
			return d, true
		}
	}
	return doodle{}, false
}

// drawDoodle draws d as a PNG.
func drawDoodle(d doodle, rng *rand.Rand) ([]byte, error) {
	p := newPaper(rng)
	d.draw(p)
	return p.png()
}
