package game

import (
	"encoding/binary"
	"io"
	"slices"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/core/validators"
	"github.com/pocketbase/pocketbase/tools/filesystem"
)

// drawingTypes are the picture types a player may upload as a drawing, told
// by the file's bytes, not its name. A drawing is shown to every player on
// whatever browser they have, so these are the types all current browsers
// draw (AVIF since Safari 16.4) and nearly every upload is. Refused:
//   - HEIC, TIFF and JPEG XL, which only some browsers draw, and camera RAW,
//     which none do: saved as is, a broken image in review for everyone else.
//     The web app converts HEIC to JPEG before sending it, so a HEIC here is
//     from a page too old to.
//   - SVG, which every browser draws, but which can carry script, and drawings
//     are served from the game's own address.
var drawingTypes = []string{
	"image/jpeg", "image/png", "image/vnd.mozilla.apng", "image/gif", "image/webp", "image/avif", "image/bmp",
}

// bindDrawingTypes refuses a player's upload of any other type. It's a
// request hook, not the field's own type list, so it checks only what a
// player sends: a host skip copies the drawing before it through a save of
// its own, and a drawing stored before this check, of whatever type, must
// still carry forward rather than stall the story.
func bindDrawingTypes(app core.App) {
	check := func(e *core.RecordRequestEvent) error {
		valid := validators.UploadedFileMimeType(drawingTypes)
		for _, f := range e.Record.GetUnsavedFiles("drawing") {
			if valid(f) != nil && !isAVIF(f) {
				e.App.Logger().Warn("turn: refused picture type", "user_id", e.Record.GetString("user_id"),
					"story", e.Record.GetString("story_id"), "file", f.OriginalName)
				return refuse(codeBadPicture, msgBadPicture)
			}
		}
		return e.Next()
	}
	app.OnRecordCreateRequest("turns").BindFunc(check)
	app.OnRecordUpdateRequest("turns").BindFunc(check)
}

// isAVIF reports whether f is an AVIF by any of its brands, as the web app
// tells one (prepareUpload). The type check above goes by an ISO media file's
// major brand alone, and an AVIF may name itself only among its compatible
// brands, behind mif1: that reads as HEIF, which the check refuses.
func isAVIF(f *filesystem.File) bool {
	r, err := f.Reader.Open()
	if err != nil {
		return false
	}
	defer r.Close()
	head := make([]byte, 64)
	n, _ := io.ReadFull(r, head)
	if n < 16 || string(head[4:8]) != "ftyp" {
		return false
	}
	// The box: its size, "ftyp", the major brand, a version, then the
	// compatible brands.
	end := min(int(binary.BigEndian.Uint32(head)), n)
	var brands []string
	for i := 8; i+4 <= end; i += 4 {
		if i != 12 {
			brands = append(brands, string(head[i:i+4]))
		}
	}
	return slices.Contains(brands, "avif") || slices.Contains(brands, "avis")
}
