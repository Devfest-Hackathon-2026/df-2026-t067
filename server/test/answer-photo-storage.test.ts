import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { Storage } from '@google-cloud/storage'
import { deleteApp, initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { createApiClient } from '../../src/shared/api/client'
import { AnswerPhotoStorage } from '../src/answer-photo-storage'
import { DemoAnswerStore } from '../src/answers'
import { durableFixtureFeatures } from '../src/demo-photo-test'
import { createDurableAnswerServer } from '../src/durable-answer-http'
import { runDueAnswerJobs } from '../src/durable-answer-jobs'
import { cleanupFinishedAnswerPhotos, runDueAnswerPhotoCleanup } from '../src/durable-answer-photo-cleanup'
import { createDurableAnswerRuntime } from '../src/durable-answer-runtime'
import { runDurableAnswer } from '../src/durable-answer-worker'
import { createSyntheticVertexTrialMatcher } from '../src/durable-vertex-trial'
import { HttpError } from '../src/errors'
import { getDurableAnswer } from '../src/firestore-answer-intake'
import { claimAnswerWork, commitVerifiedAnswer, recordAnswerMatch, recordAnswerPhoto } from '../src/firestore-answer-processing'
import { runDueDiscoveryDeletions } from '../src/firestore-discovery-deletions'
import { FirestoreOrgAssetStore } from '../src/firestore-org-assets'
import { preparePhoto } from '../src/photo-input'
import { createPublishedAnswerMaterialLoader } from '../src/published-answer-material'
import { initializeTrialLedger } from '../src/vertex-trial-ledger'
import { createVertexTrialTransport, trialEndpoint } from '../src/vertex-transport'
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

  await t.test('durable organization uploads resume across server instances and cannot outlive membership', {
    skip: !firestoreEmulator,
  }, async (assetTest) => {
    assert(firestoreEmulator && /^127\.0\.0\.1:[1-9]\d{0,4}$/.test(firestoreEmulator) &&
      Number(firestoreEmulator.split(':')[1]) <= 65535)
    process.env.FIRESTORE_EMULATOR_HOST = firestoreEmulator
    const assetsApp = initializeApp({ projectId: 'demo-t067-org-assets' }, 'org-assets-' + randomUUID())
    assetTest.after(() => deleteApp(assetsApp))
    const db = getFirestore(assetsApp)
    db.settings({ universeDomain: 'googleapis.com' })
    const orgId = 'test-org', otherOrg = 'other-org'
    const member = (uid: string, org: string) =>
      db.collection('memberships').doc(createHash('sha256').update(JSON.stringify([uid, org])).digest('hex'))
    for (const [uid, org] of [['editor', orgId], ['colleague', orgId], ['other', otherOrg]]) {
      await member(uid, org).create({ uid, orgId: org, active: true, role: 'editor', label: '架空の自治体', areaId: 'demo-area' })
    }
    let revoke = false
    const pictures = {
      async writeReference(...args: Parameters<AnswerPhotoStorage['writeReference']>) {
        const result = await store.writeReference(...args)
        if (revoke) await member('editor', orgId).update({ active: false })
        return result
      },
      readReference: store.readReference.bind(store),
      writeHint: store.writeHint.bind(store),
      readHint: store.readHint.bind(store),
    }
    async function start() {
      const policy = { maximum: 10, windowMs: 60_000 }
      const server = createDurableAnswerServer({ db, photos: store, verifier: { verify: async (token) => ({ uid: token }) },
        dataMode: 'durable-local', assets: new FirestoreOrgAssetStore(db, pictures),
        answerPolicy: policy, challengePolicy: policy, acquireUpload: () => () => {} })
      const { base } = await listenServer(assetTest, server)
      return (uid: string) => createApiClient({ expectedDataMode: 'durable-local',
        getIdToken: async () => uid, fetch: (path, init) => fetch(base + String(path), init) })
    }
    const first = await start(), second = await start()
    const input = { photo: new Blob([new Uint8Array(syntheticPng)], { type: 'image/png' }),
      purpose: 'reference' as const, photoRights: '検証用の合成画像', idempotencyKey: 'same-request' }
    await assert.rejects(first('traveler').uploadOrgAsset(orgId, input), { code: 'FORBIDDEN' })
    const [saved, replay] = await Promise.all([first('editor').uploadOrgAsset(orgId, input), second('editor').uploadOrgAsset(orgId, input)])
    assert.deepEqual(saved, replay)
    assert.equal(saved.source, 'real')
    assert.deepEqual(await second('colleague').getOrgAsset(orgId, saved.assetId), saved)
    assert.deepEqual(Buffer.from(await (await second('colleague').getOrgAssetPhoto(orgId, saved.assetId)).arrayBuffer()), photo.bytes)
    assert.equal((await db.collection('orgAssets').get()).size, 1)
    await assert.rejects(second('other').getOrgAssetPhoto(orgId, saved.assetId), { code: 'FORBIDDEN' })
    await assert.rejects(second('other').getOrgAsset(otherOrg, saved.assetId), { code: 'NOT_FOUND' })
    await assert.rejects(second('editor').uploadOrgAsset(orgId, { ...input, purpose: 'public_hint' }), { code: 'IDEMPOTENCY_CONFLICT' })

    const hint = await second('editor').uploadOrgAsset(orgId, { ...input, purpose: 'public_hint', idempotencyKey: 'hint' })
    const hintGeneration = (await db.collection('orgAssets').doc(hint.assetId).get()).get('generation')
    assert.deepEqual(Buffer.from(await (await second('colleague').getOrgAssetPhoto(orgId, hint.assetId)).arrayBuffer()), photo.bytes)
    await assert.rejects(store.readReference(orgId, hint.assetId, hintGeneration), { code: 'SYSTEM_ERROR', retryable: false })

    revoke = true
    const interrupted = { ...input, idempotencyKey: 'revoked-during-upload' }
    await assert.rejects(first('editor').uploadOrgAsset(orgId, interrupted), { code: 'FORBIDDEN' })
    const pending = await db.collection('orgAssets').get()
    assert.equal(pending.size, 3)
    const receipt = pending.docs.find((doc) => doc.get('generation') === undefined)
    assert(receipt)
    await assert.rejects(second('colleague').getOrgAsset(orgId, receipt.id), { code: 'NOT_FOUND' })
    revoke = false
    await member('editor', orgId).update({ active: true })
    assert.equal((await second('editor').uploadOrgAsset(orgId, interrupted)).assetId, receipt.id)
    assert.equal((await db.collection('orgAssets').get()).size, 3)
    const usage = db.collection('orgAssetUsage')
    assert.deepEqual((await usage.doc('global').get()).data(), { count: 3, bytes: 3 * photo.bytes.length })
    await usage.doc('org-' + orgId).set({ count: 32 })
    await assert.rejects(second('editor').uploadOrgAsset(orgId, { ...input, idempotencyKey: 'beyond-cap' }), { code: 'RATE_LIMITED' })
    assert.deepEqual(await first('editor').uploadOrgAsset(orgId, input), saved)
  })

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
    let failEnqueue = false, failDeletion = false
    const photos = { writeIncoming: store.writeIncoming.bind(store), readRecord: store.readRecord.bind(store),
      deleteRecord: async (reference: Parameters<AnswerPhotoStorage['deleteRecord']>[0]) => {
        if (failDeletion) { failDeletion = false; throw new HttpError(503, 'SYSTEM_ERROR', '代替削除障害', true) }
        return store.deleteRecord(reference)
      } }
    const server = createDurableAnswerServer({ db, photos, verifier: { verify: async (token) => ({ uid: token }) },
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
    const owner = client(identity.uid)
    const discovery = await owner.getDiscovery(final.optionalDiscoveryId)
    assert.equal(discovery.ownerPhoto, `/api/v1/me/discoveries/${final.optionalDiscoveryId}/photo`)
    assert.equal(discovery.placeName, '合成対象')
    assert.deepEqual(Buffer.from(await (await owner.getDiscoveryPhoto(discovery.discoveryId)).arrayBuffer()), photo.bytes)
    assert(!/photoObject|generation|\buid\b/.test(JSON.stringify(discovery)))
    assert.deepEqual((await client('other-owner').listDiscoveries()).items, [])
    await assert.rejects(client('other-owner').getDiscovery(discovery.discoveryId), { code: 'NOT_FOUND' })
    await assert.rejects(client('other-owner').getDiscoveryPhoto(discovery.discoveryId), { code: 'NOT_FOUND' })
    assert.equal((await fetch(base + discovery.ownerPhoto)).status, 401)

    const tiedId = 'synthetic-record-tied'
    await db.collection('discoveries').doc(tiedId).create({ ...snapshot.data(), discoveryId: tiedId,
      placeId: 'synthetic-tied-place', ownerPhoto: 'https://example.test/private-object' })
    const page = await owner.listDiscoveries({ areaId: 'demo-area', limit: 1 })
    assert.equal(page.items.length, 1)
    assert(page.nextCursor)
    const nextPage = await owner.listDiscoveries({ areaId: 'demo-area', limit: 1, cursor: page.nextCursor })
    assert.deepEqual(new Set([...page.items, ...nextPage.items].map((item) => item.discoveryId)), new Set([discovery.discoveryId, tiedId]))
    assert.equal(nextPage.nextCursor, null)
    assert.equal((await owner.getDiscovery(tiedId)).ownerPhoto, `/api/v1/me/discoveries/${tiedId}/photo`)
    await assert.rejects(owner.listDiscoveries({ areaId: 'different-area', cursor: page.nextCursor }), { code: 'INVALID_INPUT' })
    await assert.rejects(client('other-owner').listDiscoveries({ areaId: 'demo-area', cursor: page.nextCursor }), { code: 'INVALID_INPUT' })
    await db.collection('discoveries').doc(tiedId).delete()
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
    assert.deepEqual(await owner.getDiscovery(discovery.discoveryId), discovery)
    assert.deepEqual(Buffer.from(await (await owner.getDiscoveryPhoto(discovery.discoveryId)).arrayBuffer()), photo.bytes)
    assert.equal((await sweep()).discarded, 1)
    assert.equal((await db.collection('attempts').doc(beforePause.attemptId).get()).get('nextWorkAt'), undefined)
    assert.equal(matcherCalls, 2)
    const discoveries = await db.collection('discoveries').where('placeId', '==', placeId).get()
    assert.equal(discoveries.size, 2)

    await quest.update({ publishedVersion: 1, status: 'published' })
    const stale = await submit(identity.uid)
    await assert.rejects(client('other-owner').deleteDiscovery(discovery.discoveryId), { code: 'NOT_FOUND' })
    failDeletion = true
    const deletion = await owner.deleteDiscovery(discovery.discoveryId)
    assert.deepEqual(await owner.getDeletion(deletion.deletionId), { ...deletion, state: 'failed', retryable: true })
    await assert.rejects(client('other-owner').getDeletion(deletion.deletionId), { code: 'NOT_FOUND' })
    assert.deepEqual((await owner.listDiscoveries()).items, [])
    await assert.rejects(owner.getDiscoveryPhoto(discovery.discoveryId), { code: 'NOT_FOUND' })
    const oldPhoto = snapshot.get('photoObject')
    assert.deepEqual((await store.readRecord(oldPhoto)).bytes, photo.bytes)
    assert.equal(await runDueDiscoveryDeletions(db, photos, { maximumJobs: 10, retryDelayMs: 60_000 }), 1)
    assert.deepEqual(await owner.getDeletion(deletion.deletionId), { ...deletion, state: 'completed', retryable: false })
    await assert.rejects(store.readRecord(oldPhoto), { code: 'SYSTEM_ERROR', retryable: false })
    await store.deleteRecord(oldPhoto)

    const suppressed = await runDurableAnswer(stale, options)
    assert(suppressed.kind === 'completed' && suppressed.result.outcome === 'SYSTEM_ERROR')
    assert.deepEqual((await owner.listDiscoveries()).items, [])
    assert.equal(matcherCalls, 2)
    const replacement = await runDurableAnswer(await submit(identity.uid), options)
    assert(replacement.kind === 'completed' && replacement.result.outcome === 'CORRECT')
    assert.notEqual(replacement.result.optionalDiscoveryId, discovery.discoveryId)
    assert.deepEqual(await owner.deleteDiscovery(discovery.discoveryId), deletion)
    assert.deepEqual(Buffer.from(await (await owner.getDiscoveryPhoto(replacement.result.optionalDiscoveryId)).arrayBuffer()), photo.bytes)

    // Pre-existing durable records used the uniqueness hash as their public ID.
    const legacyUid = randomUUID(), legacyPlace = randomUUID(), legacyAttempt = randomUUID()
    const legacyId = createHash('sha256').update(JSON.stringify([legacyUid, legacyPlace])).digest('hex')
    const legacyIncoming = await store.writeIncoming(legacyAttempt, digest, photo)
    const legacyPhoto = await store.writeRecord(legacyAttempt, digest, legacyIncoming)
    await db.collection('discoveries').doc(legacyId).create({ ...snapshot.data(), uid: legacyUid, placeId: legacyPlace,
      discoveryId: legacyId, photoObject: legacyPhoto })
    const legacyOwner = client(legacyUid)
    assert.equal((await legacyOwner.getDiscovery(legacyId)).discoveryId, legacyId)
    const legacyDeletion = await legacyOwner.deleteDiscovery(legacyId)
    assert.equal((await legacyOwner.getDeletion(legacyDeletion.deletionId)).state, 'completed')
    await assert.rejects(store.readRecord(legacyPhoto), { code: 'SYSTEM_ERROR', retryable: false })

    const pending = await submit()
    const pendingSource = (await db.collection('attempts').doc(pending.attemptId).get()).get('sourcePhoto')
    const duplicateOwner = randomUUID()
    async function stageAnswer() {
      const input = await submit(duplicateOwner)
      const work = await claimAnswerWork(db, input, { leaseDurationMs: 180_000 })
      assert(work.kind === 'claimed' && work.step === 'verify')
      const lease = { ...input, leaseId: work.leaseId }
      await recordAnswerMatch(db, lease, { placeId, version: 1, location: 'WITHIN_AREA', photo: 'MATCH' })
      const incoming = work.source.photoObject
      const record = await store.writeRecord(input.attemptId, input.digest, incoming)
      await recordAnswerPhoto(db, lease, record.generation)
      return { input, lease, incoming, record }
    }
    const winner = await stageAnswer(), loser = await stageAnswer()
    assert.equal((await commitVerifiedAnswer(db, winner.lease)).outcome, 'CORRECT')
    assert.equal((await commitVerifiedAnswer(db, loser.lease)).outcome, 'ALREADY_CLEARED')
    const cleanupOptions = { maximumJobs: 100, retryDelayMs: 60_000 }
    const partial = { deleteIncoming: store.deleteIncoming.bind(store), deleteRecord: async (ref: typeof loser.record) => {
      if (ref.path === loser.record.path) throw new HttpError(503, 'SYSTEM_ERROR', '代替清掃障害', true)
      await store.deleteRecord(ref)
    } }
    assert.equal((await runDueAnswerPhotoCleanup(db, partial, cleanupOptions)).retrying, 1)
    const loserReceipt = db.collection('attempts').doc(loser.input.attemptId)
    const deferredCleanup = await loserReceipt.get()
    assert(deferredCleanup.get('nextPhotoCleanupAt').toMillis() > Date.now())
    assert.deepEqual(deferredCleanup.get('unusedRecordPhoto'), loser.record)
    await assert.rejects(store.readIncoming(loser.input.attemptId, loser.input.digest, loser.incoming), { code: 'SYSTEM_ERROR' })
    assert.deepEqual((await store.readRecord(loser.record)).bytes, photo.bytes)
    await assert.rejects(store.readIncoming(winner.input.attemptId, winner.input.digest, winner.incoming), { code: 'SYSTEM_ERROR' })
    assert.deepEqual((await store.readRecord(winner.record)).bytes, photo.bytes)
    assert.deepEqual((await store.readIncoming(pending.attemptId, pending.digest, pendingSource)).bytes, photo.bytes)
    await loserReceipt.update({ nextPhotoCleanupAt: Timestamp.fromMillis(0) })
    assert.equal((await runDueAnswerPhotoCleanup(db, store, cleanupOptions)).completed, 1)
    assert.equal((await loserReceipt.get()).get('unusedRecordPhoto'), undefined)
    assert.equal((await loserReceipt.get()).get('sourcePhoto'), undefined)
    await assert.rejects(store.readRecord(loser.record), { code: 'SYSTEM_ERROR', retryable: false })
    assert.equal((await client(duplicateOwner).getAttempt(loser.input.attemptId)).outcome, 'ALREADY_CLEARED')

    await db.collection('attempts').doc(legacyAttempt).create({ uid: legacyUid, digest, state: 'COMPLETED', sourcePhoto: legacyIncoming,
      result: { attemptId: legacyAttempt, state: 'COMPLETED', outcome: 'OUTSIDE_AREA', source: 'real', nextAction: 'MOVE_TO_AREA' } })
    assert.equal(await cleanupFinishedAnswerPhotos(db, store, legacyAttempt), true)
    await assert.rejects(store.readIncoming(legacyAttempt, digest, legacyIncoming), { code: 'SYSTEM_ERROR' })
  })

  await t.test('listening runtime resolves private material, calls guarded Vertex and drains work on shutdown', { skip: !firestoreEmulator }, async (runtimeTest) => {
    const runtimeApp = initializeApp({ projectId: 'demo-t067-runtime-test' }, 'runtime-' + randomUUID())
    const db = getFirestore(runtimeApp)
    const questId = 'synthetic-quest', placeId = 'synthetic-place', orgId = 'synthetic-org', assetId = 'reference-a'
    const reference = await store.writeReference(orgId, assetId, photo)
    const referenceDoc = db.collection('questVersions').doc(questId + ':1')
    const answerMaterial = { orgId, referenceAssetId: assetId, referenceGeneration: reference.generation,
      features: [...durableFixtureFeatures], zones: [{ latitude: 0, longitude: 0, radiusMeters: 100 }] }
    await Promise.all([
      db.collection('quests').doc(questId).create({ publishedVersion: 1, status: 'published', orgId }),
      referenceDoc.create({ placeId, areaId: 'demo-area', answerMaterial,
        placeName: '合成対象', descriptionSnapshot: '合成説明', revealedLocation: { latitude: 0, longitude: 0 } }),
    ])
    const material = createPublishedAnswerMaterialLoader(db, store, {
      maxAccuracyMeters: 30, maxAgeMs: 60_000, maxFutureSkewMs: 5000, maxCaptureMeasurementGapMs: 10_000,
    })
    const selection = { questId, version: 1, placeId }
    await assert.rejects(material.loadReference({ ...selection, version: 2 }), { code: 'QUEST_CHANGED' })
    await assert.rejects(material.loadReference({ ...selection, placeId: 'other-place' }), { code: 'SYSTEM_ERROR' })
    await referenceDoc.update({ 'answerMaterial.orgId': 'other-org' })
    await assert.rejects(material.loadReference(selection), { code: 'SYSTEM_ERROR', retryable: false })
    await referenceDoc.update({ 'answerMaterial.orgId': orgId, 'answerMaterial.referenceGeneration': '1' })
    await assert.rejects(material.loadReference(selection), { code: 'SYSTEM_ERROR', retryable: false })
    await referenceDoc.update({ answerMaterial })
    assert.deepEqual((await material.loadReference(selection)).reference.bytes, photo.bytes)
    await db.collection('quests').doc(questId).update({ status: 'paused' })
    await assert.rejects(material.loadReference(selection), { code: 'QUEST_UNAVAILABLE' })
    await db.collection('quests').doc(questId).update({ status: 'review_pending' })

    const ledgerDir = await mkdtemp(join(tmpdir(), 'durable-vertex-trial-'))
    const ledger = join(ledgerDir, 'trial.json')
    t.after(() => rm(ledgerDir, { force: true, recursive: true }))
    await initializeTrialLedger(ledger, 5)
    let entered!: () => void, release!: () => void
    const matching = new Promise<void>((resolve) => { entered = resolve })
    const held = new Promise<void>((resolve) => { release = resolve })
    let calls = 0, deletions = 0, tokenRequests = 0
    const matcher = await createSyntheticVertexTrialMatcher(createVertexTrialTransport(ledger, {
      getAccessToken: async () => { tokenRequests++; return 'synthetic-access-token' },
      http: async (url, request) => {
        assert.equal(url, trialEndpoint)
        const { contents } = JSON.parse(String(request?.body))
        const parts = contents[0].parts
        assert.deepEqual(JSON.parse(parts[0].text).verifiedFeatures, durableFixtureFeatures)
        assert.equal(parts[2].inlineData.data, photo.bytes.toString('base64'))
        assert.equal(parts[4].inlineData.data, photo.bytes.toString('base64'))
        if (++calls === 2) { entered(); await held }
        const verdict = calls === 3 ? 'mismatch' : 'match'
        return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ verdict }) }] } }] })
      },
    }))
    const signal = new AbortController().signal
    const allowed = { reference: photo, candidate: photo, features: durableFixtureFeatures }
    for (const input of [{ ...allowed, reference: other }, { ...allowed, features: ['private value'] },
      { ...allowed, candidate: { ...photo, bytes: Buffer.from('unknown photo') } }]) {
      await assert.rejects(matcher(input, { signal }), { code: 'SYSTEM_ERROR', retryable: false })
    }
    assert.equal(JSON.parse(await readFile(ledger, 'utf8')).used, 5)
    assert.equal(tokenRequests, 0)
    const photos = {
      writeIncoming: store.writeIncoming.bind(store), readIncoming: store.readIncoming.bind(store),
      writeRecord: store.writeRecord.bind(store), readRecord: store.readRecord.bind(store),
      deleteIncoming: store.deleteIncoming.bind(store),
      async deleteRecord(ref: Parameters<AnswerPhotoStorage['deleteRecord']>[0]) {
        if (++deletions === 1) throw new HttpError(503, 'SYSTEM_ERROR', '代替削除障害', true)
        await store.deleteRecord(ref)
      },
    }
    const failures: string[] = []
    const runtime = createDurableAnswerRuntime({
      db, photos, verifier: { verify: async (token) => ({ uid: token }) },
      challengePolicy: { maximum: 10, windowMs: 60_000 }, answerPolicy: { maximum: 10, windowMs: 60_000 },
      acquireUpload: () => () => {},
      worker: { ...material, leaseDurationMs: 180_000, authorize: async () => true, matcher, matchTimeoutMs: 30_000 },
      maintenance: { intervalMs: 25, maximumJobs: 10, retryDelayMs: 25, onFailure: (pass) => { failures.push(pass) } },
    })
    const { base } = await listenServer(runtimeTest, runtime.server)
    runtimeTest.after(async () => {
      release()
      await runtime.stopMaintenance()
      await deleteApp(runtimeApp)
    })
    const apiFor = (uid: string) => createApiClient({ fetch: (path, init) => fetch(base + String(path), init),
      getIdToken: async () => uid })
    async function submit(api: ReturnType<typeof apiFor>) {
      const challenge = await api.createChallenge({ questId, expectedVersion: 1 })
      const capturedAt = new Date().toISOString()
      return api.submitAnswer({ challengeId: challenge.challengeId, idempotencyKey: randomUUID(),
        photo: new Blob([new Uint8Array(syntheticPng)], { type: 'image/png' }),
        metadata: { capturedAt, position: { latitude: 0, longitude: 0, accuracyMeters: 5, measuredAt: capturedAt } } })
    }
    async function until<T>(read: () => Promise<T | undefined>): Promise<T> {
      const deadline = Date.now() + 5000
      do {
        const value = await read()
        if (value !== undefined) return value
        await delay(25)
      } while (Date.now() < deadline)
      throw new Error('Scheduled operation did not complete')
    }
    const api = apiFor(randomUUID())
    const receipt = await submit(api)
    assert.equal(receipt.state, 'RECEIVED')
    const attempt = db.collection('attempts').doc(receipt.attemptId)
    const final = await until(async () => {
      const result = await api.getAttempt(receipt.attemptId)
      if (result.state === 'COMPLETED' && (await attempt.get()).get('sourcePhoto') === undefined) return result
    })
    assert(final.outcome === 'CORRECT')
    assert.deepEqual(Buffer.from(await (await api.getDiscoveryPhoto(final.optionalDiscoveryId)).arrayBuffer()), photo.bytes)
    const deletion = await api.deleteDiscovery(final.optionalDiscoveryId)
    await until(async () => (await api.getDeletion(deletion.deletionId)).state === 'completed' ? true : undefined)
    assert(deletions >= 2)
    await assert.rejects(api.getDiscovery(final.optionalDiscoveryId), { code: 'NOT_FOUND' })

    const second = apiFor(randomUUID()), third = apiFor(randomUUID())
    const active = await submit(second)
    await matching
    const waiting = await submit(third)
    await delay(100)
    assert.equal((await third.getAttempt(waiting.attemptId)).state, 'RECEIVED')
    const stopped = runtime.stopMaintenance()
    release()
    await stopped
    assert.equal((await second.getAttempt(active.attemptId)).outcome, 'CORRECT')
    assert.equal((await third.getAttempt(waiting.attemptId)).state, 'RECEIVED')
    assert.equal(calls, 2)
    assert.equal(JSON.parse(await readFile(ledger, 'utf8')).used, 7)
    assert.equal(await matcher(allowed, { signal }), 'WRONG_TARGET')
    assert.equal(JSON.parse(await readFile(ledger, 'utf8')).used, 8)
    assert.deepEqual(failures, [])
  })
})
