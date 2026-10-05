// Readies an uploaded picture so every player's browser can show it.
//
// iPhones take photos as HEIC, which only Safari can decode: saved as is, the
// picture is a broken image for everyone reviewing on Chrome, Firefox or
// Android. So a HEIC upload is converted to a JPEG before it's saved. The
// decoder (libheif, a few MB) is only fetched when a HEIC actually turns up.

const HEIF_BRANDS = new Set(["heic", "heix", "heim", "heis", "hevc", "hevx", "mif1", "msf1"])

// The other types the server takes (DrawingMimeTypes in the drawing-types
// migration), by their first bytes; AVIF is told by its brand, below.
// Anything else is rare from a phone (TIFF, JPEG XL, camera RAW, SVG) and is
// refused before it's uploaded.
const SIGNATURES = [
  [0, "\xff\xd8\xff"], // JPEG
  [0, "\x89PNG"],
  [0, "GIF8"],
  [8, "WEBP"],
  [0, "BM"],
]

/** UnsupportedPicture is a picture of a type the server refuses. */
export class UnsupportedPicture extends Error {}

/**
 * brandsOf lists the brands of an ISO media file (HEIC, AVIF) from its box
 * "ftyp", major brand first; none if the file doesn't start with one.
 * @param {Uint8Array} head - the file's first bytes
 */
function brandsOf(head) {
  const text = (from, to) => String.fromCharCode(...head.subarray(from, to))
  if (head.length < 12 || text(4, 8) !== "ftyp") return []
  const size = Math.min(new DataView(head.buffer).getUint32(0), head.length)
  const brands = [text(8, 12)]
  for (let i = 16; i + 4 <= size; i += 4) brands.push(text(i, i + 4))
  return brands
}

/**
 * prepareUpload gives back a file every browser can draw: a HEIC converted
 * to JPEG (named to match), a common type unchanged. A rare type throws
 * UnsupportedPicture. Types are told by the bytes, not the name or type,
 * which some browsers leave blank.
 * @param {File} file
 * @returns {Promise<File>}
 */
export async function prepareUpload(file) {
  const head = new Uint8Array(await file.slice(0, 64).arrayBuffer())
  const brands = brandsOf(head)
  // AVIF shares HEIC's container, but every browser draws it.
  if (brands.includes("avif") || brands.includes("avis")) return file
  if (!HEIF_BRANDS.has(brands[0])) {
    const text = String.fromCharCode(...head.subarray(0, 16))
    if (SIGNATURES.some(([at, magic]) => text.startsWith(magic, at))) return file
    throw new UnsupportedPicture(file.name)
  }
  const { heicTo } = await import("heic-to")
  const jpeg = await heicTo({ blob: file, type: "image/jpeg", quality: 0.85 })
  const name = file.name.replace(/\.[^.]*$/, "") + ".jpg"
  return new File([jpeg], name, { type: "image/jpeg" })
}
