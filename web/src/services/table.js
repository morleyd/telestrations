// The waiting screen's table (see WaitingTable): who sits where, the notebooks
// in front of each player, and where it all goes on the screen.

// Who's at the table and what each of them is doing. players: the game's
// players in seat order (GET /api/games/{id}/players); rows: the progress
// view, one row per story; meId: whoever is looking; onTop: the notebook on
// top of each player's pile last time (player id to story id), which stays
// there while it's still theirs.
//
// Each seat gets the notebooks waiting on that player, the one they're on
// first: their own story while they write its opening word (TakeTurn does that
// before anything else), then the one that has been round the table the fewest
// times. A player who hasn't opened the game yet has no story of their own, so
// a blank page stands in for it. Dropped players have left the table: the
// server skips their turns as stories reach them.
export function seatPlayers(players, rows, meId, onTop = new Map()) {
  const all = players || []
  const stories = rows || []
  const piles = new Map(all.map((p) => [p.id, []]))
  for (const row of stories) {
    piles.get(row.next_user_id)?.push({
      id: row.story_id,
      isDraw: Boolean(row.prev_prompt),
      taken: row.turns_taken || 0,
    })
  }
  const unstarted = notStarted(all, stories)
  return all.flatMap((player) => {
    if (player.dropped) return []
    const papers = piles.get(player.id)
    if (unstarted.has(player.id)) papers.push({ id: `first:${player.id}`, isDraw: false, taken: 0 })
    const top = onTop.get(player.id)
    papers.sort((a, b) => (b.id === top) - (a.id === top) || a.taken - b.taken)
    const status = papers.length ? (papers[0].isDraw ? "drawing" : "writing") : player.finished ? "done" : "waiting"
    return [{
      player,
      papers: papers.map(({ id, isDraw }) => ({ id, isDraw })),
      status,
      isMe: player.id === meId,
      waitingOn: status === "waiting" ? nextFrom(player, all, stories) : null,
    }]
  })
}

// Whose notebook reaches player next: the nearest player before them in the
// rotation holding a story that still has a turn for them. Distances count
// dropped players' seats, since their skips are turns too. Null once nothing
// more is coming.
function nextFrom(player, all, stories) {
  const seat = new Map(all.map((p, i) => [p.id, i]))
  const n = all.length
  const mine = seat.get(player.id)
  // Stories not started yet start at their player, with no turns taken
  const total = stories[0]?.total_turns
  const holders = [
    ...stories.filter((r) => seat.has(r.next_user_id))
      .map((r) => ({ at: seat.get(r.next_user_id), taken: r.turns_taken || 0, total: r.total_turns })),
    ...[...notStarted(all, stories)].map((id) => ({ at: seat.get(id), taken: 0, total })),
  ]
  let best = null
  for (const h of holders) {
    const d = (mine - h.at + n) % n
    if (d === 0 || (h.total != null && h.taken + d >= h.total)) continue
    if (!best || d < best.d) best = { d, player: all[h.at] }
  }
  return best?.player || null
}

// The players still to start their own story. The players and the progress
// are two reads, so a story can show in the progress before the players say
// it exists: it counts as started.
function notStarted(all, stories) {
  const started = new Set(stories.map((r) => r.starter_user_id))
  return new Set(all.filter((p) => !p.dropped && !p.finished && !p.has_story && !started.has(p.id)).map((p) => p.id))
}

// The most a name and its status take up, high
const NAME_H = 52
// Room kept above and below the round table for a name and its status
const LABEL_H = 64
// How far a name keeps from the table's edge, its ink and shadow included
const CLEAR = 12
// How wide a name and status get at the round table before they're cut short
const LABEL_W = 150
// The avatar sizes a round table tries, roomiest first. The first where
// nothing runs into anything else is the one.
const ROUND_AVATARS = [76, 68, 60, 52]

// The round table, for a wide screen: players sit round an oval table with
// their avatars over its edge, each notebook on the table just touching its
// player and turned to face them, and the name and status out behind them.
// Whoever is looking (seat meIndex) sits at the bottom; stories go round
// clockwise. height is as much as there is room for. With more players it
// gets tighter, with smaller avatars. Null when even that's too crowded (see
// sidesTable).
//
// Whether a size fits depends on where the seats fall as well as how many
// there are, so a game can fit roomier than a smaller one would. It never gets
// to: each game is as tight as the tightest smaller one, and once a game is
// too big for the round table, so is every bigger one.
export function roundTable({ width, height, count, meIndex = 0 }) {
  const fits = (n, avatar) => !crowded(roundAt({ width, height, count: n, meIndex: 0, avatar }))
  let from = 0
  for (let n = 1; n <= count && from < ROUND_AVATARS.length; n++) {
    while (from < ROUND_AVATARS.length && !fits(n, ROUND_AVATARS[from])) from++
  }
  if (from === ROUND_AVATARS.length) return null
  return roundAt({ width, height, count, meIndex, avatar: ROUND_AVATARS[from] })
}

