import { test, expect } from '@playwright/test'

// PaintEngine on its own, on tests/e2e/paint-harness.html: every tool on both
// layers, Undo and Redo pixel for pixel, the background, finishing a stroke
// still in progress, the exported PNG, and the undo limits. The tests share one
// page so the last can measure how much of the paint code they ran; it fails if
// any function in the engine, fill, shape or color code never ran.

test.describe.configure({ mode: 'serial' })

const RED = '#E52B2B'
const BLUE = '#2264D8'
const YELLOW = '#F9D423'
const GREEN = '#36A145'
const WHITE = '#FFFFFF'

let page
const errors = []

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage()
  page.on('pageerror', (e) => errors.push(e.message))
  await page.coverage.startJSCoverage({ resetOnNavigation: false })
  await page.goto('/tests/e2e/paint-harness.html')
  await page.waitForFunction(() => window.paintReady)
})

test.afterEach(() => expect(errors, 'errors on the page').toEqual([]))

test.afterAll(async () => {
  await page?.close()
})

test('every tool\'s step undoes to the exact picture before it and redoes to the exact one after, Behind lines off and on', async () => {
  const results = await page.evaluate(({ BLUE }) => {
    const { make, drag, hash, base, tools } = window.paint
    const paths = {
      brush: [{ x: 100, y: 300 }, { x: 500, y: 330 }, { x: 1100, y: 300 }],
      eraser: [{ x: 150, y: 120 }, { x: 650, y: 420 }, { x: 1050, y: 680 }],
      spray: [{ x: 600, y: 400 }, { x: 640, y: 420 }],
      line: [{ x: 50, y: 50 }, { x: 1150, y: 750 }],
      rect: [{ x: 350, y: 250 }, { x: 850, y: 550 }],
      ellipse: [{ x: 350, y: 250 }, { x: 850, y: 550 }],
      triangle: [{ x: 350, y: 250 }, { x: 850, y: 550 }],
      rtri: [{ x: 350, y: 250 }, { x: 850, y: 550 }],
    }
    const cases = []
    for (const tool of [...Object.keys(paths), 'bucket']) {
      for (const behind of [false, true]) {
        for (const shapeStyle of tools.FILLABLE_TOOLS.has(tool) ? ['outline', 'fill'] : ['outline']) cases.push({ tool, behind, shapeStyle })
      }
    }
    const { e, s } = make()
    return cases.map((c) => {
      e.reset()
      base(e, s)
      Object.assign(s, { color: BLUE, size: 2 }, c)
      const before = hash(e)
      if (c.tool === 'bucket') e.fill({ x: 600, y: 400 })
      else drag(e, paths[c.tool])
      const after = hash(e)
      e.undo()
      const undone = hash(e)
      e.redo()
      const redone = hash(e)
      // Round trips don't drift.
      for (let i = 0; i < 3; i++) { e.undo(); e.redo() }
      return { ...c, changed: after !== before, undone: undone === before, redone: redone === after, again: hash(e) === after }
    })
  }, { BLUE })
  expect(results).toHaveLength(26)
  for (const r of results) expect(r, JSON.stringify(r)).toMatchObject({ changed: true, undone: true, redone: true, again: true })
})

test('a new step after Undo clears Redo', async () => {
  const r = await page.evaluate(() => {
    const { make, drag, hash } = window.paint
    const { e, changes } = make()
    drag(e, [{ x: 100, y: 100 }, { x: 300, y: 100 }])
    drag(e, [{ x: 100, y: 200 }, { x: 300, y: 200 }])
    e.undo()
    const canRedoAfterUndo = changes.at(-1).canRedo
    drag(e, [{ x: 100, y: 300 }, { x: 300, y: 300 }])
    const after = hash(e)
    e.redo()
    return { canRedoAfterUndo, canRedo: changes.at(-1).canRedo, redoLeft: e.redoStack.length, redoChangedNothing: hash(e) === after }
  })
  expect(r).toEqual({ canRedoAfterUndo: true, canRedo: false, redoLeft: 0, redoChangedNothing: true })
})

test('paint goes on the top layer, or on the layer behind the lines with Behind lines on', async () => {
  const results = await page.evaluate(() => {
    const { make, drag, opaque } = window.paint
    const { e, s } = make()
    const out = []
    for (const tool of ['brush', 'spray', 'line', 'rect', 'ellipse', 'triangle', 'rtri', 'bucket']) {
      for (const behind of [false, true]) {
        e.reset()
        Object.assign(s, { tool, behind, shapeStyle: 'fill', color: '#2264D8' })
        if (tool === 'bucket') e.fill({ x: 600, y: 400 })
        else drag(e, [{ x: 400, y: 300 }, { x: 800, y: 500 }])
        out.push({ tool, behind, top: opaque(e, 'ink') > 0, behindLayer: opaque(e, 'color') > 0 })
      }
    }
    return out
  })
  for (const r of results) expect(r, JSON.stringify(r)).toEqual({ ...r, top: !r.behind, behindLayer: r.behind })
})

