import { test, expect } from '@playwright/test'
import {
  seatPlayers, roundTable, sidesTable, longTable, crowded, labelBox, pileSpot, travel,
} from '../../src/services/table.js'

// The waiting screen's table: who sits where with which notebooks, and where
// it all goes. No page is opened.

const player = (id, extra = {}) => ({ id, username: id, has_story: true, finished: false, dropped: false, ...extra })
// A story waiting on next, with taken turns behind it. Its last turn was a word
// (so it's drawn next) unless it's at the start or word is ''.
const story = (id, next, taken, { word = taken % 2 ? 'a word' : '', total = 6 } = {}) =>
  ({ story_id: id, next_user_id: next, turns_taken: taken, prev_prompt: word, total_turns: total })

test('each player sits in turn order with the notebooks waiting on them, the one they are on first', () => {
  const players = [player('a'), player('b'), player('c')]
  const seats = seatPlayers(players, [
    story('sa', 'b', 1), // a's, for b to draw
    story('sb', 'b', 0), // b's own, still on its opening word
    story('sc', 'c', 2), // c's, for c to guess
  ], 'a')

  expect(seats.map((s) => s.player.id)).toEqual(['a', 'b', 'c'])
  expect(seats.map((s) => s.isMe)).toEqual([true, false, false])
  // A player writes their own opening word before anything else.
  expect(seats[1].papers).toEqual([{ id: 'sb', isDraw: false }, { id: 'sa', isDraw: true }])
  expect(seats.map((s) => s.status)).toEqual(['waiting', 'writing', 'writing'])
})

test('someone looking who isn\'t at the table is nobody\'s seat', () => {
  const seats = seatPlayers([player('a'), player('b')], [story('s1', 'a', 0)], 'spectator')
  expect(seats.map((s) => s.isMe)).toEqual([false, false])
})

test('the notebook a player was on stays on top of their pile', () => {
  const players = [player('a'), player('b')]
  const rows = [story('s1', 'b', 3), story('s2', 'b', 1)]
  const pile = (onTop) => seatPlayers(players, rows, 'a', onTop)[1].papers.map((p) => p.id)
  expect(pile()).toEqual(['s2', 's1'])
  expect(pile(new Map([['b', 's1']]))).toEqual(['s1', 's2'])
  expect(seatPlayers(players, rows, 'a', new Map([['b', 's1']]))[1].status).toBe('drawing')
})

test('a notebook passed on doesn\'t jump the pile it lands on', () => {
  const players = [player('a'), player('b'), player('c')]
  // b is guessing sb; a, who was drawing sa, passes it to b.
  const before = seatPlayers(players, [story('sa', 'a', 1), story('sb', 'b', 2)], 'c')
  const onTop = new Map(before.filter((s) => s.papers.length).map((s) => [s.player.id, s.papers[0].id]))
  const after = seatPlayers(players, [story('sa', 'b', 2), story('sb', 'b', 2)], 'c', onTop)
  expect(after[1].papers.map((p) => p.id)).toEqual(['sb', 'sa'])
  // And the other way round: it was b's that went on top before.
  const later = seatPlayers(players, [story('sa', 'b', 1), story('sb', 'b', 4)], 'c', new Map([['a', 'sa'], ['b', 'sb']]))
  expect(later[1].papers.map((p) => p.id)).toEqual(['sb', 'sa'])
})