function roundAt({ width, height, count, meIndex, avatar }) {
  const paper = { w: Math.round(avatar * 0.8), h: Math.round(avatar * 1.02) }
  const h = Math.round(Math.min(Math.max(width * 0.62, 440), Math.max(height, 440)))
  const cx = width / 2
  const cy = h / 2
  const rx = Math.max(140, cx - avatar / 2 - LABEL_W - 16)
  const ry = Math.max(110, cy - avatar / 2 - LABEL_H - 12)
  const seats = Array.from({ length: count }, (_, i) => {
    const t = ((90 + ((i - meIndex) * 360) / Math.max(count, 1)) * Math.PI) / 180
    const out = unit(rx * Math.cos(t), ry * Math.sin(t))
    const seat = seatAt(cx + rx * Math.cos(t), cy + ry * Math.sin(t), out, avatar, paper)
    return { ...seat, label: { ...clearOf({ cx, cy, rx, ry }, seat.label), max: LABEL_W } }
  })
  return {
    kind: "round", width, height: h, avatar, paper, seats,
    table: { x: cx - rx, y: cy - ry, w: rx * 2, h: ry * 2 },
  }
}

// A name placed beside or above an avatar on the slope of the oval can reach
// back over the table's edge: move it out until it's clear. A name to the side
// spans NAME_H, one above or below its widest, LABEL_W.
function clearOf({ cx, cy, rx, ry }, label) {
  // Half the oval's width at height y, or its height at x
  const across = (d, r, s) => s * Math.sqrt(Math.max(0, 1 - (d / r) ** 2))
  const nearest = (c, from, to) => Math.min(Math.max(c, from), to)
  if (label.align !== "center") {
    const y = nearest(cy, label.y - NAME_H / 2, label.y + NAME_H / 2)
    const edge = across(y - cy, ry, rx) + CLEAR
    const x = label.align === "left" ? Math.max(label.x, cx + edge) : Math.min(label.x, cx - edge)
    return { ...label, x }
  }
  const x = nearest(cx, label.x - LABEL_W / 2, label.x + LABEL_W / 2)
  const edge = across(x - cx, rx, ry) + CLEAR
  const y = label.shift.y < 0 ? Math.min(label.y, cy - edge) : Math.max(label.y, cy + edge)
  return { ...label, y }
}

// Whether anything at the table runs into anything else, or a name off the
// screen: names, avatars and piles of notebooks, each against the other
// players'.
function crowded({ seats, avatar, paper, width, height }) {
  const boxes = seats.map((s) => ({
    avatar: box(s.x, s.y, avatar / 2 + 2, avatar / 2 + 2),
    label: labelBox(s.label),
    paper: paperBox(s.paper, paper),
  }))
  const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
  const offScreen = (b) => b.left < 0 || b.right > width || b.top < 0 || b.bottom > height
  return boxes.some((a, i) => offScreen(a.label) || boxes.some((b, j) => i !== j && (
    hit(a.label, b.label) || hit(a.label, b.avatar) || hit(a.label, b.paper) ||
    hit(a.avatar, b.avatar) || hit(a.paper, b.paper))))
}

function box(x, y, halfW, halfH) {
  return { left: x - halfW, right: x + halfW, top: y - halfH, bottom: y + halfH }
}

// The room a name and status take at their widest
export function labelBox({ x, y, shift, max }) {
  const left = x + (shift.x / 100) * max
  const top = y + (shift.y / 100) * NAME_H
  return { left, right: left + max, top, bottom: top + NAME_H }
}

// The room a pile of notebooks takes, turned as it is, with its askew sheets
function paperBox({ x, y, rot }, { w, h }) {
  const r = (rot * Math.PI) / 180
  const [c, s] = [Math.abs(Math.cos(r)), Math.abs(Math.sin(r))]
  return box(x + 4, y + 4, (c * w + s * h) / 2 + 6, (s * w + c * h) / 2 + 6)
}