test('the eraser takes off both layers, or with Behind lines on only the color behind the lines', async () => {
  const r = await page.evaluate(() => {
    const { make, drag, at } = window.paint
    const { e, s } = make()
    const covered = () => {
      e.reset()
      Object.assign(s, { tool: 'bucket', behind: true, color: '#E52B2B' })
      e.fill({ x: 10, y: 10 })
      Object.assign(s, { behind: false, color: '#000000' })
      e.fill({ x: 10, y: 10 })
    }
    const erase = (behind) => {
      covered()
      Object.assign(s, { tool: 'eraser', behind, size: 2 })
      drag(e, [{ x: 100, y: 400 }, { x: 1100, y: 400 }])
      return { top: at(e, 'ink', 600, 400)[3], behindLayer: at(e, 'color', 600, 400)[3], untouched: at(e, 'ink', 600, 100)[3] }
    }
    return { off: erase(false), on: erase(true) }
  })
  expect(r.off).toEqual({ top: 0, behindLayer: 0, untouched: 255 })
  expect(r.on).toEqual({ top: 255, behindLayer: 0, untouched: 255 })
})

test('the fill bucket fills up to an outline with no pale ring, leaves the outside, and lands on the right layer', async () => {
  const results = await page.evaluate(() => {
    const { make, drag, shown, hash } = window.paint
    const { e, s } = make()
    const layerHash = (k) => { let h = 0; const d = e.layers[k].ctx.getImageData(0, 0, 1200, 800).data; for (let i = 0; i < d.length; i += 97) h = (h * 31 + d[i]) | 0; return h }
    return [false, true].map((behind) => {
      e.reset()
      Object.assign(s, { tool: 'ellipse', behind: false, shapeStyle: 'outline', size: 1, color: '#000000' })
      drag(e, [{ x: 300, y: 200 }, { x: 900, y: 600 }])
      const ink = layerHash('ink')
      Object.assign(s, { tool: 'bucket', behind, color: '#E52B2B' })
      e.fill({ x: 600, y: 400 })
      e.render()
      // From just inside the outline's left edge to the middle, along the
      // middle row: red or the line's dark edge, never a pale pixel.
      let pale = 0
      for (let x = 301; x <= 600; x++) {
        const [r, g, b] = shown(e, x, 400)
        if (Math.min(r, g, b) > 200) pale++
      }
      const steps = e.undoStack.length
      const h = hash(e)
      e.fill({ x: 600, y: 400 }) // the color already there
      e.fill({ x: -5, y: 10 }) // off the picture
      e.fill({ x: 1200, y: 0 })
      return {
        behind,
        middle: shown(e, 600, 400).join(),
        outside: shown(e, 100, 100).join(),
        pale,
        topLayerUnchanged: layerHash('ink') === ink,
        noStepForSameColorOrOffPicture: e.undoStack.length === steps && hash(e) === h,
      }
    })
  })
  for (const r of results) {
    expect(r.middle, `behind ${r.behind}`).toBe('229,43,43,255')
    expect(r.outside, `behind ${r.behind}`).toBe('255,255,255,255')
    expect(r.pale, `behind ${r.behind}`).toBe(0)
    expect(r.noStepForSameColorOrOffPicture, `behind ${r.behind}`).toBe(true)
  }
  // Behind the lines, the outline itself is left alone.
  expect(results[1].topLayerUnchanged).toBe(true)
  expect(results[0].topLayerUnchanged).toBe(false)
})

test('each size draws a line that wide, and the eraser twice as wide', async () => {
  const r = await page.evaluate(() => {
    const { make, drag, thickness, engine } = window.paint
    const { e, s } = make()
    const line = [{ x: 100, y: 400 }, { x: 600, y: 400 }, { x: 1100, y: 400 }]
    return engine.SIZES.map((width, size) => {
      e.reset()
      Object.assign(s, { tool: 'brush', behind: false, size, color: '#000000' })
      drag(e, line)
      const brush = thickness(e, 'ink', 600)
      e.reset()
      Object.assign(s, { tool: 'bucket' })
      e.fill({ x: 10, y: 10 })
      Object.assign(s, { tool: 'eraser' })
      drag(e, line)
      return { width, brush, eraser: 800 - thickness(e, 'ink', 600) }
    })
  })
  for (const { width, brush, eraser } of r) {
    expect(Math.abs(brush - width), `brush at ${width}px drew ${brush}`).toBeLessThanOrEqual(2)
    expect(Math.abs(eraser - 2 * width), `eraser at ${width}px took ${eraser}`).toBeLessThanOrEqual(2)
  }
})

