// A player's name as the game matches it, and the avatar drawn from it.

// Names keep the capitals they were typed with, but two names that differ
// only in capitals are the same player: "Sam" coming back as "sam" finds
// their seat instead of joining as someone new.
export function sameName(a, b) {
  return nameKey(a) === nameKey(b)
}

function nameKey(name) {
  return String(name ?? "").toLowerCase()
}

const graphemes = new Intl.Segmenter()

// A word's first character as a reader sees it: a whole emoji, or a letter
// with its accent mark.
function firstCharacter(word) {
  const [first] = graphemes.segment(word)
  return first.segment
}

// The letters on an avatar with no face picked: the first letters of the
// first and last words, so any name fits the circle ("Buddy With A Long Name"
// is "BN").
export function initials(name) {
  const words = String(name ?? "").trim().split(/\s+/).filter(Boolean)
  const ends = words.length > 1 ? [words[0], words.at(-1)] : words
  return ends.map(firstCharacter).join("").toUpperCase()
}

// A color of the player's own, picked from their name: the same name always
// gets the same color, whatever its capitals. Light gray until there's a name.
export function avatarColor(name) {
  const key = nameKey(name)
  if (!key) {
    return "hsl(0, 0%, 85%)"
  }
  let hash = 0
  for (let i = 0; i < key.length; i++) {
    hash = key.charCodeAt(i) + ((hash << 5) - hash)
  }
  hash = Math.abs(hash)
  const inRange = (min, max) => Math.floor((hash % (max - min)) + min)
  return `hsl(${inRange(0, 360)}, ${inRange(60, 100)}%, ${inRange(50, 80)}%)`
}
