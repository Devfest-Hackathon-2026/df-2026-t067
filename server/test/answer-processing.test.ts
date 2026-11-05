import assert from 'node:assert/strict'
import test from 'node:test'
import { DemoAnswerProcessor } from '../src/answer-processing'
import type { PrivateAnswerVersion, ProcessorOptions } from '../src/answer-processing'
import { DemoAnswerStore } from '../src/answers'
import { DemoChallengeStore } from '../src/challenges'
import { DemoDiscoveryStore } from '../src/discoveries'
import { createDemoData } from '../src/demo-data'
import { preparePhoto } from '../src/photo-input'
import { HttpError } from '../src/errors'
import { capture } from '../../src/shared/api/testFixtures'
import { otherSyntheticPng, syntheticPng } from './photo-fixtures'
import { expectError, startServer } from './helpers'

const now = Date.parse(capture.capturedAt)
async function setup(overrides: Partial<ProcessorOptions> = {}) {
  const photo = await preparePhoto({ bytes: syntheticPng, mimeType: 'image/png' })
  const challenges = new DemoChallengeStore({ now: () => now })
  const answers = new DemoAnswerStore({ now: () => now })
  const discoveries = new DemoDiscoveryStore({ now: () => now })
  const challenge = challenges.start('owner', createDemoData().quests[0]).challenge
  const quest: PrivateAnswerVersion = {
    questId: challenge.questId, version: challenge.version, status: 'published',
    placeId: 'synthetic-place', areaId: 'demo-area', placeName: '架空の対象', descriptionSnapshot: '非公開の解説',
    revealedLocation: { latitude: 0, longitude: 0 }, reference: photo, features: ['合成図形'],
    locationPolicy: { zones: [{ latitude: 0, longitude: 0, radiusMeters: 100 }], maxAccuracyMeters: 50,
      maxAgeMs: 60_000, maxFutureSkewMs: 1_000, maxCaptureMeasurementGapMs: 10_000 },
  }
  let calls = 0
  const processor = new DemoAnswerProcessor({ answers, challenges, discoveries, currentQuest: () => quest,
    authorize: async () => true, matcher: async () => { calls++; return 'MATCH' }, ...overrides })
  const input = { digest: 'server-digest', metadata: structuredClone(capture), photo }
  const receipt = (key: string) => answers.receive('owner', challenge, key, input.digest)
  return { processor, answers, challenges, discoveries, challenge, quest, input, receipt, calls: () => calls }
}

const fails = (code: string) => (error: unknown) => error instanceof HttpError && error.code === code

test('connects a server-owned receipt to GPS, photo matching and private memory storage only', async (t) => {
  const s = await setup()
  const receipt = s.receipt('a')
  const result = await s.processor.process('owner', receipt.attemptId, s.input)
  assert.equal(result.outcome, 'SAVED_IN_MEMORY')
  assert.equal(result.source, 'mock')
  assert(result.discoveryId)
  assert.equal(s.calls(), 1)
  // The service is not a public answer worker and does not manufacture CORRECT.
  assert.equal(s.answers.getOwned(receipt.attemptId, 'owner')?.state, 'RECEIVED')
  const { base } = await startServer(t, { discoveries: s.discoveries, verifier: { verify: async (uid) => ({ uid }) } })
  const path = '/api/v1/me/discoveries/' + result.discoveryId
  const response = await fetch(base + path, { headers: { Authorization: 'Bearer owner' } })
  assert.equal(response.status, 200)
  const discovery = await response.json() as { placeName: string; firstClearedAt: string; ownerPhoto: string }
  assert.equal(discovery.placeName, '架空の対象')
  assert.equal(discovery.firstClearedAt, new Date(now).toISOString())
  assert.deepEqual(Buffer.from(await (await fetch(base + discovery.ownerPhoto, { headers: { Authorization: 'Bearer owner' } })).arrayBuffer()), s.input.photo.bytes)
  await expectError(await fetch(base + path, { headers: { Authorization: 'Bearer other' } }), 404, 'NOT_FOUND')
})

