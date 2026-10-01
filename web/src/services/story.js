// A story as the review shows it, from its rows in the `results` view (in
// turn order). Shared by the review's slides and the downloadable images.

// Each turn was made from the one before it (a skip carries that one's word or
// drawing forward unchanged), so pair them up first, before skips are dropped:
// a turn's `prev` is what the player was given.
//
// Host skips just carry the previous turn forward; leave them out. Keep
// timeouts (they get a "ran out of time" slide) and opening words (a story
// needs its first word, even a randomly picked one).
export function reviewTurns(turns) {
  return turns
    .map((turn, i) => ({ ...turn, prev: turns[i - 1] }))
    .filter(turn => !turn.skipped || turn.timed_out || turn.turn_number == 0)
}

// A timed-out turn with nothing in it: it just repeats the one before, so the
// review says what happened instead of showing it twice.
export function ranOutOfTime(turn) {
  return turn.skipped && turn.turn_number > 0
}

// The note on a turn that wasn't simply played. Only on the review; during the
// game these turns look normal.
export function turnBanner(turn) {
  if (turn.skipped && turn.turn_number == 0) {
    return turn.timed_out
      ? "⏱ Ran out of time, so we picked a random word"
      : "Skipped by the host, so we picked a random word"
  }
  if (turn.timed_out && !turn.skipped) return "⏱ Ran out of time"
  return ""
}
