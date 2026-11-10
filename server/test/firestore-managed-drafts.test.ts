import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { deleteApp, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import test from 'node:test'
import type { ManagedQuestDraft } from '../../src/shared/api/admin'
import { createApiClient } from '../../src/shared/api/client'
import { createDurableAnswerServer } from '../src/durable-answer-http'
import { FirestoreManagedDraftStore } from '../src/firestore-managed-drafts'
import { listenServer } from './helpers'

const emulator = process.env.QUEST_FIRESTORE_TEST_HOST
const draft: ManagedQuestDraft = {
  materials: { name: '架空の対象', evidence: '', requiresBoat: false, requiresPaidFacility: false, price: '', photoNote: '', photoRights: '' },
  content: { title: '管理用の下書き', question: '', hints: ['', '', ''], verifiedFeatures: '', draftingNotes: '' },
  afterClear: { access: '', hours: '', promoComment: '', explanation: '' }, referenceAssetId: null, hintAssetId: null,
}

test('durable managed drafts isolate organizations and use one revision for text and private zones', {
  skip: !emulator, timeout: 15_000,
}, async (t) => {
  assert(emulator && /^127\.0\.0\.1:[1-9]\d{0,4}$/.test(emulator) && Number(emulator.split(':')[1]) <= 65535)
  process.env.FIRESTORE_EMULATOR_HOST = emulator
  const app = initializeApp({ projectId: 'demo-t067-managed-drafts' }, 'managed-drafts')
  t.after(() => deleteApp(app))
  const db = getFirestore(app)
  db.settings({ universeDomain: 'googleapis.com' })
  const orgId = 'draft-org', areaId = 'draft-area'
  const member = (uid: string, org: string) =>
    db.collection('memberships').doc(createHash('sha256').update(JSON.stringify([uid, org])).digest('hex'))
  const batch = db.batch()
  batch.create(db.collection('areas').doc(areaId), { label: '架空の地域', boundarySource: 'N03', municipalityCode: '00001', boundaryYear: 2025, prefectureCode: '01',
    marker: { latitude: 0, longitude: 0 }, publicGeometryJson: JSON.stringify({ type: 'Polygon', coordinates: [[[0, 0], [0, 1], [1, 1], [0, 0]]] }) })
  // 都道府県コードの無い（未分類の）地域と、その地域だけに所属する編集者（D-33 の作成拒否の確認用）。
  batch.create(db.collection('areas').doc('open-area'), { label: '未分類の地域', boundarySource: 'fixture',
    marker: { latitude: 0, longitude: 0 }, publicGeometryJson: JSON.stringify({ type: 'Polygon', coordinates: [[[0, 0], [0, 1], [1, 1], [0, 0]]] }) })
  batch.create(member('creator', 'open-org'), { uid: 'creator', orgId: 'open-org', active: true, role: 'editor', label: '未分類の自治体', areaId: 'open-area' })
  for (const [uid, org] of [['editor', orgId], ['colleague', orgId], ['other', 'other-org']]) {
    batch.create(member(uid, org), { uid, orgId: org, active: true, role: 'editor', label: '架空の自治体', areaId,
      municipalityCode: org === orgId ? '00001' : '00002' })
  }
  for (const [assetId, org, purpose] of [['reference', orgId, 'reference'], ['hint', orgId, 'public_hint'], ['foreign', 'other-org', 'reference'], ['foreign-hint', 'other-org', 'public_hint']]) {
    batch.create(db.collection('orgAssets').doc(assetId), { generation: '1', digest: 'a'.repeat(64),
      asset: { assetId, orgId: org, purpose, photoRights: '架空', contentType: 'image/jpeg', width: 2, height: 2, byteLength: 10, source: 'real' } })
  }
  await batch.commit()
  const unexpected = () => { throw new Error('Draft operation unexpectedly accessed photo bytes') }
  async function start() {
    const policy = { maximum: 10, windowMs: 60_000 }
    const server = createDurableAnswerServer({ db, dataMode: 'durable-local', drafts: new FirestoreManagedDraftStore(db),
      verifier: { verify: async (token) => ({ uid: token }) },
      photos: { writeIncoming: unexpected, readRecord: unexpected, deleteRecord: unexpected }, acquireUpload: unexpected,
      challengePolicy: policy, answerPolicy: policy })
    const { base } = await listenServer(t, server)
    return (uid: string) => createApiClient({ expectedDataMode: 'durable-local',
      getIdToken: async () => uid, fetch: (path, init) => fetch(base + String(path), init) })
  }
  await t.test('store clears incoming and stored legacy photo notes on the next save', async () => {
    const store = new FirestoreManagedDraftStore(db)
    const legacy = { ...draft, materials: { ...draft.materials, photoNote: '旧注意' } }
    const created = await store.create('editor', orgId, legacy)
    const ref = db.collection('quests').doc(created.questId)
    assert.equal((await ref.get()).data()?.draft.materials.photoNote, '')
    await ref.update({ 'draft.materials.photoNote': '保存済みの旧注意' })
    const loaded = await store.get('editor', orgId, created.questId)
    assert.equal(loaded.draft.materials.photoNote, '')
    // 読込だけでは保存データを書き換えず、次の本文保存で消す。
    assert.equal((await ref.get()).data()?.draft.materials.photoNote, '保存済みの旧注意')
    await store.update('editor', orgId, created.questId, { expectedDraftRevision: loaded.draftRevision, draft: legacy })
    assert.equal((await ref.get()).data()?.draft.materials.photoNote, '')
  })
  const first = await start(), second = await start()
  const editor = first('editor'), colleague = second('colleague')
  assert.deepEqual((await editor.listMemberships()).items.map(({ orgId }) => orgId), [orgId])
  assert.deepEqual((await first('traveler').listMemberships()).items, [])
  assert.deepEqual((await editor.listMemberships()).items[0]?.exploration,
    { name: '架空の地域', source: 'N03', municipalityCode: '00001', year: 2025 })
  assert.equal((await editor.listMemberships()).items[0]?.prefectureCode, '01')
  assert.equal((await first('creator').listMemberships()).items[0]?.prefectureCode, undefined)
  await assert.rejects(first('creator').createManagedQuest('open-org', draft), { code: 'AREA_UNCLASSIFIED' })
  assert.deepEqual((await first('other').listMemberships()).items[0]?.exploration, { source: 'unavailable' })
  await assert.rejects(first('other').createManagedQuest('other-org', draft), { code: 'SYSTEM_ERROR' })
  await assert.rejects(editor.createManagedQuest(orgId, { ...draft, areaId: 'foreign-area' } as ManagedQuestDraft), { code: 'INVALID_INPUT' })
  await assert.rejects(first('traveler').createManagedQuest(orgId, draft), { code: 'FORBIDDEN' })
  for (const referenceAssetId of ['hint', 'foreign', 'missing']) {
    await assert.rejects(editor.createManagedQuest(orgId, { ...draft, referenceAssetId }), { code: 'INVALID_INPUT' })
  }
  for (const index of [0, 1, 2]) {
    const hintAssetIds = [null, null, null] as (string | null)[]
    hintAssetIds[index] = 'foreign-hint'
    await assert.rejects(editor.createManagedQuest(orgId, { ...draft, hintAssetIds }), { code: 'INVALID_INPUT' })
  }
  const created = await editor.createManagedQuest(orgId, { ...draft, referenceAssetId: 'reference', hintAssetId: 'hint' })
  const { questId, draftRevision } = created
  assert.equal(created.source, 'real')
  assert.equal(created.areaId, areaId)
  assert.deepEqual((await colleague.listManagedQuests(orgId)).items, [created])
  await t.test('derives the 1km zone from the same saved spot and keeps readiness read-only', async () => {
    const position = { latitude: 0.75, longitude: 0.25 }
    const withSpot = { ...draft, afterClear: { ...draft.afterClear, spot: { name: '架空の塔', address: '架空住所', position } } }
    const created = await editor.createManagedQuest(orgId, withSpot, { deriveShootingArea: true })
    assert.equal(created.shootingAreaStatus, 'configured')
    assert.deepEqual((await editor.getShootingAreas(orgId, created.questId)).zones, [{ ...position, radiusMeters: 1000 }])
    await assert.rejects(editor.updateShootingAreas(orgId, created.questId, { expectedDraftRevision: created.draftRevision, zones: [] }), { code: 'INVALID_INPUT' })
    await assert.rejects(first('traveler').getManagedQuestReadiness(orgId, created.questId), { code: 'FORBIDDEN' })
    const before = await editor.getManagedQuestReadiness(orgId, created.questId)
    assert.equal(before.quest.status, 'draft')
    assert.equal(before.missing.includes('shootingAreas'), false)
    assert.deepEqual(await editor.getManagedQuest(orgId, created.questId), created)
    const updated = await editor.updateManagedQuest(orgId, created.questId, { expectedDraftRevision: created.draftRevision, draft })
    assert.equal(updated.shootingAreaStatus, 'unconfigured')
    assert.deepEqual((await editor.getShootingAreas(orgId, created.questId)).zones, [])
    assert((await editor.getManagedQuestReadiness(orgId, created.questId)).missing.includes('targetSpot'))
  })
  await assert.rejects(second('other').getManagedQuest(orgId, questId), { code: 'FORBIDDEN' })
  await assert.rejects(second('other').getManagedQuest('other-org', questId), { code: 'NOT_FOUND' })

  const zones = [{ latitude: 0.125, longitude: 0.25, radiusMeters: 1000 }]
  const results = await Promise.allSettled([
    editor.updateShootingAreas(orgId, questId, { expectedDraftRevision: draftRevision, zones }),
    colleague.updateManagedQuest(orgId, questId, { expectedDraftRevision: draftRevision, draft: created.draft }),
  ])
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
  const rejected = results.find((result) => result.status === 'rejected')
  assert.equal(rejected?.reason.code, 'DRAFT_CONFLICT')
  const current = await colleague.getManagedQuest(orgId, questId)
  assert.equal(current.draftRevision, draftRevision + 1)
  const configured = await editor.updateShootingAreas(orgId, questId, { expectedDraftRevision: current.draftRevision, zones })
  assert.deepEqual((await colleague.getShootingAreas(orgId, questId)).zones, zones)
  assert(!JSON.stringify(await editor.getManagedQuest(orgId, questId)).includes('latitude'))
  assert.deepEqual((await editor.listQuests()).items, [])
  await assert.rejects(editor.getQuest(questId), { code: 'NOT_FOUND' })

  await t.test('review submission persists only for the checked revision', async () => {
    const initial = await editor.createManagedQuest(orgId, draft)
    const incomplete = await colleague.submitManagedQuestReview(orgId, initial.questId, initial.draftRevision)
    assert.equal(incomplete.quest.status, 'draft')
    assert.deepEqual(incomplete.missing, [
      'referenceAssetId', 'shootingAreas',
      'content.question', 'content.hints', 'content.verifiedFeatures',
    ])

    const updated = await editor.updateManagedQuest(orgId, initial.questId, {
      expectedDraftRevision: initial.draftRevision,
      draft: { ...draft, referenceAssetId: 'reference', hintAssetId: 'hint',
        materials: { ...draft.materials, evidence: '架空の根拠', photoRights: '撮影者の許可あり' },
        content: { ...draft.content, question: 'どの建物？', hints: ['一つ目', '二つ目', '三つ目'], verifiedFeatures: '赤い屋根\n丸い窓' } },
    })
    const { draftRevision: currentRevision } = await editor.updateShootingAreas(orgId, initial.questId, {
      expectedDraftRevision: updated.draftRevision, zones,
    })
    await assert.rejects(second('other').submitManagedQuestReview(orgId, initial.questId, currentRevision), { code: 'FORBIDDEN' })
    await assert.rejects(colleague.submitManagedQuestReview(orgId, initial.questId, updated.draftRevision), { code: 'DRAFT_CONFLICT' })

    const pending = await editor.submitManagedQuestReview(orgId, initial.questId, currentRevision)
    assert.equal(pending.quest.status, 'review_pending')
    assert.equal(pending.quest.draftRevision, currentRevision)
    assert.deepEqual(pending.missing, [])
    assert.deepEqual(await colleague.getManagedQuest(orgId, initial.questId), pending.quest)
    assert.deepEqual(await colleague.submitManagedQuestReview(orgId, initial.questId, currentRevision), pending)
    await assert.rejects(editor.getQuest(initial.questId), { code: 'NOT_FOUND' })

    const next = await editor.updateShootingAreas(orgId, initial.questId, { expectedDraftRevision: currentRevision, zones })
    await assert.rejects(colleague.submitManagedQuestReview(orgId, initial.questId, currentRevision), { code: 'DRAFT_CONFLICT' })
    assert.equal((await colleague.getManagedQuest(orgId, initial.questId)).status, 'draft')
    assert.equal((await colleague.submitManagedQuestReview(orgId, initial.questId, next.draftRevision)).quest.status, 'review_pending')
    await db.collection('orgAssets').doc('hint').delete()
    const missingHint = await colleague.submitManagedQuestReview(orgId, initial.questId, next.draftRevision)
    assert.deepEqual(missingHint.missing, ['hintAssetId'])
    assert.equal(missingHint.quest.status, 'draft')
    assert.deepEqual(await editor.getManagedQuest(orgId, initial.questId), missingHint.quest)
  })

  await member('editor', orgId).update({ active: false })
  await assert.rejects(editor.submitManagedQuestReview(orgId, questId, configured.draftRevision), { code: 'FORBIDDEN' })
  await assert.rejects(editor.updateManagedQuest(orgId, questId, { expectedDraftRevision: configured.draftRevision, draft: created.draft }), { code: 'FORBIDDEN' })
  assert.equal((await colleague.getManagedQuest(orgId, questId)).draftRevision, configured.draftRevision)
})
