package game

import (
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/core/validators"
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
var drawingTypes = []string{"image/jpeg", "image/png", "image/gif", "image/webp", "image/avif", "image/bmp"}

// bindDrawingTypes refuses a player's upload of any other type. It's a
// request hook, not the field's own type list, so it checks only what a
// player sends: a host skip copies the drawing before it through a save of
// its own, and a drawing stored before this check, of whatever type, must
// still carry forward rather than stall the story.
func bindDrawingTypes(app core.App) {
	check := func(e *core.RecordRequestEvent) error {
		valid := validators.UploadedFileMimeType(drawingTypes)
		for _, f := range e.Record.GetUnsavedFiles("drawing") {
			if valid(f) != nil {
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
