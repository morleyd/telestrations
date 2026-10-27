// Readies an uploaded picture so every player's browser can show it.
//
// iPhones take photos as HEIC, which only Safari can decode: saved as is, the
// picture is a broken image for everyone reviewing on Chrome, Firefox or
// Android. So a HEIC upload is converted to a JPEG before it's saved. The
// decoder (libheif, a few MB) is only fetched when a HEIC actually turns up.
//
// The server takes only the types every current browser draws (drawingTypes
// in internal/game/drawings.go), and this refuses the rest before they're
// sent: TIFF and JPEG XL, which only some browsers draw; camera RAW, which
// none do; and SVG, which every browser draws but which can carry script, and
// drawings are served from the game's own address.
//
// A full-size phone photo can run past the server's cap on a drawing
// (turns.drawing's maxSize), and a drawing is only ever shown at 1200x800.
// So a picture over SHRINK_OVER and larger than MAX_SIDE on its long side is
// redrawn as a JPEG that size. Animated pictures (GIF, APNG, animated WebP, AVIF sequences) are
// left alone: redrawn, they'd lose their animation.

const HEIF_BRANDS = new Set(["heic", "heix", "heim", "heis", "hevc", "hevx", "mif1", "msf1"])

const at = (head, offset, magic) => head.startsWith(magic, offset)

const PNG = "\x89PNG\r\n\x1a\n"

// The types the server takes, by their first bytes; AVIF (every current
// browser, Safari since 16.4) is told by its brand, in prepareUpload.
const SIGNATURES = [
  (head) => at(head, 0, "\xff\xd8\xff"), // JPEG
  (head) => at(head, 0, PNG),
  (head) => at(head, 0, "GIF87a") || at(head, 0, "GIF89a"),
  (head) => at(head, 0, "RIFF") && at(head, 8, "WEBP"),
  // "BM", the file's size, then four reserved bytes that are always zero.
  (head) => at(head, 0, "BM") && at(head, 6, "\0\0\0\0"),
]

// A photo is kept to this on its long side: a drawing is 1200x800.
const MAX_SIDE = 1600
// Pictures this size or smaller go up as they are, well under the server's
// cap of 10 MB: a redraw is lossy, and would lose a PNG's transparency and
// sharp edges, so it's kept for the photos that need it to fit.
const SHRINK_OVER = 4 << 20
const JPEG_QUALITY = 0.85

/** UnsupportedPicture is a picture of a type the server refuses. */
export class UnsupportedPicture extends Error {}

/**
 * brandsOf lists the brands of an ISO media file (HEIC, AVIF) from its box
 * "ftyp", major brand first; none if the file doesn't start with one.
 * @param {Uint8Array} head - the file's first bytes
 */
export function brandsOf(head) {
  const text = (from, to) => String.fromCharCode(...head.subarray(from, to))
  if (head.length < 12 || text(4, 8) !== "ftyp") return []
  const size = Math.min(new DataView(head.buffer, head.byteOffset).getUint32(0), head.length)
  const brands = [text(8, 12)]
  for (let i = 16; i + 4 <= size; i += 4) brands.push(text(i, i + 4))
  return brands
}

/** heicToJpeg converts a HEIC to a JPEG blob, fetching the decoder first. */
async function heicToJpeg(file) {
  const { heicTo } = await import("heic-to")
  return heicTo({ blob: file, type: "image/jpeg", quality: 0.85 })
}

/**
 * isApng reports whether a PNG is animated: it has an animation control
 * chunk (acTL), which comes before its image data (IDAT). Only the chunks'
 * headers are read, so a big chunk before them (a color profile) is skipped.
 * @param {Blob} png
 */
