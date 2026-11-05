import assert from 'node:assert/strict'
import { test } from 'node:test'
import sharp from 'sharp'
import { comparePhotos } from '../src/photo-match'
import type { PhotoMatcher } from '../src/photo-match'
import { syntheticPng } from './photo-fixtures'

const input = () => ({ candidate: { bytes: syntheticPng, mimeType: 'image/png' }, reference: { bytes: syntheticPng, mimeType: 'image/png' }, features: ['架空の赤い対象'] })

test('only normalized photos and registered features reach the matcher; match is not CORRECT', async () => {
  let received = false
  const matcher: PhotoMatcher = async ({ reference, candidate, features }) => {
    assert.equal(reference.mimeType, 'image/jpeg')
    assert.equal(candidate.mimeType, 'image/jpeg')
    assert.equal((await sharp(candidate.bytes).metadata()).exif, undefined)
    assert.deepEqual(features, ['架空の赤い対象'])
    received = true
    return 'MATCH'
  }
  assert.equal(await comparePhotos(input(), { matcher }), 'MATCH')
  assert.equal(received, true)
})

test('wrong target and insufficient information remain distinct', async () => {
  assert.equal(await comparePhotos(input(), { matcher: async () => 'WRONG_TARGET' }), 'WRONG_TARGET')
  assert.equal(await comparePhotos(input(), { matcher: async () => 'IMAGE_UNCERTAIN' }), 'IMAGE_UNCERTAIN')
})

test('missing matcher/reference/features fail as configuration, not as a wrong photo', async () => {
  await assert.rejects(comparePhotos(input()), { status: 503, code: 'SYSTEM_ERROR', retryable: false })
  await assert.rejects(comparePhotos({ ...input(), reference: undefined }, { matcher: async () => 'MATCH' }), { status: 503, code: 'SYSTEM_ERROR', retryable: false })
  await assert.rejects(comparePhotos({ ...input(), features: [] }, { matcher: async () => 'MATCH' }), { status: 503, code: 'SYSTEM_ERROR', retryable: false })
  await assert.rejects(comparePhotos(input(), { matcher: async () => 'MATCH', timeoutMs: Infinity }), { status: 503, code: 'SYSTEM_ERROR', retryable: false })
  await assert.rejects(comparePhotos({ ...input(), reference: { bytes: Buffer.from('invalid'), mimeType: 'image/png' } }, { matcher: async () => 'MATCH' }), { status: 503, code: 'SYSTEM_ERROR', retryable: false })
})

test('an invalid candidate is input error while malformed/provider failure is system error', async () => {
  await assert.rejects(comparePhotos({ ...input(), candidate: { bytes: Buffer.from('invalid'), mimeType: 'image/png' } }, { matcher: async () => 'MATCH' }), { status: 400, code: 'INVALID_INPUT' })
  for (const matcher of [async () => 'CORRECT', async () => { throw new Error('private-provider-details') }]) {
    await assert.rejects(comparePhotos(input(), { matcher }), (error: unknown) => {
      assert.equal((error as { status: number }).status, 503)
      assert.equal((error as { code: string }).code, 'SYSTEM_ERROR')
      assert.doesNotMatch((error as Error).message, /private-provider-details/)
      return true
    })
  }
})

test('a stalled provider is aborted without automatic retry or late success', async () => {
  let calls = 0
  let signal: AbortSignal | undefined
  let finish!: (result: unknown) => void
  const pending = comparePhotos(input(), { timeoutMs: 20, matcher: async (_, call) => {
    calls++; signal = call.signal
    return new Promise((resolve) => { finish = resolve })
  } })
  await assert.rejects(pending, { status: 503, code: 'SYSTEM_ERROR', retryable: true })
  assert.equal(signal?.aborted, true)
  finish('MATCH')
  assert.equal(calls, 1)
})

test('cancellation is distinct from mismatch and aborts an in-flight provider', { timeout: 1000 }, async () => {
  const controller = new AbortController()
  let started!: () => void
  const ready = new Promise<void>((resolve) => { started = resolve })
  let signal: AbortSignal | undefined
  const pending = comparePhotos(input(), { signal: controller.signal, matcher: async (_, call) => {
    signal = call.signal; started()
    return new Promise(() => {})
  } })
  await ready
  controller.abort()
  await assert.rejects(pending, { name: 'AbortError' })
  assert.equal(signal?.aborted, true)
  await assert.rejects(comparePhotos(input(), { signal: controller.signal, matcher: async () => 'MATCH' }), { name: 'AbortError' })
})
