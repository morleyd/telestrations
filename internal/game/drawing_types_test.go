package game

import (
	"bytes"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/pocketbase/pocketbase/tools/filesystem"
)

// Which picture types a player can upload as a drawing (bindDrawingTypes):
// the ones every browser draws, through the API, on a new turn or an edit.
// A drawing already stored carries forward on a skip whatever its type.

var (
	// The start of an iPhone photo: enough for the type check, which reads
	// the bytes, not the name.
	heicHeader = []byte("\x00\x00\x00\x18ftypheic\x00\x00\x00\x00mif1heic")
	tiffHeader = []byte("II*\x00\x08\x00\x00\x00\x00\x00\x00\x00")
)

// upload sends a turn's fields, with data as its drawing, the way the web app
// does: multipart, to the record route (POST to create, PATCH to edit).
func upload(api http.Handler, method, path string, fields map[string]any, filename string, data []byte) *httptest.ResponseRecorder {
	var body bytes.Buffer
	w := multipart.NewWriter(&body)
	for k, v := range fields {
		_ = w.WriteField(k, fmt.Sprint(v))
	}
	part, _ := w.CreateFormFile("drawing", filename)
	_, _ = part.Write(data)
	_ = w.Close()
	req := httptest.NewRequest(method, path, &body)
	req.Header.Set("Content-Type", w.FormDataContentType())
	rec := httptest.NewRecorder()
	api.ServeHTTP(rec, req)
	return rec
}

const turnsRoute = "/api/collections/turns/records"

func TestDrawingRefusesTypesNotEveryBrowserDraws(t *testing.T) {
	refused := map[string][]byte{
		"IMG_0619.heic": heicHeader,
		"scan.tiff":     tiffHeader,
		"logo.svg":      []byte(`<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>`),
		"photo.jxl":     []byte("\xff\x0a\x00\x00\x00\x00\x00\x00"),
	}
	for name, data := range refused {
		t.Run(name, func(t *testing.T) {
			app := newTestApp(t)
			api := serveAPI(t, app)
			g := newGame(t, app, "ann", "ben")
			g.play(t, "ann", "ann")
			rec := upload(api, http.MethodPost, turnsRoute, g.nextTurn(t, "ann", "ben"), name, data)
			if code, _ := refusal(rec); rec.Code != http.StatusBadRequest || code != codeBadPicture {
				t.Fatalf("%s: %d %s, want refused as %s", name, rec.Code, rec.Body, codeBadPicture)
			}
			if len(g.turnsBy(t, "ann", "ben")) != 0 {
				t.Fatalf("%s was saved as ben's drawing", name)
			}
		})
	}
}

func TestDrawingTakesAPng(t *testing.T) {
	app := newTestApp(t)
	api := serveAPI(t, app)
	g := newGame(t, app, "ann", "ben")
	g.play(t, "ann", "ann")
	rec := upload(api, http.MethodPost, turnsRoute, g.nextTurn(t, "ann", "ben"), "d.png", pngPixel)
	if rec.Code != http.StatusOK {
		t.Fatalf("PNG drawing: %d %s", rec.Code, rec.Body)
	}
}

// The turns update rule is open, so an edit is checked like a new turn.
func TestDrawingEditRefusesATiff(t *testing.T) {
	app := newTestApp(t)
	api := serveAPI(t, app)
	g := newGame(t, app, "ann", "ben")
	g.play(t, "ann", "ann")
	turn := g.drawWithFile(t, "ann", "ben")
	rec := upload(api, http.MethodPatch, turnsRoute+"/"+turn.Id, nil, "scan.tiff", tiffHeader)
	if code, _ := refusal(rec); rec.Code != http.StatusBadRequest || code != codeBadPicture {
		t.Fatalf("editing in a TIFF: %d %s, want refused as %s", rec.Code, rec.Body, codeBadPicture)
	}
}

// A skip copies the drawing before it through a save of its own: one stored
// before the check, of a type it now refuses, must still carry forward.
func TestSkipCarriesAnOlderTiffForward(t *testing.T) {
	app := newTestApp(t)
	g := newGame(t, app, "ann", "ben", "cat")
	g.play(t, "ann", "ann")
	turn := g.nextTurn(t, "ann", "ben")
	file, err := filesystem.NewFileFromBytes(tiffHeader, "scan.tiff")
	if err != nil {
		t.Fatal(err)
	}
	turn["drawing"] = file
	save(t, app, "turns", turn)

	if _, err := skipPendingTurns(app, g.game.Id, g.players["cat"].Id, false); err != nil {
		t.Fatal(err)
	}
	skip := g.turnsBy(t, "ann", "cat")
	if len(skip) != 1 || skip[0].GetString("drawing") == "" {
		t.Fatalf("cat's skip on ann's story: %d turns, want one carrying ben's drawing", len(skip))
	}
	if got := readDrawing(t, app, skip[0]); !bytes.Equal(got, tiffHeader) {
		t.Fatalf("cat's skip carries %q, want ben's TIFF", got)
	}
}
