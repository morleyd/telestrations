// A game's settings as the New Game and Play Again dialogs edit them
// (GameSettings.vue), and as a game record stores them.

const UNIT_SECONDS = { Seconds: 1, Minutes: 60, Hours: 3600 }

export function defaultSettings() {
  return { rounds: 1, endless: false, timed: false, timeValue: 90, timeUnit: "Seconds" }
}

// The settings a finished game was played with, to start the next one from.
export function settingsOf(game) {
  const settings = { ...defaultSettings(), rounds: game.rounds || 1, endless: Boolean(game.endless) }
  const seconds = Number(game.roundDuration ?? game.duration)
  if (seconds > 0) {
    settings.timed = true
    const unit = seconds % 3600 == 0 ? "Hours" : seconds % 60 == 0 ? "Minutes" : "Seconds"
    settings.timeValue = seconds / UNIT_SECONDS[unit]
    settings.timeUnit = unit
  }
  return settings
}

// The game record's fields for settings: roundDuration in seconds (-1 for
// untimed), rounds, endless.
export function gameFields(settings) {
  const seconds = Number(settings.timeValue) * (UNIT_SECONDS[settings.timeUnit] || 0)
  return {
    roundDuration: settings.timed && seconds > 0 ? Math.max(1, Math.round(seconds)) : -1,
    rounds: settings.endless ? 1 : Number(settings.rounds),
    endless: Boolean(settings.endless),
  }
}