test('a player who has not opened the game yet gets a blank page; finished players are done; dropped ones leave', () => {
  const seats = seatPlayers([
    player('a'),
    player('b', { has_story: false }),
    player('c', { finished: true }),
    player('d', { dropped: true, finished: true }),
  ], [story('sa', 'b', 1)], 'a')

  expect(seats.map((s) => s.player.id)).toEqual(['a', 'b', 'c'])
  // a's notebook is waiting on b too, but b will write their own opening word
  // first.
  expect(seats[1].papers).toEqual([{ id: 'first:b', isDraw: false }, { id: 'sa', isDraw: true }])
  expect(seats[1].status).toBe('writing')
  expect(seats[2].status).toBe('done')
  expect(seats[2].papers).toEqual([])

  // Finished without a story of their own (the game ended before they opened
  // it): nothing to write, so no blank page.
  const ended = seatPlayers([player('a'), player('b', { has_story: false, finished: true })], [], 'a')
  expect(ended[1].papers).toEqual([])
  expect(ended[1].status).toBe('done')

  const fresh = seatPlayers([player('a'), player('b', { has_story: false })], [], 'a')
  expect(fresh[1].papers).toEqual([{ id: 'first:b', isDraw: false }])
  expect(fresh[1].status).toBe('writing')

  // The players were read before b's story existed, the progress after: the
  // story is there, so no blank page as well.
  const between = seatPlayers([player('a'), player('b', { has_story: false })],
    [{ ...story('sb', 'b', 0), starter_user_id: 'b' }], 'a')
  expect(between[1].papers).toEqual([{ id: 'sb', isDraw: false }])
})

test('notebooks the same number of turns in go in order of their stories, as the turn page takes them', () => {
  const seats = seatPlayers([player('a'), player('b')], [story('s9', 'b', 2), story('s3', 'b', 2), story('s5', 'b', 2)], 'a')
  expect(seats[1].papers.map((p) => p.id)).toEqual(['s3', 's5', 's9'])
})

test('a player\'s opening word goes on top of their pile, even over the one they were on last time', () => {
  // The players said b had a story before the progress showed it, so last
  // time a's notebook was on top. Now b's story is here: b writes that first.
  const players = [player('a'), player('b')]
  const rows = [story('sa', 'b', 1), story('sb', 'b', 0)]
  const seats = seatPlayers(players, rows, 'a', new Map([['b', 'sa']]))
  expect(seats[1].papers.map((p) => p.id)).toEqual(['sb', 'sa'])
  expect(seats[1].status).toBe('writing')
})

test('a waiting player is waiting on whoever has the next notebook coming their way', () => {
  const players = [player('a'), player('b'), player('c'), player('d')]
  // c holds the only notebook, with turns to spare: everyone else waits on c.
  const seats = seatPlayers(players, [story('s1', 'c', 1, { total: 8 })], 'a')
  expect(seats[0].waitingOn?.id).toBe('c')
  expect(seats[1].waitingOn?.id).toBe('c')
  expect(seats[3].waitingOn?.id).toBe('c')

  // The nearest holder before them wins.
  const two = seatPlayers(players, [story('s1', 'c', 1, { total: 8 }), story('s2', 'b', 1, { total: 8 })], 'a')
  expect(two[3].waitingOn?.id).toBe('c')
  expect(two[0].waitingOn?.id).toBe('c')

  // A notebook that ends before it reaches them doesn't count: one turn left
  // means it never leaves c.
  const ending = seatPlayers(players, [story('s1', 'c', 7, { total: 8 })], 'a')
  expect(ending[0].waitingOn).toBeNull()
  expect(ending[3].waitingOn).toBeNull()
  expect(ending[3].status).toBe('waiting')

  // An endless game never runs out.
  const endless = seatPlayers(players, [story('s1', 'c', 70, { total: null })], 'a')
  expect(endless[1].waitingOn?.id).toBe('c')

  // A dropped player's seat still counts: their skip is a turn. b's notebook
  // goes to c (dropped, skipped) then d, using two of its three turns left.
  const skipping = seatPlayers(
    [player('a'), player('b'), player('c', { dropped: true }), player('d')],
    [story('s1', 'b', 5, { total: 8 })], 'a')
  expect(skipping.find((s) => s.player.id === 'd').waitingOn?.id).toBe('b')
  expect(skipping.find((s) => s.player.id === 'a').waitingOn).toBeNull()

  // Someone yet to open the game will start their notebook at their own seat.
  const late = seatPlayers([player('a'), player('b', { has_story: false })], [], 'a')
  expect(late[0].waitingOn?.id).toBe('b')
})

