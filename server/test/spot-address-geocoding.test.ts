import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { createSpotAddressGeocoder } from '../src/spot-address-geocoding'

const position = { latitude: 35, longitude: 139 }
const callerSignal = () => new AbortController().signal

test('reverse geocoding uses the fixed Google endpoint and returns only the first nearby address', async () => {
  const lookup = createSpotAddressGeocoder('synthetic-key', async (input, options) => {
    const url = new URL(String(input))
    assert.equal(url.origin + url.pathname, 'https://geocode.googleapis.com/v4/geocode/location')
    assert.equal(url.searchParams.get('location.latitude'), '35')
    assert.equal(url.searchParams.get('location.longitude'), '139')
    assert.equal(url.searchParams.get('languageCode'), 'ja')
    assert.equal(url.searchParams.has('key'), false)
    assert.equal(options?.redirect, 'error')
    assert.equal(options?.cache, 'no-store')
    assert.equal(new Headers(options?.headers).get('X-Goog-Api-Key'), 'synthetic-key')
    assert.equal(new Headers(options?.headers).get('X-Goog-FieldMask'), 'results.formattedAddress')
    return Response.json({ results: [{ formattedAddress: '合成候補住所', placeId: 'ignored' }, { formattedAddress: '別の候補' }] })
  })
  assert.deepEqual(await lookup({ position }, callerSignal()), { status: 'candidate', source: 'nearby', address: '合成候補住所' })
})

test('Place ID results must match the identifier and any explicit link coordinates', async () => {
  let data: unknown = { placeId: 'ChIJ_test', location: position, formattedAddress: '架空の施設住所' }
  const lookup = createSpotAddressGeocoder('synthetic-key', async (input, options) => {
    const url = new URL(String(input))
    assert.equal(url.pathname, '/v4/geocode/places/ChIJ_test')
    assert.match(new Headers(options?.headers).get('X-Goog-FieldMask') ?? '', /formattedAddress,placeId/)
    return Response.json(data)
  })
  assert.deepEqual(await lookup({ googlePlaceId: 'ChIJ_test' }, callerSignal()), { status: 'candidate', source: 'place', address: '架空の施設住所' })
  assert.equal((await lookup({ position, googlePlaceId: 'ChIJ_test' }, callerSignal())).status, 'candidate')
  assert.equal((await lookup({ position: { latitude: 36, longitude: 139 }, googlePlaceId: 'ChIJ_test' }, callerSignal())).status, 'conflict')
  data = { placeId: 'ChIJ_other', location: position, formattedAddress: '別の住所' }
  assert.deepEqual(await lookup({ googlePlaceId: 'ChIJ_test' }, callerSignal()), { status: 'conflict' })
})

test('empty, unavailable, oversized and cancelled provider responses do not invent addresses', async () => {
  const request = { position }
  const empty = createSpotAddressGeocoder('synthetic-key', async () => Response.json({ results: [] }))
  assert.deepEqual(await empty(request, callerSignal()), { status: 'no-result' })
  const failed = createSpotAddressGeocoder('synthetic-key', async () => Response.json({ message: 'private provider error' }, { status: 429 }))
  assert.deepEqual(await failed(request, callerSignal()), { status: 'unavailable' })
  const oversized = createSpotAddressGeocoder('synthetic-key', async () => Response.json({ value: 'x'.repeat(33_000) }))
  assert.deepEqual(await oversized(request, callerSignal()), { status: 'unavailable' })
  const cancelled = createSpotAddressGeocoder('synthetic-key', async (_input, options) => {
    await delay(1000, undefined, { signal: options?.signal ?? undefined })
    return Response.json({})
  })
  assert.deepEqual(await cancelled(request, AbortSignal.timeout(15)), { status: 'unavailable' })
})
