import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { Storage } from '@google-cloud/storage'
import { deleteApp, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import test from 'node:test'
import type { ManagedQuestDraft } from '../../src/shared/api/admin'
import { createApiClient } from '../../src/shared/api/client'
import { AnswerPhotoStorage } from '../src/answer-photo-storage'
import type { PhotoReference } from '../src/answer-photo-storage'
import { createFixturePhotoMatcher, durableFixtureFeatures, otherSyntheticPng, syntheticPng } from '../src/demo-photo-test'
import { createDurableAnswerServer } from '../src/durable-answer-http'
import { cleanupFinishedAnswerPhotos } from '../src/durable-answer-photo-cleanup'
import { runDurableAnswer } from '../src/durable-answer-worker'
import { FirestoreManagedDraftStore } from '../src/firestore-managed-drafts'
import { FirestoreOrgAssetStore } from '../src/firestore-org-assets'
import { createPublishedAnswerMaterialLoader } from '../src/published-answer-material'
import { listenServer } from './helpers'

const firestore = process.env.QUEST_FIRESTORE_TEST_HOST
const storage = process.env.QUEST_STORAGE_TEST_HOST
const image = (bytes: Uint8Array) => new Blob([Uint8Array.from(bytes)], { type: 'image/png' })
const confirmations = { fictionalData: true, visitConditions: true, photoRights: true, shootingArea: true, testCases: true } as const

test('durable publishing freezes the tested version and pausing stops all public access', {
  skip: !firestore || !storage, timeout: 20_000,
}, async (t) => {
  for (const address of [firestore, storage]) {
    assert(address && /^127\.0\.0\.1:[1-9]\d{0,4}$/.test(address) && Number(address.split(':')[1]) <= 65535)
  }
  process.env.FIRESTORE_EMULATOR_HOST = firestore
  delete process.env.STORAGE_EMULATOR_HOST
  const projectId = 'demo-t067-durable-publication', bucketName = projectId + '.appspot.com'
  const setup = await fetch('http://' + storage + '/storage/v1/b?project=' + projectId, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: bucketName }),
  })
  assert(setup.ok || setup.status === 409)
  await setup.body?.cancel()
  const app = initializeApp({ projectId }, 'durable-publication')
  t.after(() => deleteApp(app))
  const db = getFirestore(app)
  db.settings({ universeDomain: 'googleapis.com' })
  const photos = new AnswerPhotoStorage(new Storage({ projectId, apiEndpoint: 'http://' + storage }).bucket(bucketName))
  const orgId = 'publish-org', areaId = 'publish-area'
  const batch = db.batch()
  batch.create(db.collection('areas').doc(areaId), { label: '架空の公開地域', marker: { latitude: 0, longitude: 0 },
    publicGeometryJson: JSON.stringify({ type: 'Polygon', coordinates: [[[0, 0], [0, 1], [1, 1], [0, 0]]] }) })
  for (const [uid, org, role] of [['editor', orgId, 'editor'], ['publisher', orgId, 'publisher'], ['other', 'other-org', 'publisher']]) {
    const id = createHash('sha256').update(JSON.stringify([uid, org])).digest('hex')
    batch.create(db.collection('memberships').doc(id), { uid, orgId: org, role, active: true, label: '架空の自治体', areaId })
  }
  await batch.commit()
  const matcher = await createFixturePhotoMatcher()
  let duplicate = false
  let revokeDuringHintRead = false
  const publisherId = createHash('sha256').update(JSON.stringify(['publisher', orgId])).digest('hex')
  const publisherMembership = db.collection('memberships').doc(publisherId)
  const publication = {
    readReference: photos.readReference.bind(photos),
    async readHint(...args: Parameters<AnswerPhotoStorage['readHint']>) {
      const picture = await photos.readHint(...args)
      if (revokeDuringHintRead) await publisherMembership.update({ role: 'editor' })
      return picture
    },
  }
  async function start(teamPreview?: { allowedUids: ReadonlySet<string>; webDirectory: string }) {
    const policy = { maximum: 10, windowMs: 60_000 }
    const server = createDurableAnswerServer({ db, photos, publication, dataMode: 'durable-local', teamPreview,
      verifier: { verify: async (token) => ({ uid: token }) }, challengePolicy: policy, answerPolicy: policy, acquireUpload: () => () => {},
      assets: new FirestoreOrgAssetStore(db, photos), drafts: new FirestoreManagedDraftStore(db),
      photoTest: { matcher: (input, call) => duplicate ? Promise.resolve('WRONG_TARGET') : matcher(input, call), source: 'mock' } })
    const { base } = await listenServer(t, server)
    return { base, api: (uid: string) => createApiClient({ expectedDataMode: teamPreview ? 'team-preview' : 'durable-local',
      getIdToken: async () => uid, fetch: (path, init) => fetch(base + String(path), init) }) }
  }
  const second = await start()
  const team = await start({ allowedUids: new Set(['editor', 'publisher', 'traveler', 'other']), webDirectory: '' })
  const editor = team.api('editor'), publisher = team.api('publisher'), traveler = second.api('traveler')
  const teamTraveler = team.api('traveler')
  await assert.rejects(team.api('outsider').listQuests(), { code: 'FORBIDDEN' })
  await assert.rejects(teamTraveler.listManagedQuests(orgId), { code: 'FORBIDDEN' })
  const reference = await editor.uploadOrgAsset(orgId, { purpose: 'reference', photoRights: '合成画像', photo: image(syntheticPng), idempotencyKey: 'reference' })
  const hint = await editor.uploadOrgAsset(orgId, { purpose: 'public_hint', photoRights: '合成画像', photo: image(otherSyntheticPng), idempotencyKey: 'hint' })
  const draft: ManagedQuestDraft = {
    materials: { name: '非公開の対象名', evidence: '架空の根拠', requiresBoat: true, requiresPaidFacility: false, price: '', photoNote: '', photoRights: '合成画像' },
    content: { title: '公開する問題', question: '問題文', hints: ['一つ目', '二つ目', '三つ目'], verifiedFeatures: durableFixtureFeatures[0], draftingNotes: '' },
    afterClear: { access: 'クリア後のアクセス', hours: '', promoComment: '', explanation: 'クリア後の解説' },
    referenceAssetId: reference.assetId, hintAssetId: hint.assetId,
  }
  const { questId } = await editor.createManagedQuest(orgId, draft)
  const zones = [{ latitude: 0.125, longitude: 0.25, radiusMeters: 25 }]
  const { draftRevision } = await editor.updateShootingAreas(orgId, questId, { expectedDraftRevision: 1, zones })
  const compare = (photo: Blob, idempotencyKey: string, revision: number) => editor.testManagedQuest(orgId, questId, {
    photo, idempotencyKey, expectedDraftRevision: revision, photoRights: '合成画像',
  })
  const match = await compare(image(syntheticPng), 'match', draftRevision)
  duplicate = true
  const reused = await compare(image(syntheticPng), 'duplicate', draftRevision)
  duplicate = false
  const mismatch = await compare(image(otherSyntheticPng), 'mismatch', draftRevision)
  const input = { expectedDraftRevision: draftRevision, matchTestId: match.testId, mismatchTestId: mismatch.testId, confirmations }
  await assert.rejects(editor.publishManagedQuest(orgId, questId, input), { code: 'FORBIDDEN' })
  await assert.rejects(second.api('other').publishManagedQuest('other-org', questId, input), { code: 'NOT_FOUND' })
  await assert.rejects(publisher.publishManagedQuest(orgId, questId, input), { code: 'REVIEW_REQUIRED' })
  const unsafeHint = await editor.uploadOrgAsset(orgId, { purpose: 'public_hint', photoRights: '合成画像',
    photo: image(syntheticPng), idempotencyKey: 'unsafe-hint' })
  const unsafe = await editor.createManagedQuest(orgId, { ...draft, hintAssetId: unsafeHint.assetId })
  await editor.updateShootingAreas(orgId, unsafe.questId, { expectedDraftRevision: unsafe.draftRevision, zones })
  assert.equal((await editor.submitManagedQuestReview(orgId, unsafe.questId, draftRevision)).quest.status, 'review_pending')
  await assert.rejects(publisher.publishManagedQuest(orgId, unsafe.questId, input), { code: 'REVIEW_REQUIRED' })
  await editor.submitManagedQuestReview(orgId, questId, draftRevision)
  await assert.rejects(publisher.publishManagedQuest(orgId, questId, { ...input, mismatchTestId: reused.testId }), { code: 'PHOTO_TEST_REQUIRED' })
  revokeDuringHintRead = true
  await assert.rejects(publisher.publishManagedQuest(orgId, questId, input), { code: 'FORBIDDEN' })
  revokeDuringHintRead = false
  await publisherMembership.update({ role: 'publisher' })
  await assert.rejects(traveler.getQuest(questId), { code: 'NOT_FOUND' })
  await assert.rejects(teamTraveler.getQuest(questId), { code: 'NOT_FOUND' })
  const published = await publisher.publishManagedQuest(orgId, questId, input)
  assert.equal(published.publishedVersion, 1)
  assert.deepEqual(await second.api('publisher').publishManagedQuest(orgId, questId, input), published)
  const visible = await traveler.getQuest(questId)
  assert.deepEqual(await teamTraveler.getQuest(questId), visible)
  assert.equal(visible.title, draft.content.title)
  assert.equal((await traveler.listAreas()).items[0].publishedCount, 1)
  assert.doesNotMatch(JSON.stringify(visible), /非公開|クリア後|latitude|referenceAssetId/)
  assert.deepEqual(visible.shootingConditions, { requiresBoat: true, requiresPaidFacility: false })
  assert.equal((await traveler.getHint({ questId, index: 1, expectedVersion: 1 })).text, '一つ目')
  assert(visible.optionalHintImage)
  const displayedHint = await fetch(second.base + visible.optionalHintImage)
  assert.equal(displayedHint.headers.get('Content-Type'), 'image/jpeg')
  assert.deepEqual(await displayedHint.arrayBuffer(), await (await editor.getOrgAssetPhoto(orgId, hint.assetId)).arrayBuffer())
  const protectedHint = await teamTraveler.getPublishedHintPhoto(questId, 1)
  assert.deepEqual(await protectedHint.arrayBuffer(), await (await editor.getOrgAssetPhoto(orgId, hint.assetId)).arrayBuffer())
  const anonymousHint = await fetch(team.base + visible.optionalHintImage)
  assert.equal(anonymousHint.status, 401)
  await anonymousHint.body?.cancel()
  const v1 = db.collection('questVersions').doc(questId + ':1')
  assert.deepEqual((await v1.get()).get('answerMaterial.zones'), zones)
  assert.equal((await v1.get()).get('descriptionSnapshot'), draft.afterClear.explanation)

  const started = await traveler.createChallenge({ questId, expectedVersion: 1 })
  const edited = await editor.updateManagedQuest(orgId, questId, { expectedDraftRevision: draftRevision,
    draft: { ...draft, content: { ...draft.content, title: '改版した問題' } } })
  assert.equal((await traveler.getQuest(questId)).title, visible.title)
  const pause = { expectedPublishedVersion: 1, reason: '架空の休止' }
  await assert.rejects(editor.pauseManagedQuest(orgId, questId, pause), { code: 'FORBIDDEN' })
  const paused = await publisher.pauseManagedQuest(orgId, questId, pause)
  assert.equal(paused.draftRevision, edited.draftRevision + 1)
  assert.deepEqual(await second.api('publisher').pauseManagedQuest(orgId, questId, pause), paused)
  await assert.rejects(publisher.pauseManagedQuest(orgId, questId, { ...pause, reason: '別の理由' }), { code: 'QUEST_UNAVAILABLE' })
  await assert.rejects(traveler.getQuest(questId), { code: 'NOT_FOUND' })
  await assert.rejects(teamTraveler.getPublishedHintPhoto(questId, 1), { code: 'NOT_FOUND' })
  assert.equal((await traveler.listAreas()).items[0].publishedCount, 0)
  await assert.rejects(traveler.createChallenge({ questId, expectedVersion: 1 }), { code: 'QUEST_UNAVAILABLE' })
  const hiddenHint = await fetch(second.base + visible.optionalHintImage)
  assert.equal(hiddenHint.status, 404)
  await hiddenHint.body?.cancel()

  await editor.submitManagedQuestReview(orgId, questId, paused.draftRevision)
  await assert.rejects(traveler.createChallenge({ questId, expectedVersion: 1 }), { code: 'QUEST_UNAVAILABLE' })
  await assert.rejects(publisher.publishManagedQuest(orgId, questId, { ...input, expectedDraftRevision: paused.draftRevision }), { code: 'PHOTO_TEST_REQUIRED' })
  const newMatch = await compare(image(syntheticPng), 'match-v2', paused.draftRevision)
  const newMismatch = await compare(image(otherSyntheticPng), 'mismatch-v2', paused.draftRevision)
  assert.equal((await publisher.publishManagedQuest(orgId, questId, { ...input, expectedDraftRevision: paused.draftRevision,
    matchTestId: newMatch.testId, mismatchTestId: newMismatch.testId })).publishedVersion, 2)
  assert.equal((await traveler.getQuest(questId)).title, '改版した問題')
  const oldImage = await fetch(second.base + visible.optionalHintImage)
  assert.equal(oldImage.status, 409)
  await oldImage.body?.cancel()
  const capturedAt = new Date().toISOString()
  await assert.rejects(traveler.submitAnswer({ challengeId: started.challengeId, photo: image(syntheticPng), idempotencyKey: 'old-version',
    metadata: { capturedAt, position: { latitude: 0.125, longitude: 0.25, accuracyMeters: 1, measuredAt: capturedAt } } }), { code: 'QUEST_CHANGED' })
  assert.equal((await v1.get()).get('descriptionSnapshot'), draft.afterClear.explanation)

  const current = await traveler.createChallenge({ questId, expectedVersion: 2 })
  const recordedAt = new Date().toISOString()
  const receipt = await traveler.submitAnswer({ challengeId: current.challengeId, photo: image(syntheticPng), idempotencyKey: 'pause-during-save',
    metadata: { capturedAt: recordedAt, position: { latitude: 0.125, longitude: 0.25, accuracyMeters: 1, measuredAt: recordedAt } } })
  const attempt = db.collection('attempts').doc(receipt.attemptId)
  const accepted = await attempt.get()
  const digest = accepted.get('digest')
  const incoming = accepted.get('sourcePhoto')
  let staged: PhotoReference | undefined
  const result = await runDurableAnswer({ uid: 'traveler', attemptId: receipt.attemptId, digest }, {
    db, matcher, authorize: async (uid) => uid === 'traveler', leaseDurationMs: 180_000,
    ...createPublishedAnswerMaterialLoader(db, photos, {
      maxAccuracyMeters: 30, maxAgeMs: 60_000, maxFutureSkewMs: 5000, maxCaptureMeasurementGapMs: 10_000,
    }),
    photos: {
      readIncoming: photos.readIncoming.bind(photos),
      async writeRecord(...args) {
        staged = await photos.writeRecord(...args)
        await publisher.pauseManagedQuest(orgId, questId, { expectedPublishedVersion: 2, reason: '保存中の休止' })
        return staged
      },
    },
  })
  assert(result.kind === 'completed' && result.result.outcome === 'QUEST_UNAVAILABLE')
  assert.deepEqual(await traveler.getAttempt(receipt.attemptId), result.result)
  assert.deepEqual((await traveler.listDiscoveries()).items, [])
  assert(staged)
  assert.deepEqual((await attempt.get()).get('unusedRecordPhoto'), staged)
  assert.equal(await cleanupFinishedAnswerPhotos(db, photos, receipt.attemptId), true)
  await assert.rejects(photos.readIncoming(receipt.attemptId, digest, incoming), { code: 'SYSTEM_ERROR' })
  await assert.rejects(photos.readRecord(staged), { code: 'SYSTEM_ERROR' })
})
