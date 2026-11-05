import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createApiClient } from '../../src/shared/api/client'
import { parseAttemptResult, parseChallenge } from '../../src/shared/api/validation'
import type { CaptureMetadata } from '../../src/shared/api/types'
import type { LocationPolicy, LocationValidation } from '../src/location'
import { createDemoLocationValidation } from '../src/demo-location'
import { expectError, startServer } from './helpers'
import { syntheticPng as photo } from './photo-fixtures'

const fixedNow = Date.parse('2026-11-05T06:00:00Z')
const policy: LocationPolicy = {
  zones: [{ latitude: 0, longitude: 0, radiusMeters: 100 }], maxAccuracyMeters: 50,
  maxAgeMs: 120_000, maxFutureSkewMs: 5000, maxCaptureMeasurementGapMs: 30_000,
}
function metadata(latitude = 0, accuracyMeters = 10): CaptureMetadata {
  return { capturedAt: '2026-11-05T06:00:00Z', position: { latitude, longitude: 0, accuracyMeters, measuredAt: '2026-11-05T06:00:00Z' } }
}

async function setup(t: Parameters<typeof startServer>[0], validation?: LocationValidation) {
  let now = fixedNow
  const options = { verifier: { verify: async (token: string) => ({ uid: token }) },
    locationValidation: validation ?? { policyFor: () => policy, now: () => now } }
  const { base } = await startServer(t, options)
  const response = await fetch(base + '/api/v1/challenges', { method: 'POST', headers: {
    Authorization: 'Bearer owner', 'Content-Type': 'application/json',
  }, body: JSON.stringify({ questId: 'demo-quest', expectedVersion: 1 }) })
  const challenge = parseChallenge(await response.json())
  const post = (capture: unknown, key = 'answer-key', token = 'owner') => {
    const body = new FormData()
    body.append('photo', new Blob([photo], { type: 'image/png' }), 'synthetic.png')
    body.append('metadata', JSON.stringify(capture))
    return fetch(base + '/api/v1/challenges/' + challenge.challengeId + '/answers', { method: 'POST', body,
      headers: { Authorization: 'Bearer ' + token, 'Idempotency-Key': key } })
  }
  return { base, post, advance: (milliseconds: number) => { now += milliseconds } }
}

test('GPS failures stop the answer; passing location does not mean correct or saved', async (t) => {
  const { post, base } = await setup(t)
  for (const [capture, status, state, outcome, nextAction] of [
    [metadata(0.001, 10), 200, 'COMPLETED', 'OUTSIDE_AREA', 'MOVE_TO_AREA'],
    [metadata(0.001, 20), 200, 'COMPLETED', 'LOCATION_UNCERTAIN', 'RETAKE'],
    [metadata(), 202, 'RECEIVED', null, 'WAIT'],
  ] as const) {
    const response = await post(capture, String(outcome))
    assert.equal(response.status, status)
    const result = parseAttemptResult(await response.json())
    assert.deepEqual(result, { attemptId: result.attemptId, state, outcome, nextAction, source: 'mock' })
    const restored = await fetch(base + '/api/v1/attempts/' + result.attemptId, { headers: { Authorization: 'Bearer owner' } })
    assert.deepEqual(await restored.json(), result)
    assert.doesNotMatch(JSON.stringify(result), /latitude|longitude|radius|distance|accuracy|capturedAt|Discovery/)
    await expectError(await fetch(base + '/api/v1/attempts/' + result.attemptId, { headers: { Authorization: 'Bearer other' } }), 404, 'NOT_FOUND')
  }
})

test('a replay keeps its original classification after time passes; a new answer is checked afresh', async (t) => {
  const { post, advance } = await setup(t)
  const first = await (await post(metadata())).json()
  advance(120_001)
  assert.deepEqual(await (await post(metadata())).json(), first)
  const freshKey = parseAttemptResult(await (await post(metadata(), 'another-answer')).json())
  assert.equal(freshKey.outcome, 'LOCATION_UNCERTAIN')
  assert.notEqual(freshKey.attemptId, (first as { attemptId: string }).attemptId)
  await expectError(await post(metadata(1)), 409, 'IDEMPOTENCY_CONFLICT')
  await expectError(await post(metadata(), 'another-key', 'other'), 404, 'NOT_FOUND')
})

test('retries and owner reads survive a later policy outage without reclassifying an existing answer', async (t) => {
  let available = true
  const { post } = await setup(t, { policyFor: () => available ? policy : undefined, now: () => fixedNow })
  const first = await (await post(metadata(1))).json()
  available = false
  assert.deepEqual(await (await post(metadata(1))).json(), first)
  await expectError(await post(metadata(1), 'new-answer'), 503, 'SYSTEM_ERROR')
})

test('missing or broken enabled policy fails closed and client policy injection is invalid', async (t) => {
  const missing = await setup(t, { policyFor: () => undefined, now: () => fixedNow })
  await expectError(await missing.post(metadata()), 503, 'SYSTEM_ERROR')
  const broken = await setup(t, { policyFor: () => ({ ...policy, zones: [] }), now: () => fixedNow })
  await expectError(await broken.post(metadata()), 503, 'SYSTEM_ERROR')
  const regular = await setup(t)
  await expectError(await regular.post({ ...metadata(), maxAgeMs: 999999999, zones: policy.zones }), 400, 'INVALID_INPUT')
  const publicQuest = await (await fetch(regular.base + '/api/v1/quests/demo-quest')).json()
  assert.doesNotMatch(JSON.stringify(publicQuest), /radius|zones|latitude|longitude|maxAge/)
})

test('the common client decodes an explicit demo GPS failure without accepting mock success', async (t) => {
  const demo = createDemoLocationValidation()
  demo.now = () => fixedNow
  assert.equal(demo.policyFor('demo-quest', 2), undefined)
  assert.equal(demo.policyFor('not-a-demo-quest', 1), undefined)
  const { base } = await setup(t, demo)
  const api = createApiClient({ fetch: (path, init) => fetch(base + String(path), init), getIdToken: async () => 'owner', expectedDataMode: 'demo' })
  const challenge = await api.createChallenge({ questId: 'demo-quest', expectedVersion: 1 })
  const outside = await api.submitAnswer({ challengeId: challenge.challengeId, metadata: metadata(1), photo: new Blob([photo], { type: 'image/png' }), idempotencyKey: 'client-key' })
  assert.equal(outside.outcome, 'OUTSIDE_AREA')
  assert.equal(outside.source, 'mock')
  assert.deepEqual(await api.getAttempt(outside.attemptId), outside)
})
