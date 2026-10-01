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
