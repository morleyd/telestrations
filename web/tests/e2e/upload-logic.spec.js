import { test, expect } from '@playwright/test'
import { prepareUpload, UnsupportedPicture, brandsOf } from '../../src/services/uploadImage.js'

// Which uploads go up as they are, which are converted (HEIC, with the
// converter stubbed: the real one runs in upload.spec.js), and which are
// refused before they're sent. No page is opened.

const bytes = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0))
const file = (s, name = 'pic') => new File([bytes(s)], name)
// An ISO media file's "ftyp" box: major brand, minor version, compatible brands.
const ftyp = (major, ...compatible) => {
  const body = 'ftyp' + major + '\0\0\0\0' + compatible.join('')
  const size = body.length + 4
  return String.fromCharCode(size >> 24, (size >> 16) & 255, (size >> 8) & 255, size & 255) + body
}

const STUB_JPEG = new Blob([bytes('\xff\xd8\xff\xe0 converted')])
const stub = () => {
  const calls = []
  return { calls, convert: async (f) => { calls.push(f); return STUB_JPEG } }
}

const kept = {
  'a JPEG': '\xff\xd8\xff\xe0\0\x10JFIF',
  'a PNG': '\x89PNG\r\n\x1a\n\0\0\0\rIHDR',
  'a GIF': 'GIF89a\x01\0\x01\0',
  'an old GIF': 'GIF87a\x01\0\x01\0',
  'a WebP': 'RIFF\x24\0\0\0WEBPVP8 ',
  'a BMP': 'BM\x3a\0\0\0\0\0\0\0\x36\0\0\0',
  'an AVIF': ftyp('avif', 'avif', 'mif1', 'miaf'),
  'an AVIF sequence': ftyp('avis', 'avis', 'msf1'),
  'an AVIF under a mif1 major brand': ftyp('mif1', 'mif1', 'miaf', 'avif'),
}
for (const [kind, head] of Object.entries(kept)) {
  test(`${kind} goes up as it is`, async () => {
    const { calls, convert } = stub()
    const f = file(head)
    expect(await prepareUpload(f, convert)).toBe(f)
    expect(calls).toHaveLength(0)
  })
}

const heics = {
  'a HEIC': ftyp('heic', 'mif1', 'heic'),
  'a HEIF under a mif1 major brand': ftyp('mif1', 'mif1', 'heic', 'miaf'),
  'a HEIC burst': ftyp('hevc', 'msf1', 'hevc'),
}
for (const [kind, head] of Object.entries(heics)) {
  test(`${kind} is converted to a JPEG named to match`, async () => {
    const { calls, convert } = stub()
    const out = await prepareUpload(file(head, 'IMG_0619.HEIC'), convert)
    expect(calls).toHaveLength(1)
    expect(out.name).toBe('IMG_0619.jpg')
    expect(out.type).toBe('image/jpeg')
    expect(bytes(await out.text())).toEqual(bytes(await STUB_JPEG.text()))
  })
}

test('a HEIC with no extension gets one', async () => {
  const out = await prepareUpload(file(ftyp('heic'), 'photo'), stub().convert)
  expect(out.name).toBe('photo.jpg')
})

const refused = {
  'a TIFF': 'II*\0\x08\0\0\0',
  'a big-endian TIFF': 'MM\0*\0\0\0\x08',
  'a camera RAW (DNG)': 'II*\0\x08\0\0\0\x0e\0\xfe\0',
  'an SVG': '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>',
  'a JPEG XL': '\xff\x0a\xfa\x7f',
  'a JPEG XL container': '\0\0\0\x0cJXL \r\n\x87\n',
  'text that starts with BM': 'BMX is a kind of bike',
  'a RIFF that isn\'t WebP (a WAV)': 'RIFF\x24\0\0\0WAVEfmt ',
  'WEBP without RIFF': 'XXXX\x24\0\0\0WEBPVP8 ',
  'an ftyp box cut short': '\0\0\0\x18ftyp',
  'a video (MP4)': ftyp('isom', 'isom', 'mp41'),
  'an empty file': '',
}
for (const [kind, head] of Object.entries(refused)) {
  test(`${kind} is refused`, async () => {
    const { calls, convert } = stub()
    await expect(prepareUpload(file(head), convert)).rejects.toBeInstanceOf(UnsupportedPicture)
    expect(calls).toHaveLength(0)
  })
}

test('brands are read from the whole ftyp box, and no further', () => {
  // A late compatible brand counts...
  expect(brandsOf(bytes(ftyp('mif1', 'miaf', 'MiHE', 'MiPr', 'avif')))).toEqual(['mif1', 'miaf', 'MiHE', 'MiPr', 'avif'])
  // ...but not what follows the box.
  expect(brandsOf(bytes(ftyp('heic', 'mif1') + '\0\0\0\x08avif'))).toEqual(['heic', 'mif1'])
  // A box claiming more than was read stops at what was read.
  expect(brandsOf(bytes('\0\0\x10\0ftypheic\0\0\0\0mif1')).length).toBe(2)
  expect(brandsOf(bytes('\0\0\0'))).toEqual([])
})
