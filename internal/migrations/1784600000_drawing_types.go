package migrations

import (
	"fmt"

	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// A drawing is shown to every player, on whatever browser they have, so the
// server takes only the picture types nearly every upload is. TIFF, JPEG XL,
// camera RAW, SVG and the like are refused: they're rare from a phone, and
// most of them only some browsers can draw, so saved as is they're a broken
// image in review for everyone else. PocketBase checks the file's bytes, not
// its name.
//
// HEIC stays allowed although only Safari draws it. The web app converts it
// to JPEG before uploading, so it rarely arrives here, and a host skip copies
// the previous drawing into the skipped turn through this same check:
// refusing HEIC would stall a game on one uploaded before the conversion.

// DrawingMimeTypes are the picture types the turns.drawing field accepts.
var DrawingMimeTypes = []string{
	"image/jpeg", "image/png", "image/gif", "image/webp", "image/avif", "image/bmp",
	"image/heic", "image/heif",
}

func init() {
	m.Register(func(app core.App) error {
		return setDrawingMimeTypes(app, DrawingMimeTypes)
	}, func(app core.App) error {
		return setDrawingMimeTypes(app, []string{})
	})
}

func setDrawingMimeTypes(app core.App, types []string) error {
	turns, err := app.FindCollectionByNameOrId("turns")
	if err != nil {
		return fmt.Errorf("find turns: %w", err)
	}
	field, ok := turns.Fields.GetByName("drawing").(*core.FileField)
	if !ok {
		return fmt.Errorf("turns.drawing isn't a file field")
	}
	field.MimeTypes = types
	if err := app.Save(turns); err != nil {
		return fmt.Errorf("save turns: %w", err)
	}
	return nil
}