test('shapes: outlined or filled, Shift for a square or circle, and which way the triangles point', async () => {
  const r = await page.evaluate(() => {
    const { make, drag, at } = window.paint
    const { e, s } = make()
    const a = (x, y) => at(e, 'ink', x, y)[3]
    const shape = (tool, from, to, { shapeStyle = 'outline', shift = false } = {}) => {
      e.reset()
      Object.assign(s, { tool, shapeStyle, behind: false, size: 1, color: '#000000' })
      drag(e, [from, to], { shift })
    }
    const out = {}
    shape('rect', { x: 300, y: 200 }, { x: 700, y: 500 })
    out.rectOutline = { edge: a(300, 350), middle: a(500, 350) }
    shape('rect', { x: 300, y: 200 }, { x: 700, y: 500 }, { shapeStyle: 'fill' })
    out.rectFilled = { middle: a(500, 350), outside: a(250, 350) }
    shape('line', { x: 300, y: 200 }, { x: 700, y: 500 }, { shapeStyle: 'fill' })
    out.lineIgnoresFilled = { onLine: a(500, 350), offLine: a(650, 250) }
    shape('ellipse', { x: 300, y: 200 }, { x: 700, y: 300 })
    out.oval = { bottom: a(500, 300), belowIt: a(500, 600) }
    shape('ellipse', { x: 300, y: 200 }, { x: 700, y: 300 }, { shift: true })
    out.circle = { bottom: a(500, 600) }
    shape('rect', { x: 300, y: 200 }, { x: 700, y: 300 }, { shift: true })
    out.square = { bottomEdge: a(500, 600) }
    shape('triangle', { x: 300, y: 200 }, { x: 700, y: 500 })
    out.pointUp = { tip: a(500, 203), topCorner: a(310, 210), baseCorner: a(300, 500) }
    shape('triangle', { x: 300, y: 500 }, { x: 700, y: 200 })
    out.pointDown = { tip: a(500, 497), baseCorner: a(300, 200) }
    shape('rtri', { x: 300, y: 200 }, { x: 700, y: 500 })
    out.rightTriangle = { squareCorner: a(300, 500), start: a(300, 200), openCorner: a(690, 210) }
    e.reset()
    s.tool = 'rect'
    drag(e, [{ x: 400, y: 400 }, { x: 401, y: 400 }])
    out.tap = { steps: e.undoStack.length, drawn: a(400, 400) }
    return out
  })
  expect(r.rectOutline.edge).toBeGreaterThan(0)
  expect(r.rectOutline.middle).toBe(0)
  expect(r.rectFilled).toEqual({ middle: 255, outside: 0 })
  expect(r.lineIgnoresFilled.onLine).toBeGreaterThan(0)
  expect(r.lineIgnoresFilled.offLine).toBe(0)
  expect(r.oval.bottom).toBeGreaterThan(0)
  expect(r.oval.belowIt).toBe(0)
  expect(r.circle.bottom).toBeGreaterThan(0)
  expect(r.square.bottomEdge).toBeGreaterThan(0)
  expect(r.pointUp.tip).toBeGreaterThan(0)
  expect(r.pointUp.topCorner).toBe(0)
  expect(r.pointUp.baseCorner).toBeGreaterThan(0)
  expect(r.pointDown.tip).toBeGreaterThan(0)
  expect(r.pointDown.baseCorner).toBeGreaterThan(0)
  expect(r.rightTriangle.squareCorner).toBeGreaterThan(0)
  expect(r.rightTriangle.start).toBeGreaterThan(0)
  expect(r.rightTriangle.openCorner).toBe(0)
  expect(r.tap).toEqual({ steps: 0, drawn: 0 })
})

