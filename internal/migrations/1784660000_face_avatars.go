package migrations

import (
	"fmt"

	"github.com/morleyd/telestrations/web"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// A player's avatar is a face's name, or "" for their initials, and the users
// guards refuse anything else (isAvatar in internal/game). Older pages saved a
// face as its whole SVG markup, and drew whatever the field held as HTML, so
// one saved by anyone could carry script. This clears every avatar that isn't
// a face's name, so a page still running old code has nothing to draw. Those
// players show their initials until they pick a face again. Down restores
// nothing: the markup is gone.

func init() {
	m.Register(func(app core.App) error {
		faces := make([]any, 0, len(web.FaceNames()))
		for _, name := range web.FaceNames() {
			faces = append(faces, name)
		}
		_, err := app.DB().Update("users", dbx.Params{"avatar": ""},
			dbx.And(dbx.NewExp("avatar != ''"), dbx.NotIn("avatar", faces...))).Execute()
		if err != nil {
			return fmt.Errorf("clear avatars that aren't faces: %w", err)
		}
		return nil
	}, nil)
}
