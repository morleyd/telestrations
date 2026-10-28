package game

import (
	"errors"
	"fmt"
	"strings"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/hook"
	"github.com/pocketbase/pocketbase/tools/router"
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

	// Every story goes round the table at least once, and a round timer of no
	// time at all is no timer: -1, how the pages and /timeout tell an untimed
	// game. A client's create and Play again's alike.
	app.OnRecordCreate("games").BindFunc(func(e *core.RecordEvent) error {
		e.Record.Set("rounds", max(e.Record.GetInt("rounds"), 1))
		if e.Record.GetFloat("roundDuration") <= 0 {
			e.Record.Set("roundDuration", -1)
		}
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
	bindTurnWriteLog(app)
}

// bindTurnWriteLog logs a player's turn write that validation or a hook
// fails, with its cause. To the player a full disk, a picture over the size
// cap and most other failures all read "Failed to create record.";
// PocketBase keeps the real reason out of the response, so this puts it in
// the dashboard's Logs. It binds ahead of every other request hook, so it sees
// their failures too, but leaves out a refusal with a code (refuse): the
// player is told why, and the guard logs it itself where that's worth it.
// A request PocketBase answers before the request hooks run isn't logged
// here: a body over its limit (a 413), a malformed form, a failing rule.
func bindTurnWriteLog(app core.App) {
	logFailure := func(e *core.RecordRequestEvent) error {
		err := e.Next()
		if err == nil || isRefusal(err) {
			return err
		}
		attrs := []any{
			"source", "server",
			"game_id", e.Record.GetString("game_id"), "story", e.Record.GetString("story_id"),
			"user_id", e.Record.GetString("user_id"), "is_drawing", e.Record.GetBool("is_drawing"),
		}
		cause := err.Error()
		var apiErr *router.ApiError
		if errors.As(err, &apiErr) {
			attrs = append(attrs, "status", apiErr.Status)
			if raw := apiErr.RawData(); raw != nil {
				cause = fmt.Sprint(raw)
			}
		}
		// Both may carry the file's name, which is the player's to choose.
		attrs = append(attrs, "cause", clip(cause, 500))
		for _, f := range e.Record.GetUnsavedFiles("drawing") {
			attrs = append(attrs, "file", clip(f.OriginalName, 150), "file_size", f.Size)
		}
		e.App.Logger().Warn("turn: write failed", attrs...)
		return err
	}
	for _, h := range []*hook.TaggedHook[*core.RecordRequestEvent]{
		app.OnRecordCreateRequest("turns"), app.OnRecordUpdateRequest("turns"),
	} {
		h.Bind(&hook.Handler[*core.RecordRequestEvent]{Priority: -100, Func: logFailure})
	}
}

// isRefusal reports whether err is one of the game's own refusals (refuse).
func isRefusal(err error) bool {
	var apiErr *router.ApiError
	if !errors.As(err, &apiErr) {
		return false
	}
	data, _ := apiErr.RawData().(map[string]error)
	_, ok := data["code"].(refusalCode)
	return ok
}

// clip is s cut to at most n bytes, marked as cut.
func clip(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return strings.ToValidUTF8(s[:n], "") + "…"
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