// Whether (x, y) is inside the oval table
const onTable = ({ table }, x, y) => {
  const rx = table.w / 2
  const ry = table.h / 2
  return ((x - table.x - rx) / rx) ** 2 + ((y - table.y - ry) / ry) ** 2
}
// The way a paper turned rot degrees faces: its bottom edge's direction
const down = (rot) => ({ x: -Math.sin((rot * Math.PI) / 180), y: Math.cos((rot * Math.PI) / 180) })

for (const count of [1, 2, 3, 6, 8, 12]) {
  test(`round table for ${count}: avatars over the edge, notebooks on the table facing them, names behind`, () => {
    const layout = roundTable({ width: 1100, height: 700, count, meIndex: count > 2 ? 2 : 0 })
    const me = layout.seats[count > 2 ? 2 : 0]
    // Whoever's looking sits at the bottom, in the middle.
    expect(me.x).toBeCloseTo(layout.width / 2, 5)
    expect(Math.max(...layout.seats.map((s) => s.y))).toBeCloseTo(me.y, 5)
    for (const [i, seat] of layout.seats.entries()) {
      // Half on the table, half off it.
      expect(onTable(layout, seat.x, seat.y), `seat ${i} on the edge`).toBeCloseTo(1, 5)
      // The notebook's on the table, its bottom edge toward the player and
      // just touching the avatar.
      const { x, y, rot } = seat.paper
      expect(onTable(layout, x, y), `notebook ${i} on the table`).toBeLessThan(1)
      const toPlayer = { x: seat.x - x, y: seat.y - y }
      const gap = Math.hypot(toPlayer.x, toPlayer.y) - layout.paper.h / 2 - layout.avatar / 2
      expect(gap, `notebook ${i} touching`).toBeGreaterThanOrEqual(0)
      expect(gap, `notebook ${i} touching`).toBeLessThanOrEqual(2)
      const facing = down(rot)
      const len = Math.hypot(toPlayer.x, toPlayer.y)
      expect(facing.x * toPlayer.x / len + facing.y * toPlayer.y / len, `notebook ${i} facing`).toBeCloseTo(1, 5)
      // The name starts clear of the avatar, away from the table, and on screen.
      const { label } = seat
      expect(onTable(layout, label.x, label.y), `name ${i} off the table`).toBeGreaterThan(1)
      expect(Math.hypot(label.x - seat.x, label.y - seat.y)).toBeGreaterThan(layout.avatar / 2)
      expect(label.x).toBeGreaterThan(150)
      expect(label.x).toBeLessThan(layout.width - 150)
      expect(label.y).toBeGreaterThan(40)
      expect(label.y).toBeLessThan(layout.height - 40)
      // Nor does any of it reach back over the edge: the side of the name
      // nearest the table, all along it, is off the table.
      const near = label.align === 'center'
        ? Array.from({ length: 16 }, (_, k) => ({ x: label.x - 75 + k * 10, y: label.y }))
        : Array.from({ length: 14 }, (_, k) => ({ x: label.x, y: label.y - 26 + k * 4 }))
      for (const p of near) expect(onTable(layout, p.x, p.y), `name ${i} clear of the edge`).toBeGreaterThan(1)
    }
  })
}

test('round table: notebooks go round clockwise, starting to the left of whoever is looking', () => {
  const layout = roundTable({ width: 1100, height: 700, count: 4, meIndex: 1 })
  const [, me, next, opposite] = layout.seats
  expect(next.x).toBeLessThan(me.x)
  expect(opposite.y).toBeLessThan(me.y)
})

test('round table fits a short screen, and never gets too short for the names', () => {
  const tall = roundTable({ width: 1100, height: 2000, count: 6 })
  const short = roundTable({ width: 1100, height: 300, count: 6 })
  expect(tall.height).toBeLessThanOrEqual(1100 * 0.62 + 1)
  expect(short.height).toBe(440)
})

// Whether two boxes overlap
const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
const avatarBox = (seat, size) => ({ left: seat.x - size / 2, right: seat.x + size / 2, top: seat.y - size / 2, bottom: seat.y + size / 2 })