// The table with players down both sides, for a wide screen with too many
// players to fit round the round one. Stories still go round clockwise: across
// the top, down the right side, across the bottom and up the left. Whoever is
// looking sits at the top of the left side, with the player they pass to
// across from them. Rows get closer as the sides get longer.
export function sidesTable({ width, count, meIndex = 0 }) {
  const avatar = 64
  const paper = { w: Math.round(avatar * 0.8), h: Math.round(avatar * 1.02) }
  const labelW = 190
  const left = Math.ceil(count / 2)
  const right = count - left
  const rowH = Math.min(100, Math.max(80, 118 - left * 3))
  const pad = 36
  const tableW = Math.min(560, Math.max(300, width - 2 * (avatar / 2 + 10 + labelW + 8)))
  const x0 = (width - tableW) / 2
  const h = pad * 2 + left * rowH
  // A shorter side sits in the middle of the table's length
  const rowY = (row, rows) => pad + rowH * (row + 0.5 + (left - rows) / 2)
  const seats = Array.from({ length: count }, (_, i) => {
    const k = (i - meIndex + count) % count
    if (k === 0 || k > right) {
      const seat = seatAt(x0, rowY(k === 0 ? 0 : count - k, left), { x: -1, y: 0 }, avatar, paper)
      return { ...seat, label: { ...seat.label, max: Math.min(labelW, seat.label.x - 8) } }
    }
    const seat = seatAt(x0 + tableW, rowY(k - 1, right), { x: 1, y: 0 }, avatar, paper)
    return { ...seat, label: { ...seat.label, max: Math.min(labelW, width - seat.label.x - 8) } }
  })
  return {
    kind: "sides", width, height: h, avatar, paper, seats,
    table: { x: x0, y: pad - 16, w: tableW, h: h - 2 * pad + 32 },
  }
}

// The long table, for a phone: it runs down the right of the screen with
// everyone along its left edge, top to bottom in turn order, and otherwise as
// the round table. It's as narrow as the notebooks allow, so the names get the
// rest, and its rows get closer the more players there are.
export function longTable({ width, count }) {
  const avatar = 56
  const paper = { w: 44, h: 56 }
  const rowH = count <= 6 ? 96 : Math.max(72, 96 - (count - 6) * 3)
  const pad = 28
  const w = Math.min(width, 480)
  const edge = Math.max(176, w - 14 - 132)
  const h = pad * 2 + count * rowH
  const seats = Array.from({ length: count }, (_, i) => {
    const seat = seatAt(edge, pad + rowH * (i + 0.5), { x: -1, y: 0 }, avatar, paper)
    return { ...seat, label: { ...seat.label, max: seat.label.x - 8 } }
  })
  return {
    kind: "long", width: w, height: h, avatar, paper, seats,
    table: { x: edge, y: pad - 14, w: w - 14 - edge, h: h - 2 * pad + 28 },
  }
}

// A seat at (x, y) facing away from out, the way out from the table: the
// notebook goes in front, its bottom edge just touching the avatar, and the
// name behind: beside the avatar for a seat at the side of the table, above or
// below it at the top or bottom.
function seatAt(x, y, out, avatar, paper) {
  const near = avatar / 2 + paper.h / 2 + 1
  const side = Math.abs(out.x) >= 0.6
  const way = Math.sign(side ? out.x : out.y) || 1
  return {
    x, y,
    paper: { x: x - out.x * near, y: y - out.y * near, rot: (Math.atan2(out.y, out.x) * 180) / Math.PI - 90 },
    // The point the name starts from, and how far to move the name by its own
    // size (percentages) so it runs away from the avatar from there
    label: side
      ? { x: x + way * (avatar / 2 + 10), y, shift: { x: way < 0 ? -100 : 0, y: -50 }, align: way < 0 ? "right" : "left" }
      : { x, y: y + way * (avatar / 2 + 6), shift: { x: -50, y: way < 0 ? -100 : 0 }, align: "center" },
  }
}

function unit(x, y) {
  const len = Math.hypot(x, y) || 1
  return { x: x / len, y: y / len }
}

// Where the k-th notebook in a seat's pile lies: the top one (0) as placed,
// the ones under it a little askew and showing at the corner. Past four the
// rest hide under those.
const ASKEW = [0, 7, -6, 4]
export function pileSpot(seat, k) {
  const i = Math.min(k, 3)
  return { x: seat.paper.x + i * 3, y: seat.paper.y + i * 3, rot: seat.paper.rot + ASKEW[i] }
}

// The way a notebook goes from one spot to another (see pileSpot), as the
// spots along it. Turning, it takes the short way round. On the long table one
// going back up (the last player passing to the first) goes up behind the
// players' avatars, out of the way of the notebooks on the table.
export function travel(from, to, layout, fromSeat, toSeat) {
  const end = { ...to, rot: from.rot + turn(to.rot - from.rot) }
  if (layout.kind !== "long" || toSeat >= fromSeat) return [from, end]
  const x = layout.seats[0].x
  return [
    from,
    { x, y: layout.seats[fromSeat].y, rot: from.rot },
    { x, y: layout.seats[toSeat].y, rot: from.rot },
    end,
  ]
}

// An angle in degrees as the shortest turn: -180 to 180
function turn(deg) {
  return ((((deg + 180) % 360) + 360) % 360) - 180
}
