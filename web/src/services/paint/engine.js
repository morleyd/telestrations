// Copyright (2025- ) David C. Morley

// PaintEngine draws a fixed-size picture in three layers: the background
// color, a layer of color behind the lines, and the top layer. It shows them,
// plus any shape preview or brush outline, on one visible canvas, and keeps an
// undo history that saves the area each action touched.
//
// Points are in picture pixels (WIDTH × HEIGHT); the visible canvas is scaled
// to fit the screen, so the caller converts pointer positions.
import { hexToRgb, rgbToHex } from "./color.js"
import { edgeRing, floodRegion, growBox, paintRegion } from "./fill.js"
import { constrain, tracePath } from "./shapes.js"
import { FILLABLE_TOOLS, RING_TOOLS, SHAPE_TOOLS } from "./tools.js"

export const WIDTH = 1200
export const HEIGHT = 800
// Line widths, in picture pixels, smallest size first. The eraser is twice as wide.
export const SIZES = [4, 10, 18, 28, 44]
// Undo keeps up to this many steps, and drops the oldest sooner if their pixel
// data takes more bytes than this (a Clear holds two whole layers).
export const MAX_UNDO = 80
export const MAX_UNDO_BYTES = 120 * 1024 * 1024
// How far a pixel's color may drift from the tapped one and still be filled.
const FILL_TOLERANCE = 48
// How many pixels a fill reaches under the edge of a line.
const FILL_REACH = 2

export const entryBytes = (entry) =>
  entry.type === "pixels" ? entry.patches.reduce((n, p) => n + p.pixels.data.length, 0) : 0

function makeCanvas(readable = false) {
  const canvas = document.createElement("canvas")
  canvas.width = WIDTH
  canvas.height = HEIGHT
  return { canvas, ctx: canvas.getContext("2d", { willReadFrequently: readable }) }
}

export default class PaintEngine {
  /**
   * @param {HTMLCanvasElement} display - the visible canvas
   * @param {object} options
   * @param {() => {tool: string, color: string, size: number, shapeStyle: string, behind: boolean}} options.settings -
   *   reads the current tool settings; size is an index into SIZES
   * @param {(state: {canUndo: boolean, canRedo: boolean, bg: string}) => void} options.onChange -
   *   called whenever the history or the background color changes
   */
  constructor(display, { settings, onChange }) {
    display.width = WIDTH
    display.height = HEIGHT
    this.display = display.getContext("2d")
    this.settings = settings
    this.onChange = onChange
    // Each layer keeps a copy of itself from before the current action, so the
    // action's undo entry can be cut from it once we know what it touched.
    this.layers = {
      color: { ...makeCanvas(), snap: makeCanvas(true) },
      ink: { ...makeCanvas(), snap: makeCanvas(true) },
    }
    this.overlay = makeCanvas()
    this.scratch = makeCanvas(true)
    this.bg = "#FFFFFF"
    // The background from before the color picker began previewing others,
    // which is what choosing a color undoes back to
    this.previewFrom = null
    this.undoStack = []
    this.redoStack = []
    // Pixels held by both stacks, and whether old steps have been dropped
    this.undoBytes = 0
    this.trimmed = false
    this.pending = null
    this.active = null
    this.frame = 0
    this.render()
  }

  destroy() {
    cancelAnimationFrame(this.frame)
    if (this.active) cancelAnimationFrame(this.active.raf)
    this.active = null
  }

  // ---------- showing the picture ----------

  composite(ctx) {
    ctx.globalCompositeOperation = "source-over"
    ctx.fillStyle = this.bg
    ctx.fillRect(0, 0, WIDTH, HEIGHT)
    ctx.drawImage(this.layers.color.canvas, 0, 0)
    ctx.drawImage(this.layers.ink.canvas, 0, 0)
  }

  render() {
    cancelAnimationFrame(this.frame)
    this.frame = 0
    this.composite(this.display)
    this.display.drawImage(this.overlay.canvas, 0, 0)
  }

  scheduleRender() {
    if (!this.frame) this.frame = requestAnimationFrame(() => this.render())
  }

