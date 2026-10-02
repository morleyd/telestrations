import { test, expect } from '@playwright/test'
import { edgeRing, floodRegion, growBox, paintRegion } from '../../src/services/paint/fill.js'
import { constrain } from '../../src/services/paint/shapes.js'

// The fill bucket's pixel logic and the shape snapping, on small hand-made
// images. Pure functions: no page, no browser.

const WHITE = [255, 255, 255, 255]
const BLACK = [0, 0, 0, 255]

// A w×h RGBA image of one color, with `paint(x, y)` returning the color to use instead.
function image(w, h, paint = () => WHITE) {
  const px = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px.set(paint(x, y), (y * w + x) * 4)
  return px
}

// A black 1-pixel outline of the square (2,2)-(7,7) on white, optionally with a gap.
const outlined = (gapAt) => image(10, 10, (x, y) => {
  const onEdge = (x === 2 || x === 7 || y === 2 || y === 7) && x >= 2 && x <= 7 && y >= 2 && y <= 7
  if (gapAt && x === gapAt[0] && y === gapAt[1]) return WHITE
  return onEdge ? BLACK : WHITE
})

const count = (mask) => mask.reduce((n, v) => n + v, 0)

test('a fill stays inside a closed outline', () => {
  const { mask, box } = floodRegion(outlined(), 10, 10, 4, 4, 48)
  expect(count(mask)).toBe(16) // the 4×4 inside
  expect(box).toEqual({ x0: 3, y0: 3, x1: 6, y1: 6 })
})

test('a fill leaks out through a gap in the outline', () => {
  const { mask } = floodRegion(outlined([7, 4]), 10, 10, 4, 4, 48)
  expect(count(mask)).toBe(100 - 19) // everything but the 19 outline pixels left
})

test('a fill takes in nearly matching colors, but not ones past the tolerance', () => {
  // Left half near-white (a line's faint edge), right half mid-gray.
  const px = image(6, 1, (x) => (x < 3 ? [240, 240, 240, 255] : [128, 128, 128, 255]))
  px.set(WHITE, 0)
  expect(count(floodRegion(px, 6, 1, 0, 0, 48).mask)).toBe(3)
})

test('the fill reaches under a line only where the top layer has ink', () => {
  // Fill the left half of a 6×1 strip; ink sits at x=3 and x=4 but not x=5.
  const mask = Uint8Array.from([1, 1, 1, 0, 0, 0])
  const ink = image(6, 1, (x) => (x === 3 || x === 4 ? [0, 0, 0, 128] : [0, 0, 0, 0]))
  const area = growBox({ x0: 0, y0: 0, x1: 2, y1: 0 }, 2, 6, 1)
  expect(area).toEqual({ x: 0, y: 0, w: 5, h: 1 })
  const ring = edgeRing(mask, 6, 1, ink, area, 2)
  expect(Array.from(ring)).toEqual([0, 0, 0, 1, 2])
})

test('filling the top layer blends a line\'s soft edge over the fill color', () => {
  const mask = Uint8Array.from([1, 0])
  const ring = Uint8Array.from([0, 1])
  const area = { x: 0, y: 0, w: 2, h: 1 }
  // A half-transparent black pixel at the line's edge.
  const layer = Uint8ClampedArray.from([0, 0, 0, 0, 0, 0, 0, 128])
  paintRegion(layer, mask, 2, ring, area, [255, 0, 0], false)
  expect(Array.from(layer)).toEqual([255, 0, 0, 255, 127, 0, 0, 255])
})

test('filling behind the lines paints the edge solid, since the line covers it', () => {
  const layer = new Uint8ClampedArray(8)
  paintRegion(layer, Uint8Array.from([1, 0]), 2, Uint8Array.from([0, 1]), { x: 0, y: 0, w: 2, h: 1 }, [0, 0, 255], true)
  expect(Array.from(layer)).toEqual([0, 0, 255, 255, 0, 0, 255, 255])
})

test('Shift snaps a line to 45° and makes other shapes square', () => {
  const line = constrain({ x: 0, y: 0 }, { x: 100, y: 90 }, true, 'line')
  expect(line.x).toBeCloseTo(line.y, 6)
  expect(constrain({ x: 10, y: 10 }, { x: 60, y: 30 }, true, 'rect')).toEqual({ x: 60, y: 60 })
  expect(constrain({ x: 10, y: 10 }, { x: -30, y: 20 }, true, 'ellipse')).toEqual({ x: -30, y: 50 })
  expect(constrain({ x: 0, y: 0 }, { x: 5, y: 9 }, false, 'rect')).toEqual({ x: 5, y: 9 })
})