test('rejects another owner, mismatched input and unavailable challenges before any matcher call', async () => {
  const s = await setup()
  const receipt = s.receipt('a')
  await assert.rejects(s.processor.process('other', receipt.attemptId, s.input), fails('NOT_FOUND'))
  await assert.rejects(s.processor.process('owner', receipt.attemptId, { ...s.input, digest: 'different' }), fails('IDEMPOTENCY_CONFLICT'))
  assert.equal(s.calls(), 0)
  assert.deepEqual((await s.discoveries.listOwned('owner', {})).items, [])
})

test('coalesces concurrent retries, caches results and rejects changed payloads even with a copied digest', async () => {
  let calls = 0
  let finish!: (value: string) => void
  let began!: () => void
  const started = new Promise<void>((resolve) => { began = resolve })
  const matching = new Promise<string>((resolve) => { finish = resolve })
  const s = await setup({ matcher: async () => { calls++; began(); return matching }, capacity: 1 })
  const receipt = s.receipt('a')
  const first = s.processor.process('owner', receipt.attemptId, s.input)
  await started
  const retry = s.processor.process('owner', receipt.attemptId, s.input)
  finish('MATCH')
  const results = await Promise.all([first, retry])
  assert.deepEqual(results[0], results[1])
  results[0].discoveryId = 'outside-mutation'
  assert.deepEqual(await s.processor.process('owner', receipt.attemptId, s.input), results[1])
  assert.equal(calls, 1)
  await assert.rejects(s.processor.process('owner', receipt.attemptId, { ...s.input,
    metadata: { ...capture, position: { ...capture.position, latitude: 1 } } }), fails('IDEMPOTENCY_CONFLICT'))
  await assert.rejects(s.processor.process('owner', s.receipt('b').attemptId, s.input), fails('RATE_LIMITED'))
})

test('different concurrent attempts preserve one initial record, photo and server date', async () => {
  const s = await setup({ concurrency: 2 })
  const first = s.receipt('a'), second = s.receipt('b')
  const changedPhoto = await preparePhoto({ bytes: otherSyntheticPng, mimeType: 'image/png' })
  const results = await Promise.all([
    s.processor.process('owner', first.attemptId, s.input),
    s.processor.process('owner', second.attemptId, { ...s.input, photo: changedPhoto }),
  ])
  assert.deepEqual(results.map((result) => result.outcome).sort(), ['ALREADY_SAVED_IN_MEMORY', 'SAVED_IN_MEMORY'])
  assert.equal(results[0].discoveryId, results[1].discoveryId)
  const record = (await s.discoveries.listOwned('owner', {})).items
  assert.equal(record.length, 1)
  assert.equal(record[0].firstClearedAt, new Date(now).toISOString())
  const winner = results[0].outcome === 'SAVED_IN_MEMORY' ? s.input.photo.bytes : changedPhoto.bytes
  assert.deepEqual((await s.discoveries.getPhotoOwned('owner', record[0].discoveryId))?.bytes, winner)
})

test('an existing owner record skips further AI calls and does not recreate a deleted record on replay', async () => {
  const s = await setup()
  const first = s.receipt('a')
  const saved = await s.processor.process('owner', first.attemptId, s.input)
  assert(saved.discoveryId)
  const next = await s.processor.process('owner', s.receipt('b').attemptId, s.input)
  assert.deepEqual(next, { ...saved, outcome: 'ALREADY_SAVED_IN_MEMORY' })
  assert.equal(s.calls(), 1)
  assert.equal(s.discoveries.findByPlaceOwned('other', s.quest.placeId), null)
  const copy = s.discoveries.findByPlaceOwned('owner', s.quest.placeId)!
  copy.placeName = 'changed'
  assert.equal(s.discoveries.findByPlaceOwned('owner', s.quest.placeId)?.placeName, '架空の対象')
  await s.discoveries.deleteOwned('owner', saved.discoveryId)
  assert.deepEqual(await s.processor.process('owner', first.attemptId, s.input), saved)
  assert.deepEqual((await s.discoveries.listOwned('owner', {})).items, [])
  assert.equal(s.calls(), 1)
})