  clearOverlay() {
    this.overlay.ctx.clearRect(0, 0, WIDTH, HEIGHT)
  }

  // ---------- history ----------

  begin(keys) {
    this.pending = { keys, x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }
    for (const k of keys) {
      const { canvas, snap } = this.layers[k]
      snap.ctx.clearRect(0, 0, WIDTH, HEIGHT)
      snap.ctx.drawImage(canvas, 0, 0)
    }
  }

  touch(x0, y0, x1, y1) {
    const p = this.pending
    if (!p) return
    p.x0 = Math.min(p.x0, x0)
    p.y0 = Math.min(p.y0, y0)
    p.x1 = Math.max(p.x1, x1)
    p.y1 = Math.max(p.y1, y1)
  }

  touchPoint(p, r) {
    this.touch(p.x - r, p.y - r, p.x + r, p.y + r)
  }

  commit() {
    const p = this.pending
    this.pending = null
    if (p) {
      const x = Math.max(0, Math.floor(p.x0))
      const y = Math.max(0, Math.floor(p.y0))
      const w = Math.min(WIDTH, Math.ceil(p.x1)) - x
      const h = Math.min(HEIGHT, Math.ceil(p.y1)) - y
      // A step holds one copy of its area per layer: the pixels Undo puts back.
      // The other side is always on the layer itself (see apply).
      if (w > 0 && h > 0) {
        this.push({
          type: "pixels", x, y,
          patches: p.keys.map((k) => ({ k, pixels: this.layers[k].snap.ctx.getImageData(x, y, w, h) })),
        })
      }
    }
    this.render()
    this.changed()
  }

  push(entry) {
    for (const e of this.redoStack) this.undoBytes -= entryBytes(e)
    this.redoStack.length = 0
    this.undoStack.push(entry)
    this.undoBytes += entryBytes(entry)
    while (this.undoStack.length > 1 && (this.undoStack.length > MAX_UNDO || this.undoBytes > MAX_UNDO_BYTES)) {
      this.undoBytes -= entryBytes(this.undoStack.shift())
      this.trimmed = true
    }
  }

  // A background step keeps both its colors. A pixel step swaps its copy with
  // the layer's pixels: the layer is always in the state on the other side of
  // the step, so what comes off it is exactly what the opposite move needs.
  apply(entry, side) {
    if (entry.type === "bg") {
      // A preview showing now started from a background Undo has just replaced.
      this.previewFrom = null
      this.bg = entry[side]
      return
    }
    for (const patch of entry.patches) {
      const { ctx } = this.layers[patch.k]
      const { width, height } = patch.pixels
      const current = ctx.getImageData(entry.x, entry.y, width, height)
      ctx.putImageData(patch.pixels, entry.x, entry.y)
      patch.pixels = current
    }
  }

  changed() {
    this.onChange({ canUndo: this.undoStack.length > 0, canRedo: this.redoStack.length > 0, bg: this.bg })
  }

  undo() {
    if (this.active) return
    const entry = this.undoStack.pop()
    if (!entry) return
    this.apply(entry, "before")
    this.redoStack.push(entry)
    this.render()
    this.changed()
  }

  redo() {
    if (this.active) return
    const entry = this.redoStack.pop()
    if (!entry) return
    this.apply(entry, "after")
    this.undoStack.push(entry)
    this.render()
    this.changed()
  }

  // Behind lines off: paint on the top layer, and erase everything.
  // Behind lines on: paint and erase only the layer behind the lines.
  paintKeys() {
    return this.settings().behind ? ["color"] : ["ink"]
  }

  eraseKeys() {
    return this.settings().behind ? ["color"] : ["ink", "color"]
  }

  // ---------- whole-picture actions ----------

  /** clear empties both layers as one step that Undo brings back. On a blank picture it does nothing, so Redo survives. */
  clear() {
    if (this.active || this.isBlank()) return
    this.begin(["color", "ink"])
    for (const k of ["color", "ink"]) this.layers[k].ctx.clearRect(0, 0, WIDTH, HEIGHT)
    this.touch(0, 0, WIDTH, HEIGHT)
    this.commit()
  }