test('the spray can sprays inside its radius, onto the right layer, for as long as it\'s held', async () => {
  const r = await page.evaluate(async () => {
    const { make, opaque, wait, layer } = window.paint
    const { e, s } = make()
    const spray = async (behind) => {
      e.reset()
      Object.assign(s, { tool: 'spray', behind, size: 1, color: '#000000' })
      const p = { x: 600, y: 400 }
      const k = behind ? 'color' : 'ink'
      e.start(p, false)
      const first = opaque(e, k)
      await wait(200)
      const held = opaque(e, k)
      e.end()
      const done = opaque(e, k)
      await wait(100)
      // Every dot within the radius, give or take the dot's own 2px square.
      const radius = e.sprayRadius()
      const d = layer(e, k)
      let outside = 0
      for (let i = 3; i < d.length; i += 4) {
        if (!d[i]) continue
        const x = ((i - 3) / 4) % 1200 + 0.5
        const y = Math.floor((i - 3) / 4 / 1200) + 0.5
        if (Math.hypot(x - p.x, y - p.y) > radius + 2) outside++
      }
      return { first, held, stopped: opaque(e, k) === done, outside, other: opaque(e, behind ? 'ink' : 'color'), steps: e.undoStack.length }
    }
    return { off: await spray(false), on: await spray(true) }
  })
  for (const side of [r.off, r.on]) {
    expect(side.first).toBeGreaterThan(0)
    expect(side.held).toBeGreaterThan(side.first)
    expect(side.stopped).toBe(true)
    expect(side.outside).toBe(0)
    expect(side.other).toBe(0)
    expect(side.steps).toBe(1)
  }
})

test('the background: one step per change, and a color picker preview undoes to where it started', async () => {
  const r = await page.evaluate(({ RED, BLUE, YELLOW, GREEN }) => {
    const { make } = window.paint
    const out = {}
    let { e, changes } = make()
    e.setBackground(RED)
    out.reported = changes.at(-1).bg
    e.undo()
    out.undone = e.bg
    e.redo()
    out.redone = e.bg
    const steps = e.undoStack.length
    e.setBackground(RED)
    out.sameColorAddsNoStep = e.undoStack.length === steps

    // Previewing two colors, then closing the picker on the second: one step, from red.
    e.previewBackground(YELLOW)
    out.previewReported = changes.at(-1).bg
    e.previewBackground(GREEN)
    e.endPreview()
    out.previewSteps = e.undoStack.length - steps
    e.endPreview()
    out.secondEndAddsNoStep = e.undoStack.length - steps === 1
    e.undo()
    out.previewUndone = e.bg

    // The picker opens on the current color and closes unchanged, then Undo,
    // then a new color: Undo must go back to white.
    ;({ e } = make())
    e.setBackground(RED)
    e.previewBackground(RED)
    e.endPreview()
    out.unchangedCloseSteps = e.undoStack.length
    e.undo()
    e.setBackground(BLUE)
    e.undo()
    out.afterUnchangedClose = e.bg

    // A swatch tapped while the picker is open closes it after picking: the
    // swatch's color stays, as one step from where the preview began.
    ;({ e } = make())
    e.previewBackground(YELLOW)
    e.setBackground(GREEN)
    e.endPreview()
    out.swatchWhilePreviewing = { bg: e.bg, steps: e.undoStack.length }
    e.undo()
    out.swatchUndone = e.bg

    // Undoing a background step while a preview shows: the preview's start is
    // gone, so closing the picker records nothing and the undone color shows.
    ;({ e } = make())
    e.setBackground(RED)
    e.previewBackground(YELLOW)
    e.undo()
    e.endPreview()
    out.undoBackgroundMidPreview = { bg: e.bg, steps: e.undoStack.length }

    // Undoing a stroke while a preview shows leaves the background's start alone.
    ;({ e } = make())
    window.paint.drag(e, [{ x: 100, y: 100 }, { x: 300, y: 100 }])
    e.previewBackground(BLUE)
    e.undo()
    e.endPreview()
    out.undoStrokeMidPreview = { bg: e.bg, steps: e.undoStack.length }
    e.undo()
    out.undoStrokeMidPreviewUndone = e.bg

    // Closing a picker that previewed nothing records nothing.
    ;({ e } = make())
    e.endPreview()
    out.noPreview = e.undoStack.length
    return out
  }, { RED, BLUE, YELLOW, GREEN })
  expect(r).toEqual({
    reported: RED, undone: WHITE, redone: RED, sameColorAddsNoStep: true,
    previewReported: YELLOW, previewSteps: 1, secondEndAddsNoStep: true, previewUndone: RED,
    unchangedCloseSteps: 1, afterUnchangedClose: WHITE,
    swatchWhilePreviewing: { bg: GREEN, steps: 1 }, swatchUndone: WHITE,
    undoBackgroundMidPreview: { bg: WHITE, steps: 0 },
    undoStrokeMidPreview: { bg: BLUE, steps: 1 }, undoStrokeMidPreviewUndone: WHITE,
    noPreview: 0,
  })
})

