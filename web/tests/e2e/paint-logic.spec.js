import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import { hexToRgb, rgbToHex } from '../../src/services/paint/color.js'
import { SIZES } from '../../src/services/paint/engine.js'
import { edgeRing, floodRegion, growBox, paintRegion } from '../../src/services/paint/fill.js'
import { PALETTE, PALETTE_HEX } from '../../src/services/paint/palette.js'
import { constrain, tracePath } from '../../src/services/paint/shapes.js'
import { FILLABLE_TOOLS, OPTION_HINTS, RING_TOOLS, SHAPE_TOOLS, TOOLS, TOOL_BY_ID } from '../../src/services/paint/tools.js'

// The paint code that needs no browser: the fill bucket's pixel work on small
// hand-made images, shape geometry, colors, the palette and tool lists, and the
// README's list of shortcuts. No page is opened.

const WHITE = [255, 255, 255, 255]
const BLACK = [0, 0, 0, 255]

// A w×h RGBA image, `paint(x, y)` giving each pixel (white by default).
function image(w, h, paint = () => WHITE) {
  const px = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px.set(paint(x, y), (y * w + x) * 4)
  return px
}

// Rows of '#' (black) and '.' (white), as an image.
function drawn(rows) {
  return { px: image(rows[0].length, rows.length, (x, y) => (rows[y][x] === '#' ? BLACK : WHITE)), w: rows[0].length, h: rows.length }
}

// The filled area as rows of '*' and '.', to compare by eye.
function filled(mask, w) {
  const rows = []
  for (let i = 0; i < mask.length; i += w) rows.push(Array.from(mask.slice(i, i + w), (v) => (v ? '*' : '.')).join(''))
  return rows
}

// A black 1-pixel outline of the square (2,2)-(7,7) on white, optionally with a gap.
const outlined = (gapAt) => image(10, 10, (x, y) => {
  const onEdge = (x === 2 || x === 7 || y === 2 || y === 7) && x >= 2 && x <= 7 && y >= 2 && y <= 7
  if (gapAt && x === gapAt[0] && y === gapAt[1]) return WHITE
  return onEdge ? BLACK : WHITE
})

const count = (mask) => mask.reduce((n, v) => n + v, 0)