  /** reset empties both layers and forgets the history, for a new drawing */
  reset() {
    this.destroy()
    for (const k of ["color", "ink"]) this.layers[k].ctx.clearRect(0, 0, WIDTH, HEIGHT)
    this.clearOverlay()
    this.undoStack = []
    this.redoStack = []
    this.undoBytes = 0
    this.trimmed = false
    this.pending = null
    this.previewFrom = null
    this.render()
    this.changed()
  }

  /**
   * setBackground changes the background color as one undoable step. After a
   * preview, the step goes from the color before the preview began; choosing
   * that same color again records nothing.
   * @param {string} hex - the new color
   */
  setBackground(hex) {
    const before = this.previewFrom ?? this.bg
    this.previewFrom = null
    if (hex !== before) this.push({ type: "bg", before, after: hex })
    this.bg = hex
    this.render()
    this.changed()
  }

  /** previewBackground shows a background color without recording it. setBackground or endPreview ends the preview. */
  previewBackground(hex) {
    if (this.previewFrom === null) this.previewFrom = this.bg
    this.bg = hex
    this.render()
    this.changed()
  }

  /**
   * endPreview keeps the background a preview is showing, as one step. It
   * does nothing when no preview is pending (one never began, or a color
   * chosen meanwhile already ended it).
   */
  endPreview() {
    if (this.previewFrom !== null) this.setBackground(this.bg)
  }

  /** isBlank reports whether nothing is drawn (a background color alone doesn't count) */
  isBlank() {
    // Layers only change through history entries, so with none left (and none
    // dropped for space) they're as empty as they were after the last reset.
    if (!this.trimmed && !this.undoStack.some((e) => e.type === "pixels")) return true
    for (const k of ["ink", "color"]) {
      const data = this.layers[k].ctx.getImageData(0, 0, WIDTH, HEIGHT).data
      for (let i = 3; i < data.length; i += 4) if (data[i]) return false
    }
    return true
  }