// The room a pile of four notebooks takes, worked out from its sheets'
// corners
function pileBox(seat, { w, h }) {
  const corners = [0, 1, 2, 3].flatMap((k) => {
    const { x, y, rot } = pileSpot(seat, k)
    const r = (rot * Math.PI) / 180
    return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => [
      x + (sx * w / 2) * Math.cos(r) - (sy * h / 2) * Math.sin(r),
      y + (sx * w / 2) * Math.sin(r) + (sy * h / 2) * Math.cos(r),
    ])
  })
  const xs = corners.map(([x]) => x)
  const ys = corners.map(([, y]) => y)
  return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) }
}

// No name runs into another name, another player's avatar or their pile of
// notebooks, and none is off the screen; no avatars or piles overlap
function expectRoom(layout, at) {
  const names = layout.seats.map((s) => labelBox(s.label))
  const piles = layout.seats.map((s) => pileBox(s, layout.paper))
  const avatars = layout.seats.map((s) => avatarBox(s, layout.avatar))
  for (const [i, name] of names.entries()) {
    expect(name.left, `name ${i} on screen ${at}`).toBeGreaterThanOrEqual(0)
    expect(name.right, `name ${i} on screen ${at}`).toBeLessThanOrEqual(layout.width)
    expect(name.top, `name ${i} on screen ${at}`).toBeGreaterThanOrEqual(0)
    expect(name.bottom, `name ${i} on screen ${at}`).toBeLessThanOrEqual(layout.height)
    for (let j = 0; j < layout.seats.length; j++) {
      if (i === j) continue
      expect(hit(name, names[j]), `names ${i} and ${j} apart ${at}`).toBe(false)
      expect(hit(name, avatars[j]), `name ${i} clear of avatar ${j} ${at}`).toBe(false)
      expect(hit(name, piles[j]), `name ${i} clear of pile ${j} ${at}`).toBe(false)
      expect(hit(avatars[i], avatars[j]), `avatars ${i} and ${j} apart ${at}`).toBe(false)
      expect(hit(piles[i], piles[j]), `piles ${i} and ${j} apart ${at}`).toBe(false)
    }
  }
}

// Two players far apart at a table 1000 by 600: a name under each avatar, a
// notebook above it. Each case below moves one thing of the second player's.
function twoSeats() {
  const seat = (x) => ({
    x, y: 300,
    paper: { x, y: 240, rot: 0 },
    label: { x, y: 330, shift: { x: -50, y: 0 }, align: 'center', max: 100 },
  })
  return { width: 1000, height: 600, avatar: 50, paper: { w: 40, h: 50 }, seats: [seat(200), seat(700)] }
}

test('a table is crowded when anything of one player\'s runs into another\'s, or a name is off the screen', () => {
  expect(crowded(twoSeats())).toBe(false)
  const moved = (change) => {
    const layout = twoSeats()
    change(layout.seats[1])
    return crowded(layout)
  }
  // Each runs into exactly one thing of the first player's
  expect(moved((s) => { s.paper = { x: 205, y: 240, rot: 0 } }), 'piles').toBe(true)
  expect(moved((s) => { s.x = 230; s.paper.x = 700 }), 'avatars').toBe(true)
  expect(moved((s) => { s.label = { ...s.label, x: 200, y: 276 } }), 'name on avatar').toBe(true)
  expect(moved((s) => { s.label = { ...s.label, x: 200, y: 200 } }), 'name on pile').toBe(true)
  expect(moved((s) => { s.label = { ...s.label, x: 200, y: 340 } }), 'names').toBe(true)
  // Off each edge
  expect(moved((s) => { s.label = { ...s.label, x: 960 } }), 'off the right').toBe(true)
  expect(moved((s) => { s.label = { ...s.label, x: 40 } }), 'off the left').toBe(true)
  expect(moved((s) => { s.label = { ...s.label, y: -10 } }), 'off the top').toBe(true)
  expect(moved((s) => { s.label = { ...s.label, y: 560 } }), 'off the bottom').toBe(true)
  // A player's own things may touch: their notebook meets their avatar
  expect(moved((s) => { s.paper = { x: 700, y: 262, rot: 0 } }), 'own pile on own avatar').toBe(false)
})