test.describe('the fill bucket', () => {
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

  test('the tolerance includes a channel exactly that far off, and not one step further, in each channel', () => {
    for (const channel of [0, 1, 2]) {
      const off = (by) => { const c = [...WHITE]; c[channel] -= by; return c }
      const atLimit = image(2, 1, (x) => (x ? off(48) : WHITE))
      const pastIt = image(2, 1, (x) => (x ? off(49) : WHITE))
      expect(Array.from(floodRegion(atLimit, 2, 1, 0, 0, 48).mask), `channel ${channel} at 48`).toEqual([1, 1])
      expect(Array.from(floodRegion(pastIt, 2, 1, 0, 0, 48).mask), `channel ${channel} at 49`).toEqual([1, 0])
    }
  })

  test('a zero tolerance takes only the exact color', () => {
    const px = image(3, 1, (x) => [WHITE, [254, 255, 255, 255], WHITE][x])
    expect(Array.from(floodRegion(px, 3, 1, 0, 0, 0).mask)).toEqual([1, 0, 0])
  })

  test('a fill along the right edge stops there instead of wrapping onto the next row', () => {
    const { px, w, h } = drawn([
      '#..',
      '.##',
    ])
    // From the top row's right end: the two white pixels, and not (0,1), which
    // is the next pixel in memory after (2,0).
    expect(filled(floodRegion(px, w, h, 2, 0, 0).mask, w)).toEqual(['.**', '...'])
    // From the left end of the second row: not (2,0), the pixel before it in memory.
    expect(filled(floodRegion(px, w, h, 0, 1, 0).mask, w)).toEqual(['...', '*..'])
  })

  test('a fill reaches the top and bottom rows and stops at the picture\'s edges', () => {
    const { px, w, h } = drawn([
      '...',
      '###',
      '...',
    ])
    const top = floodRegion(px, w, h, 2, 0, 0)
    expect(filled(top.mask, w)).toEqual(['***', '...', '...'])
    expect(top.box).toEqual({ x0: 0, y0: 0, x1: 2, y1: 0 })
    const bottom = floodRegion(px, w, h, 1, 2, 0)
    expect(filled(bottom.mask, w)).toEqual(['...', '...', '***'])
    expect(bottom.box).toEqual({ x0: 0, y0: 2, x1: 2, y1: 2 })
  })

  test('a fill does not slip between two pixels that only touch at a corner', () => {
    const { px, w, h } = drawn([
      '.#.',
      '#..',
      '...',
    ])
    expect(filled(floodRegion(px, w, h, 0, 0, 0).mask, w)).toEqual(['*..', '...', '...'])
  })

  test('a fill finds every arm of a winding area', () => {
    // A spiral: the scanline fill has to seed rows above and below more than once.
    const { px, w, h } = drawn([
      '.......',
      '.#####.',
      '.#...#.',
      '.#.#.#.',
      '.#.###.',
      '.#.....',
      '#######',
    ])
    const { mask } = floodRegion(px, w, h, 4, 3, 0)
    expect(filled(mask, w)).toEqual([
      '*******',
      '*.....*',
      '*.***.*',
      '*.*.*.*',
      '*.*...*',
      '*.*****',
      '.......',
    ])
  })

  test('the grown box stays inside the picture on every side', () => {
    expect(growBox({ x0: 0, y0: 0, x1: 9, y1: 9 }, 2, 10, 10)).toEqual({ x: 0, y: 0, w: 10, h: 10 })
    expect(growBox({ x0: 4, y0: 4, x1: 5, y1: 5 }, 2, 10, 10)).toEqual({ x: 2, y: 2, w: 6, h: 6 })
    expect(growBox({ x0: 8, y0: 1, x1: 9, y1: 1 }, 3, 10, 10)).toEqual({ x: 5, y: 0, w: 5, h: 5 })
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

  test('the reach stops after its number of steps, even under more ink', () => {
    const mask = Uint8Array.from([1, 0, 0, 0])
    const ink = image(4, 1, (x) => (x ? [0, 0, 0, 255] : [0, 0, 0, 0]))
    const area = { x: 0, y: 0, w: 4, h: 1 }
    expect(Array.from(edgeRing(mask, 4, 1, ink, area, 1))).toEqual([0, 1, 0, 0])
    expect(Array.from(edgeRing(mask, 4, 1, ink, area, 2))).toEqual([0, 1, 2, 0])
  })

  test('ink that doesn\'t touch the filled area stays out of the reach', () => {
    // Ink two pixels from the area, with a gap of no ink between.
    const mask = Uint8Array.from([1, 0, 0])
    const ink = image(3, 1, (x) => (x === 2 ? [0, 0, 0, 255] : [0, 0, 0, 0]))
    expect(Array.from(edgeRing(mask, 3, 1, ink, { x: 0, y: 0, w: 3, h: 1 }, 2))).toEqual([0, 0, 0])
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

  test('a fill leaves pixels outside the area and its reach untouched', () => {
    const before = [10, 20, 30, 40, 50, 60, 70, 80]
    const layer = Uint8ClampedArray.from(before)
    paintRegion(layer, Uint8Array.from([0, 0]), 2, Uint8Array.from([0, 0]), { x: 0, y: 0, w: 2, h: 1 }, [255, 0, 0], false)
    expect(Array.from(layer)).toEqual(before)
  })

  test('a fill writes its area at the right place inside a larger picture', () => {
    // A 4×3 picture whose filled pixel (2,1) sits in a 2×2 area starting at (1,0).
    const mask = new Uint8Array(12)
    mask[1 * 4 + 2] = 1
    const area = { x: 1, y: 0, w: 2, h: 2 }
    const layer = new Uint8ClampedArray(area.w * area.h * 4)
    paintRegion(layer, mask, 4, new Uint8Array(4), area, [9, 8, 7], true)
    // Area pixel (1,1) is picture pixel (2,1).
    expect(Array.from(layer.slice(12, 16))).toEqual([9, 8, 7, 255])
    expect(Array.from(layer.slice(0, 12))).toEqual(new Array(12).fill(0))
  })
})

test.describe('shapes', () => {
  // A stand-in for a canvas context that writes down each call.
  function recorder() {
    const calls = []
    const round = (v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v)
    const ctx = new Proxy({}, { get: (_, name) => (...args) => calls.push([name, ...args.map(round)]) })
    return { calls, ctx }
  }
  const trace = (tool, start, end) => {
    const { calls, ctx } = recorder()
    tracePath(ctx, tool, start, end)
    return calls
  }
  const A = { x: 10, y: 20 }
  const B = { x: 110, y: 70 }

  test('a line runs from where the drag began to where it ends', () => {
    expect(trace('line', A, B)).toEqual([['beginPath'], ['moveTo', 10, 20], ['lineTo', 110, 70]])
  })

  test('a rectangle and an oval fill the box dragged, whichever way it was dragged', () => {
    expect(trace('rect', A, B)).toEqual([['beginPath'], ['rect', 10, 20, 100, 50]])
    expect(trace('rect', B, A)).toEqual([['beginPath'], ['rect', 10, 20, 100, 50]])
    const oval = [['beginPath'], ['ellipse', 60, 45, 50, 25, 0, 0, Math.round(Math.PI * 2 * 1000) / 1000]]
    expect(trace('ellipse', A, B)).toEqual(oval)
    expect(trace('ellipse', { x: 110, y: 20 }, { x: 10, y: 70 })).toEqual(oval)
  })

  test('a triangle\'s tip is on the row where the drag began: point-up dragging down, point-down dragging up', () => {
    expect(trace('triangle', A, B)).toEqual([
      ['beginPath'], ['moveTo', 60, 20], ['lineTo', 110, 70], ['lineTo', 10, 70], ['closePath'],
    ])
    expect(trace('triangle', { x: 10, y: 70 }, { x: 110, y: 20 })).toEqual([
      ['beginPath'], ['moveTo', 60, 70], ['lineTo', 110, 20], ['lineTo', 10, 20], ['closePath'],
    ])
  })

  test('a right triangle has its square corner below where the drag began', () => {
    expect(trace('rtri', A, B)).toEqual([
      ['beginPath'], ['moveTo', 10, 20], ['lineTo', 10, 70], ['lineTo', 110, 70], ['closePath'],
    ])
  })

  test('Shift snaps a line to the nearest 45°, in all eight directions', () => {
    const from = { x: 0, y: 0 }
    for (let k = 0; k < 8; k++) {
      // 10° off each compass direction.
      const angle = (k * Math.PI) / 4 + (10 * Math.PI) / 180
      const end = constrain(from, { x: Math.cos(angle) * 100, y: Math.sin(angle) * 100 }, true, 'line')
      // Compared as directions, since -180° and 180° are the same one.
      expect(end.x / 100, `direction ${k}, x`).toBeCloseTo(Math.cos((k * Math.PI) / 4), 6)
      expect(end.y / 100, `direction ${k}, y`).toBeCloseTo(Math.sin((k * Math.PI) / 4), 6)
      expect(Math.hypot(end.x, end.y), `direction ${k} keeps its length`).toBeCloseTo(100, 6)
    }
  })

  test('Shift makes other shapes as wide as they are tall, toward the drag', () => {
    expect(constrain({ x: 10, y: 10 }, { x: 60, y: 30 }, true, 'rect')).toEqual({ x: 60, y: 60 })
    expect(constrain({ x: 10, y: 10 }, { x: -30, y: 20 }, true, 'ellipse')).toEqual({ x: -30, y: 50 })
    expect(constrain({ x: 10, y: 10 }, { x: 20, y: -50 }, true, 'triangle')).toEqual({ x: 70, y: -50 })
    // No movement at all still gives a point, not NaN.
    expect(constrain({ x: 10, y: 10 }, { x: 10, y: 10 }, true, 'rtri')).toEqual({ x: 10, y: 10 })
  })

  test('without Shift the end point is left as it is', () => {
    const end = { x: 5, y: 9 }
    expect(constrain({ x: 0, y: 0 }, end, false, 'rect')).toBe(end)
    expect(constrain({ x: 0, y: 0 }, end, false, 'line')).toBe(end)
  })
})

test.describe('colors, the palette and the tools', () => {
  test('hex and RGB convert both ways, in upper case with leading zeros', () => {
    expect(hexToRgb('#E52B2B')).toEqual([229, 43, 43])
    expect(hexToRgb('#e52b2b')).toEqual([229, 43, 43])
    expect(hexToRgb('#000000')).toEqual([0, 0, 0])
    expect(rgbToHex(0, 10, 255)).toBe('#000AFF')
    for (const { hex } of PALETTE) expect(rgbToHex(...hexToRgb(hex))).toBe(hex)
  })

  test('the palette has 32 different colors, including black, white, grays, browns and skin tones', () => {
    expect(PALETTE).toHaveLength(32)
    expect(PALETTE_HEX.size).toBe(32)
    for (const { hex, name } of PALETTE) {
      expect(hex).toMatch(/^#[0-9A-F]{6}$/)
      expect(name.length).toBeGreaterThan(0)
    }
    expect(new Set(PALETTE.map((c) => c.name)).size).toBe(32)
    const names = PALETTE.map((c) => c.name)
    expect(names).toEqual(expect.arrayContaining(['Black', 'White', 'Charcoal', 'Light gray', 'Brown', 'Tan']))
    expect(names.filter((n) => n.startsWith('Skin tone'))).toHaveLength(4)
  })

  test('the palette is laid out in columns, each color over its lighter partner', () => {
    const light = (hex) => { const [r, g, b] = hexToRgb(hex); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
    for (let i = 0; i < PALETTE.length; i += 2) {
      expect(light(PALETTE[i].hex), `${PALETTE[i].name} over ${PALETTE[i + 1].name}`).toBeLessThan(light(PALETTE[i + 1].hex))
    }
  })

  test('every tool has a name, an icon and a hint, and its own shortcut', () => {
    const keys = TOOLS.map((t) => t.key).filter(Boolean)
    expect(new Set(keys).size).toBe(keys.length)
    expect(new Set(TOOLS.map((t) => t.id)).size).toBe(TOOLS.length)
    for (const t of TOOLS) {
      expect(TOOL_BY_ID[t.id]).toBe(t)
      expect(t.name.length).toBeGreaterThan(0)
      expect(t.icon).toMatch(/^mdi-/)
      expect(t.hint).toMatch(/\.$/)
      if (t.key) expect(t.key).toMatch(/^[a-z]$/)
    }
    // Keys the drawing box keeps for itself
    expect(keys).not.toContain('h')
  })

  test('the tool groups only name real tools, and agree with each other', () => {
    for (const id of [...SHAPE_TOOLS, ...FILLABLE_TOOLS, ...RING_TOOLS, ...Object.keys(OPTION_HINTS)]) expect(TOOL_BY_ID[id], id).toBeTruthy()
    for (const id of FILLABLE_TOOLS) expect(SHAPE_TOOLS.has(id), `${id} is a shape`).toBe(true)
    expect(FILLABLE_TOOLS.has('line')).toBe(false)
    // Tools with an options hint have no sizes, and no brush outline.
    for (const id of Object.keys(OPTION_HINTS)) {
      expect(SHAPE_TOOLS.has(id) || RING_TOOLS.has(id), id).toBe(false)
    }
  })
})

test.describe('the README', () => {
  test('lists every drawing shortcut there is, and no others', () => {
    const readme = fs.readFileSync(new URL('../../../README.md', import.meta.url), 'utf8')
    const section = readme.split(/^## /m).find((s) => s.startsWith('Drawing'))
    expect(section, 'a Drawing section').toBeTruthy()
    const keysLine = section.slice(section.indexOf('- Keys:'))
    const named = [...keysLine.matchAll(/\*\*([^*]+)\*\*/g)].map((m) => m[1])
    const expected = [
      ...TOOLS.filter((t) => t.key).map((t) => t.key.toUpperCase()),
      'H', '[', ']', '1', String(SIZES.length), 'Shift', 'Ctrl+Z', 'Ctrl+Y', 'Ctrl+Shift+Z',
    ]
    expect(named.sort()).toEqual(expected.sort())
  })
})