test('GPS failure never calls the matcher, and retries use receipt time instead of worker time', async () => {
  const s = await setup()
  for (const [index, position] of [{ ...capture.position, latitude: 1 }, { ...capture.position, accuracyMeters: 200 }].entries()) {
    const result = await s.processor.process('owner', s.receipt(String(index)).attemptId, { ...s.input, metadata: { ...capture, position } })
    assert.equal(result.outcome, index === 0 ? 'OUTSIDE_AREA' : 'LOCATION_UNCERTAIN')
  }
  assert.equal(s.calls(), 0)
  assert.deepEqual((await s.discoveries.listOwned('owner', {})).items, [])
  const receipt = s.receipt('valid')
  const context = s.answers.getAcceptedOwned(receipt.attemptId, 'owner')!
  assert.equal(context.receivedAt, now)
  assert.equal(s.answers.getAcceptedOwned(receipt.attemptId, 'other'), null)
  context.result.nextAction = 'changed'
  assert.equal(s.answers.getOwned(receipt.attemptId, 'owner')?.nextAction, 'WAIT')
  // The fixed capture is far older than wall-clock time but valid at receipt.
  assert.equal((await s.processor.process('owner', receipt.attemptId, s.input)).outcome, 'SAVED_IN_MEMORY')
})

test('wrong target and uncertain photo stay distinct and never produce a record', async () => {
  for (const outcome of ['WRONG_TARGET', 'IMAGE_UNCERTAIN']) {
    const s = await setup({ matcher: async () => outcome })
    assert.deepEqual(await s.processor.process('owner', s.receipt('a').attemptId, s.input), { source: 'mock', outcome })
    assert.deepEqual((await s.discoveries.listOwned('owner', {})).items, [])
  }
})

test('revocation, pause and changed private data while matching prevent storage', async () => {
  for (const change of ['owner', 'pause', 'version', 'snapshot']) {
    let allowed = true
    let current: PrivateAnswerVersion | null = null
    const s = await setup({ authorize: async () => allowed, currentQuest: () => current,
      matcher: async () => {
        if (change === 'owner') allowed = false
        if (change === 'pause') current!.status = 'paused'
        if (change === 'version') current!.version++
        if (change === 'snapshot') current!.descriptionSnapshot = 'silently-changed'
        return 'MATCH'
      } })
    current = s.quest
    const expected = change === 'owner' ? 'UNAUTHENTICATED' : change === 'pause' ? 'QUEST_UNAVAILABLE' : 'QUEST_CHANGED'
    await assert.rejects(s.processor.process('owner', s.receipt('a').attemptId, s.input), fails(expected))
    assert.deepEqual((await s.discoveries.listOwned('owner', {})).items, [])
  }
})

test('checks authorization and publication again after decoding and before calling a provider', async () => {
  for (const change of ['owner', 'pause']) {
    let checks = 0, calls = 0
    let current: PrivateAnswerVersion | null = null
    const s = await setup({ currentQuest: () => current, authorize: async () => {
      checks++
      if (checks === 2 && change === 'pause') current!.status = 'paused'
      return change !== 'owner' || checks === 1
    }, matcher: async () => { calls++; return 'MATCH' } })
    current = s.quest
    await assert.rejects(s.processor.process('owner', s.receipt('a').attemptId, s.input),
      fails(change === 'owner' ? 'UNAUTHENTICATED' : 'QUEST_UNAVAILABLE'))
    assert.equal(calls, 0)
    assert.deepEqual((await s.discoveries.listOwned('owner', {})).items, [])
  }
})