  /** toBlob renders the picture, without any preview, as a PNG */
  toBlob() {
    this.composite(this.scratch.ctx)
    return new Promise((resolve, reject) => {
      this.scratch.canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("couldn't save the drawing"))), "image/png")
    })
  }

  /** colorAt returns the visible color at a point, as "#RRGGBB" */
  colorAt(p) {
    const x = Math.max(0, Math.min(WIDTH - 1, Math.floor(p.x)))
    const y = Math.max(0, Math.min(HEIGHT - 1, Math.floor(p.y)))
    this.composite(this.scratch.ctx)
    const [r, g, b] = this.scratch.ctx.getImageData(x, y, 1, 1).data
    return rgbToHex(r, g, b)
  }

  /**
   * fill pours the pen color into the area around a point, judged by what's
   * visible, and reaches a little under the edges of lines (see fill.js)
   */
  fill(p) {
    const x = Math.floor(p.x)
    const y = Math.floor(p.y)
    if (this.active || x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) return
    const { color, behind } = this.settings()
    const rgb = hexToRgb(color)
    this.composite(this.scratch.ctx)
    const pixels = this.scratch.ctx.getImageData(0, 0, WIDTH, HEIGHT).data
    const s = (y * WIDTH + x) * 4
    if (pixels[s] === rgb[0] && pixels[s + 1] === rgb[1] && pixels[s + 2] === rgb[2]) return

    const { mask, box } = floodRegion(pixels, WIDTH, HEIGHT, x, y, FILL_TOLERANCE)
    const area = growBox(box, FILL_REACH, WIDTH, HEIGHT)
    const ink = this.layers.ink.ctx.getImageData(area.x, area.y, area.w, area.h).data
    const ring = edgeRing(mask, WIDTH, HEIGHT, ink, area, FILL_REACH)

    const keys = this.paintKeys()
    this.begin(keys)
    const ctx = this.layers[keys[0]].ctx
    const img = ctx.getImageData(area.x, area.y, area.w, area.h)
    paintRegion(img.data, mask, WIDTH, ring, area, rgb, behind)
    ctx.putImageData(img, area.x, area.y)
    this.touch(area.x, area.y, area.x + area.w, area.y + area.h)
    this.commit()
  }

  // ---------- dragging: brush, eraser, spray can, shapes ----------

  /**
   * start begins a drag with the current tool
   * @param {{x: number, y: number}} p - where it began
   * @param {boolean} shift - whether Shift is held
   */
  start(p, shift) {
    if (this.active) return
    const { tool } = this.settings()
    this.clearOverlay()
    this.active = { tool, start: p, end: p, shift }
    if (tool === "brush" || tool === "eraser") this.strokeStart(p, tool === "eraser")
    else if (tool === "spray") this.sprayStart(p)
    else if (SHAPE_TOOLS.has(tool)) this.previewShape()
    else this.active = null
  }

  move(p, shift) {
    const a = this.active
    if (!a) return
    if (a.tool === "brush" || a.tool === "eraser") this.strokeMove(p)
    else if (a.tool === "spray") a.pos = p
    else {
      a.end = p
      a.shift = shift
      this.previewShape()
    }
  }

  end() {
    const a = this.active
    if (!a) return
    if (a.tool === "brush" || a.tool === "eraser") this.strokeEnd()
    else if (a.tool === "spray") {
      cancelAnimationFrame(a.raf)
      this.commit()
    } else this.commitShape()
    this.active = null
  }

  /**
   * finish completes a drag still in progress, as if the pointer had been let
   * go, so a turn that ends mid-stroke keeps the stroke
   */
  finish() {
    this.end()
  }

  /** setShift updates a shape being dragged when Shift goes down or up */
  setShift(shift) {
    if (!this.active || !SHAPE_TOOLS.has(this.active.tool)) return
    this.active.shift = shift
    this.previewShape()
  }

  /**
   * hover outlines the brush under the mouse
   * @param {{x: number, y: number}} p - the mouse position
   * @param {number} pixel - picture pixels per screen pixel, to keep the outline thin
   */
  hover(p, pixel) {
    if (this.active) return
    this.clearOverlay()
    const { tool, size } = this.settings()
    if (RING_TOOLS.has(tool)) {
      const radius = tool === "spray" ? this.sprayRadius() : tool === "eraser" ? SIZES[size] : SIZES[size] / 2
      const ctx = this.overlay.ctx
      ctx.beginPath()
      ctx.arc(p.x, p.y, Math.max(radius, 2), 0, Math.PI * 2)
      ctx.lineWidth = pixel * 2.5
      ctx.strokeStyle = "rgba(255, 255, 255, 0.9)"
      ctx.stroke()
      ctx.lineWidth = pixel
      ctx.strokeStyle = "rgba(0, 0, 0, 0.85)"
      ctx.stroke()
    }
    this.scheduleRender()
  }

  /** leave removes the brush outline when the mouse leaves the canvas */
  leave() {
    if (this.active) return
    this.clearOverlay()
    this.render()
  }

  withStrokeContexts(draw) {
    const a = this.active
    for (const k of a.keys) {
      const ctx = this.layers[k].ctx
      ctx.save()
      ctx.globalCompositeOperation = a.erase ? "destination-out" : "source-over"
      ctx.strokeStyle = ctx.fillStyle = a.erase ? "#000000" : this.settings().color
      ctx.lineWidth = a.width
      ctx.lineCap = "round"
      ctx.lineJoin = "round"
      draw(ctx)
      ctx.restore()
    }
  }

  strokeStart(p, erase) {
    const { size } = this.settings()
    const keys = erase ? this.eraseKeys() : this.paintKeys()
    Object.assign(this.active, { keys, erase, width: SIZES[size] * (erase ? 2 : 1), prev: p, mid: p })
    this.begin(keys)
    this.withStrokeContexts((ctx) => {
      ctx.beginPath()
      ctx.arc(p.x, p.y, this.active.width / 2, 0, Math.PI * 2)
      ctx.fill()
    })
    this.touchPoint(p, this.active.width / 2 + 2)
    this.scheduleRender()
  }

  // Curves through the midpoints between pointer samples, so fast strokes stay smooth.
  strokeMove(p) {
    const a = this.active
    const prev = a.prev
    if (Math.hypot(p.x - prev.x, p.y - prev.y) < 0.75) return
    const from = a.mid
    const mid = { x: (prev.x + p.x) / 2, y: (prev.y + p.y) / 2 }
    this.withStrokeContexts((ctx) => {
      ctx.beginPath()
      ctx.moveTo(from.x, from.y)
      ctx.quadraticCurveTo(prev.x, prev.y, mid.x, mid.y)
      ctx.stroke()
    })
    const r = a.width / 2 + 2
    this.touchPoint(from, r)
    this.touchPoint(prev, r)
    this.touchPoint(mid, r)
    a.mid = mid
    a.prev = p
    this.scheduleRender()
  }

  strokeEnd() {
    const { mid, prev, width } = this.active
    this.withStrokeContexts((ctx) => {
      ctx.beginPath()
      ctx.moveTo(mid.x, mid.y)
      ctx.lineTo(prev.x, prev.y)
      ctx.stroke()
    })
    this.touchPoint(prev, width / 2 + 2)
    this.commit()
  }

  sprayRadius() {
    return Math.round(SIZES[this.settings().size] * 1.3 + 14)
  }

  // Sprays every frame while held, even when the pointer is still.
  sprayStart(p) {
    const a = this.active
    a.keys = this.paintKeys()
    a.pos = p
    this.begin(a.keys)
    const tick = () => {
      if (this.active !== a) return
      this.sprayBurst()
      a.raf = requestAnimationFrame(tick)
    }
    tick()
  }

  sprayBurst() {
    const a = this.active
    const ctx = this.layers[a.keys[0]].ctx
    const radius = this.sprayRadius()
    const dots = Math.round(8 + radius * 0.5)
    ctx.save()
    ctx.globalCompositeOperation = "source-over"
    ctx.fillStyle = this.settings().color
    for (let i = 0; i < dots; i++) {
      const angle = Math.random() * Math.PI * 2
      const d = radius * Math.sqrt(Math.random())
      ctx.fillRect(a.pos.x + Math.cos(angle) * d - 1, a.pos.y + Math.sin(angle) * d - 1, 2, 2)
    }
    ctx.restore()
    this.touchPoint(a.pos, radius + 3)
    this.render()
  }

  paintShape(ctx, tool, start, end) {
    const { color, size, shapeStyle } = this.settings()
    ctx.save()
    ctx.globalCompositeOperation = "source-over"
    ctx.strokeStyle = ctx.fillStyle = color
    ctx.lineWidth = SIZES[size]
    ctx.lineCap = "round"
    ctx.lineJoin = "round"
    tracePath(ctx, tool, start, end)
    if (shapeStyle === "fill" && FILLABLE_TOOLS.has(tool)) ctx.fill()
    else ctx.stroke()
    ctx.restore()
  }

  // The preview is drawn see-through when it will land behind the lines.
  previewShape() {
    const a = this.active
    this.clearOverlay()
    this.overlay.ctx.globalAlpha = this.settings().behind ? 0.55 : 1
    this.paintShape(this.overlay.ctx, a.tool, a.start, constrain(a.start, a.end, a.shift, a.tool))
    this.overlay.ctx.globalAlpha = 1
    this.scheduleRender()
  }

  commitShape() {
    const a = this.active
    this.clearOverlay()
    const start = a.start
    const end = constrain(start, a.end, a.shift, a.tool)
    if (Math.hypot(end.x - start.x, end.y - start.y) < 2) {
      this.render()
      return
    }
    const keys = this.paintKeys()
    this.begin(keys)
    this.paintShape(this.layers[keys[0]].ctx, a.tool, start, end)
    const pad = SIZES[this.settings().size] / 2 + 3
    this.touch(Math.min(start.x, end.x) - pad, Math.min(start.y, end.y) - pad,
      Math.max(start.x, end.x) + pad, Math.max(start.y, end.y) + pad)
    this.commit()
  }
}
