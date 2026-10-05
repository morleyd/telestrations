package game

import (
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// BindHooks binds the record hooks the game relies on: the guards on
// client writes (bindTurnGuards in host.go, bindDrawingTypes in drawings.go)
// and, after every turn, the audit log and the auto-skip past dropped players.
// The Go tests bind the same set.
func BindHooks(app core.App) {
	// Number every turn by its place in its story, whoever writes it (a
	// submit, a skip, a timeout): the views find a story's previous turn by
	// it. Counted in the write's own transaction, so two writes racing for one
	// place can't both get it; the unique (story_id, turn_index) index refuses
	// the second.
	app.OnRecordCreate("turns").BindFunc(func(e *core.RecordEvent) error {
		// Hand the caller's app back afterwards: outside a transaction,
		// PocketBase runs the after-create hooks (the audit, the dropped-player
		// skip) with e.App, and by then this transaction is over.
		orig := e.App
		defer func() { e.App = orig }()
		return orig.RunInTransaction(func(tx core.App) error {
			e.App = tx
			var n int
			err := tx.DB().NewQuery("SELECT COUNT(*) FROM turns WHERE story_id = {:s}").
				Bind(dbx.Params{"s": e.Record.GetString("story_id")}).Row(&n)
			if err != nil {
				return err
			}
			e.Record.Set("turn_index", n)
			return e.Next()
		})
	})

	// Every story goes round the table at least once.
	app.OnRecordCreate("games").BindFunc(func(e *core.RecordEvent) error {
		e.Record.Set("rounds", max(e.Record.GetInt("rounds"), 1))
		return e.Next()
	})

	// Audit every turn as it lands. The rotation is only visible across devices,
	// so the server is the one place that can check each write against the
	// game's shape and flag the first bad turn, rather than finding a garbled
	// story at the review screen.
	app.OnRecordAfterCreateSuccess("turns").BindFunc(func(e *core.RecordEvent) error {
		s, err := loadStory(e.App, e.Record.GetString("story_id"))
		if err != nil {
			e.App.Logger().Error("turn: audit failed", "story", e.Record.GetString("story_id"),
				"turn", e.Record.Id, "error", err.Error())
			return e.Next()
		}
		auditTurn(e.App, e.Record, s)
		skipIfNextIsDropped(e.App, s)
		return e.Next()
	})
	bindTurnGuards(app)
	bindDrawingTypes(app)
}

// auditTurn logs a just-created turn with its place in the story (s, read after
// the insert), and warns when it breaks the game's invariants: a story opens
// with a word and then alternates word/drawing (a skipped turn instead repeats
// the type before it, since it carries that turn forward), and the writer must
// be the player the rotation expected. (One write per place in a story is
// enforced by the idx_turns_story_index unique index, so a duplicate never
// gets here.)
func auditTurn(app core.App, turn *core.Record, s *storyState) {
	storyID := turn.GetString("story_id")
	userID := turn.GetString("user_id")

	username := userID
	if u, err := app.FindRecordById("users", userID); err == nil {
		username = u.GetString("username")
	}

	index := s.Taken - 1 // this turn is already counted
	isDrawing := turn.GetBool("is_drawing")
	skipped := turn.GetBool("skipped")
	wantDrawing := false
	if index > 0 {
		var prevDrawing bool
		_ = app.DB().NewQuery(`SELECT is_drawing FROM turns WHERE story_id = {:s} AND turn_index = {:i}`).
			Bind(dbx.Params{"s": storyID, "i": turn.GetInt("turn_index") - 1}).Row(&prevDrawing)
		wantDrawing = !prevDrawing
		if skipped {
			wantDrawing = prevDrawing // carried forward unchanged
		}
	}
	logger := app.Logger().With(
		"source", "server",
		"game_id", turn.GetString("game_id"), "story", storyID, "turn", turn.Id,
		"user", username, "user_id", userID,
		"index", index, "of", s.TotalTurns,
		"is_drawing", isDrawing, "has_file", turn.GetString("drawing") != "",
		"skipped", skipped, "timed_out", turn.GetBool("timed_out"),
	)
	logger.Info("turn: created")

	switch {
	case s.PrevUser != "" && s.PrevUser != userID:
		logger.Warn("turn: out of rotation", "expected_user_id", s.PrevUser)
	case s.TotalTurns >= 0 && index >= s.TotalTurns:
		logger.Warn("turn: story has more turns than its rounds allow", "total_turns", s.TotalTurns)
	}
	if isDrawing != wantDrawing {
		logger.Warn("turn: wrong type for position", "want_drawing", wantDrawing)
	}
}