test('a deadline during the provider authorization gate prevents a later send and keeps the slot bounded', async () => {
  let release!: (allowed: boolean) => void
  const authorization = new Promise<boolean>((resolve) => { release = resolve })
  let checks = 0, calls = 0
  const s = await setup({ timeoutMs: 5, authorize: async () => ++checks === 2 ? authorization : true,
    matcher: async () => { calls++; return 'MATCH' } })
  await assert.rejects(s.processor.process('owner', s.receipt('a').attemptId, s.input), fails('SYSTEM_ERROR'))
  const second = s.receipt('b')
  await assert.rejects(s.processor.process('owner', second.attemptId, s.input), fails('RATE_LIMITED'))
  release(true)
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(calls, 0)
  assert.equal((await s.processor.process('owner', second.attemptId, s.input)).outcome, 'SAVED_IN_MEMORY')
})

test('missing ownership, authorization failure and malformed private policy fail before the provider', async (t) => {
  const expired = await setup()
  const receipt = expired.receipt('a')
  t.mock.method(expired.challenges, 'getOwned', () => null)
  await assert.rejects(expired.processor.process('owner', receipt.attemptId, expired.input), fails('NOT_FOUND'))
  const denied = await setup({ authorize: async () => { throw new Error('private credentials') } })
  await assert.rejects(denied.processor.process('owner', denied.receipt('a').attemptId, denied.input), fails('AUTH_UNAVAILABLE'))
  const invalid = await setup()
  invalid.quest.locationPolicy.zones = []
  await assert.rejects(invalid.processor.process('owner', invalid.receipt('a').attemptId, invalid.input), fails('SYSTEM_ERROR'))
  assert.equal(expired.calls() + denied.calls() + invalid.calls(), 0)
})

test('missing/paused configuration and invalid model output fail closed; errors are cached without re-sending', async () => {
  let calls = 0
  const s = await setup({ matcher: async () => { calls++; return 'CORRECT' } })
  const receipt = s.receipt('a')
  for (let index = 0; index < 2; index++) await assert.rejects(s.processor.process('owner', receipt.attemptId, s.input), fails('SYSTEM_ERROR'))
  assert.equal(calls, 1)
  assert.deepEqual((await s.discoveries.listOwned('owner', {})).items, [])
  for (const overrides of [{ currentQuest: () => null }, { matcher: undefined }]) {
    const missing = await setup(overrides)
    await assert.rejects(missing.processor.process('owner', missing.receipt('a').attemptId, missing.input),
      fails(overrides.currentQuest ? 'QUEST_UNAVAILABLE' : 'SYSTEM_ERROR'))
  }
})

test('a timed-out provider retains its slot until settled and a late match never writes', async () => {
  let finish!: (value: string) => void
  const pending = new Promise<string>((resolve) => { finish = resolve })
  const s = await setup({ matcher: async () => pending, timeoutMs: 5 })
  const first = s.receipt('a')
  await assert.rejects(s.processor.process('owner', first.attemptId, s.input), fails('SYSTEM_ERROR'))
  const second = s.receipt('b')
  await assert.rejects(s.processor.process('owner', second.attemptId, s.input), fails('RATE_LIMITED'))
  finish('MATCH')
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.deepEqual((await s.discoveries.listOwned('owner', {})).items, [])
  assert.equal((await s.processor.process('owner', second.attemptId, s.input)).outcome, 'SAVED_IN_MEMORY')
})

test('storage failure is not a successful result and does not re-run the matcher on retry', async (t) => {
  const s = await setup()
  t.mock.method(s.discoveries, 'saveFirstClear', async () => { throw new HttpError(503, 'SYSTEM_ERROR', '保存できません。', true) })
  const receipt = s.receipt('a')
  for (let index = 0; index < 2; index++) await assert.rejects(s.processor.process('owner', receipt.attemptId, s.input), fails('SYSTEM_ERROR'))
  assert.equal(s.calls(), 1)
  assert.deepEqual((await s.discoveries.listOwned('owner', {})).items, [])
})