test('the round table squeezes in more players, then gives way to the table with two sides', () => {
  for (const [width, height] of [[1100, 700], [928, 560], [1400, 900]]) {
    let last = Infinity
    let gaveWay = 0
    for (let count = 2; count <= 30; count++) {
      const layout = roundTable({ width, height, count })
      if (!layout) {
        gaveWay ||= count
        continue
      }
      expect(gaveWay, `round again at ${count} after giving way at ${gaveWay}, ${width}x${height}`).toBe(0)
      // Smaller avatars only as more players need the room
      expect(layout.avatar).toBeLessThanOrEqual(last)
      last = layout.avatar
      expectRoom(layout, `for ${count} at ${width}x${height}`)
    }
    // A handful of players get the roomiest table; a crowd gets two sides.
    expect(roundTable({ width, height, count: 5 }).avatar).toBe(76)
    expect(gaveWay, `${width}x${height}`).toBeGreaterThan(8)
    expect(gaveWay, `${width}x${height}`).toBeLessThanOrEqual(24)
  }
})

test('the table with two sides: stories go round clockwise from whoever is looking, at the top left', () => {
  for (const count of [13, 14, 20, 31]) {
    const me = 5
    const layout = sidesTable({ width: 1148, count, meIndex: me })
    const { table, seats } = layout
    const at = (k) => seats[(me + k) % count]
    const leftSide = seats.filter((s) => s.x === table.x)
    const rightSide = seats.filter((s) => s.x === table.x + table.w)
    expect(leftSide.length + rightSide.length).toBe(count)
    expect(leftSide.length - rightSide.length).toBeGreaterThanOrEqual(0)
    expect(leftSide.length - rightSide.length).toBeLessThanOrEqual(1)
    // Me at the top of the left side, passing across the table to the top of
    // the right side...
    expect(at(0).x).toBe(table.x)
    expect(at(0).y).toBe(Math.min(...leftSide.map((s) => s.y)))
    expect(at(1).x).toBe(table.x + table.w)
    expect(at(1).y).toBe(Math.min(...rightSide.map((s) => s.y)))
    // ...then down the right side, across the bottom, and up the left.
    for (let k = 1; k < rightSide.length; k++) expect(at(k + 1).y).toBeGreaterThan(at(k).y)
    expect(at(rightSide.length + 1).x).toBe(table.x)
    for (let k = rightSide.length + 1; k < count - 1; k++) expect(at(k + 1).y).toBeLessThan(at(k).y)
    for (const seat of seats) {
      // Notebooks on the table, facing their player, just touching
      const left = seat.x === table.x
      expect(seat.paper.rot).toBeCloseTo(left ? 90 : -90, 5)
      expect(Math.abs(seat.paper.x - seat.x) - layout.paper.h / 2 - layout.avatar / 2).toBeCloseTo(1, 5)
      expect(seat.paper.x > table.x && seat.paper.x < table.x + table.w).toBe(true)
      // Names outside, away from the table
      expect(seat.label.align).toBe(left ? 'right' : 'left')
      expect(seat.label.max).toBeGreaterThanOrEqual(150)
    }
    // The table fills the width, in the middle
    expect(table.x + table.w / 2).toBeCloseTo(layout.width / 2, 5)
    expect(table.w).toBeGreaterThanOrEqual(300)
    expectRoom(layout, `for ${count}`)
  }
  // The longer the sides, the closer the rows
  const gap = (n) => {
    const { seats } = sidesTable({ width: 1148, count: n })
    return seats[1].y - seats[0].y || Math.abs(seats[2].y - seats[0].y)
  }
  expect(gap(30)).toBeLessThan(gap(14))
})

test('a notebook passed across the table with two sides slides straight over', () => {
  const layout = sidesTable({ width: 1148, count: 14 })
  const from = pileSpot(layout.seats[0], 0)
  const to = pileSpot(layout.seats[1], 0)
  const way = travel(from, to, layout, 0, 1)
  expect(way).toHaveLength(2)
  expect(Math.abs(way[1].rot - from.rot)).toBe(180)
  // The last player passing to the first is just the next seat up the left.
  expect(travel(pileSpot(layout.seats[13], 0), pileSpot(layout.seats[0], 0), layout, 13, 0)).toHaveLength(2)
})

