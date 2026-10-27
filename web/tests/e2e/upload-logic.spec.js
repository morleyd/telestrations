import { test, expect } from '@playwright/test'
import { prepareUpload, UnsupportedPicture, brandsOf } from '../../src/services/uploadImage.js'

// Which uploads go up as they are, which are converted (HEIC, with the
// converter stubbed: the real one runs in upload.spec.js), which are shrunk
// (stubbed too, as only a page can redraw a picture), and which are refused
// before they're sent. No page is opened.

const bytes = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0))
const file = (s, name = 'pic') => new File([bytes(s)], name)
// An ISO media file's "ftyp" box: major brand, minor version, compatible brands.
const ftyp = (major, ...compatible) => {
  const body = 'ftyp' + major + '\0\0\0\0' + compatible.join('')
  const size = body.length + 4
  return String.fromCharCode(size >> 24, (size >> 16) & 255, (size >> 8) & 255, size & 255) + body
}

// A picture of head and then zeros, size bytes in all.
const big = (head, name = 'pic', size = 3 << 20) => new File([bytes(head), new Uint8Array(size - head.length)], name)

const STUB_JPEG = new Blob([bytes('\xff\xd8\xff\xe0 converted')])
const stub = () => {
  const calls = []
  return { calls, convert: async (f) => { calls.push(f); return STUB_JPEG } }
}
// A stand-in for the redraw, giving a JPEG of `size` bytes.
const shrinker = (size = 1000) => {
  const calls = []
  const shrunk = new Blob([bytes('\xff\xd8\xff\xe0 shrunk'), new Uint8Array(size)])
  return { calls, shrunk, shrink: async (f) => { calls.push(f); return shrunk } }
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
    const { calls: shrunk, shrink } = shrinker()
    const f = file(head)
    expect(await prepareUpload(f, convert, shrink)).toBe(f)
    expect(calls).toHaveLength(0)
    expect(shrunk).toHaveLength(0)
  })
}

const shrunk = {
  'a big JPEG': ['\xff\xd8\xff\xe1\0\x22Exif', 'IMG_0620.JPG'],
  'a big PNG': ['\x89PNG\r\n\x1a\n\0\0\0\rIHDR', 'screenshot.png'],
  'a big still WebP': ['RIFF\x24\0\0\0WEBPVP8X\x0a\0\0\0\x10\0\0\0', 'pic.webp'],
  'a big BMP': ['BM\x3a\0\0\0\0\0\0\0\x36\0\0\0', 'scan.bmp'],
  'a big AVIF': [ftyp('avif', 'avif', 'mif1', 'miaf'), 'pic.avif'],
}
for (const [kind, [head, name]] of Object.entries(shrunk)) {
  test(`${kind} comes out a smaller JPEG named to match`, async () => {
    const { calls, shrunk, shrink } = shrinker()
    const f = big(head, name)
    const out = await prepareUpload(f, stub().convert, shrink)
    expect(calls).toEqual([f])
    expect(out.size).toBe(shrunk.size)
    expect(out.size).toBeLessThan(f.size)
    expect(out.name).toBe(name.replace(/\.\w+$/, '.jpg'))
    expect(out.type).toBe('image/jpeg')
  })
}

const animated = {
  'a big GIF': 'GIF89a\x01\0\x01\0',
  'a big old GIF': 'GIF87a\x01\0\x01\0',
  // VP8X, then its flags: 0x02 is "animated".
  'a big animated WebP': 'RIFF\x24\0\0\0WEBPVP8X\x0a\0\0\0\x12\0\0\0',
  'a big AVIF sequence': ftyp('avis', 'avis', 'msf1'),
}
for (const [kind, head] of Object.entries(animated)) {
  test(`${kind} goes up unchanged, so it still moves`, async () => {
    const { calls, shrink } = shrinker()
    const f = big(head, 'party.gif')
    expect(await prepareUpload(f, stub().convert, shrink)).toBe(f)
    expect(calls).toHaveLength(0)
  })
}

test('a picture of a MB or less is not redrawn', async () => {
  const { calls, shrink } = shrinker()
  const f = big('\xff\xd8\xff\xe0\0\x10JFIF', 'small.jpg', 1 << 20)
  expect(await prepareUpload(f, stub().convert, shrink)).toBe(f)
  expect(calls).toHaveLength(0)
})

test('a redraw that comes out no smaller is dropped', async () => {
  const f = big('\x89PNG\r\n\x1a\n\0\0\0\rIHDR', 'noise.png', 2 << 20)
  expect(await prepareUpload(f, stub().convert, shrinker(2 << 20).shrink)).toBe(f)
})

test('a picture the browser cannot redraw goes up as it is', async () => {
  const f = big('BM\x3a\0\0\0\0\0\0\0\x36\0\0\0', 'odd.bmp')
  const out = await prepareUpload(f, stub().convert, async () => { throw new Error('decode failed') })
  expect(out).toBe(f)
})

test('a big HEIC is converted, then shrunk', async () => {
  const { shrink, calls } = shrinker()
  const convert = async () => new Blob([bytes('\xff\xd8\xff\xe0'), new Uint8Array(3 << 20)])
  const out = await prepareUpload(file(ftyp('heic', 'mif1', 'heic'), 'IMG_0619.HEIC'), convert, shrink)
  expect(calls).toHaveLength(1)
  expect(calls[0].name).toBe('IMG_0619.jpg')
  expect(out.name).toBe('IMG_0619.jpg')
  expect(out.size).toBeLessThan(1 << 20)
})

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