async function isApng(png) {
  let offset = PNG.length
  // A still PNG has a handful of chunks before its image data; give up on
  // one that has more.
  for (let i = 0; i < 64 && offset + 8 <= png.size; i++) {
    const header = new Uint8Array(await png.slice(offset, offset + 8).arrayBuffer())
    const type = String.fromCharCode(...header.subarray(4))
    if (type === "acTL") return true
    if (type === "IDAT" || type === "IEND") return false
    offset += 12 + new DataView(header.buffer).getUint32(0) // length, type, data, CRC
  }
  return false
}

/**
 * isAnimated reports whether a picture may move: a GIF, an APNG, a WebP with
 * its animation flag set, or an AVIF sequence.
 * @param {Blob} picture
 * @param {string} text - its first bytes, one character each
 * @param {string[]} brands - its ISO media brands (brandsOf)
 */
async function isAnimated(picture, text, brands) {
  if (at(text, 0, "GIF8")) return true
  if (at(text, 0, PNG)) return isApng(picture)
  if (at(text, 0, "RIFF") && at(text, 8, "WEBPVP8X")) return (text.charCodeAt(20) & 0x02) !== 0
  return brands.includes("avis")
}

/**
 * shrinkPicture redraws a picture larger than MAX_SIDE as a JPEG that size
 * on its long side, on white, so a transparent PNG doesn't come out black;
 * for one within MAX_SIDE already, it gives back null, so it goes up as it
 * is (1600x1600 at 4 bytes a pixel is under the server's cap). The
 * browser turns a photo upright as it decodes it (its EXIF orientation), and
 * a JPEG drawn from a canvas carries none, so it stays upright.
 * @param {Blob} picture
 * @returns {Promise<Blob | null>}
 */
async function shrinkPicture(picture) {
  const url = URL.createObjectURL(picture)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const scale = MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight)
    if (scale >= 1) return null
    const canvas = document.createElement("canvas")
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
    const ctx = canvas.getContext("2d")
    ctx.fillStyle = "#fff"
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    return await new Promise((resolve, reject) => canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error("couldn't encode the picture")),
      "image/jpeg", JPEG_QUALITY))
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** asJpeg is blob as a File named after name, with a .jpg extension. */
const asJpeg = (blob, name) => new File([blob], name.replace(/\.[^.]*$/, "") + ".jpg", { type: "image/jpeg" })

/**
 * prepareUpload gives back a file every browser can draw: a HEIC converted
 * to JPEG (named to match), a type the server takes unchanged. Any other type
 * throws UnsupportedPicture. Types are told by the bytes, not the name or
 * type, which some browsers leave blank. Then a picture over SHRINK_OVER is
 * shrunk to a JPEG (shrinkPicture), unless it's animated, already within
 * MAX_SIDE, or the JPEG would be no smaller; if the browser can't redraw it,
 * it goes up as it is, for the server to judge.
 * @param {File} file
 * @param {(file: File) => Promise<Blob>} [convert] - HEIC to JPEG; tests stub it
 * @param {(picture: File) => Promise<Blob | null>} [shrink] - the redraw; tests stub it
 * @returns {Promise<File>}
 */
export async function prepareUpload(file, convert = heicToJpeg, shrink = shrinkPicture) {
  const head = new Uint8Array(await file.slice(0, 64).arrayBuffer())
  const text = String.fromCharCode(...head)
  const brands = brandsOf(head)
  // AVIF shares HEIC's container, whatever its major brand.
  const avif = brands.includes("avif") || brands.includes("avis")
  let picture = file
  if (!avif && HEIF_BRANDS.has(brands[0])) {
    picture = asJpeg(await convert(file), file.name)
  } else if (!avif && !SIGNATURES.some((matches) => matches(text.slice(0, 16)))) {
    throw new UnsupportedPicture(file.name)
  }
  if (picture.size <= SHRINK_OVER || await isAnimated(picture, text, brands)) return picture
  let shrunk
  try {
    shrunk = await shrink(picture)
  } catch (e) {
    console.warn("couldn't shrink the picture, sending it as it is", e)
    return picture
  }
  return shrunk && shrunk.size < picture.size ? asJpeg(shrunk, picture.name) : picture
}
