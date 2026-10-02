package game

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/pocketbase/pocketbase/core"
)

// clientLogEntry is one event from web/src/services/log.js.
type clientLogEntry struct {
	Seq   int            `json:"seq"`
	T     string         `json:"t"`
	Level string         `json:"level"`
	Event string         `json:"event"`
	Attrs map[string]any `json:"attrs"`
}

const maxClientLogBytes = 256 << 10
const maxClientLogEntries = 200

func handleClientLog(e *core.RequestEvent) error {
	body := struct {
		Session  string           `json:"session"`
		Browser  string           `json:"browser"`
		UA       string           `json:"ua"`
		Game     string           `json:"game"`
		GameID   string           `json:"gameId"`
		Username string           `json:"username"`
		UserID   string           `json:"userId"`
		Entries  []clientLogEntry `json:"entries"`
	}{}
	// Decoded by hand rather than BindBody: sendBeacon posts as text/plain.
	r := http.MaxBytesReader(e.Response, e.Request.Body, maxClientLogBytes)
	if err := json.NewDecoder(r).Decode(&body); err != nil {
		return e.BadRequestError("Invalid log payload.", err)
	}
	if len(body.Entries) > maxClientLogEntries {
		body.Entries = body.Entries[len(body.Entries)-maxClientLogEntries:]
	}

	logger := e.App.Logger().With(
		"source", "client",
		"game", body.Game, "game_id", body.GameID,
		"user", body.Username, "user_id", body.UserID,
		"browser", body.Browser, "session", body.Session,
		"ip", e.RealIP(), "ua", body.UA,
	)
	for _, entry := range body.Entries {
		level := slog.LevelInfo
		switch entry.Level {
		case "warn":
			level = slog.LevelWarn
		case "error":
			level = slog.LevelError
		}
		logger.Log(context.Background(), level, "client: "+entry.Event,
			"seq", entry.Seq, "client_time", entry.T, "attrs", entry.Attrs)
	}
	return e.NoContent(http.StatusNoContent)
}