test('blank means nothing drawn: not after Undo or Clear, not a background alone, and not after old steps are dropped', async () => {
  const r = await page.evaluate(() => {
    const { make, drag, engine } = window.paint
    const { e } = make()
    const out = { fresh: e.isBlank() }
    drag(e, [{ x: 100, y: 100 }, { x: 200, y: 100 }])
    out.drawn = e.isBlank()
    e.undo()
    out.undone = e.isBlank()
    e.redo()
    out.redone = e.isBlank()
    e.clear()
    out.cleared = e.isBlank()
    e.undo()
    out.clearUndone = e.isBlank()
    e.reset()
    e.setBackground('#E52B2B')
    out.backgroundOnly = e.isBlank()
    // One stroke, then enough background changes to push it out of the history.
    e.reset()
    drag(e, [{ x: 100, y: 100 }, { x: 200, y: 100 }])
    for (let i = 0; i < engine.MAX_UNDO; i++) e.setBackground(i % 2 ? '#E52B2B' : '#2264D8')
    out.strokeDropped = !e.undoStack.some((step) => step.type === 'pixels')
    out.afterDropping = e.isBlank()
    e.clear()
    out.clearedAfterDropping = e.isBlank()
    return out
  })
  expect(r).toEqual({
    fresh: true, drawn: false, undone: true, redone: false, cleared: true, clearUndone: false,
    backgroundOnly: true, strokeDropped: true, afterDropping: false, clearedAfterDropping: true,
  })
})

test('finish keeps a stroke, a spray or a shape that\'s still being drawn when the turn ends', async () => {
  const r = await page.evaluate(async () => {
    const { make, png, wait, opaque, hash } = window.paint
    const { e, s } = make()
    const out = {}

    // The first stroke, pointer still down: not a step yet, so not counted.
    e.start({ x: 100, y: 100 }, false)
    e.move({ x: 300, y: 100 }, false)
    out.heldBlank = e.isBlank()
    e.finish()
    out.finishedBlank = e.isBlank()
    out.strokeSteps = e.undoStack.length
    out.stroke = (await png(e, [{ x: 200, y: 100 }])).pixels[0].join()

    // A shape mid-drag is only a preview until it's finished.
    s.tool = 'rect'
    e.start({ x: 400, y: 400 }, false)
    e.move({ x: 600, y: 600 }, false)
    out.previewOnly = (await png(e, [{ x: 400, y: 500 }])).pixels[0].join()
    e.finish()
    out.shape = (await png(e, [{ x: 400, y: 500 }])).pixels[0].join()

    // A spray still held stops spraying once finished.
    s.tool = 'spray'
    e.start({ x: 900, y: 300 }, false)
    e.finish()
    const sprayed = opaque(e, 'ink')
    await wait(100)
    out.sprayStopped = opaque(e, 'ink') === sprayed
    out.steps = e.undoStack.length

    // With nothing in progress, finish does nothing.
    const h = hash(e)
    e.finish()
    out.idle = hash(e) === h && e.undoStack.length === out.steps
    return out
  })
  expect(r).toEqual({
    heldBlank: true, finishedBlank: false, strokeSteps: 1, stroke: '0,0,0,255',
    previewOnly: '255,255,255,255', shape: '0,0,0,255',
    sprayStopped: true, steps: 3, idle: true,
  })
})

test('the PNG is 1200 × 800 and shows the picture, without the brush outline or a shape preview', async () => {
  const r = await page.evaluate(async () => {
    const { make, drag, png, shown, frame } = window.paint
    const { e, s } = make()
    e.setBackground('#9EC5FF')
    Object.assign(s, { tool: 'rect', shapeStyle: 'fill', behind: true, color: '#E52B2B' })
    drag(e, [{ x: 400, y: 200 }, { x: 800, y: 600 }])
    Object.assign(s, { tool: 'brush', behind: false, color: '#000000' })
    drag(e, [{ x: 300, y: 400 }, { x: 900, y: 400 }])
    // The brush outline under the mouse, and a rectangle being dragged.
    e.hover({ x: 100, y: 700 }, 2)
    await frame()
    const ring = { x: 105, y: 700 }
    const ringOnScreen = shown(e, ring.x, ring.y).join()
    s.tool = 'rect'
    e.start({ x: 1000, y: 100 }, false)
    e.move({ x: 1100, y: 200 }, false)
    await frame()
    const previewOnScreen = shown(e, 1000, 150).join()
    const out = await png(e, [{ x: 50, y: 50 }, { x: 600, y: 300 }, { x: 600, y: 400 }, ring, { x: 1000, y: 150 }])
    e.end()
    return { ...out, ringOnScreen, previewOnScreen }
  })
  expect(r.type).toBe('image/png')
  expect([r.width, r.height]).toEqual([1200, 800])
  const [background, behindLayer, inkOverIt, ring, preview] = r.pixels.map((p) => p.join())
  expect(background).toBe('158,197,255,255')
  expect(behindLayer).toBe('229,43,43,255')
  expect(inkOverIt).toBe('0,0,0,255')
  expect(r.ringOnScreen).not.toBe(background)
  expect(ring).toBe(background)
  expect(r.previewOnScreen).not.toBe(background)
  expect(preview).toBe(background)
})

