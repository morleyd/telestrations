// Copyright (2025- ) David C. Morley

// The drawing palette. Each pair is a color and its lighter partner, laid out
// dark over light the way MS Paint does, with grays and skin tones included.
const PAIRS = [
  [["#000000", "Black"], ["#FFFFFF", "White"]],
  [["#4D4D4D", "Charcoal"], ["#B3B3B3", "Light gray"]],
  [["#8E1B1B", "Dark red"], ["#F4A7B9", "Pink"]],
  [["#E52B2B", "Red"], ["#FF9B85", "Salmon"]],
  [["#F57C1F", "Orange"], ["#FFC88A", "Peach"]],
  [["#F9D423", "Yellow"], ["#FFF3A3", "Pale yellow"]],
  [["#36A145", "Green"], ["#A9E39B", "Light green"]],
  [["#155C30", "Forest green"], ["#9CC5A1", "Sage"]],
  [["#12929D", "Teal"], ["#9AE4E6", "Aqua"]],
  [["#2264D8", "Blue"], ["#9EC5FF", "Sky blue"]],
  [["#1A2E6E", "Navy"], ["#8F9FE0", "Periwinkle"]],
  [["#7334B3", "Purple"], ["#CBB0F0", "Lavender"]],
  [["#D3358C", "Magenta"], ["#F8B8DA", "Light pink"]],
  [["#6A3C1E", "Brown"], ["#C99A6B", "Tan"]],
  [["#C68642", "Skin tone, medium"], ["#FFDBAC", "Skin tone, light"]],
  [["#8D5524", "Skin tone, deep"], ["#E0AC69", "Skin tone, medium light"]],
]

// In column order (dark, light, dark, light...), which is how the palette grid fills.
export const PALETTE = PAIRS.flat().map(([hex, name]) => ({ hex, name }))

export const PALETTE_HEX = new Set(PALETTE.map((c) => c.hex))
