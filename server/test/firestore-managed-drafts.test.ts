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
  batch.create(db.collection('areas').doc(areaId), { label: '架空の地域' })
  for (const [uid, org] of [['editor', orgId], ['colleague', orgId], ['other', 'other-org']]) {
    batch.create(member(uid, org), { uid, orgId: org, active: true, role: 'editor', label: '架空の自治体', areaId })
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
  const first = await start(), second = await start()
  const editor = first('editor'), colleague = second('colleague')
  assert.deepEqual((await editor.listMemberships()).items.map(({ orgId }) => orgId), [orgId])
  assert.deepEqual((await first('traveler').listMemberships()).items, [])
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
  assert.deepEqual((await colleague.listManagedQuests(orgId)).items, [created])
  await assert.rejects(second('other').getManagedQuest(orgId, questId), { code: 'FORBIDDEN' })
  await assert.rejects(second('other').getManagedQuest('other-org', questId), { code: 'NOT_FOUND' })

  const zones = [{ latitude: 0.125, longitude: 0.25, radiusMeters: 25 }]
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
      'materials.photoRights', 'referenceAssetId', 'shootingAreas',
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