test('the eyedropper reads what\'s shown: lines over color over the background', async () => {
  const r = await page.evaluate(() => {
    const { make, drag } = window.paint
    const { e, s } = make()
    Object.assign(s, { tool: 'rect', shapeStyle: 'fill', behind: true, color: '#E52B2B' })
    drag(e, [{ x: 400, y: 200 }, { x: 800, y: 600 }])
    Object.assign(s, { tool: 'brush', behind: false, color: '#2264D8', size: 3 })
    drag(e, [{ x: 300, y: 400 }, { x: 900, y: 400 }])
    return {
      background: e.colorAt({ x: 50, y: 50 }),
      behindLayer: e.colorAt({ x: 600, y: 300 }),
      line: e.colorAt({ x: 600, y: 400 }),
      offThePicture: e.colorAt({ x: -40, y: 9000 }),
    }
  })
  expect(r).toEqual({ background: WHITE, behindLayer: RED, line: BLUE, offThePicture: WHITE })
})

test('an undo step keeps one copy of the area it touched, per layer it touched', async () => {
  const r = await page.evaluate(() => {
    const { make, drag, engine } = window.paint
    const { WIDTH, HEIGHT, entryBytes } = engine
    const { e, s } = make()
    const last = () => e.undoStack.at(-1)
    const out = {}
    drag(e, [{ x: 100, y: 100 }, { x: 300, y: 120 }])
    const stroke = last()
    out.stroke = { layers: stroke.patches.length, bytes: entryBytes(stroke), area: stroke.patches[0].pixels.width * stroke.patches[0].pixels.height * 4 }
    drag(e, [{ x: 0, y: 0 }, { x: 600, y: 400 }, { x: 1199, y: 799 }])
    out.acrossPicture = { bytes: entryBytes(last()), onePicture: WIDTH * HEIGHT * 4 }
    Object.assign(s, { tool: 'eraser', behind: false })
    drag(e, [{ x: 100, y: 100 }, { x: 300, y: 120 }])
    out.eraserLayers = last().patches.length
    e.clear()
    out.clear = { layers: last().patches.length, bytes: entryBytes(last()) }
    const total = e.undoBytes
    for (let i = 0; i < 4; i++) e.undo()
    out.sameBytesAfterUndo = e.undoBytes === total
    for (let i = 0; i < 4; i++) e.redo()
    out.sameBytesAfterRedo = e.undoBytes === total
    out.sumMatches = e.undoBytes === e.undoStack.reduce((n, step) => n + entryBytes(step), 0)

    // Clear on an empty picture adds nothing, and keeps Redo.
    e.reset()
    s.tool = 'brush'
    drag(e, [{ x: 100, y: 100 }, { x: 300, y: 100 }])
    e.undo()
    e.clear()
    out.clearOnBlank = { steps: e.undoStack.length, redo: e.redoStack.length }
    return out
  })
  expect(r.stroke.layers).toBe(1)
  expect(r.stroke.bytes).toBe(r.stroke.area)
  expect(r.acrossPicture.bytes).toBeLessThanOrEqual(r.acrossPicture.onePicture)
  expect(r.eraserLayers).toBe(2)
  expect(r.clear).toEqual({ layers: 2, bytes: 2 * 1200 * 800 * 4 })
  expect(r.sameBytesAfterUndo).toBe(true)
  expect(r.sameBytesAfterRedo).toBe(true)
  expect(r.sumMatches).toBe(true)
  expect(r.clearOnBlank).toEqual({ steps: 0, redo: 1 })
})

