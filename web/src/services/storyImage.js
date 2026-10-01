// Stories as images to keep: one tall PNG per story (its title, then each turn
// with who made it), and a zip of every story in a game. Drawn in the browser,
// so any player can save them.
import { zipSync } from 'fflate'
import { ranOutOfTime, turnBanner } from '@/services/story'

const WIDTH = 800
const PAD = 40
const GAP = 32
const MAX_DRAWING_HEIGHT = 620
const FONT = 'Roboto, "Helvetica Neue", Arial, sans-serif'
// Browsers refuse canvases past these (iOS Safari's area limit is the lowest),
// so a very long story is drawn smaller.
const MAX_SIDE = 16000
const MAX_AREA = 16_000_000

const COLORS = {
  background: "#e3eefc",
  title: "#16365c",
  label: "#2c5ea3",
  text: "#1a1a1a",
  card: "#ffffff",
  banner: "#6b4e00",
}

// What each turn was, for its label.
function verb(turn) {
  if (turn.turn_number == 0) return "wrote"
  return turn.drawing ? "drew" : "guessed"
}

function loadImage(url) {
  return new Promise((resolve) => {
    const img = new Image()
    // The files are on the PocketBase origin; without CORS the canvas can't be
    // exported. A drawing that won't load is drawn as a placeholder.
    img.crossOrigin = "anonymous"
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = url
  })
}

// Splits text into lines that fit maxWidth, breaking inside a word only when
// the word alone is too long.
function wrap(ctx, text, maxWidth) {
  const lines = []
  for (const paragraph of String(text).split("\n")) {
    let line = ""
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word
      if (ctx.measureText(next).width <= maxWidth) {
        line = next
        continue
      }
      if (line) lines.push(line)
      line = ""
      for (const ch of word) {
        if (ctx.measureText(line + ch).width > maxWidth && line) {
          lines.push(line)
          line = ""
        }
        line += ch
      }
    }
    lines.push(line)
  }
  return lines
}

// One block per turn: its heading, an optional banner, and either text lines
// or an image, with the height it all takes.
function layout(ctx, turns, images, userMap) {
  const inner = WIDTH - 2 * PAD
  return turns.map((turn, i) => {
    const name = userMap[turn.turn_user_id]?.username || "Someone"
    const block = { heading: `${name} ${verb(turn)}`, banner: turnBanner(turn), height: 0 }
    if (ranOutOfTime(turn)) {
      block.heading = `⏱ ${name} ran out of time`
      block.lines = []
    } else if (turn.drawing) {
      const img = images[i]
      const scale = img ? Math.min(1, inner / img.width, MAX_DRAWING_HEIGHT / img.height) : 1
      block.img = img
      block.imgW = img ? img.width * scale : inner
      block.imgH = img ? img.height * scale : 120
    } else {
      ctx.font = `bold 34px ${FONT}`
      block.lines = wrap(ctx, turn.prompt || "", inner - 48)
    }
    block.height = 36 + (block.banner ? 30 : 0) +
      (block.lines ? (block.lines.length ? block.lines.length * 44 + 40 : 0) : block.imgH + 24)
    return block
  })
}

function roundRect(ctx, x, y, w, h, r) {
  if (!ctx.roundRect) {
    ctx.fillRect(x, y, w, h) // older browsers: square corners
    return
  }
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
  ctx.fill()
}

// A PNG of one story: `turns` as reviewTurns gives them, `userMap` by user id.
export async function storyImage(turns, userMap, { title, subtitle }) {
  const images = await Promise.all(turns.map((t) => (t.drawing && !ranOutOfTime(t) ? loadImage(t.drawing) : null)))
  const measureCanvas = document.createElement("canvas")
  const blocks = layout(measureCanvas.getContext("2d"), turns, images, userMap)
  measureCanvas.width = measureCanvas.height = 0
  const height = PAD + 56 + 32 + GAP + blocks.reduce((sum, b) => sum + b.height + GAP, 0) + PAD

  const scale = Math.min(1, MAX_SIDE / height, Math.sqrt(MAX_AREA / (WIDTH * height)))
  const canvas = document.createElement("canvas")
  canvas.width = Math.floor(WIDTH * scale)
  canvas.height = Math.floor(height * scale)
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("this device ran out of memory for drawing; try one story at a time")
  ctx.scale(scale, scale)
  ctx.textBaseline = "top"

  ctx.fillStyle = COLORS.background
  ctx.fillRect(0, 0, WIDTH, height)
  let y = PAD
  ctx.fillStyle = COLORS.title
  ctx.font = `bold 48px ${FONT}`
  ctx.fillText(title, PAD, y, WIDTH - 2 * PAD)
  y += 56
  ctx.fillStyle = COLORS.label
  ctx.font = `24px ${FONT}`
  ctx.fillText(subtitle, PAD, y, WIDTH - 2 * PAD)
  y += 32 + GAP

  for (const b of blocks) {
    ctx.fillStyle = COLORS.label
    ctx.font = `bold 26px ${FONT}`
    ctx.fillText(b.heading, PAD, y, WIDTH - 2 * PAD)
    y += 36
    if (b.banner) {
      ctx.fillStyle = COLORS.banner
      ctx.font = `italic 22px ${FONT}`
      ctx.fillText(b.banner, PAD, y, WIDTH - 2 * PAD)
      y += 30
    }
    if (b.lines?.length) {
      const boxH = b.lines.length * 44 + 32
      ctx.fillStyle = COLORS.card
      roundRect(ctx, PAD, y, WIDTH - 2 * PAD, boxH, 16)
      ctx.fillStyle = COLORS.text
      ctx.font = `bold 34px ${FONT}`
      b.lines.forEach((line, k) => ctx.fillText(line, PAD + 24, y + 18 + k * 44))
      y += boxH + 8
    } else if (b.lines === undefined) {
      const x = PAD + (WIDTH - 2 * PAD - b.imgW) / 2
      ctx.fillStyle = COLORS.card
      roundRect(ctx, x - 8, y - 8, b.imgW + 16, b.imgH + 16, 12)
      if (b.img) {
        ctx.drawImage(b.img, x, y, b.imgW, b.imgH)
      } else {
        ctx.fillStyle = COLORS.label
        ctx.font = `22px ${FONT}`
        ctx.fillText("(this drawing couldn't be loaded)", x + 24, y + 48)
      }
      y += b.imgH + 24
    }
    y += GAP
  }

  try {
    return await new Promise((resolve, reject) =>
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("couldn't draw the story"))), "image/png"))
  } finally {
    // Free the pixels now: some browsers (iOS Safari) only do it on garbage
    // collection, and cap the total, so a zip of long stories would run out.
    canvas.width = canvas.height = 0
  }
}

// A zip of named files (PNGs, already compressed, so stored as they are).
export async function zipFiles(files) {
  const entries = {}
  for (const [name, blob] of files) {
    entries[name] = [new Uint8Array(await blob.arrayBuffer()), { level: 0 }]
  }
  return new Blob([zipSync(entries)], { type: "application/zip" })
}

// A safe file name part: letters and digits (in any script), dashes between.
export function fileSafe(text) {
  return String(text).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "") || "story"
}

// Saves blob as a file named name.
export function saveFile(blob, name) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
