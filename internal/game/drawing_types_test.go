package game

import (
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/filesystem"
)

// Which picture types a drawing can be (the drawing-types migration): the
// ones nearly every upload is, and not the rare ones only some browsers draw.

// heicHeader is the start of an iPhone photo: enough for the type check,
// which reads the bytes, not the name.
var heicHeader = []byte("\x00\x00\x00\x18ftypheic\x00\x00\x00\x00mif1heic")

func (g *testGame) drawFile(t *testing.T, starter, name string, data []byte, filename string) (*core.Record, error) {
	t.Helper()
	col, err := g.app.FindCollectionByNameOrId("turns")
	if err != nil {
		t.Fatal(err)
	}
	file, err := filesystem.NewFileFromBytes(data, filename)
	if err != nil {
		t.Fatal(err)
	}
	turn := core.NewRecord(col)
	turn.Load(g.nextTurn(t, starter, name))
	turn.Set("drawing", file)
	return turn, g.app.Save(turn)
}

func TestDrawingRefusesRareFormats(t *testing.T) {
	refused := map[string][]byte{
		"scan.tiff": []byte("II*\x00\x08\x00\x00\x00\x00\x00\x00\x00"),
		"logo.svg":  []byte(`<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>`),
		"photo.jxl": []byte("\xff\x0a\x00\x00\x00\x00\x00\x00"),
	}
	for name, data := range refused {
		t.Run(name, func(t *testing.T) {
			app := newTestApp(t)
			g := newGame(t, app, "ann", "ben")
			g.play(t, "ann", "ann")
			if _, err := g.drawFile(t, "ann", "ben", data, name); err == nil {
				t.Fatalf("%s was saved as a drawing, want it refused", name)
			}
		})
	}
}

func TestDrawingTakesCommonFormats(t *testing.T) {
	for name, data := range map[string][]byte{"d.png": pngPixel, "IMG_0619.heic": heicHeader} {
		t.Run(name, func(t *testing.T) {
			app := newTestApp(t)
			g := newGame(t, app, "ann", "ben")
			g.play(t, "ann", "ann")
			if _, err := g.drawFile(t, "ann", "ben", data, name); err != nil {
				t.Fatalf("%s refused: %v", name, err)
			}
		})
	}
}

// A skip copies the drawing before it through the same check, so a HEIC
// saved before the web app converted them mustn't stall the game.
func TestSkipCarriesAHeicForward(t *testing.T) {
	app := newTestApp(t)
	g := newGame(t, app, "ann", "ben", "cat")
	g.play(t, "ann", "ann")
	if _, err := g.drawFile(t, "ann", "ben", heicHeader, "IMG_0619.heic"); err != nil {
		t.Fatal(err)
	}
	if _, err := skipPendingTurns(app, g.game.Id, g.players["cat"].Id, false); err != nil {
		t.Fatal(err)
	}
	if skip := g.turnsBy(t, "ann", "cat"); len(skip) != 1 || skip[0].GetString("drawing") == "" {
		t.Fatalf("cat's skip on ann's story: %d turns, want one carrying ben's drawing", len(skip))
	}
}
