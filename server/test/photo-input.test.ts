import assert from 'node:assert/strict'
import { test } from 'node:test'
import sharp from 'sharp'
import { preparePhoto } from '../src/photo-input'
import { syntheticPng } from './photo-fixtures'

test('a real decoder normalizes supported photos, strips metadata and applies orientation', async () => {
  const source = await sharp({ create: { width: 4, height: 2, channels: 3, background: 'red' } })
    .jpeg().withExif({ IFD0: { Artist: 'synthetic metadata' } }).withMetadata({ orientation: 6 }).toBuffer()
  const result = await preparePhoto({ bytes: source, mimeType: 'image/jpeg' })
  assert.equal(result.mimeType, 'image/jpeg')
  assert.equal(result.width, 2)
  assert.equal(result.height, 4)
  const meta = await sharp(result.bytes).metadata()
  assert.equal(meta.format, 'jpeg')
  assert.equal(meta.exif, undefined)
  assert.equal(meta.icc, undefined)
  assert.equal(meta.xmp, undefined)
  assert.equal(meta.orientation, undefined)
  assert.doesNotMatch(result.bytes.toString('latin1'), /synthetic metadata/)
  for (const [bytes, mimeType] of [[syntheticPng, 'image/png'], [await sharp(syntheticPng).webp().toBuffer(), 'image/webp']] as const) {
    const photo = await preparePhoto({ bytes, mimeType })
    assert.equal((await sharp(photo.bytes).metadata()).format, 'jpeg')
  }
})

test('resizing is bounded and transparent pixels become an opaque image', async () => {
  const source = await sharp({ create: { width: 3200, height: 1000, channels: 4, background: '#00000000' } }).png().toBuffer()
  const result = await preparePhoto({ bytes: source, mimeType: 'image/png' })
  assert.equal(result.width, 1600)
  assert.equal(result.height, 500)
  assert.equal((await sharp(result.bytes).metadata()).hasAlpha, false)
  assert(result.bytes.length <= 2 * 1024 * 1024)
})

test('header-only, corrupt, truncated, wrong-MIME and path inputs are never valid photos', async () => {
  const corrupt = Buffer.from(syntheticPng)
  corrupt[corrupt.length - 20] ^= 0xff
  for (const input of [
    { bytes: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), mimeType: 'image/png' },
    { bytes: corrupt, mimeType: 'image/png' },
    { bytes: syntheticPng.subarray(0, 40), mimeType: 'image/png' },
    { bytes: syntheticPng, mimeType: 'image/jpeg' },
    { bytes: syntheticPng, mimeType: 'image/svg+xml' },
    { bytes: Buffer.alloc(0), mimeType: 'image/png' },
    { bytes: '/private/photo.jpg', mimeType: 'image/jpeg' },
  ]) await assert.rejects(preparePhoto(input as never), { status: 400, code: 'INVALID_INPUT' })
})

test('compressed byte and decoded pixel limits are enforced before a result can be used', async () => {
  await assert.rejects(preparePhoto({ bytes: Buffer.alloc(4 * 1024 * 1024 + 1), mimeType: 'image/png' }), { status: 413, code: 'MEDIA_TOO_LARGE' })
  const huge = await sharp({ create: { width: 5000, height: 4000, channels: 3, background: 'red' } }).png().toBuffer()
  await assert.rejects(preparePhoto({ bytes: huge, mimeType: 'image/png' }), { status: 400, code: 'INVALID_INPUT' })
})

test('multiple-frame images cannot silently become a different still photo', async () => {
  const pixels = Buffer.concat([Buffer.alloc(12).fill(Buffer.from([255, 0, 0])), Buffer.alloc(12).fill(Buffer.from([0, 0, 255]))])
  const animated = await sharp(pixels, { raw: { width: 2, height: 4, pageHeight: 2, channels: 3 } })
    .webp({ loop: 0, delay: [100, 100] }).toBuffer()
  assert.equal((await sharp(animated, { animated: true }).metadata()).pages, 2)
  await assert.rejects(preparePhoto({ bytes: animated, mimeType: 'image/webp' }), { status: 400, code: 'INVALID_INPUT' })
})
