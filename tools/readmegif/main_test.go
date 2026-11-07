package main

import (
	"image"
	"image/color"
	"image/gif"
	"image/png"
	"os"
	"path/filepath"
	"testing"
)

func writeFrame(t *testing.T, dir, name string, c color.RGBA) {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 40, 20))
	for i := 0; i < len(img.Pix); i += 4 {
		img.Pix[i], img.Pix[i+1], img.Pix[i+2], img.Pix[i+3] = c.R, c.G, c.B, 255
	}
	f, err := os.Create(filepath.Join(dir, name))
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	if err := png.Encode(f, img); err != nil {
		t.Fatal(err)
	}
}

// An empty recording must not touch the GIF that's already committed, or
// leave a half-written file beside it.
func TestZeroFramesLeavesTheOutputAlone(t *testing.T) {
	dir := t.TempDir()
	outDir := t.TempDir()
	out := filepath.Join(outDir, "demo.gif")
	if err := os.WriteFile(filepath.Join(dir, "frames.json"), []byte("[]"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(out, []byte("the committed gif"), 0o644); err != nil {
		t.Fatal(err)
	}

	if _, err := run(dir, out, 20); err == nil {
		t.Fatal("run with no frames succeeded; want an error")
	}
	got, err := os.ReadFile(out)
	if err != nil || string(got) != "the committed gif" {
		t.Fatalf("the existing output changed: %q, %v", got, err)
	}
	entries, _ := os.ReadDir(outDir)
	if len(entries) != 1 {
		t.Fatalf("%d files beside the output, want only the output", len(entries))
	}
}

func TestRunWritesAValidGIF(t *testing.T) {
	dir := t.TempDir()
	outDir := t.TempDir()
	out := filepath.Join(outDir, "demo.gif")
	writeFrame(t, dir, "a.png", color.RGBA{R: 200})
	writeFrame(t, dir, "b.png", color.RGBA{B: 200})
	list := `[{"file":"a.png","ms":1500},{"file":"b.png","ms":700}]`
	if err := os.WriteFile(filepath.Join(dir, "frames.json"), []byte(list), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(out, []byte("an older gif"), 0o644); err != nil {
		t.Fatal(err)
	}

	n, err := run(dir, out, 20)
	if err != nil || n != 2 {
		t.Fatalf("run = %d, %v; want 2 frames", n, err)
	}
	f, err := os.Open(out)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	anim, err := gif.DecodeAll(f)
	if err != nil {
		t.Fatalf("the output isn't a GIF: %v", err)
	}
	if len(anim.Image) != 2 || anim.Delay[0] != 150 || anim.Delay[1] != 70 {
		t.Fatalf("frames %d, delays %v; want 2 frames, delays [150 70]", len(anim.Image), anim.Delay)
	}
	if w := anim.Image[0].Bounds().Dx(); w != 20 {
		t.Fatalf("width %d, want 20", w)
	}
	entries, _ := os.ReadDir(outDir)
	if len(entries) != 1 {
		t.Fatalf("%d files beside the output, want only the output", len(entries))
	}
}