test('retries only the save after a transient failure and coalesces concurrent recovery', async (t) => {
  const s = await setup()
  const actual = s.discoveries.saveFirstClear.bind(s.discoveries)
  let writes = 0
  t.mock.method(s.discoveries, 'saveFirstClear', async (...args: Parameters<typeof actual>) => {
    if (++writes === 1) throw new HttpError(503, 'SYSTEM_ERROR', '一時保存障害', true)
    return actual(...args)
  })
  const receipt = s.receipt('recover')
  await assert.rejects(s.processor.process('owner', receipt.attemptId, s.input), fails('SYSTEM_ERROR'))
  const recovered = await Promise.all([
    s.processor.process('owner', receipt.attemptId, s.input),
    s.processor.process('owner', receipt.attemptId, s.input),
  ])
  assert.deepEqual(recovered[0], recovered[1])
  assert.equal(recovered[0].outcome, 'SAVED_IN_MEMORY')
  assert.equal(writes, 2)
  assert.equal(s.calls(), 1)
  assert.equal((await s.discoveries.listOwned('owner', {})).items.length, 1)
})

test('recovery preserves the first record when the write succeeded but its reply was lost', async (t) => {
  const s = await setup()
  const actual = s.discoveries.saveFirstClear.bind(s.discoveries)
  let writes = 0
  let firstId: string | undefined
  t.mock.method(s.discoveries, 'saveFirstClear', async (...args: Parameters<typeof actual>) => {
    const saved = await actual(...args)
    if (++writes === 1) { firstId = saved.discovery.discoveryId; throw new Error('private storage response lost') }
    return saved
  })
  const receipt = s.receipt('lost-reply')
  await assert.rejects(s.processor.process('owner', receipt.attemptId, s.input), fails('SYSTEM_ERROR'))
  const recovered = await s.processor.process('owner', receipt.attemptId, s.input)
  assert.equal(recovered.outcome, 'ALREADY_SAVED_IN_MEMORY')
  assert.equal(recovered.discoveryId, firstId)
  assert.equal(s.calls(), 1)
  const records = (await s.discoveries.listOwned('owner', {})).items
  assert.equal(records.length, 1)
  assert.equal(records[0].firstClearedAt, new Date(now).toISOString())
  assert.deepEqual((await s.discoveries.getPhotoOwned('owner', recovered.discoveryId!))?.bytes, s.input.photo.bytes)
})

test('recovery rejects another owner or altered input and rechecks pause, version and private snapshot', async (t) => {
  for (const change of ['pause', 'version', 'snapshot']) {
    const s = await setup()
    let writes = 0
    t.mock.method(s.discoveries, 'saveFirstClear', async () => { writes++; throw new HttpError(503, 'SYSTEM_ERROR', '一時障害', true) })
    const receipt = s.receipt('recover')
    await assert.rejects(s.processor.process('owner', receipt.attemptId, s.input), fails('SYSTEM_ERROR'))
    await assert.rejects(s.processor.process('other', receipt.attemptId, s.input), fails('NOT_FOUND'))
    await assert.rejects(s.processor.process('owner', receipt.attemptId, { ...s.input, digest: 'changed' }), fails('IDEMPOTENCY_CONFLICT'))
    await assert.rejects(s.processor.process('owner', receipt.attemptId, { ...s.input,
      metadata: { ...capture, position: { ...capture.position, latitude: 1 } } }), fails('IDEMPOTENCY_CONFLICT'))
    if (change === 'pause') s.quest.status = 'paused'
    if (change === 'version') s.quest.version++
    if (change === 'snapshot') s.quest.descriptionSnapshot = 'changed'
    await assert.rejects(s.processor.process('owner', receipt.attemptId, s.input), fails(change === 'pause' ? 'QUEST_UNAVAILABLE' : 'QUEST_CHANGED'))
    assert.equal(writes, 1)
    assert.equal(s.calls(), 1)
    assert.deepEqual((await s.discoveries.listOwned('owner', {})).items, [])
  }
})