test('undo keeps the newest steps: at most its step limit, and fewer when they hold too much', async () => {
  const r = await page.evaluate(() => {
    const { make, drag, opaque, engine } = window.paint
    const { WIDTH, HEIGHT, MAX_UNDO, MAX_UNDO_BYTES } = engine
    const { e, s } = make()
    // Five more short strokes than the limit, each in its own place.
    for (let i = 0; i < MAX_UNDO + 5; i++) {
      const x = 20 + (i % 40) * 28
      const y = 40 + Math.floor(i / 40) * 60
      drag(e, [{ x, y }, { x: x + 10, y }])
    }
    const byCount = { steps: e.undoStack.length, trimmed: e.trimmed }
    while (e.undoStack.length) e.undo()
    byCount.oldestKept = opaque(e, 'ink') > 0
    byCount.blank = e.isBlank()

    // Whole-picture rectangles, each a full layer's worth of pixels.
    e.reset()
    Object.assign(s, { tool: 'rect', shapeStyle: 'fill' })
    for (let i = 0; i < 40; i++) {
      s.color = i % 2 ? '#E52B2B' : '#2264D8'
      drag(e, [{ x: 0, y: 0 }, { x: WIDTH, y: HEIGHT }])
    }
    const bySize = { steps: e.undoStack.length, bytes: e.undoBytes, limit: MAX_UNDO_BYTES, fits: Math.floor(MAX_UNDO_BYTES / (WIDTH * HEIGHT * 4)) }
    return { MAX_UNDO, byCount, bySize }
  })
  expect(r.byCount).toEqual({ steps: r.MAX_UNDO, trimmed: true, oldestKept: true, blank: false })
  expect(r.bySize.bytes).toBeLessThanOrEqual(r.bySize.limit)
  expect(r.bySize.steps).toBe(r.bySize.fits)
})

test('Undo, Redo, Clear and fill wait while a drag is in progress', async () => {
  const r = await page.evaluate(() => {
    const { make, drag, hash } = window.paint
    const { e, s } = make()
    drag(e, [{ x: 100, y: 100 }, { x: 300, y: 100 }])
    e.undo()
    s.tool = 'brush'
    e.start({ x: 100, y: 300 }, false)
    e.move({ x: 300, y: 300 }, false)
    const mid = hash(e)
    e.undo()
    e.redo()
    e.clear()
    s.tool = 'bucket'
    e.fill({ x: 600, y: 600 })
    s.tool = 'brush'
    const untouched = hash(e) === mid && e.undoStack.length === 0 && e.redoStack.length === 1
    e.start({ x: 500, y: 500 }, false) // a second pointer while one is down
    e.end()
    return { untouched, steps: e.undoStack.length }
  })
  expect(r).toEqual({ untouched: true, steps: 1 })
})

test('the brush outline follows the mouse for the brush, eraser and spray can, at each one\'s size', async () => {
  const r = await page.evaluate(async () => {
    const { make, overlay, overlayAt, shown, frame, engine } = window.paint
    const { e, s } = make({ size: 2 })
    const p = { x: 600, y: 400 }
    const ring = (tool) => {
      s.tool = tool
      e.hover(p, 1)
      const radius = tool === 'spray' ? e.sprayRadius() : tool === 'eraser' ? engine.SIZES[2] : engine.SIZES[2] / 2
      return { drawn: overlay(e) > 0, onRing: overlayAt(e, p.x + radius, p.y) > 0, middle: overlayAt(e, p.x, p.y) }
    }
    const out = { brush: ring('brush'), eraser: ring('eraser'), spray: ring('spray') }
    s.tool = 'rect'
    e.hover(p, 1)
    out.rectDrawsNone = overlay(e) === 0
    s.tool = 'brush'
    e.hover(p, 1)
    await frame()
    out.onScreen = shown(e, p.x + engine.SIZES[2] / 2, p.y).join() !== '255,255,255,255'
    e.leave()
    out.leaveClears = overlay(e) === 0 && shown(e, p.x + engine.SIZES[2] / 2, p.y).join() === '255,255,255,255'
    // While dragging, hovering and leaving leave the drag's preview alone.
    s.tool = 'rect'
    e.start({ x: 100, y: 100 }, false)
    e.move({ x: 300, y: 300 }, false)
    const preview = overlay(e)
    e.hover(p, 1)
    e.leave()
    out.dragKeepsPreview = overlay(e) === preview && preview > 0
    e.end()
    return out
  })
  for (const tool of ['brush', 'eraser', 'spray']) expect(r[tool], tool).toEqual({ drawn: true, onRing: true, middle: 0 })
  expect(r.rectDrawsNone).toBe(true)
  expect(r.onScreen).toBe(true)
  expect(r.leaveClears).toBe(true)
  expect(r.dragKeepsPreview).toBe(true)
})

