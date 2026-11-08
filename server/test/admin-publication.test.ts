import assert from 'node:assert/strict'
import test from 'node:test'
import sharp from 'sharp'
import { createApiClient } from '../../src/shared/api/client'
import type { ManagedQuestDraft, OrgMembership } from '../../src/shared/api/admin'
import { DemoAdminStore } from '../src/admin'
import { DemoAssetStore } from '../src/admin-assets'
import { createFixturePhotoMatcher } from '../src/demo-photo-test'
import { otherSyntheticPng, syntheticPng } from './photo-fixtures'
import { expectError, startServer } from './helpers'

const confirmations = { fictionalData: true, visitConditions: true, photoRights: true, shootingArea: true, testCases: true } as const
const image = (bytes: Uint8Array) => new Blob([new Uint8Array(bytes)], { type: 'image/png' })

test('only a publisher can publish tested versions and pause the public snapshot', async (t) => {
  const fixtureMatcher = await createFixturePhotoMatcher()
  const assets = new DemoAssetStore()
  const admin = new DemoAdminStore({ assetLookup: (assetId) => assets.metadata(assetId) })
  let wrongTargetForDuplicate = false
  let revokeOnRecheck = false
  let publisherChecks = 0
  const { base } = await startServer(t, {
    verifier: { verify: async (uid) => ({ uid }) },
    memberships: async (uid): Promise<OrgMembership[]> => {
      if (uid === 'traveler') return []
      return [{ orgId: uid === 'other' ? 'other-org' : 'demo-org', label: '架空',
        role: uid === 'editor' || (uid === 'publisher' && revokeOnRecheck && ++publisherChecks === 2) ? 'editor' : 'publisher', areaId: 'demo-area' }]
    },
    admin,
    adminAssets: assets,
    demoReports: true,
    adminPhotoTest: { matcher: async (input, call) => wrongTargetForDuplicate ? 'WRONG_TARGET' : fixtureMatcher(input, call) },
    locationValidation: 'demo',
  })
  const api = (uid: string) => createApiClient({ fetch: (input, init) => fetch(base + String(input), init),
    getIdToken: async () => uid, expectedDataMode: 'demo' })
  const editor = api('editor')
  const publisher = api('publisher')
  const org = 'demo-org'
  const reference = await editor.uploadOrgAsset(org, { purpose: 'reference', photoRights: '自作合成', photo: image(syntheticPng), idempotencyKey: 'ref' })
  const hint = await editor.uploadOrgAsset(org, { purpose: 'public_hint', photoRights: '自作合成', photo: image(otherSyntheticPng), idempotencyKey: 'hint' })
  const draft: ManagedQuestDraft = {
    materials: { name: '内部対象名', evidence: '非公開の根拠', photoRights: '自作合成',
      requiresBoat: true, requiresPaidFacility: false, price: '', photoNote: '架空の撮影注意' },
    content: { title: '公開する架空問題', question: '公開用の問題文', hints: ['ヒント1', 'ヒント2', 'ヒント3'],
      verifiedFeatures: '非公開の確認済み特徴', draftingNotes: '内部メモ' },
    afterClear: { access: 'クリア後のアクセス', hours: '', promoComment: '', explanation: '非公開の解説' },
    referenceAssetId: reference.assetId, hintAssetId: null, hintAssetIds: [null, hint.assetId, null],
  }
  const created = await editor.createManagedQuest(org, draft)
  const id = created.questId
  assert.equal(admin.getPublishedAnswerMaterial(id, 1), undefined)
  await editor.updateShootingAreas(org, id, { expectedDraftRevision: 1,
    zones: [{ latitude: 0.1221, longitude: 0.2332, radiusMeters: 1000 }] })
  const endpoint = '/api/v1/orgs/' + org + '/quests/' + id
  const send = (suffix: string, uid: string, body: unknown, path = endpoint) => fetch(base + path + suffix, {
    method: 'POST', headers: { Authorization: 'Bearer ' + uid, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  const compare = (photo: Blob, key: string, rev: number) => editor.testManagedQuest(org, id, {
    photo, photoRights: '自作合成', expectedDraftRevision: rev, idempotencyKey: key,
  })
  const unrecognized = await sharp({ create: { width: 3, height: 3, channels: 3, background: 'red' } }).png().toBuffer()
  await assert.rejects(compare(image(unrecognized), 'unrecognized', 2), { code: 'SYSTEM_ERROR', retryable: false })
  const match = await compare(image(syntheticPng), 'match', 2)
  assert.equal(match.outcome, 'MATCH')
  wrongTargetForDuplicate = true
  const reused = await compare(image(syntheticPng), 'reused', 2)
  wrongTargetForDuplicate = false
  const mismatch = await compare(image(otherSyntheticPng), 'mismatch', 2)
  assert.equal(mismatch.outcome, 'WRONG_TARGET')
  const body = { expectedDraftRevision: 2, matchTestId: match.testId, mismatchTestId: mismatch.testId, confirmations }
  await expectError(await send('/publish', 'editor', body), 403, 'FORBIDDEN')
  await expectError(await send('/publish', 'other', body, endpoint.replace(org, 'other-org')), 404, 'NOT_FOUND')
  await expectError(await send('/publish', 'publisher', body), 409, 'REVIEW_REQUIRED')
  const duplicateHint = await editor.uploadOrgAsset(org, { purpose: 'public_hint', photoRights: '自作合成',
    photo: image(syntheticPng), idempotencyKey: 'duplicate-hint' })
  const unsafe = await editor.createManagedQuest(org, { ...draft, hintAssetId: duplicateHint.assetId })
  await editor.updateShootingAreas(org, unsafe.questId, { expectedDraftRevision: 1,
    zones: [{ latitude: 0.1221, longitude: 0.2332, radiusMeters: 1000 }] })
  assert.equal((await editor.submitManagedQuestReview(org, unsafe.questId, 2)).quest.status, 'review_pending')
  await expectError(await send('/publish', 'publisher', body, endpoint.replace(id, unsafe.questId)), 409, 'REVIEW_REQUIRED')
  assert.equal((await editor.submitManagedQuestReview(org, id, 2)).quest.status, 'review_pending')
  await expectError(await send('/publish', 'publisher', { ...body, mismatchTestId: reused.testId }), 409, 'PHOTO_TEST_REQUIRED')
  revokeOnRecheck = true
  await expectError(await send('/publish', 'publisher', body), 403, 'FORBIDDEN')
  revokeOnRecheck = false
  assert.equal((await publisher.publishManagedQuest(org, id, body)).publishedVersion, 1)
  assert.equal((await (await send('/publish', 'publisher', body)).json() as { publishedVersion: number }).publishedVersion, 1)
  const firstMaterial = {
    orgId: org, referenceAssetId: reference.assetId, features: ['非公開の確認済み特徴'],
    zones: [{ latitude: 0.1221, longitude: 0.2332, radiusMeters: 1000 }],
  }
  const readMaterial = admin.getPublishedAnswerMaterial(id, 1)
  assert.deepEqual(readMaterial, firstMaterial)
  assert(readMaterial)
  readMaterial.features.push('取得後の編集')
  readMaterial.zones[0].radiusMeters = 1
  assert.deepEqual(admin.getPublishedAnswerMaterial(id, 1), firstMaterial)
  assert.equal(admin.getPublishedAnswerMaterial(id, 2), undefined)
  assert.doesNotMatch(JSON.stringify(admin.getPublished(id)), /referenceAssetId|features|zones|0\.1221|0\.2332/)
  const traveler = api('traveler')
  const visible = await traveler.getQuest(id)
  assert.equal(visible.title, draft.content.title)
  assert.deepEqual(visible.shootingConditions, { requiresBoat: true, requiresPaidFacility: false })
  assert.equal((await traveler.listAreas()).items.find((area) => area.areaId === 'demo-area')?.publishedCount, 3)
  assert.doesNotMatch(JSON.stringify(visible), /内部|非公開|クリア後|0\.1221|0\.2332/)
  for (const assetId of [reference.assetId, hint.assetId]) assert(!JSON.stringify(visible).includes(assetId))
  assert.equal((await traveler.getHint({ questId: id, expectedVersion: 1, index: 1 })).text, 'ヒント1')
  assert(visible.hintImages?.[1])
  assert.equal(visible.optionalHintImage, undefined)
  const publicHint = await fetch(base + visible.hintImages[1])
  assert.equal(publicHint.headers.get('Content-Type'), 'image/jpeg')
  const storedHint = await editor.getOrgAssetPhoto(org, hint.assetId)
  assert.deepEqual(await publicHint.arrayBuffer(), await storedHint.arrayBuffer())
  const replacement = await editor.uploadOrgAsset(org, { purpose: 'reference', photoRights: '自作合成',
    photo: image(syntheticPng), idempotencyKey: 'ref-v2' })
  const edited = await editor.updateManagedQuest(org, id, { expectedDraftRevision: 2,
    draft: { ...draft, referenceAssetId: replacement.assetId,
      materials: { ...draft.materials, requiresBoat: false, requiresPaidFacility: true },
      content: { ...draft.content, title: '編集中の新しい題名', verifiedFeatures: '別の非公開特徴\n\n  二つ目の特徴  ' } } })
  assert.equal(edited.publishedVersion, 1)
  assert.equal((await traveler.getQuest(id)).title, draft.content.title)
  assert.deepEqual((await traveler.getQuest(id)).shootingConditions, visible.shootingConditions)
  await editor.updateShootingAreas(org, id, { expectedDraftRevision: 3, zones: [{ latitude: 1, longitude: 1, radiusMeters: 1000 }] })
  assert.deepEqual(admin.getPublishedAnswerMaterial(id, 1), firstMaterial)
  assert.equal((await editor.submitManagedQuestReview(org, id, 4)).quest.status, 'review_pending')
  await expectError(await send('/publish', 'publisher', { ...body, expectedDraftRevision: 4 }), 409, 'PHOTO_TEST_REQUIRED')
  const challenge = await traveler.createChallenge({ questId: id, expectedVersion: 1 })
  const capturedAt = new Date().toISOString()
  const answer = { challengeId: challenge.challengeId, idempotencyKey: 'original-zone', photo: image(syntheticPng),
    metadata: { capturedAt, position: { latitude: 0.1221, longitude: 0.2332, accuracyMeters: 10, measuredAt: capturedAt } } }
  const pending = await traveler.submitAnswer(answer)
  assert.equal(pending.state, 'RECEIVED')
  assert.deepEqual(await traveler.getAttempt(pending.attemptId), pending)
  const outside = await traveler.submitAnswer({ ...answer, idempotencyKey: 'outside-original-zone',
    metadata: { ...answer.metadata, position: { ...answer.metadata.position, latitude: 1, longitude: 1 } } })
  assert.equal(outside.outcome, 'OUTSIDE_AREA')
  const pause = { expectedPublishedVersion: 1, reason: '開発用の休止確認' }
  await expectError(await send('/pause', 'editor', pause), 403, 'FORBIDDEN')
  const paused = await publisher.pauseManagedQuest(org, id, pause)
  assert.equal(paused.draftRevision, 5)
  assert.equal(paused.status, 'paused')
  assert.equal(admin.getPublishedAnswerMaterial(id, 1), undefined)
  assert.deepEqual(await publisher.pauseManagedQuest(org, id, pause), paused)
  await expectError(await fetch(base + '/api/v1/quests/' + id), 404, 'NOT_FOUND')
  await expectError(await fetch(base + visible.hintImages[1]), 404, 'NOT_FOUND')
  assert.equal((await traveler.listAreas()).items.find((area) => area.areaId === 'demo-area')?.publishedCount, 2)
  await assert.rejects(traveler.createChallenge({ questId: id, expectedVersion: 1 }), { code: 'QUEST_UNAVAILABLE' })
  await assert.rejects(traveler.submitAnswer({ ...answer, idempotencyKey: 'paused' }), { code: 'QUEST_UNAVAILABLE' })
  await assert.rejects(traveler.getAttempt(pending.attemptId), { code: 'QUEST_UNAVAILABLE' })
  const report = await traveler.submitReport({ questId: id, category: 'PHOTO_UNAVAILABLE', text: '架空の休止後報告', idempotencyKey: 'report' })
  const [received] = (await publisher.listManagedReports(org)).items
  assert.equal(received.reportId, report.reportId)
  assert.equal(received.questVersion, 1)
  await assert.rejects(api('other-traveler').getAttempt(pending.attemptId), { code: 'NOT_FOUND' })
  assert.deepEqual(await traveler.getAttempt(outside.attemptId), outside)
  await assert.rejects(editor.submitManagedQuestReview(org, id, 4), { code: 'DRAFT_CONFLICT' })
  await editor.submitManagedQuestReview(org, id, 5)
  const secondMatch = await compare(image(syntheticPng), 'match-v2', 5)
  const secondMismatch = await compare(image(otherSyntheticPng), 'mismatch-v2', 5)
  assert.equal((await publisher.publishManagedQuest(org, id, { ...body, expectedDraftRevision: 5,
    matchTestId: secondMatch.testId, mismatchTestId: secondMismatch.testId })).publishedVersion, 2)
  assert.equal(admin.getPublishedAnswerMaterial(id, 1), undefined)
  assert.deepEqual(admin.getPublishedAnswerMaterial(id, 2), {
    orgId: org, referenceAssetId: replacement.assetId, features: ['別の非公開特徴', '二つ目の特徴'],
    zones: [{ latitude: 1, longitude: 1, radiusMeters: 1000 }],
  })
  assert.deepEqual((await traveler.getQuest(id)).shootingConditions, { requiresBoat: false, requiresPaidFacility: true })
  await expectError(await fetch(base + visible.hintImages[1]), 409, 'QUEST_CHANGED')
  await assert.rejects(traveler.submitAnswer({ ...answer, idempotencyKey: 'old-version' }), { code: 'QUEST_CHANGED' })
  await assert.rejects(traveler.getAttempt(pending.attemptId), { code: 'QUEST_CHANGED' })
})