test('checkpoint byte capacity stops new AI work and is released after recovery', async (t) => {
  const photo = await preparePhoto({ bytes: syntheticPng, mimeType: 'image/png' })
  const s = await setup({ maximumCheckpointBytes: photo.bytes.length })
  const actual = s.discoveries.saveFirstClear.bind(s.discoveries)
  let writes = 0
  t.mock.method(s.discoveries, 'saveFirstClear', async (...args: Parameters<typeof actual>) => {
    if (++writes === 1) throw new HttpError(503, 'SYSTEM_ERROR', '一時障害', true)
    return actual(...args)
  })
  const first = s.receipt('first'), second = s.receipt('second')
  await assert.rejects(s.processor.process('owner', first.attemptId, s.input), fails('SYSTEM_ERROR'))
  await assert.rejects(s.processor.process('owner', second.attemptId, s.input), fails('RATE_LIMITED'))
  assert.equal(s.calls(), 1)
  const recovered = await s.processor.process('owner', first.attemptId, s.input)
  await s.discoveries.deleteOwned('owner', recovered.discoveryId!)
  assert.equal((await s.processor.process('owner', second.attemptId, s.input)).outcome, 'SAVED_IN_MEMORY')
  assert.equal(s.calls(), 2)
})

test('a fatal revocation discards the checkpoint, while an authorization outage can recover without AI', async (t) => {
  for (const fatal of [true, false]) {
    let allowed = true, unavailable = false
    const photo = await preparePhoto({ bytes: syntheticPng, mimeType: 'image/png' })
    const s = await setup({ maximumCheckpointBytes: photo.bytes.length, authorize: async () => {
      if (unavailable) throw new Error('temporary auth outage')
      return allowed
    } })
    const actual = s.discoveries.saveFirstClear.bind(s.discoveries)
    let writes = 0
    t.mock.method(s.discoveries, 'saveFirstClear', async (...args: Parameters<typeof actual>) => {
      if (++writes === 1) throw new HttpError(503, 'SYSTEM_ERROR', '一時障害', true)
      return actual(...args)
    })
    const receipt = s.receipt('first')
    await assert.rejects(s.processor.process('owner', receipt.attemptId, s.input), fails('SYSTEM_ERROR'))
    allowed = !fatal; unavailable = !fatal
    await assert.rejects(s.processor.process('owner', receipt.attemptId, s.input), fails(fatal ? 'UNAUTHENTICATED' : 'AUTH_UNAVAILABLE'))
    allowed = true; unavailable = false
    if (fatal) {
      await assert.rejects(s.processor.process('owner', receipt.attemptId, s.input), fails('UNAUTHENTICATED'))
      assert.equal((await s.processor.process('owner', s.receipt('new').attemptId, s.input)).outcome, 'SAVED_IN_MEMORY')
      assert.equal(s.calls(), 2)
    } else {
      assert.equal((await s.processor.process('owner', receipt.attemptId, s.input)).outcome, 'SAVED_IN_MEMORY')
      assert.equal(s.calls(), 1)
    }
  }
})

test('an expired challenge discards its recovery photo without letting another owner cancel it', async (t) => {
  const photo = await preparePhoto({ bytes: syntheticPng, mimeType: 'image/png' })
  const s = await setup({ maximumCheckpointBytes: photo.bytes.length })
  const actual = s.discoveries.saveFirstClear.bind(s.discoveries)
  let writes = 0, expired = false
  t.mock.method(s.discoveries, 'saveFirstClear', async (...args: Parameters<typeof actual>) => {
    if (++writes === 1) throw new HttpError(503, 'SYSTEM_ERROR', '一時障害', true)
    return actual(...args)
  })
  const owned = s.challenges.getOwned.bind(s.challenges)
  t.mock.method(s.challenges, 'getOwned', (id: string, uid: string) => expired ? null : owned(id, uid))
  const receipt = s.receipt('expired')
  await assert.rejects(s.processor.process('owner', receipt.attemptId, s.input), fails('SYSTEM_ERROR'))
  await assert.rejects(s.processor.process('other', receipt.attemptId, s.input), fails('NOT_FOUND'))
  await assert.rejects(s.processor.process('owner', s.receipt('blocked').attemptId, s.input), fails('RATE_LIMITED'))
  expired = true
  await assert.rejects(s.processor.process('owner', receipt.attemptId, s.input), fails('NOT_FOUND'))
  expired = false
  await assert.rejects(s.processor.process('owner', receipt.attemptId, s.input), fails('NOT_FOUND'))
  assert.equal((await s.processor.process('owner', s.receipt('fresh').attemptId, s.input)).outcome, 'SAVED_IN_MEMORY')
})