test('long table rows get closer the more players there are', () => {
  const gap = (count) => {
    const { seats } = longTable({ width: 390, count })
    return seats[1].y - seats[0].y
  }
  expect(gap(4)).toBe(96)
  expect(gap(6)).toBe(96)
  expect(gap(10)).toBeLessThan(96)
  expect(gap(20)).toBe(72)
  expect(gap(40)).toBe(72)
  expectRoom(longTable({ width: 390, count: 20 }), 'for 20 on a phone')
})

test('long table: everyone down its left edge in turn order, notebooks on it facing them, names to the left', () => {
  const layout = longTable({ width: 390, count: 5 })
  const { table, seats } = layout
  expect(layout.width).toBe(390)
  expect(table.x + table.w).toBeLessThanOrEqual(390)
  for (const [i, seat] of seats.entries()) {
    expect(seat.x).toBe(table.x)
    if (i) expect(seat.y).toBeGreaterThan(seats[i - 1].y)
    // On the table, upright for someone sitting to its left, just touching.
    expect(seat.paper.y).toBe(seat.y)
    expect(seat.paper.rot).toBeCloseTo(90, 5)
    expect(seat.paper.x - layout.paper.h / 2 - (seat.x + layout.avatar / 2)).toBeCloseTo(1, 5)
    expect(seat.paper.x + layout.paper.h / 2).toBeLessThan(table.x + table.w)
    // The name ends left of the avatar, and has room.
    expect(seat.label.align).toBe('right')
    expect(seat.label.shift).toEqual({ x: -100, y: -50 })
    expect(seat.label.x).toBeLessThan(seat.x - layout.avatar / 2)
    expect(seat.label.x).toBeGreaterThanOrEqual(130)
  }
  expect(table.y).toBeLessThan(seats[0].y - layout.avatar / 2)
  expect(table.y + table.h).toBeGreaterThan(seats.at(-1).y + layout.avatar / 2)
  // A wide screen gets a table no wider than a phone's.
  expect(longTable({ width: 1100, count: 20 }).width).toBe(480)
})

test('a pile shows the notebooks under the top one a little askew', () => {
  const seat = longTable({ width: 390, count: 2 }).seats[0]
  expect(pileSpot(seat, 0)).toEqual(seat.paper)
  const under = pileSpot(seat, 1)
  expect(under.rot).not.toBe(seat.paper.rot)
  // Past four, the rest hide under them.
  expect(pileSpot(seat, 9)).toEqual(pileSpot(seat, 3))
})

test('a notebook passed down the long table slides straight there; from the last player to the first it goes up behind the avatars', () => {
  const layout = longTable({ width: 390, count: 4 })
  const spot = (i) => pileSpot(layout.seats[i], 0)

  expect(travel(spot(1), spot(2), layout, 1, 2)).toEqual([spot(1), spot(2)])

  const [from, out, up, to] = travel(spot(3), spot(0), layout, 3, 0)
  expect(from).toEqual(spot(3))
  expect(to).toEqual(spot(0))
  // Under the avatar it leaves, up the column of avatars, out under the one
  // it reaches.
  expect(out).toEqual({ x: layout.seats[3].x, y: layout.seats[3].y, rot: spot(3).rot })
  expect(up).toEqual({ x: layout.seats[0].x, y: layout.seats[0].y, rot: spot(3).rot })
})

test('a notebook passed round the round table turns the short way', () => {
  const layout = roundTable({ width: 1100, height: 700, count: 8 })
  const a = { x: 0, y: 0, rot: 170 }
  const b = { x: 10, y: 0, rot: -170 }
  const [, end] = travel(a, b, layout, 0, 1)
  expect(end.rot).toBe(190)
  // The last player passing to the first is just the next seat round.
  expect(travel(pileSpot(layout.seats[7], 0), pileSpot(layout.seats[0], 0), layout, 7, 0)).toHaveLength(2)
})
