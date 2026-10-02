// Copyright (2025- ) David C. Morley

// The fill bucket's pixel work, kept free of the DOM so it can be tested on
// small hand-made images. Pixels are RGBA bytes, row by row, as in ImageData.

/**
 * floodRegion finds the connected area around (x, y) whose color is within
 * `tolerance` of the color at (x, y), per channel. The tolerance takes in the
 * soft, partly blended pixels along a line's edge.
 * @param {Uint8ClampedArray} pixels - the whole picture's RGBA bytes
 * @param {number} width - picture width
 * @param {number} height - picture height
 * @param {number} x - where the user tapped
 * @param {number} y - where the user tapped
 * @param {number} tolerance - how far each channel may differ, 0-255
 * @returns {{mask: Uint8Array, box: {x0: number, y0: number, x1: number, y1: number}}}
 *   mask has a 1 for every pixel in the area; box is the area's inclusive bounds
 */
export function floodRegion(pixels, width, height, x, y, tolerance) {
  const s = (y * width + x) * 4
  const [sr, sg, sb] = [pixels[s], pixels[s + 1], pixels[s + 2]]
  const mask = new Uint8Array(width * height)
  const matches = (i) => {
    if (mask[i]) return false
    const j = i * 4
    return Math.abs(pixels[j] - sr) <= tolerance &&
      Math.abs(pixels[j + 1] - sg) <= tolerance &&
      Math.abs(pixels[j + 2] - sb) <= tolerance
  }
  const box = { x0: x, y0: y, x1: x, y1: y }

  // Scanline fill: take a seed, run left to the start of its span, then mark
  // the span rightward, seeding the rows above and below once per run.
  const stack = [x, y]
  while (stack.length) {
    const cy = stack.pop()
    let cx = stack.pop()
    let i = cy * width + cx
    if (!matches(i)) continue
    while (cx > 0 && matches(i - 1)) { cx--; i-- }
    let up = false
    let down = false
    while (cx < width && matches(i)) {
      mask[i] = 1
      if (cx < box.x0) box.x0 = cx
      if (cx > box.x1) box.x1 = cx
      if (cy < box.y0) box.y0 = cy
      if (cy > box.y1) box.y1 = cy
      if (cy > 0) {
        const m = matches(i - width)
        if (m && !up) stack.push(cx, cy - 1)
        up = m
      }
      if (cy < height - 1) {
        const m = matches(i + width)
        if (m && !down) stack.push(cx, cy + 1)
        down = m
      }
      cx++
      i++
    }
  }
  return { mask, box }
}

/**
 * growBox widens a region's bounds by `reach` pixels, kept inside the picture
 * @param {{x0: number, y0: number, x1: number, y1: number}} box - inclusive bounds
 * @param {number} reach - pixels to add on every side
 * @param {number} width - picture width
 * @param {number} height - picture height
 * @returns {{x: number, y: number, w: number, h: number}} the grown area
 */
export function growBox(box, reach, width, height) {
  const x = Math.max(0, box.x0 - reach)
  const y = Math.max(0, box.y0 - reach)
  return { x, y, w: Math.min(width - 1, box.x1 + reach) - x + 1, h: Math.min(height - 1, box.y1 + reach) - y + 1 }
}

/**
 * edgeRing marks the pixels just outside a filled area, up to `reach` steps
 * away, that lie under the top layer's lines. Filling those too tucks the color
 * under the line's soft edge, so no pale halo is left between fill and line.
 * @param {Uint8Array} mask - the area, from floodRegion
 * @param {number} width - picture width
 * @param {number} height - picture height
 * @param {Uint8ClampedArray} ink - the top layer's RGBA bytes over `area`
 * @param {{x: number, y: number, w: number, h: number}} area - from growBox
 * @param {number} reach - how many steps out to go
 * @returns {Uint8Array} one entry per pixel of `area`: the step (1..reach) at
 *   which it joined the ring, or 0
 */
export function edgeRing(mask, width, height, ink, area, reach) {
  const ring = new Uint8Array(area.w * area.h)
  // Whether (gx, gy) was filled, or joined the ring before this step.
  const reached = (gx, gy, step) => {
    if (gx < 0 || gy < 0 || gx >= width || gy >= height) return false
    if (mask[gy * width + gx]) return true
    const lx = gx - area.x
    const ly = gy - area.y
    if (lx < 0 || ly < 0 || lx >= area.w || ly >= area.h) return false
    const r = ring[ly * area.w + lx]
    return r > 0 && r < step
  }
  for (let step = 1; step <= reach; step++) {
    for (let ly = 0; ly < area.h; ly++) {
      for (let lx = 0; lx < area.w; lx++) {
        const li = ly * area.w + lx
        if (ring[li] || ink[li * 4 + 3] === 0) continue
        const gx = area.x + lx
        const gy = area.y + ly
        if (mask[gy * width + gx]) continue
        if (reached(gx - 1, gy, step) || reached(gx + 1, gy, step) ||
          reached(gx, gy - 1, step) || reached(gx, gy + 1, step)) ring[li] = step
      }
    }
  }
  return ring
}

/**
 * paintRegion writes a fill into one layer's pixels over `area`. The area
 * itself turns solid. The ring turns solid too when filling the layer behind
 * the lines (the lines cover it); on the top layer, a ring pixel keeps its line
 * color, now blended over the fill instead of over what was under it.
 * @param {Uint8ClampedArray} layer - the target layer's RGBA bytes over `area`, changed in place
 * @param {Uint8Array} mask - the area, from floodRegion
 * @param {number} width - picture width
 * @param {Uint8Array} ring - from edgeRing
 * @param {{x: number, y: number, w: number, h: number}} area - from growBox
 * @param {number[]} rgb - the fill color
 * @param {boolean} behind - whether `layer` is the layer behind the lines
 */
export function paintRegion(layer, mask, width, ring, area, rgb, behind) {
  const [r, g, b] = rgb
  for (let ly = 0; ly < area.h; ly++) {
    for (let lx = 0; lx < area.w; lx++) {
      const li = ly * area.w + lx
      const o = li * 4
      if (mask[(area.y + ly) * width + area.x + lx] || (ring[li] && behind)) {
        layer[o] = r
        layer[o + 1] = g
        layer[o + 2] = b
        layer[o + 3] = 255
      } else if (ring[li]) {
        const t = layer[o + 3] / 255
        layer[o] = Math.round(layer[o] * t + r * (1 - t))
        layer[o + 1] = Math.round(layer[o + 1] * t + g * (1 - t))
        layer[o + 2] = Math.round(layer[o + 2] * t + b * (1 - t))
        layer[o + 3] = 255
      }
    }
  }
}
