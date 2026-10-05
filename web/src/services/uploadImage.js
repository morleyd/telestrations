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

const HEIF_BRANDS = new Set(["heic", "heix", "heim", "heis", "hevc", "hevx", "mif1", "msf1"])

const at = (head, offset, magic) => head.startsWith(magic, offset)

// The types the server takes, by their first bytes; AVIF (every current
// browser, Safari since 16.4) is told by its brand, in prepareUpload.
const SIGNATURES = [
  (head) => at(head, 0, "\xff\xd8\xff"), // JPEG
  (head) => at(head, 0, "\x89PNG\r\n\x1a\n"),
  (head) => at(head, 0, "GIF87a") || at(head, 0, "GIF89a"),
  (head) => at(head, 0, "RIFF") && at(head, 8, "WEBP"),
  // "BM", the file's size, then four reserved bytes that are always zero.
  (head) => at(head, 0, "BM") && at(head, 6, "\0\0\0\0"),
]

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
 * prepareUpload gives back a file every browser can draw: a HEIC converted
 * to JPEG (named to match), a type the server takes unchanged. Any other type
 * throws UnsupportedPicture. Types are told by the bytes, not the name or
 * type, which some browsers leave blank.
 * @param {File} file
 * @param {(file: File) => Promise<Blob>} [convert] - HEIC to JPEG; tests stub it
 * @returns {Promise<File>}
 */
export async function prepareUpload(file, convert = heicToJpeg) {
  const head = new Uint8Array(await file.slice(0, 64).arrayBuffer())
  const brands = brandsOf(head)
  // AVIF shares HEIC's container, whatever its major brand.
  if (brands.includes("avif") || brands.includes("avis")) return file
  if (!HEIF_BRANDS.has(brands[0])) {
    const text = String.fromCharCode(...head.subarray(0, 16))
    if (SIGNATURES.some((matches) => matches(text))) return file
    throw new UnsupportedPicture(file.name)
  }
  const jpeg = await convert(file)
  const name = file.name.replace(/\.[^.]*$/, "") + ".jpg"
  return new File([jpeg], name, { type: "image/jpeg" })
}
