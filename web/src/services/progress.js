// How far a story has got, from its row in the progress view: "3 / 8" turns,
// or in an endless game (no total) the turns so far, with the bar showing how
// far round the table the story is this time.
export function storyProgress(row) {
  const taken = row?.turns_taken || 0
  const total = row?.total_turns
  if (total == null) {
    const players = row?.total_players || 1
    return { label: `${taken} ${taken == 1 ? "turn" : "turns"}`, percent: ((taken % players) / players) * 100 }
  }
  return { label: `${taken} / ${total}`, percent: total ? (taken / total) * 100 : 0 }
}

// Who a story is waiting on, from its row in the progress view, written
// under its progress: "Waiting on Sam", "Waiting on you" (meId is whoever is
// looking), or "Done" once it's had its last turn or the game is over.
export function waitingOn(row, userMap, meId) {
  const next = row?.next_user_id
  if (!next) return "Done"
  if (next === meId) return "Waiting on you"
  return `Waiting on ${userMap?.[next]?.username || "someone"}`
}

// How far the whole game has got, from all its rows in the progress view:
// "Game 63% done", or null before there are any. A story whose player hasn't
// opened the game yet has no row; it counts at its full total with none taken,
// so the percent doesn't jump back when it appears. Skipped turns are rows in
// turns like any other, so they count as taken. An endless game has no total:
// it says the turns so far. Once no story is waiting on anyone (they've all
// had their last turn, or End Game's time is up) the game is done.
export function gameProgress(rows) {
  if (!rows?.length) return null
  if (rows.every((row) => !row.next_user_id)) return { label: "Game done", percent: 100 }
  const taken = rows.reduce((sum, row) => sum + (row.turns_taken || 0), 0)
  if (rows.some((row) => row.total_turns == null)) {
    return { label: `Game: ${taken} ${taken == 1 ? "turn" : "turns"} so far`, percent: null }
  }
  const perStory = Math.max(...rows.map((row) => row.total_turns))
  const stories = Math.max(...rows.map((row) => row.total_players || 0), rows.length)
  const total = perStory * stories
  // Rounded down: 100% only once it's done (and that's said above)
  const percent = total ? Math.min(99, Math.floor((taken / total) * 100)) : 0
  return { label: `Game ${percent}% done`, percent }
}

// How far a player has got, from their row of the game's players: "5 / 8"
// turns, the bar's share of them they took (done) and the share written for
// them (skipped: the host skipped them, they were dropped, or their timer ran
// out with nothing entered), and a note for beside it. In an endless game (no
// total) it's the turns so far, with the bars against the most turns anyone
// has (most).
export function playerTurns(player, most = 0) {
  const turns = player?.turns || 0
  const skipped = Math.min(player?.skipped || 0, turns)
  const total = player?.total_turns
  const label = total == null ? `${turns} ${turns == 1 ? "turn" : "turns"}` : `${turns} / ${total}`
  const of = total ?? most
  const share = (n) => (of ? Math.min(100, (n / of) * 100) : 0)
  const done = share(turns - skipped)
  let status = ""
  if (player?.dropped) status = "Dropped"
  else if (player?.finished) status = "Done"
  else if (!turns && !player?.has_story) status = "Not started yet"
  return {
    label,
    done,
    skipped: Math.min(100 - done, share(skipped)),
    status,
    skippedNote: skipped ? `${skipped} skipped` : "",
  }
}