test('Shift reshapes a shape while it\'s dragged, and is ignored otherwise', async () => {
  const r = await page.evaluate(() => {
    const { make, overlayAt, at } = window.paint
    const { e, s } = make()
    e.setShift(true) // nothing being dragged
    s.tool = 'brush'
    e.start({ x: 100, y: 700 }, false)
    e.setShift(true) // a brush stroke has no shape
    e.end()
    s.tool = 'rect'
    e.start({ x: 300, y: 200 }, false)
    e.move({ x: 700, y: 300 }, false)
    const before = overlayAt(e, 500, 600)
    e.setShift(true)
    const square = overlayAt(e, 500, 600)
    e.setShift(false)
    const back = overlayAt(e, 500, 600)
    e.setShift(true)
    e.end()
    return { before, square, back, committed: at(e, 'ink', 500, 600)[3], steps: e.undoStack.length }
  })
  expect(r.before).toBe(0)
  expect(r.square).toBeGreaterThan(0)
  expect(r.back).toBe(0)
  expect(r.committed).toBeGreaterThan(0)
  expect(r.steps).toBe(2)
})

test('reset empties the picture and the history; destroy stops a spray that\'s held', async () => {
  const r = await page.evaluate(async () => {
    const { make, base, opaque, wait } = window.paint
    const { e, s, changes } = make()
    base(e, s)
    e.undo()
    e.reset()
    const afterReset = { top: opaque(e, 'ink'), behind: opaque(e, 'color'), steps: e.undoStack.length, redo: e.redoStack.length, bytes: e.undoBytes, reported: changes.at(-1) }
    s.tool = 'spray'
    e.start({ x: 600, y: 400 }, false)
    e.destroy()
    const sprayed = opaque(e, 'ink')
    await wait(100)
    return { afterReset, stopped: opaque(e, 'ink') === sprayed, active: e.active }
  })
  expect(r.afterReset).toEqual({ top: 0, behind: 0, steps: 0, redo: 0, bytes: 0, reported: { canUndo: false, canRedo: false, bg: WHITE } })
  expect(r.stopped).toBe(true)
  expect(r.active).toBe(null)
})

// Coverage of each paint module across all the tests above. Every function in
// the gated modules must have run; the share of code run is reported.
test('every function in the paint code ran (coverage)', async () => {
  const entries = await page.coverage.stopJSCoverage()
  const gated = ['engine.js', 'fill.js', 'shapes.js', 'color.js']
  const report = []
  const unrun = []
  for (const file of [...gated, 'palette.js', 'tools.js']) {
    const entry = entries.find((en) => new URL(en.url).pathname === `/src/services/paint/${file}`)
    expect(entry, `${file} was loaded`).toBeTruthy()
    const m = measure(entry)
    report.push(`${file}: ${m.percent}% of code ran, ${m.ran}/${m.total} functions`)
    if (gated.includes(file)) unrun.push(...m.unrun.map((name) => `${file}: ${name}`))
  }
  console.log(`Paint code coverage:\n  ${report.join('\n  ')}`)
  test.info().annotations.push({ type: 'paint coverage', description: report.join('; ') })
  expect(unrun, 'functions no test ran').toEqual([])
})

// V8's block coverage for one script: the share of its non-blank characters
// that ran, and which functions never ran. Inner ranges come after the ranges
// that contain them once sorted, so painting them in order leaves each
// character with its innermost count.
function measure({ source, functions }) {
  const counts = new Int32Array(source.length).fill(-1)
  const ranges = functions.flatMap((f) => f.ranges).sort((a, b) => a.startOffset - b.startOffset || b.endOffset - a.endOffset)
  for (const r of ranges) counts.fill(r.count, r.startOffset, r.endOffset)
  let code = 0
  let ran = 0
  for (let i = 0; i < source.length; i++) {
    if (counts[i] < 0 || /\s/.test(source[i])) continue
    code++
    if (counts[i] > 0) ran++
  }
  const line = (offset) => source.slice(0, offset).split('\n').length
  // Every function but the module itself
  const fns = functions.filter((f) => !(f.ranges[0].startOffset === 0 && f.ranges[0].endOffset >= source.length - 1))
  const unrun = fns.filter((f) => f.ranges[0].count === 0).map((f) => `${f.functionName || 'an unnamed function'} (line ${line(f.ranges[0].startOffset)})`)
  return { percent: Math.round((1000 * ran) / code) / 10, total: fns.length, ran: fns.length - unrun.length, unrun }
}
