import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { deleteApp, initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { commitVerifiedAnswer } from '../src/firestore-answer-commit'

const emulator = process.env.QUEST_FIRESTORE_TEST_HOST

test('Firestore commits the verified answer and its first discovery atomically', {
  skip: !emulator && 'Set QUEST_FIRESTORE_TEST_HOST for the isolated Firestore emulator', timeout: 120_000,
}, async (t) => {
  assert(emulator && /^127\.0\.0\.1:[1-9]\d{0,4}$/.test(emulator) && Number(emulator.split(':')[1]) <= 65535)
  process.env.FIRESTORE_EMULATOR_HOST = emulator
  const app = initializeApp({ projectId: 'demo-t067-finalization' }, 'answer-commit-' + randomUUID())
  const db = getFirestore(app)
  t.after(async () => { await db.terminate(); await deleteApp(app) })

  async function seedQuest(placeId = randomUUID()) {
    const questId = randomUUID()
    const quest = db.collection('quests').doc(questId)
    await Promise.all([
      quest.create({ publishedVersion: 1, status: 'review_pending' }),
      db.collection('questVersions').doc(`${questId}:1`).create({
        placeId, areaId: 'demo-area', placeName: '合成対象', descriptionSnapshot: '確認済みの公開版',
        revealedLocation: { latitude: 0, longitude: 0 },
      }),
    ])

    async function seedAnswer(uid = 'owner') {
      const attemptId = randomUUID()
      const challenge = db.collection('challenges').doc(randomUUID())
      const receipt = db.collection('attempts').doc(attemptId)
      const input = { uid, attemptId, digest: 'a'.repeat(64), leaseId: randomUUID() }
      await Promise.all([
        challenge.create({ uid, questId, version: 1 }),
        receipt.create({ uid, digest: input.digest, challengeId: challenge.id, questId, version: 1, state: 'COMMITTING',
          lease: { id: input.leaseId, expiresAt: Timestamp.fromMillis(Date.now() + 180_000) },
          checkpoint: { placeId, version: 1, location: 'WITHIN_AREA', photo: 'MATCH', generation: '1234' },
        }),
      ])
      return { input, receipt, challenge, commit: () => commitVerifiedAnswer(db, input) }
    }

    const records = () => db.collection('discoveries').where('placeId', '==', placeId).get()
    return { quest, placeId, seedAnswer, records }
  }

  await t.test('concurrent answers for the same owner and place share one initial photo and time', async () => {
    const fixture = await seedQuest()
    const otherQuest = await seedQuest(fixture.placeId)
    const [first, second] = await Promise.all([fixture.seedAnswer(), otherQuest.seedAnswer()])
    const [a, b] = await Promise.all([first.commit(), second.commit()])
    assert.deepEqual([a.outcome, b.outcome].sort(), ['ALREADY_CLEARED', 'CORRECT'])
    assert(a.optionalDiscoveryId)
    assert.equal(a.optionalDiscoveryId, b.optionalDiscoveryId)
    const winner = a.outcome === 'CORRECT' ? first : second
    const snapshot = await fixture.records()
    assert.equal(snapshot.size, 1)
    const record = snapshot.docs[0].data()
    assert.equal(record.uid, 'owner')
    assert.equal(record.placeName, '合成対象')
    assert(record.firstClearedAt instanceof Timestamp)
    assert.deepEqual(record.photoObject, { path: `answer-photos/${winner.input.attemptId}/record.jpg`, generation: '1234' })
    const [receiptA, receiptB] = await Promise.all([first.receipt.get(), second.receipt.get()])
    assert.deepEqual(receiptA.get('result'), a)
    assert.deepEqual(receiptB.get('result'), b)
    assert.equal(receiptA.get('checkpoint'), undefined)
    assert.equal(receiptB.get('lease'), undefined)

    await fixture.quest.update({ publishedVersion: null, status: 'paused' })
    assert.deepEqual(await first.commit(), a)
    assert.deepEqual((await fixture.records()).docs[0].data(), record)
    await assert.rejects(commitVerifiedAnswer(db, { ...first.input, uid: 'other-owner' }), { code: 'NOT_FOUND' })
    await assert.rejects(commitVerifiedAnswer(db, { ...first.input, digest: 'b'.repeat(64) }), { code: 'IDEMPOTENCY_CONFLICT' })
  })

  await t.test('replaying one answer concurrently is stable and another owner has an independent record', async () => {
    const fixture = await seedQuest()
    const [first, other] = await Promise.all([fixture.seedAnswer(), fixture.seedAnswer('other-owner')])
    const [a, replay, b] = await Promise.all([first.commit(), first.commit(), other.commit()])
    assert.equal(a.outcome, 'CORRECT')
    assert.deepEqual(a, replay)
    assert.equal(b.outcome, 'CORRECT')
    assert.notEqual(a.optionalDiscoveryId, b.optionalDiscoveryId)
    assert.equal((await fixture.records()).size, 2)
  })

  await t.test('pause, changed version, stale lease and invalid private evidence cannot commit', async () => {
    const fixture = await seedQuest()
    const pending = await fixture.seedAnswer()
    await fixture.quest.update({ publishedVersion: null, status: 'paused' })
    await assert.rejects(pending.commit(), { code: 'QUEST_UNAVAILABLE' })
    await fixture.quest.update({ publishedVersion: 2, status: 'published' })
    await assert.rejects(pending.commit(), { code: 'QUEST_CHANGED' })
    await fixture.quest.update({ publishedVersion: 1 })
    await pending.challenge.update({ uid: 'other-owner' })
    await assert.rejects(pending.commit(), { code: 'NOT_FOUND' })
    await pending.challenge.update({ uid: pending.input.uid })
    await pending.receipt.update({ 'lease.expiresAt': Timestamp.fromMillis(0) })
    await assert.rejects(pending.commit(), { code: 'SYSTEM_ERROR', retryable: true })
    const newLease = randomUUID()
    await pending.receipt.update({ lease: { id: newLease, expiresAt: Timestamp.fromMillis(Date.now() + 180_000) } })
    await assert.rejects(pending.commit(), { code: 'SYSTEM_ERROR', retryable: true })
    const finishWithLease = () => commitVerifiedAnswer(db, { ...pending.input, leaseId: newLease })
    await pending.receipt.update({ 'checkpoint.photo': 'WRONG_TARGET' })
    await assert.rejects(finishWithLease(), { code: 'SYSTEM_ERROR', retryable: false })
    await pending.receipt.update({ 'checkpoint.photo': 'MATCH', 'checkpoint.placeId': randomUUID() })
    await assert.rejects(finishWithLease(), { code: 'SYSTEM_ERROR', retryable: false })
    await pending.receipt.update({ 'checkpoint.placeId': fixture.placeId, 'checkpoint.version': 2 })
    await assert.rejects(finishWithLease(), { code: 'SYSTEM_ERROR', retryable: false })
    await pending.receipt.update({ 'checkpoint.version': 1, 'checkpoint.generation': '9223372036854775808' })
    await assert.rejects(finishWithLease(), { code: 'SYSTEM_ERROR', retryable: false })
    assert.equal((await fixture.records()).size, 0)
    assert.equal((await pending.receipt.get()).get('state'), 'COMMITTING')
    await pending.receipt.update({ 'checkpoint.generation': '1234' })
    assert.equal((await finishWithLease()).outcome, 'CORRECT')
  })
})
