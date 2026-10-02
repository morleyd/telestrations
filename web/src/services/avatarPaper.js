// The cut paper an avatar is made of (see AvatarCircle): the avatar itself, an
// uneven circle of the player's color, laid on a scrap of the opposite color
// about its size, a blob or a bean, a little off center so it shows round one
// side like a shadow. Every choice comes from the player's name, so a player
// looks the same on every screen and every visit.

// FNV-1a: similar names still land far apart
function hash(text) {
  let h = 0x811c9dc5
  for (const ch of text) {
    h ^= ch.codePointAt(0)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h
}

// mulberry32: a run of numbers in [0, 1) from a seed
function randoms(seed) {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const round = (n) => Math.round(n * 1000) / 1000

// A smooth closed outline round the points (Catmull-Rom, drawn as Béziers)
function closedCurve(points) {
  const at = (i) => points[(i + points.length) % points.length]
  let d = `M${round(at(0)[0])} ${round(at(0)[1])}`
  for (let i = 0; i < points.length; i++) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)]
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6]
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6]
    d += `C${round(c1[0])} ${round(c1[1])} ${round(c2[0])} ${round(c2[1])} ${round(p2[0])} ${round(p2[1])}`
  }
  return `${d}Z`
}

// A blob in the box -1..1: six points round a circle, each its own distance
// out, then squashed to up to 1.3 times as wide as tall, which makes the
// beans. Gentle, so the rim it leaves round the avatar has no lumps.
function blob(random) {
  const squash = 1 + random() * 0.3
  const points = Array.from({ length: 6 }, (_, i) => {
    const angle = (i / 6) * 2 * Math.PI + (random() - 0.5) * 0.5
    const reach = 0.86 + random() * 0.14
    return [Math.cos(angle) * reach, (Math.sin(angle) * reach) / squash]
  })
  return closedCurve(points)
}

// The opposite hue to the avatar's, a little darker so the two pieces read
// apart. Colors are hsl() (see avatarColor); anything else gets sunflower.
export function scrapColor(color) {
  const hsl = /hsl\(\s*([\d.]+)[\s,]+([\d.]+)%[\s,]+([\d.]+)%/.exec(color ?? "")
  if (!hsl) return "rgb(var(--v-theme-secondary))"
  const [hue, saturation, lightness] = hsl.slice(1).map(Number)
  return `hsl(${(hue + 180) % 360}, ${saturation}%, ${Math.max(35, lightness - 10)}%)`
}

// The avatar's cut (a CSS border-radius) and its scrap: the outline, and
// where it sits, as shares of the avatar's size. The scrap is a little
// bigger than the avatar and mostly under it, its center pushed 10-17% of the
// way out at an angle of its own, so the most of it shows on that side.
export function avatarPaper(name) {
  const random = randoms(hash(String(name ?? "")))
  // Each corner a little off round: 42-58% instead of 50%
  const [a, b, c, d] = Array.from({ length: 4 }, () => Math.round(42 + random() * 16))
  const cut = `${a}% ${100 - a}% ${b}% ${100 - b}% / ${c}% ${d}% ${100 - d}% ${100 - c}%`

  const around = random() * 2 * Math.PI
  const out = 0.1 + random() * 0.07
  const size = 1.1 + random() * 0.12
  const turn = Math.round(random() * 360)
  const path = blob(random)
  return {
    cut,
    scrap: {
      path,
      turn,
      size: round(size),
      // Its box's top-left corner
      x: round(0.5 + Math.cos(around) * out - size / 2),
      y: round(0.5 + Math.sin(around) * out - size / 2),
    },
  }
}
