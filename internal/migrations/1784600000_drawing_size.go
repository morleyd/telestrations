package migrations

import (
	"fmt"

	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// turns.drawing was created with maxSize 0, which PocketBase reads as its
// default cap of 5 MB, and a full-size phone photo is often bigger: refused
// with a bare "Failed to create record.". The web app now shrinks big photos
// before sending them (prepareUpload in web/src/services/uploadImage.js), so
// this cap is the backstop, for a GIF (sent as is) or a page too old to
// shrink. Down puts back the default.

const drawingMaxSize = 20 << 20

func init() {
	m.Register(func(app core.App) error {
		return setDrawingMaxSize(app, drawingMaxSize)
	}, func(app core.App) error {
		return setDrawingMaxSize(app, 0)
	})
}

func setDrawingMaxSize(app core.App, size int64) error {
	turns, err := app.FindCollectionByNameOrId("turns")
	if err != nil {
		return fmt.Errorf("find turns: %w", err)
	}
	drawing, ok := turns.Fields.GetByName("drawing").(*core.FileField)
	if !ok {
		return fmt.Errorf("turns.drawing is not a file field")
	}
	drawing.MaxSize = size
	if err := app.Save(turns); err != nil {
		return fmt.Errorf("save turns: %w", err)
	}
	return nil
}
