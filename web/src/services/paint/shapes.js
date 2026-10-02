// Copyright (2025- ) David C. Morley

// Geometry for the shape tools: line, rectangle, oval, triangle, right triangle.

/**
 * constrain applies Shift to a shape being dragged: a line snaps to the nearest
 * 45°, and every other shape becomes as wide as it is tall
 * @param {{x: number, y: number}} start - where the drag began
 * @param {{x: number, y: number}} end - where the pointer is now
 * @param {boolean} shift - whether Shift is held
 * @param {string} tool - the shape tool's id
 * @returns {{x: number, y: number}} the end point to draw to
 */
export function constrain(start, end, shift, tool) {
  if (!shift) return end
  const dx = end.x - start.x
  const dy = end.y - start.y
  if (tool === "line") {
    const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4)
    const length = Math.hypot(dx, dy)
    return { x: start.x + Math.cos(angle) * length, y: start.y + Math.sin(angle) * length }
  }
  const side = Math.max(Math.abs(dx), Math.abs(dy))
  return { x: start.x + Math.sign(dx || 1) * side, y: start.y + Math.sign(dy || 1) * side }
}

/**
 * tracePath adds a shape's outline to a canvas path. The triangle's tip sits on
 * the row where the drag began, so dragging down draws it point-up; the right
 * triangle's square corner is below the start point.
 * @param {CanvasRenderingContext2D} ctx - the context to trace on
 * @param {string} tool - the shape tool's id
 * @param {{x: number, y: number}} start - where the drag began
 * @param {{x: number, y: number}} end - where it ends
 */
export function tracePath(ctx, tool, start, end) {
  const x0 = Math.min(start.x, end.x)
  const y0 = Math.min(start.y, end.y)
  const w = Math.abs(end.x - start.x)
  const h = Math.abs(end.y - start.y)
  ctx.beginPath()
  switch (tool) {
    case "line":
      ctx.moveTo(start.x, start.y)
      ctx.lineTo(end.x, end.y)
      break
    case "rect":
      ctx.rect(x0, y0, w, h)
      break
    case "ellipse":
      ctx.ellipse(x0 + w / 2, y0 + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2)
      break
    case "triangle":
      ctx.moveTo((start.x + end.x) / 2, start.y)
      ctx.lineTo(end.x, end.y)
      ctx.lineTo(start.x, end.y)
      ctx.closePath()
      break
    case "rtri":
      ctx.moveTo(start.x, start.y)
      ctx.lineTo(start.x, end.y)
      ctx.lineTo(end.x, end.y)
      ctx.closePath()
      break
  }
}
