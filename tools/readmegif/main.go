// Command readmegif turns the frames the README GIF's recording saves
// (web/tests/e2e/readme-gif.spec.js) into an animated GIF: each frame scaled
// down, with a palette of its own most common colors, shown for as long as
// the recording asked. `make readme-gif` runs both.
package main

import (
	"encoding/json"
	"flag"
	"image"
	"image/color"
	"image/gif"
	"image/png"
	"log"
	"os"
	"path/filepath"
	"slices"

	xdraw "golang.org/x/image/draw"
)

type frame struct {
	File string `json:"file"`
	MS   int    `json:"ms"`
}

func main() {
	dir := flag.String("frames", "web/test-results/readme-gif", "the recording's frames and frames.json")
	out := flag.String("out", "docs/demo.gif", "the GIF to write")
	width := flag.Int("width", 760, "the GIF's width in pixels")
	flag.Parse()

	data, err := os.ReadFile(filepath.Join(*dir, "frames.json"))
	if err != nil {
		log.Fatalf("read the frames list (record them first): %v", err)
	}
	var frames []frame
	if err := json.Unmarshal(data, &frames); err != nil {
		log.Fatal(err)
	}

	anim := &gif.GIF{}
	for _, f := range frames {
		img, err := readPNG(filepath.Join(*dir, f.File))
		if err != nil {
			log.Fatal(err)
		}
		small := scale(img, *width)
		anim.Image = append(anim.Image, quantize(small))
		anim.Delay = append(anim.Delay, f.MS/10) // hundredths of a second
	}
	file, err := os.Create(*out)
	if err != nil {
		log.Fatal(err)
	}
	defer file.Close()
	if err := gif.EncodeAll(file, anim); err != nil {
		log.Fatal(err)
	}
	log.Printf("wrote %s: %d frames", *out, len(frames))
}

func readPNG(path string) (image.Image, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	return png.Decode(f)
}

func scale(img image.Image, width int) *image.RGBA {
	b := img.Bounds()
	height := b.Dy() * width / b.Dx()
	dst := image.NewRGBA(image.Rect(0, 0, width, height))
	xdraw.CatmullRom.Scale(dst, dst.Bounds(), img, b, xdraw.Src, nil)
	return dst
}

// bucket is a color to 5 bits a channel: close colors count as one.
func bucket(r, g, b uint8) int { return int(r>>3)<<10 | int(g>>3)<<5 | int(b>>3) }

// quantize maps img onto the 256 colors it uses most. The app is flat
// colors on paper, so its most common colors are nearly all of it, and
// nothing needs dithering.
func quantize(img *image.RGBA) *image.Paletted {
	counts := map[int]int{}
	for i := 0; i < len(img.Pix); i += 4 {
		counts[bucket(img.Pix[i], img.Pix[i+1], img.Pix[i+2])]++
	}
	buckets := make([]int, 0, len(counts))
	for k := range counts {
		buckets = append(buckets, k)
	}
	slices.SortFunc(buckets, func(a, b int) int { return counts[b] - counts[a] })
	if len(buckets) > 256 {
		buckets = buckets[:256]
	}
	pal := make(color.Palette, len(buckets))
	for i, k := range buckets {
		pal[i] = color.RGBA{uint8(k>>10&31)<<3 | 4, uint8(k>>5&31)<<3 | 4, uint8(k&31)<<3 | 4, 255}
	}
	// Each bucket's nearest palette color, worked out once.
	nearest := map[int]uint8{}
	dst := image.NewPaletted(img.Bounds(), pal)
	for i, p := 0, 0; i < len(img.Pix); i, p = i+4, p+1 {
		k := bucket(img.Pix[i], img.Pix[i+1], img.Pix[i+2])
		idx, ok := nearest[k]
		if !ok {
			idx = uint8(pal.Index(color.RGBA{img.Pix[i], img.Pix[i+1], img.Pix[i+2], 255}))
			nearest[k] = idx
		}
		dst.Pix[p] = idx
	}
	return dst
}
