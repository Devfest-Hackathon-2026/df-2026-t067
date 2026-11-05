import assert from 'node:assert/strict'
import { test } from 'node:test'
import { capture } from '../../src/shared/api/testFixtures'
import { evaluateLocation } from '../src/location'
import type { LocationPolicy } from '../src/location'

const now = Date.parse('2026-11-05T06:00:00Z')
const policy: LocationPolicy = {
  zones: [{ latitude: 0, longitude: 0, radiusMeters: 100 }],
  maxAccuracyMeters: 50, maxAgeMs: 120_000, maxFutureSkewMs: 5000, maxCaptureMeasurementGapMs: 30_000,
}
const input = (latitude = 0, accuracyMeters = 10, longitude = 0) => ({
  ...capture, position: { ...capture.position, latitude, longitude, accuracyMeters },
})

test('location uses accuracy conservatively, with inclusive inside and strict outside boundaries', () => {
  assert.equal(evaluateLocation(input(), policy, now), 'WITHIN_AREA')
  assert.equal(evaluateLocation(input(0, 50), { ...policy, zones: [{ latitude: 0, longitude: 0, radiusMeters: 50 }] }, now), 'WITHIN_AREA')
  assert.equal(evaluateLocation(input(0, 51), policy, now), 'LOCATION_UNCERTAIN')
  // At the equator 0.001 degrees is about 111.195m: accuracy 10m is
  // completely outside 100m, accuracy 20m overlaps the boundary.
  assert.equal(evaluateLocation(input(0.001, 10), policy, now), 'OUTSIDE_AREA')
  assert.equal(evaluateLocation(input(0.001, 20), policy, now), 'LOCATION_UNCERTAIN')
  assert.equal(evaluateLocation(input(0.0005, 10), policy, now), 'WITHIN_AREA')
  assert.equal(evaluateLocation(input(0.0009, 10), policy, now), 'LOCATION_UNCERTAIN')
  // Equatorial separation 0.001 degrees is 111.19508023353292m on the
  // specified sphere: the lower edge is uncertain and upper edge is inside.
  assert.equal(evaluateLocation(input(0.001, 10), { ...policy, zones: [{ latitude: 0, longitude: 0, radiusMeters: 101.19508023353292 }] }, now), 'LOCATION_UNCERTAIN')
  assert.equal(evaluateLocation(input(0.001, 10), { ...policy, zones: [{ latitude: 0, longitude: 0, radiusMeters: 121.19508023353292 }] }, now), 'WITHIN_AREA')
})

test('any fully containing zone wins; all outside is required to return outside', () => {
  const zones = [{ latitude: 1, longitude: 0, radiusMeters: 100 }, { latitude: 0, longitude: 0, radiusMeters: 100 }]
  assert.equal(evaluateLocation(input(), { ...policy, zones }, now), 'WITHIN_AREA')
  assert.equal(evaluateLocation(input(2), { ...policy, zones }, now), 'OUTSIDE_AREA')
  assert.equal(evaluateLocation(input(0.001, 20), { ...policy, zones }, now), 'LOCATION_UNCERTAIN')
})

test('date-line, polar and antipodal points produce finite conservative decisions', () => {
  const world = (latitude: number, longitude: number, radiusMeters: number) => ({ ...policy, zones: [{ latitude, longitude, radiusMeters }] })
  assert.equal(evaluateLocation(input(0, 1, -179.9999), world(0, 179.9999, 30), now), 'WITHIN_AREA')
  assert.equal(evaluateLocation(input(90, 1, 180), world(90, 0, 30), now), 'WITHIN_AREA')
  assert.equal(evaluateLocation(input(0, 0, 180), world(0, 0, 100), now), 'OUTSIDE_AREA')
})

test('stale, future, poor-accuracy and detached measurements are uncertain before spatial classification', () => {
  assert.equal(evaluateLocation(input(10, 51), policy, now), 'LOCATION_UNCERTAIN')
  assert.equal(evaluateLocation(input(), policy, now + 120_000), 'WITHIN_AREA')
  assert.equal(evaluateLocation(input(), policy, now + 120_001), 'LOCATION_UNCERTAIN')
  assert.equal(evaluateLocation(input(), policy, now - 5000), 'WITHIN_AREA')
  assert.equal(evaluateLocation(input(), policy, now - 5001), 'LOCATION_UNCERTAIN')
  const captured = { ...input(), capturedAt: '2026-11-05T05:58:00Z' }
  assert.equal(evaluateLocation(captured, policy, now), 'LOCATION_UNCERTAIN')
  const earlierMeasurement = { ...input(), position: { ...input().position, measuredAt: '2026-11-05T05:57:59Z' } }
  assert.equal(evaluateLocation(earlierMeasurement, policy, now), 'LOCATION_UNCERTAIN')
})

test('measurement may precede or follow the frozen photo within the allowed gap', () => {
  const after = { ...input(), position: { ...input().position, measuredAt: '2026-11-05T06:00:30Z' } }
  assert.equal(evaluateLocation(after, policy, now + 30_000), 'WITHIN_AREA')
  const before = { ...input(), capturedAt: '2026-11-05T06:00:30Z' }
  assert.equal(evaluateLocation(before, policy, now + 30_000), 'WITHIN_AREA')
  assert.equal(evaluateLocation({ ...before, capturedAt: '2026-11-05T06:00:30.001Z' }, policy, now + 30_001), 'LOCATION_UNCERTAIN')
})

test('untrusted coordinates, dates and injected server policy fields are invalid input', () => {
  for (const bad of [
    null, input(NaN), input(91), input(0, -1), input(0, Infinity), input(0, 1, -181),
    { ...input(), capturedAt: 'not-a-date' }, { ...input(), radiusMeters: 999999 },
  ]) assert.throws(() => evaluateLocation(bad, policy, now), { status: 400, code: 'INVALID_INPUT' })
})

test('invalid or missing server policy fails closed without leaking its values', () => {
  const badPolicies = [
    null, { ...policy, zones: [] }, { ...policy, zones: [{ latitude: 91, longitude: 0, radiusMeters: 100 }] },
    { ...policy, zones: [{ latitude: 0, longitude: NaN, radiusMeters: 100 }] },
    { ...policy, zones: [{ latitude: 0, longitude: 0, radiusMeters: 0 }] },
    { ...policy, maxAccuracyMeters: Infinity }, { ...policy, maxAgeMs: -1 },
    { ...policy, maxFutureSkewMs: NaN }, { ...policy, maxCaptureMeasurementGapMs: -1 },
  ]
  for (const bad of badPolicies) assert.throws(() => evaluateLocation(input(), bad as LocationPolicy, now), { status: 503, code: 'SYSTEM_ERROR' })
  assert.throws(() => evaluateLocation(input(), policy, NaN), { status: 503, code: 'SYSTEM_ERROR' })
})
