import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { Storage } from '@google-cloud/storage'
import { deleteApp, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { AnswerPhotoStorage } from '../src/answer-photo-storage'
import { acceptDurableAnswer, getDurableAnswer, prepareAnswerIntake } from '../src/firestore-answer-intake'
import { claimAnswerWork, commitVerifiedAnswer, recordAnswerMatch, recordAnswerPhoto } from '../src/firestore-answer-processing'
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

  await t.test('a Firestore receipt and discovery keep the actual stored JPEG generations', { skip: !firestoreEmulator }, async () => {
    assert(firestoreEmulator && /^127\.0\.0\.1:[1-9]\d{0,4}$/.test(firestoreEmulator) && Number(firestoreEmulator.split(':')[1]) <= 65535)
    process.env.FIRESTORE_EMULATOR_HOST = firestoreEmulator
    const db = getFirestore(app)
    const uid = randomUUID(), questId = randomUUID(), placeId = randomUUID(), challengeId = randomUUID()
    await Promise.all([
      db.collection('challenges').doc(challengeId).create({ uid, questId, version: 1 }),
      db.collection('quests').doc(questId).create({ publishedVersion: 1, status: 'published' }),
      db.collection('questVersions').doc(`${questId}:1`).create({ placeId, areaId: 'demo-area', placeName: '合成対象',
        descriptionSnapshot: '合成説明', revealedLocation: { latitude: 0, longitude: 0 } }),
    ])
    const submission = { uid, challengeId, digest, idempotencyKey: 'first-answer' }
    const policy = { maximum: 1, windowMs: 60_000 }
    const upload = await prepareAnswerIntake(db, submission, policy)
    assert(upload.kind === 'upload')
    const incoming = await store.writeIncoming(upload.attemptId, digest, photo)
    assert.equal(incoming.path, upload.objectPath)
    const capturedAt = '2026-11-06T00:00:00.000Z'
    await acceptDurableAnswer(db, { ...submission, generation: incoming.generation,
      metadata: { capturedAt, position: { latitude: 0, longitude: 0, accuracyMeters: 5, measuredAt: capturedAt } } }, policy)
    const identity = { uid, attemptId: upload.attemptId, digest }
    const claim = await claimAnswerWork(db, identity, { leaseDurationMs: 180_000 })
    assert(claim.kind === 'claimed' && claim.step === 'verify')
    assert.deepEqual(claim.source.photoObject, incoming)
    assert.deepEqual((await store.readIncoming(identity.attemptId, digest, claim.source.photoObject)).bytes, photo.bytes)
    const lease = { ...identity, leaseId: claim.leaseId }
    await recordAnswerMatch(db, lease, { placeId, version: 1, location: 'WITHIN_AREA', photo: 'MATCH' })
    const recordPhoto = await store.writeRecord(identity.attemptId, digest, claim.source.photoObject)
    await recordAnswerPhoto(db, lease, recordPhoto.generation)
    const final = await commitVerifiedAnswer(db, lease)
    assert(final.outcome === 'CORRECT')
    assert.deepEqual(await getDurableAnswer(db, uid, identity.attemptId), final)
    const snapshot = await db.collection('discoveries').doc(final.optionalDiscoveryId).get()
    assert.deepEqual(snapshot.get('photoObject'), recordPhoto)
    assert.deepEqual((await store.readRecord(recordPhoto)).bytes, photo.bytes)
  })
})
