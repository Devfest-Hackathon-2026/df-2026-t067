import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { Storage } from '@google-cloud/storage'
import { deleteApp, initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { createApiClient } from '../../src/shared/api/client'
import { AnswerPhotoStorage } from '../src/answer-photo-storage'
import { DemoAnswerStore } from '../src/answers'
import { createDurableAnswerServer } from '../src/durable-answer-http'
import { runDueAnswerJobs } from '../src/durable-answer-jobs'
import { runDurableAnswer } from '../src/durable-answer-worker'
import { HttpError } from '../src/errors'
import { getDurableAnswer } from '../src/firestore-answer-intake'
import { preparePhoto } from '../src/photo-input'
import { listenServer } from './helpers'
import { otherSyntheticPng, syntheticPng } from './photo-fixtures'

const emulator = process.env.QUEST_STORAGE_TEST_HOST
const firestoreEmulator = process.env.QUEST_FIRESTORE_TEST_HOST

test('Cloud Storage photo generations stay immutable across retries', {
  skip: !emulator && 'Set QUEST_STORAGE_TEST_HOST for the isolated GCS emulator', timeout: 45_000,
}, async (t) => {
  assert(emulator && /^127\.0\.0\.1:[1-9]\d{0,4}$/.test(emulator) && Number(emulator.split(':')[1]) <= 65535)
  delete process.env.STORAGE_EMULATOR_HOST
  const projectId = 'demo-t067-photos'
  const storageBucket = `${projectId}.appspot.com`
  const setup = await fetch(`http://${emulator}/storage/v1/b?project=${projectId}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: storageBucket }),
  })
  assert(setup.ok || setup.status === 409)
  await setup.body?.cancel()
  const app = initializeApp({ projectId, storageBucket }, 'answer-photos-' + randomUUID())
  t.after(() => deleteApp(app))
  // The pinned Admin SDK uses this same GCS client. Set the JSON API endpoint
  // explicitly because this emulator serves it at /storage/v1.
  const bucket = new Storage({ projectId, apiEndpoint: `http://${emulator}` }).bucket(storageBucket)
  const store = new AnswerPhotoStorage(bucket)
  const photo = await preparePhoto({ bytes: syntheticPng, mimeType: 'image/png' })
  const other = await preparePhoto({ bytes: otherSyntheticPng, mimeType: 'image/png' })
  const digest = 'a'.repeat(64)
  const attemptId = randomUUID()

  const [first, retry] = await Promise.all([
    store.writeIncoming(attemptId, digest, photo), store.writeIncoming(attemptId, digest, photo),
  ])
  assert.deepEqual(retry, first)
  assert.equal(first.path, `answer-photos/${attemptId}/incoming-${digest}.jpg`)
  await assert.rejects(store.writeIncoming(attemptId, digest, other), { code: 'IDEMPOTENCY_CONFLICT' })
  assert.deepEqual((await store.readIncoming(attemptId, digest, first)).bytes, photo.bytes)
  await assert.rejects(store.readIncoming(randomUUID(), digest, first), { code: 'INVALID_INPUT' })
  await assert.rejects(store.readIncoming(attemptId, digest, { ...first, generation: '9223372036854775807' }), { code: 'INVALID_INPUT' })

  const record = await store.writeRecord(attemptId, digest, first)
  assert.equal(record.path, `answer-photos/${attemptId}/record.jpg`)
  assert.deepEqual(await store.writeRecord(attemptId, digest, first), record)
  assert.deepEqual((await store.readRecord(record)).bytes, photo.bytes)
  await assert.rejects(store.readRecord(first), { code: 'INVALID_INPUT' })
  const replacement = await store.writeIncoming(attemptId, 'b'.repeat(64), other)
  await assert.rejects(store.writeRecord(attemptId, 'b'.repeat(64), replacement), { code: 'IDEMPOTENCY_CONFLICT' })
  assert.deepEqual((await store.readRecord(record)).bytes, photo.bytes)

  await bucket.file(first.path).delete()
  const newVersion = await store.writeIncoming(attemptId, digest, photo)
  assert.notEqual(newVersion.generation, first.generation)
  await assert.rejects(store.readIncoming(attemptId, digest, first), { code: 'SYSTEM_ERROR', retryable: false })

  await t.test('HTTP intake and durable recovery keep JPEGs and results across interruptions', { skip: !firestoreEmulator }, async () => {
    assert(firestoreEmulator && /^127\.0\.0\.1:[1-9]\d{0,4}$/.test(firestoreEmulator) && Number(firestoreEmulator.split(':')[1]) <= 65535)
    process.env.FIRESTORE_EMULATOR_HOST = firestoreEmulator
    const db = getFirestore(app)
    const questId = randomUUID(), placeId = randomUUID()
    const quest = db.collection('quests').doc(questId)
    await Promise.all([
      quest.create({ publishedVersion: 1, status: 'published' }),
      db.collection('questVersions').doc(`${questId}:1`).create({ placeId, areaId: 'demo-area', placeName: '合成対象',
        descriptionSnapshot: '合成説明', revealedLocation: { latitude: 0, longitude: 0 } }),
    ])
    const queued = new Map<string, { uid: string; attemptId: string; digest: string }>()
    const uploadLimiter = new DemoAnswerStore()
    let failEnqueue = false
    const server = createDurableAnswerServer({ db, photos: store, verifier: { verify: async (token) => ({ uid: token }) },
      challengePolicy: { maximum: 10, windowMs: 60_000 }, answerPolicy: { maximum: 10, windowMs: 60_000 },
      acquireUpload: (uid) => uploadLimiter.acquire(uid), enqueue: async (input) => {
        if (failEnqueue) { failEnqueue = false; throw new Error('代替ジョブ投入の障害') }
        queued.set(input.attemptId, input)
      } })
    const { base } = await listenServer(t, server)
    const wrongMethod = await fetch(base + '/api/v1/challenges')
    assert.equal(wrongMethod.status, 405)
    assert.equal(wrongMethod.headers.get('Allow'), 'POST')
    const client = (uid: string) => createApiClient({ fetch: async (path, init) => {
      const response = await fetch(base + String(path), init)
      assert.equal(response.headers.get('X-Quest-Data-Mode'), 'real')
      return response
    }, getIdToken: async () => uid })
    async function submit(uid: string = randomUUID(), latitude = 0, accuracyMeters = 5, interruptEnqueue = false) {
      const api = client(uid)
      const selection = { questId, expectedVersion: 1 }
      const challenge = await api.createChallenge(selection)
      assert.deepEqual(await api.createChallenge(selection), challenge)
      const capturedAt = new Date().toISOString()
      const input = { challengeId: challenge.challengeId, idempotencyKey: randomUUID(),
        photo: new Blob([new Uint8Array(syntheticPng)], { type: 'image/png' }),
        metadata: { capturedAt, position: { latitude, longitude: 0, accuracyMeters, measuredAt: capturedAt } } }
      if (interruptEnqueue) {
        failEnqueue = true
        assert.equal((await api.getSession()).uid, uid)
        await assert.rejects(client('other-owner').submitAnswer(input), { code: 'NOT_FOUND' })
        await assert.rejects(api.submitAnswer(input), { code: 'SYSTEM_ERROR', retryable: true })
        const accepted = await db.collection('attempts').where('challengeId', '==', challenge.challengeId).get()
        assert.equal(accepted.size, 1)
        assert(!queued.has(accepted.docs[0].id))
        return { uid, attemptId: accepted.docs[0].id, digest: String(accepted.docs[0].get('digest')) }
      }
      const receipt = await api.submitAnswer(input)
      assert.equal(receipt.state, 'RECEIVED')
      assert.deepEqual(await api.getAttempt(receipt.attemptId), receipt)
      const identity = queued.get(receipt.attemptId)
      assert(identity && identity.uid === uid)
      return identity
    }
    let matcherCalls = 0, referenceCalls = 0
    const options = { db, photos: store, leaseDurationMs: 180_000, authorize: async () => true,
      locationPolicy: async () => ({ zones: [{ latitude: 0, longitude: 0, radiusMeters: 100 }],
        maxAccuracyMeters: 30, maxAgeMs: 60_000, maxFutureSkewMs: 5_000, maxCaptureMeasurementGapMs: 10_000 }),
      loadReference: async () => { referenceCalls++; return { reference: other, features: ['合成の確認済み特徴'] } },
      matcher: async () => { matcherCalls++; return 'MATCH' },
    }
    const sweep = (worker = options) => runDueAnswerJobs({ worker, maximumJobs: 10, retryDelayMs: 60_000 })
    const identity = await submit(undefined, 0, 5, true)
    await Promise.all([sweep(), sweep()])
    const final = await client(identity.uid).getAttempt(identity.attemptId)
    assert(final.outcome === 'CORRECT')
    await assert.rejects(client('other-owner').getAttempt(identity.attemptId), { code: 'NOT_FOUND' })
    assert.deepEqual(await getDurableAnswer(db, identity.uid, identity.attemptId), final)
    const snapshot = await db.collection('discoveries').doc(final.optionalDiscoveryId).get()
    assert.deepEqual((await store.readRecord(snapshot.get('photoObject'))).bytes, photo.bytes)
    assert.deepEqual(await runDurableAnswer(identity, options), { kind: 'completed', result: final })
    const repeatVisit = await runDurableAnswer(await submit(identity.uid), options)
    assert(repeatVisit.kind === 'completed' && repeatVisit.result.outcome === 'ALREADY_CLEARED')
    assert.equal(repeatVisit.result.optionalDiscoveryId, final.optionalDiscoveryId)

    for (const [latitude, accuracy, expected] of [[1, 5, 'OUTSIDE_AREA'], [0, 50, 'LOCATION_UNCERTAIN']] as const) {
      const located = await submit(undefined, latitude, accuracy)
      const rejected = await runDurableAnswer(located, options)
      assert(rejected.kind === 'completed' && rejected.result.outcome === expected)
      assert.deepEqual(await client(located.uid).getAttempt(located.attemptId), rejected.result)
    }
    assert.equal(referenceCalls, 1)
    assert.equal(matcherCalls, 1)
    for (const outcome of ['WRONG_TARGET', 'IMAGE_UNCERTAIN'] as const) {
      const rejected = await runDurableAnswer(await submit(), { ...options, matcher: async () => outcome })
      assert(rejected.kind === 'completed' && rejected.result.outcome === outcome)
      assert(!rejected.result.optionalDiscoveryId)
    }

    const recoverable = await submit()
    const flaky = { readIncoming: store.readIncoming.bind(store),
      writeRecord: async () => { throw new HttpError(503, 'SYSTEM_ERROR', '一時障害', true) } }
    await assert.rejects(runDurableAnswer(recoverable, { ...options, photos: flaky }), { code: 'SYSTEM_ERROR', retryable: true })
    assert.equal((await getDurableAnswer(db, recoverable.uid, recoverable.attemptId)).state, 'IMAGE_EVALUATED')
    await db.collection('attempts').doc(recoverable.attemptId).update({ 'lease.expiresAt': Timestamp.fromMillis(0), nextWorkAt: Timestamp.fromMillis(0) })
    assert.equal((await sweep()).completed, 1)
    assert.equal((await client(recoverable.uid).getAttempt(recoverable.attemptId)).outcome, 'CORRECT')
    assert.equal(matcherCalls, 2)

    const outage = await submit()
    await assert.rejects(runDurableAnswer(outage, { ...options, matcher: async () => { throw new Error('代替照合の通信障害') } }),
      { code: 'SYSTEM_ERROR', retryable: true })
    assert.equal((await getDurableAnswer(db, outage.uid, outage.attemptId)).outcome, null)
    assert.deepEqual(await runDurableAnswer(outage, options), { kind: 'busy' })
    await db.collection('attempts').doc(outage.attemptId).update({ 'lease.expiresAt': Timestamp.fromMillis(0) })
    assert.equal((await sweep()).examined, 0)
    assert.equal(matcherCalls, 2)

    const deferred = await submit(undefined, 1)
    const deferredRef = db.collection('attempts').doc(deferred.attemptId)
    assert.equal((await sweep({ ...options, authorize: async () => { throw new Error('認証の一時障害') } })).deferred, 1)
    assert((await deferredRef.get()).get('nextWorkAt').toMillis() > Date.now())
    assert.equal((await sweep()).examined, 0)
    await deferredRef.update({ nextWorkAt: Timestamp.fromMillis(0) })
    const future = Timestamp.fromMillis(Date.now() + 180_000)
    const rescheduled = await sweep({ ...options, authorize: async () => {
      await deferredRef.update({ nextWorkAt: future })
      throw new Error('別のプロセスが回収日時を更新した後の障害')
    } })
    assert.equal(rescheduled.deferred, 1)
    assert((await deferredRef.get()).get('nextWorkAt').isEqual(future))
    await deferredRef.update({ nextWorkAt: Timestamp.fromMillis(0) })
    assert.equal((await sweep()).completed, 1)
    assert.equal((await client(deferred.uid).getAttempt(deferred.attemptId)).outcome, 'OUTSIDE_AREA')

    const beforePause = await submit()
    const paused = await submit()
    await assert.rejects(runDurableAnswer(paused, { ...options, loadReference: async () => {
      await quest.update({ publishedVersion: null, status: 'paused' })
      return { reference: other, features: ['合成の確認済み特徴'] }
    } }), { code: 'QUEST_UNAVAILABLE' })
    await assert.rejects(client(paused.uid).createChallenge({ questId, expectedVersion: 1 }), { code: 'QUEST_UNAVAILABLE' })
    await assert.rejects(client(paused.uid).getAttempt(paused.attemptId), { code: 'QUEST_UNAVAILABLE' })
    assert.equal((await sweep()).discarded, 1)
    assert.equal((await db.collection('attempts').doc(beforePause.attemptId).get()).get('nextWorkAt'), undefined)
    assert.equal(matcherCalls, 2)
    const discoveries = await db.collection('discoveries').where('placeId', '==', placeId).get()
    assert.equal(discoveries.size, 2)
  })
})
