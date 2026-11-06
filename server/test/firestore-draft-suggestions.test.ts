import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { deleteApp, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import test from 'node:test'
import type { ManagedQuestDraft } from '../../src/shared/api/admin'
import { createApiClient } from '../../src/shared/api/client'
import { createFixtureDraftSuggester } from '../src/demo-draft-suggestions'
import { syntheticPng } from '../src/demo-photo-test'
import { createDurableAnswerServer } from '../src/durable-answer-http'
import { FirestoreManagedDraftStore } from '../src/firestore-managed-drafts'
import { FirestoreOrgAssetStore } from '../src/firestore-org-assets'
import { preparePhoto } from '../src/photo-input'
import { listenServer } from './helpers'

const emulator = process.env.QUEST_FIRESTORE_TEST_HOST

test('durable generation returns a candidate for a saved draft and rechecks access after loading the private photo', {
  skip: !emulator, timeout: 15_000,
}, async (t) => {
  assert(emulator && /^127\.0\.0\.1:[1-9]\d{0,4}$/.test(emulator) && Number(emulator.split(':')[1]) <= 65535)
  process.env.FIRESTORE_EMULATOR_HOST = emulator
  const app = initializeApp({ projectId: 'demo-t067-gen-' + randomUUID().slice(0, 8) }, 'durable-draft-suggestions')
  t.after(() => deleteApp(app))
  const db = getFirestore(app)
  db.settings({ universeDomain: 'googleapis.com' })
  const uid = 'editor', orgId = 'draft-org', areaId = 'draft-area', assetId = 'reference-photo'
  const member = db.collection('memberships').doc(createHash('sha256').update(JSON.stringify([uid, orgId])).digest('hex'))
  const reference = await preparePhoto({ bytes: syntheticPng, mimeType: 'image/png' })
  await db.batch()
    .create(db.collection('areas').doc(areaId), { label: '架空の地域' })
    .create(member, { uid, orgId, active: true, role: 'editor', label: '架空の自治体', areaId })
    .create(db.collection('orgAssets').doc(assetId), { generation: '7', digest: 'a'.repeat(64), asset: {
      assetId, orgId, purpose: 'reference', photoRights: '自作の合成画像', contentType: 'image/jpeg',
      width: reference.width, height: reference.height, byteLength: reference.bytes.length, source: 'real',
    } }).commit()

  let reads = 0
  let whileReading: (() => Promise<unknown>) | undefined
  const unexpected = () => { throw new Error('Generation must not write or fetch another photo') }
  const assets = new FirestoreOrgAssetStore(db, {
    writeReference: unexpected, writeHint: unexpected, readHint: unexpected,
    readReference: async (org, asset, generation) => {
      assert.deepEqual([org, asset, generation], [orgId, assetId, '7'])
      reads++
      await whileReading?.()
      return reference
    },
  })
  const policy = { maximum: 10, windowMs: 60_000 }
  const options = { db, dataMode: 'durable-local' as const, assets, drafts: new FirestoreManagedDraftStore(db),
    suggestDraft: await createFixtureDraftSuggester(), verifier: { verify: async (token: string) => ({ uid: token }) },
    photos: { writeIncoming: unexpected, readRecord: unexpected, deleteRecord: unexpected },
    acquireUpload: () => () => {}, challengePolicy: policy, answerPolicy: policy,
  }
  const { base } = await listenServer(t, createDurableAnswerServer(options))
  const client = (token: string) => createApiClient({ expectedDataMode: 'durable-local', getIdToken: async () => token,
    fetch: (path, init) => fetch(base + String(path), init) })
  const editor = client(uid)
  const draft: ManagedQuestDraft = {
    materials: { name: '架空の対象', evidence: '合成図形を確認済み', requiresBoat: false, requiresPaidFacility: false,
      price: '', photoNote: '', photoRights: '自作の合成画像' },
    content: { title: '保存済みタイトル', question: '', hints: ['', '', ''], verifiedFeatures: '', draftingNotes: '' },
    afterClear: { access: '', hours: '', promoComment: '', explanation: '' }, referenceAssetId: assetId, hintAssetId: null,
  }
  const saved = await editor.createManagedQuest(orgId, draft)
  const { questId, draftRevision } = saved
  const candidate = await editor.generateManagedQuestDraft(orgId, questId, draftRevision)
  assert.equal(candidate.source, 'mock')
  assert.equal(candidate.draftRevision, draftRevision)
  assert.equal(candidate.content.title, '合成画像の色を探す')
  assert.deepEqual(await editor.getManagedQuest(orgId, questId), saved)
  await assert.rejects(client('outsider').generateManagedQuestDraft(orgId, questId, draftRevision), { code: 'FORBIDDEN' })
  await assert.rejects(editor.generateManagedQuestDraft(orgId, questId, draftRevision + 1), { code: 'DRAFT_CONFLICT' })
  assert.equal(reads, 1)

  whileReading = () => editor.updateManagedQuest(orgId, questId, { expectedDraftRevision: draftRevision, draft })
  await assert.rejects(editor.generateManagedQuestDraft(orgId, questId, draftRevision), { code: 'DRAFT_CONFLICT' })
  const updated = await editor.getManagedQuest(orgId, questId)
  whileReading = () => member.update({ active: false })
  await assert.rejects(editor.generateManagedQuestDraft(orgId, questId, updated.draftRevision), { code: 'FORBIDDEN' })
  assert.equal(reads, 3)
})
