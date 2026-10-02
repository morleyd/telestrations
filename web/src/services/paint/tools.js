// Copyright (2025- ) David C. Morley

// The drawing tools, in toolbox order. `key` is the keyboard shortcut and
// `hint` is the one-line help shown under the canvas.
export const TOOLS = [
  { id: "brush", name: "Brush", key: "b", icon: "mdi-brush", hint: "Drag to draw." },
  { id: "eraser", name: "Eraser", key: "e", icon: "mdi-eraser", hint: "Drag to erase." },
  { id: "bucket", name: "Fill bucket", key: "g", icon: "mdi-format-color-fill", hint: "Tap an area to fill it with the pen color." },
  { id: "eyedropper", name: "Eyedropper", key: "i", icon: "mdi-eyedropper-variant", hint: "Tap the drawing to pick up one of its colors." },
  { id: "spray", name: "Spray can", key: "s", icon: "mdi-spray", hint: "Hold and drag to spray." },
  { id: "line", name: "Line", key: "l", icon: "mdi-vector-line", hint: "Drag to draw a line. Hold Shift to snap to 45°." },
  { id: "rect", name: "Rectangle", key: "r", icon: "mdi-rectangle-outline", hint: "Drag to draw a rectangle. Hold Shift for a square." },
  { id: "ellipse", name: "Oval", key: "o", icon: "mdi-ellipse-outline", hint: "Drag to draw an oval. Hold Shift for a circle." },
  { id: "triangle", name: "Triangle", key: "t", icon: "mdi-triangle-outline", hint: "Drag to draw a triangle." },
  { id: "rtri", name: "Right triangle", key: "", icon: "mdi-set-square", hint: "Drag to draw a right triangle." },
]

export const TOOL_BY_ID = Object.fromEntries(TOOLS.map((t) => [t.id, t]))

// What the tool options box says for tools that have no size or style.
export const OPTION_HINTS = {
  bucket: "Fills the area you tap. If color leaks through a gap, press Undo.",
  eyedropper: "Picks a color from the drawing, then switches back to your last tool.",
}

// Tools drawn by dragging out a shape.
export const SHAPE_TOOLS = new Set(["line", "rect", "ellipse", "triangle", "rtri"])

// Shapes that can be filled instead of outlined.
export const FILLABLE_TOOLS = new Set(["rect", "ellipse", "triangle", "rtri"])

// Tools that show an outline of the brush under the mouse.
export const RING_TOOLS = new Set(["brush", "eraser", "spray"])
