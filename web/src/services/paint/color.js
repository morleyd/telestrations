// Copyright (2025- ) David C. Morley

// Conversions between "#RRGGBB" strings and [r, g, b] byte triples.

/**
 * hexToRgb splits a "#RRGGBB" color into its channels
 * @param {string} hex - the color, e.g. "#E52B2B"
 * @returns {number[]} [r, g, b], each 0-255
 */
export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/**
 * rgbToHex joins channels into an upper-case "#RRGGBB" color
 * @param {number} r - red, 0-255
 * @param {number} g - green, 0-255
 * @param {number} b - blue, 0-255
 * @returns {string} the color
 */
export function rgbToHex(r, g, b) {
  return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase()
}
