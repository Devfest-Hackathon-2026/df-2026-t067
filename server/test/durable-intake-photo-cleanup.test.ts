import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { Storage } from '@google-cloud/storage'
import { deleteApp, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import test from 'node:test'
import { AnswerPhotoStorage } from '../src/answer-photo-storage'
import { runIntakePhotoCleanup } from '../src/durable-intake-photo-cleanup'
import { acceptDurableAnswer, prepareAnswerIntake } from '../src/firestore-answer-intake'
import { preparePhoto } from '../src/photo-input'
import { syntheticPng } from './photo-fixtures'

const firestore = process.env.QUEST_FIRESTORE_TEST_HOST
const storage = process.env.QUEST_STORAGE_TEST_HOST

test('intake cleanup seals old orphan uploads and keeps images belonging to accepted answers', {
  skip: !firestore || !storage, timeout: 20_000,
}, async (t) => {
  for (const address of [firestore, storage]) {
    assert(address && /^127\.0\.0\.1:[1-9]\d{0,4}$/.test(address) && Number(address.split(':')[1]) <= 65535)
  }
  process.env.FIRESTORE_EMULATOR_HOST = firestore
  delete process.env.STORAGE_EMULATOR_HOST
  const projectId = 'demo-t067-intake-cleanup', bucketName = projectId + '.appspot.com'
  const setup = await fetch('http://' + storage + '/storage/v1/b?project=' + projectId, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: bucketName }),
  })
  assert(setup.ok || setup.status === 409)
  await setup.body?.cancel()
  const app = initializeApp({ projectId }, 'intake-cleanup')
  t.after(() => deleteApp(app))
  const db = getFirestore(app)
  db.settings({ universeDomain: 'googleapis.com' })
  const bucket = new Storage({ projectId, apiEndpoint: 'http://' + storage }).bucket(bucketName)
  const photos = new AnswerPhotoStorage(bucket)
  const jpeg = await preparePhoto({ bytes: syntheticPng, mimeType: 'image/png' })
  const uid = 'owner', challengeId = 'challenge', questId = 'quest'
  const batch = db.batch()
  batch.create(db.collection('quests').doc(questId), { publishedVersion: 1, status: 'published' })
  batch.create(db.collection('questVersions').doc(questId + ':1'), { placeId: 'place' })
  batch.create(db.collection('challenges').doc(challengeId), { uid, questId, version: 1 })
  await batch.commit()
  const policy = { maximum: 10, windowMs: 60_000 }
  const capturedAt = new Date().toISOString()
  const metadata = { capturedAt, position: { latitude: 0, longitude: 0, accuracyMeters: 5, measuredAt: capturedAt } }
  function submission(idempotencyKey: string, digest: string) {
    const attemptId = createHash('sha256').update(JSON.stringify([uid, challengeId, idempotencyKey])).digest('hex')
    return { attemptId, input: { uid, challengeId, idempotencyKey, digest } }
  }
  const accepted = submission('accepted', 'a'.repeat(64))
  const orphan = submission('orphan', 'b'.repeat(64))
  const acceptedPhoto = await photos.writeIncoming(accepted.attemptId, accepted.input.digest, jpeg)
  const orphanPhoto = await photos.writeIncoming(orphan.attemptId, orphan.input.digest, jpeg)
  const losingDigest = 'c'.repeat(64)
  const losingPhoto = await photos.writeIncoming(accepted.attemptId, losingDigest, jpeg)
  await photos.writeReference('org', 'reference', jpeg)
  await acceptDurableAnswer(db, { ...accepted.input, metadata, generation: acceptedPhoto.generation }, policy)

  const fresh = await runIntakePhotoCleanup(db, photos, { before: Date.now() - 60_000, maximumPhotos: 10 })
  assert.equal(fresh.deleted, 0)
  assert((await bucket.file(orphanPhoto.path).exists())[0])
  assert.equal((await prepareAnswerIntake(db, orphan.input, policy)).kind, 'upload')

  const cutoff = Date.now() + 60_000
  let cursor: string | undefined
  let deleted = 0
  for (let page = 0; page < 5; page++) {
    const result = await runIntakePhotoCleanup(db, photos, { before: cutoff, maximumPhotos: 2, cursor })
    assert.equal(result.failed, 0)
    deleted += result.deleted
    cursor = result.cursor
    if (!cursor) break
  }
  assert.equal(cursor, undefined)
  assert.equal(deleted, 2)
  assert((await bucket.file(acceptedPhoto.path).exists())[0])
  assert((await bucket.file('reference-photos/org/reference.jpg').exists())[0])
  assert.equal((await bucket.file(orphanPhoto.path).exists())[0], false)
  assert.equal((await bucket.file(losingPhoto.path).exists())[0], false)
  await assert.rejects(prepareAnswerIntake(db, orphan.input, policy), { code: 'IDEMPOTENCY_CONFLICT' })
  await assert.rejects(prepareAnswerIntake(db, { ...orphan.input, digest: losingDigest }, policy), { code: 'IDEMPOTENCY_CONFLICT' })
  await assert.rejects(acceptDurableAnswer(db, { ...orphan.input, metadata, generation: orphanPhoto.generation }, policy),
    { code: 'IDEMPOTENCY_CONFLICT' })
  assert.equal((await prepareAnswerIntake(db, accepted.input, policy)).kind, 'replay')

  // A writer that was already past preflight can finish after the first
  // sweep. It cannot obtain a receipt and the next sweep removes its object.
  const late = await photos.writeIncoming(orphan.attemptId, orphan.input.digest, jpeg)
  await assert.rejects(acceptDurableAnswer(db, { ...orphan.input, metadata, generation: late.generation }, policy),
    { code: 'IDEMPOTENCY_CONFLICT' })
  assert.equal((await runIntakePhotoCleanup(db, photos, { before: cutoff, maximumPhotos: 10 })).deleted, 1)
  assert.equal((await bucket.file(late.path).exists())[0], false)
  assert((await bucket.file(acceptedPhoto.path).exists())[0])

  const retry = submission('delete-retry', 'd'.repeat(64))
  const retryPhoto = await photos.writeIncoming(retry.attemptId, retry.input.digest, jpeg)
  const failed = await runIntakePhotoCleanup(db, {
    listIncomingPhotos: photos.listIncomingPhotos.bind(photos),
    deleteIncoming: async () => { throw new Error('transient storage failure') },
  }, { before: cutoff, maximumPhotos: 10 })
  assert.equal(failed.failed, 1)
  assert((await bucket.file(retryPhoto.path).exists())[0])
  await assert.rejects(acceptDurableAnswer(db, { ...retry.input, metadata, generation: retryPhoto.generation }, policy),
    { code: 'IDEMPOTENCY_CONFLICT' })
  assert.equal((await runIntakePhotoCleanup(db, photos, { before: cutoff, maximumPhotos: 10 })).deleted, 1)

  const racing = submission('racing', 'e'.repeat(64))
  const racingPhoto = await photos.writeIncoming(racing.attemptId, racing.input.digest, jpeg)
  const [intake, cleanup] = await Promise.allSettled([
    acceptDurableAnswer(db, { ...racing.input, metadata, generation: racingPhoto.generation }, policy),
    runIntakePhotoCleanup(db, photos, { before: cutoff, maximumPhotos: 10 }),
  ])
  assert.equal(cleanup.status, 'fulfilled')
  assert.equal(cleanup.value.failed, 0)
  if (intake.status === 'fulfilled') {
    assert.equal(intake.value.state, 'RECEIVED')
    assert((await bucket.file(racingPhoto.path).exists())[0])
  } else {
    assert.equal(intake.reason.code, 'IDEMPOTENCY_CONFLICT')
    assert.equal((await bucket.file(racingPhoto.path).exists())[0], false)
  }
})
