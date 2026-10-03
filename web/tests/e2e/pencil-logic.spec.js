import { test, expect } from '@playwright/test'
import { DRAWN, pencilWork } from '../../src/services/pencil.js'

// When the pencil on a notebook puts each stroke down. No page is opened.
// (That each stroke's stated length matches its path, and the pencil's
// resting place the end of its last stroke, is checked in the browser, in
// waiting-screen.spec.js.)

const times = (stroke) => stroke.keyTimes.split(';').map(Number)

for (const isDraw of [false, true]) {
  test(`${isDraw ? 'a drawing' : 'writing'}: each stroke inks in after the last, all within the drawing part of the loop`, () => {
    const { strokes, motion } = pencilWork(isDraw)
    expect(strokes).toHaveLength(3)
    let end = 0
    for (const stroke of strokes) {
      const [start, from, to, last] = times(stroke)
      expect(start).toBe(0)
      expect(last).toBe(1)
      expect(from).toBeCloseTo(end, 4)
      expect(to).toBeGreaterThan(from)
      end = to
    }
    // The pencil finishes as the drawing part of the loop does, then rests
    expect(end).toBeCloseTo(DRAWN, 4)
    expect(DRAWN).toBeLessThan(1)
    // and its way is the strokes in order
    expect(motion).toBe(strokes.map((s) => s.d).join(' '))
  })
}

test('writing: each line takes as long as its humps', () => {
  const share = pencilWork(false).strokes.map((s) => {
    const [, from, to] = times(s)
    return (to - from) / DRAWN
  })
  // Lines of 12, 10 and 6 humps
  expect(share[0]).toBeCloseTo(12 / 28, 3)
  expect(share[1]).toBeCloseTo(10 / 28, 3)
  expect(share[2]).toBeCloseTo(6 / 28, 3)
})

test('a page for a word and a page for a drawing get different marks', () => {
  expect(pencilWork(false).motion).not.toBe(pencilWork(true).motion)
  expect(pencilWork(false).rest).not.toBe(pencilWork(true).rest)
})