test('nonretryable save failure and negative photo results release their reserved photo capacity', async (t) => {
  const photo = await preparePhoto({ bytes: syntheticPng, mimeType: 'image/png' })
  const s = await setup({ maximumCheckpointBytes: photo.bytes.length })
  const actual = s.discoveries.saveFirstClear.bind(s.discoveries)
  let writes = 0
  t.mock.method(s.discoveries, 'saveFirstClear', async (...args: Parameters<typeof actual>) => {
    if (++writes === 1) throw new HttpError(503, 'SYSTEM_ERROR', '再開できない障害', false)
    return actual(...args)
  })
  const receipt = s.receipt('fatal')
  for (let index = 0; index < 2; index++) await assert.rejects(s.processor.process('owner', receipt.attemptId, s.input), fails('SYSTEM_ERROR'))
  assert.equal(s.calls(), 1)
  assert.equal(writes, 1)
  assert.equal((await s.processor.process('owner', s.receipt('fresh').attemptId, s.input)).outcome, 'SAVED_IN_MEMORY')
  const negative = await setup({ maximumCheckpointBytes: photo.bytes.length, matcher: async () => 'WRONG_TARGET' })
  for (const key of ['a', 'b']) assert.equal((await negative.processor.process('owner', negative.receipt(key).attemptId, negative.input)).outcome, 'WRONG_TARGET')
})

test('a retry arriving as a save fails shares that execution before a single recovery starts', async (t) => {
  const s = await setup({ concurrency: 2 })
  const actual = s.discoveries.saveFirstClear.bind(s.discoveries)
  const receipt = s.receipt('racing-retry')
  let writes = 0
  let racing: ReturnType<typeof s.processor.process> | undefined
  t.mock.method(s.discoveries, 'saveFirstClear', async (...args: Parameters<typeof actual>) => {
    if (++writes === 1) {
      queueMicrotask(() => {
        racing = s.processor.process('owner', receipt.attemptId, s.input)
        void racing.catch(() => {})
      })
      throw new HttpError(503, 'SYSTEM_ERROR', '一時障害', true)
    }
    return actual(...args)
  })
  await assert.rejects(s.processor.process('owner', receipt.attemptId, s.input), fails('SYSTEM_ERROR'))
  assert(racing)
  await assert.rejects(racing, fails('SYSTEM_ERROR'))
  assert.equal(writes, 1)
  assert.equal((await s.processor.process('owner', receipt.attemptId, s.input)).outcome, 'SAVED_IN_MEMORY')
  assert.equal(writes, 2)
  assert.equal(s.calls(), 1)
})

test('a temporary authorization outage after MATCH resumes at save without another provider call', async () => {
  let checks = 0
  const s = await setup({ authorize: async () => {
    if (++checks === 3) throw new Error('auth temporarily unavailable after matching')
    return true
  } })
  const receipt = s.receipt('auth-recovery')
  await assert.rejects(s.processor.process('owner', receipt.attemptId, s.input), fails('AUTH_UNAVAILABLE'))
  assert.deepEqual((await s.discoveries.listOwned('owner', {})).items, [])
  assert.equal((await s.processor.process('owner', receipt.attemptId, s.input)).outcome, 'SAVED_IN_MEMORY')
  assert.equal(s.calls(), 1)
})
