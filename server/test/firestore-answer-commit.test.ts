import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { deleteApp, initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { acceptDurableAnswer, getDurableAnswer, prepareAnswerIntake } from '../src/firestore-answer-intake'
import { claimAnswerWork, commitVerifiedAnswer, recordAnswerMatch, recordAnswerPhoto } from '../src/firestore-answer-processing'

const emulator = process.env.QUEST_FIRESTORE_TEST_HOST
const policy = { maximum: 10, windowMs: 60_000 }
const metadata = { capturedAt: '2026-11-06T00:00:00.000Z',
  position: { latitude: 0, longitude: 0, accuracyMeters: 4, measuredAt: '2026-11-06T00:00:00.000Z' } }

test('Firestore leases, resumes and atomically commits answers', {
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

    async function seedChallenge(uid = 'owner') {
      const challenge = db.collection('challenges').doc(randomUUID())
      await challenge.create({ uid, questId, version: 1 })
      const submission = { uid, challengeId: challenge.id, idempotencyKey: randomUUID(), digest: 'a'.repeat(64) }
      return { challenge, submission }
    }

    async function seedAnswer(uid = 'owner', state: 'RECEIVED' | 'COMMITTING' = 'COMMITTING') {
      const { challenge, submission } = await seedChallenge(uid)
      const attemptId = state === 'RECEIVED'
        ? (await acceptDurableAnswer(db, { ...submission, metadata, generation: '4321' }, policy)).attemptId
        : randomUUID()
      const receipt = db.collection('attempts').doc(attemptId)
      const input = { uid, attemptId, digest: submission.digest, leaseId: randomUUID() }
      if (state === 'COMMITTING') await receipt.create({ uid, digest: input.digest, challengeId: challenge.id, questId, version: 1, state,
        lease: { id: input.leaseId, expiresAt: Timestamp.fromMillis(Date.now() + 180_000) },
        checkpoint: { placeId, version: 1, location: 'WITHIN_AREA', photo: 'MATCH', generation: '1234' },
      })
      return { input, receipt, challenge, commit: () => commitVerifiedAnswer(db, input) }
    }

    const records = () => db.collection('discoveries').where('placeId', '==', placeId).get()
    return { quest, placeId, seedAnswer, seedChallenge, records }
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

  await t.test('one worker claims the answer and later workers resume from the durable match and photo', async () => {
    const fixture = await seedQuest()
    const pending = await fixture.seedAnswer('owner', 'RECEIVED')
    const claim = () => claimAnswerWork(db, pending.input, { leaseDurationMs: 180_000 })
    const claims = await Promise.all([claim(), claim()])
    assert.deepEqual(claims.map(({ kind }) => kind).sort(), ['busy', 'claimed'])
    const first = claims.find((candidate) => candidate.kind === 'claimed')
    assert(first?.kind === 'claimed' && first.step === 'verify')
    assert.deepEqual(first.source.metadata, metadata)
    assert(first.source.receivedAt > 0)
    assert.deepEqual(first.source.photoObject, {
      path: `answer-photos/${pending.input.attemptId}/incoming-${pending.input.digest}.jpg`, generation: '4321',
    })
    const firstLease = { ...pending.input, leaseId: first.leaseId }
    const proof = { placeId: fixture.placeId, version: 1, location: 'WITHIN_AREA', photo: 'MATCH' } as const
    await assert.rejects(recordAnswerPhoto(db, firstLease, '1234'), { code: 'SYSTEM_ERROR', retryable: true })
    await assert.rejects(recordAnswerMatch(db, firstLease, { ...proof, version: 2 }), { code: 'QUEST_CHANGED' })
    await recordAnswerMatch(db, firstLease, proof)
    await recordAnswerMatch(db, firstLease, proof)
    assert.equal((await pending.receipt.get()).get('state'), 'IMAGE_EVALUATED')
    assert.equal((await fixture.records()).size, 0)
    assert.deepEqual(await claim(), { kind: 'busy' })

    await pending.receipt.update({ 'lease.expiresAt': Timestamp.fromMillis(0) })
    const second = await claim()
    assert(second.kind === 'claimed' && second.step === 'prepare-photo')
    assert.deepEqual(second.source, first.source)
    const secondLease = { ...pending.input, leaseId: second.leaseId }
    assert.notEqual(secondLease.leaseId, firstLease.leaseId)
    await assert.rejects(recordAnswerPhoto(db, firstLease, '1234'), { code: 'SYSTEM_ERROR', retryable: true })
    await recordAnswerPhoto(db, secondLease, '1234')
    await recordAnswerPhoto(db, secondLease, '1234')
    await assert.rejects(recordAnswerPhoto(db, secondLease, '9999'), { code: 'IDEMPOTENCY_CONFLICT' })
    await recordAnswerMatch(db, secondLease, proof)
    assert.equal((await pending.receipt.get()).get('state'), 'COMMITTING')

    await pending.receipt.update({ 'lease.expiresAt': Timestamp.fromMillis(0) })
    const third = await claim()
    assert(third.kind === 'claimed' && third.step === 'commit')
    assert(!('source' in third))
    await assert.rejects(commitVerifiedAnswer(db, secondLease), { code: 'SYSTEM_ERROR', retryable: true })
    const result = await commitVerifiedAnswer(db, { ...pending.input, leaseId: third.leaseId })
    assert.equal(result.outcome, 'CORRECT')
    assert.deepEqual(await claim(), { kind: 'completed', result })
    assert.deepEqual(await getDurableAnswer(db, pending.input.uid, pending.input.attemptId), result)
    assert.equal((await pending.receipt.get()).get('capture'), undefined)
    assert.equal((await fixture.records()).size, 1)
  })

  await t.test('expired verification needs an explicit retry and paused versions stop work at every stage', async () => {
    const fixture = await seedQuest()
    const pending = await fixture.seedAnswer('owner', 'RECEIVED')
    const options = { leaseDurationMs: 180_000 }
    await assert.rejects(claimAnswerWork(db, { ...pending.input, uid: 'other' }, options), { code: 'NOT_FOUND' })
    const first = await claimAnswerWork(db, pending.input, options)
    assert(first.kind === 'claimed')
    await pending.receipt.update({ 'lease.expiresAt': Timestamp.fromMillis(0) })
    assert.deepEqual(await claimAnswerWork(db, pending.input, options), { kind: 'verification-expired' })
    assert.equal((await pending.receipt.get()).get('lease.id'), first.leaseId)
    const replacement = await claimAnswerWork(db, pending.input, { ...options, retryVerification: true })
    assert(replacement.kind === 'claimed' && replacement.step === 'verify')
    const lease = { ...pending.input, leaseId: replacement.leaseId }
    const proof = { placeId: fixture.placeId, version: 1, location: 'WITHIN_AREA', photo: 'MATCH' } as const
    await fixture.quest.update({ publishedVersion: null, status: 'paused' })
    await assert.rejects(recordAnswerMatch(db, lease, proof), { code: 'QUEST_UNAVAILABLE' })
    await assert.rejects(claimAnswerWork(db, pending.input, options), { code: 'QUEST_UNAVAILABLE' })
    assert.equal((await pending.receipt.get()).get('checkpoint'), undefined)
    await fixture.quest.update({ publishedVersion: 1, status: 'published' })
    await recordAnswerMatch(db, lease, proof)
    await fixture.quest.update({ publishedVersion: 2, status: 'published' })
    await assert.rejects(recordAnswerPhoto(db, lease, '1234'), { code: 'QUEST_CHANGED' })
    assert.equal((await pending.receipt.get()).get('state'), 'IMAGE_EVALUATED')
    assert.equal((await fixture.records()).size, 0)
  })

  await t.test('intake returns an owner-only receipt and deduplicates a concurrent replay without charging the limit', async () => {
    const fixture = await seedQuest()
    const { submission } = await fixture.seedChallenge(randomUUID())
    const limit = { maximum: 1, windowMs: 180_000 }
    const upload = await prepareAnswerIntake(db, submission, limit)
    assert(upload.kind === 'upload')
    assert.equal(upload.objectPath, `answer-photos/${upload.attemptId}/incoming-${submission.digest}.jpg`)
    await assert.rejects(getDurableAnswer(db, submission.uid, upload.attemptId), { code: 'NOT_FOUND' })
    const accept = () => acceptDurableAnswer(db, { ...submission, metadata, generation: '1234' }, limit)
    const [first, second] = await Promise.all([accept(), accept()])
    assert.deepEqual(first, { attemptId: upload.attemptId, state: 'RECEIVED', outcome: null, nextAction: 'WAIT', source: 'real' })
    assert.deepEqual(second, first)
    assert.deepEqual(await prepareAnswerIntake(db, submission, limit), { kind: 'replay', result: first })
    assert.deepEqual(await getDurableAnswer(db, submission.uid, upload.attemptId), first)
    await assert.rejects(getDurableAnswer(db, 'another-owner', upload.attemptId), { code: 'NOT_FOUND' })
    await assert.rejects(prepareAnswerIntake(db, { ...submission, digest: 'b'.repeat(64) }, limit), { code: 'IDEMPOTENCY_CONFLICT' })
    await assert.rejects(prepareAnswerIntake(db, { ...submission, idempotencyKey: 'second' }, limit), { code: 'RATE_LIMITED' })
  })

  await t.test('intake rechecks the public version after the upload and enforces a shared limit under concurrency', async () => {
    const fixture = await seedQuest()
    const { submission } = await fixture.seedChallenge(randomUUID())
    const limit = { maximum: 1, windowMs: 180_000 }
    const upload = await prepareAnswerIntake(db, submission, limit)
    assert(upload.kind === 'upload')
    const accept = (idempotencyKey: string = submission.idempotencyKey) =>
      acceptDurableAnswer(db, { ...submission, idempotencyKey, metadata, generation: '1234' }, limit)
    await fixture.quest.update({ publishedVersion: null, status: 'paused' })
    await assert.rejects(accept(), { code: 'QUEST_UNAVAILABLE' })
    await fixture.quest.update({ publishedVersion: 2, status: 'published' })
    await assert.rejects(accept(), { code: 'QUEST_CHANGED' })
    await assert.rejects(getDurableAnswer(db, submission.uid, upload.attemptId), { code: 'NOT_FOUND' })
    await fixture.quest.update({ publishedVersion: 1 })
    await assert.rejects(prepareAnswerIntake(db, { ...submission, uid: 'another-owner' }, limit), { code: 'NOT_FOUND' })
    const results = await Promise.allSettled([accept(), accept('second')])
    assert.equal(results.filter(({ status }) => status === 'fulfilled').length, 1)
    const rejected = results.find(({ status }) => status === 'rejected')
    assert(rejected?.status === 'rejected')
    assert.equal(rejected.reason.code, 'RATE_LIMITED')
    assert(rejected.reason.retryAfterSeconds > 0)
  })
})
