import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { Storage } from '@google-cloud/storage'
import { deleteApp, initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { AnswerPhotoStorage } from '../src/answer-photo-storage'
import { runDurableAnswer } from '../src/durable-answer-worker'
import { HttpError } from '../src/errors'
import { acceptDurableAnswer, getDurableAnswer, prepareAnswerIntake } from '../src/firestore-answer-intake'
import { preparePhoto } from '../src/photo-input'
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

  await t.test('the durable worker uses stored JPEGs, distinguishes failures and resumes without repeating a match', { skip: !firestoreEmulator }, async () => {
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
    async function submit(uid: string = randomUUID(), latitude = 0, accuracyMeters = 5) {
      const challengeId = randomUUID()
      await db.collection('challenges').doc(challengeId).create({ uid, questId, version: 1 })
      const submission = { uid, challengeId, digest, idempotencyKey: 'first-answer' }
      const policy = { maximum: 10, windowMs: 60_000 }
      const upload = await prepareAnswerIntake(db, submission, policy)
      assert(upload.kind === 'upload')
      const incoming = await store.writeIncoming(upload.attemptId, digest, photo)
      assert.equal(incoming.path, upload.objectPath)
      const capturedAt = new Date().toISOString()
      await acceptDurableAnswer(db, { ...submission, generation: incoming.generation,
        metadata: { capturedAt, position: { latitude, longitude: 0, accuracyMeters, measuredAt: capturedAt } } }, policy)
      return { uid, attemptId: upload.attemptId, digest }
    }
    let matcherCalls = 0, referenceCalls = 0
    const options = { db, photos: store, leaseDurationMs: 180_000, authorize: async () => true,
      locationPolicy: async () => ({ zones: [{ latitude: 0, longitude: 0, radiusMeters: 100 }],
        maxAccuracyMeters: 30, maxAgeMs: 60_000, maxFutureSkewMs: 5_000, maxCaptureMeasurementGapMs: 10_000 }),
      loadReference: async () => { referenceCalls++; return { reference: other, features: ['合成の確認済み特徴'] } },
      matcher: async () => { matcherCalls++; return 'MATCH' },
    }
    const identity = await submit()
    const final = await runDurableAnswer(identity, options)
    assert(final.kind === 'completed' && final.result.outcome === 'CORRECT')
    assert.deepEqual(await getDurableAnswer(db, identity.uid, identity.attemptId), final.result)
    const snapshot = await db.collection('discoveries').doc(final.result.optionalDiscoveryId).get()
    assert.deepEqual((await store.readRecord(snapshot.get('photoObject'))).bytes, photo.bytes)
    assert.deepEqual(await runDurableAnswer(identity, options), final)
    const repeatVisit = await runDurableAnswer(await submit(identity.uid), options)
    assert(repeatVisit.kind === 'completed' && repeatVisit.result.outcome === 'ALREADY_CLEARED')
    assert.equal(repeatVisit.result.optionalDiscoveryId, final.result.optionalDiscoveryId)

    for (const [latitude, accuracy, expected] of [[1, 5, 'OUTSIDE_AREA'], [0, 50, 'LOCATION_UNCERTAIN']] as const) {
      const located = await submit(undefined, latitude, accuracy)
      const rejected = await runDurableAnswer(located, options)
      assert(rejected.kind === 'completed' && rejected.result.outcome === expected)
      assert.deepEqual(await getDurableAnswer(db, located.uid, located.attemptId), rejected.result)
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
    await db.collection('attempts').doc(recoverable.attemptId).update({ 'lease.expiresAt': Timestamp.fromMillis(0) })
    const resumed = await runDurableAnswer(recoverable, options)
    assert(resumed.kind === 'completed' && resumed.result.outcome === 'CORRECT')
    assert.equal(matcherCalls, 2)

    const outage = await submit()
    await assert.rejects(runDurableAnswer(outage, { ...options, matcher: async () => { throw new Error('代替照合の通信障害') } }),
      { code: 'SYSTEM_ERROR', retryable: true })
    assert.equal((await getDurableAnswer(db, outage.uid, outage.attemptId)).outcome, null)
    assert.deepEqual(await runDurableAnswer(outage, options), { kind: 'busy' })

    const paused = await submit()
    await assert.rejects(runDurableAnswer(paused, { ...options, loadReference: async () => {
      await quest.update({ publishedVersion: null, status: 'paused' })
      return { reference: other, features: ['合成の確認済み特徴'] }
    } }), { code: 'QUEST_UNAVAILABLE' })
    assert.equal(matcherCalls, 2)
    const discoveries = await db.collection('discoveries').where('placeId', '==', placeId).get()
    assert.equal(discoveries.size, 2)
  })
})
