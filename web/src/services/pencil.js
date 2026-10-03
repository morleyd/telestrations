// What the pencil on a notebook (see StoryPaper) puts down, stroke by stroke,
// and when, in the notebook's own units (a page 60 wide and 76 high).

// The share of the loop the pencil spends drawing. Then it rests, and starts
// over.
export const DRAWN = 0.8

// Each stroke's length is in any unit, the same for all of one kind, and must
// match its path: they set how long the pencil spends on each.
//
// Handwriting along the first three lines. Every hump is the same length, so
// a line's length is its humps.
const WRITING = [12, 10, 6].map((humps, i) => ({
  d: `M15 ${21 + 10 * i} q1.5 -5 3 0` + " t3 0".repeat(humps - 1),
  length: humps,
}))
// A house (its walls, roof and floor, then its door) under the sun, a circle
// of radius 4
const DRAWING = [
  { d: "M16 60 L16 40 L30 27 L44 40 L44 60 Z", length: 20 + 20 + 28 + 2 * Math.hypot(14, 13) },
  { d: "M26 60 L26 49 L34 49 L34 60", length: 30 },
  { d: "M44 15 a4 4 0 1 0 8 0 a4 4 0 1 0 -8 0", length: 8 * Math.PI },
]

// When each stroke inks in: while the pencil, going along them all at an even
// pace, is on it. keyTimes for an <animate> of the stroke's dash, held
// before and after.
function timed(strokes) {
  const total = strokes.reduce((sum, s) => sum + s.length, 0)
  let done = 0
  return strokes.map(({ d, length }) => {
    const from = (done / total) * DRAWN
    done += length
    const to = (done / total) * DRAWN
    return { d, keyTimes: `0;${from.toFixed(4)};${to.toFixed(4)};1` }
  })
}

// rest: where the pencil rests when nothing moves, at the end of the last
// stroke (the end of the last line; where the sun's circle closes)
function kind(strokes, rest) {
  return {
    strokes: timed(strokes),
    // The pencil's way: every stroke, jumping from one to the next
    motion: strokes.map((s) => s.d).join(" "),
    rest,
  }
}

const KINDS = { writing: kind(WRITING, "33 41"), drawing: kind(DRAWING, "44 15") }

// The pencil's work on a page for a drawing (isDraw) or for a word or guess
export function pencilWork(isDraw) {
  return KINDS[isDraw ? "drawing" : "writing"]
}
