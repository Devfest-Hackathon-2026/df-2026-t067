import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { parseManagedQuestDraft } from '../../src/shared/api/admin'
import { DemoAdminStore } from '../src/admin'
import { createDurableDraftHandler } from '../src/durable-admin-drafts-http'
import type { FirestoreManagedDraftStore } from '../src/firestore-managed-drafts'

const draft = parseManagedQuestDraft({
  materials: { name: '', evidence: '', photoRights: '', requiresBoat: false, requiresPaidFacility: false, price: '', photoNote: '' },
  content: { title: '途中の謎', question: '', hints: ['', '', ''], verifiedFeatures: '', draftingNotes: '' },
  afterClear: { access: '', hours: '', promoComment: '', explanation: '' }, referenceAssetId: null, hintAssetId: null,
})

test('title-only drafts round-trip privately and cannot pass review or appear to travelers', () => {
  const store = new DemoAdminStore()
  const created = store.create({ orgId: 'org', areaId: 'area', label: '架空', role: 'editor' }, draft)
  assert.deepEqual(store.get('org', created.questId).draft, draft)
  assert.deepEqual(store.listPublished(), [])
  assert.equal(store.getPublished(created.questId), undefined)
  const reviewed = store.submitReview('org', created.questId, 1)
  assert.equal(reviewed.quest.status, 'draft')
  for (const field of ['materials.name', 'referenceAssetId', 'shootingAreas', 'content.question', 'content.hints', 'content.verifiedFeatures']) {
    assert(reviewed.missing.includes(field as typeof reviewed.missing[number]))
  }
  assert.deepEqual(store.listPublished(), [])
})

test('durable photo-test endpoint rejects incomplete saved drafts before reading a photo or calling a matcher', async () => {
  let checked = false
  const store = { readiness: async (uid: string, org: string, quest: string) => {
    assert.deepEqual([uid, org, quest], ['user', 'org', 'quest'])
    checked = true
    return { missing: ['referenceAssetId', 'shootingAreas'] }
  } } as unknown as FirestoreManagedDraftStore
  const handler = createDurableDraftHandler(store, async () => 'user')
  await assert.rejects(handler({ method: 'POST' } as IncomingMessage, {} as ServerResponse,
    '/api/v1/orgs/org/quests/quest/test', new URLSearchParams()), { code: 'REVIEW_REQUIRED' })
  assert.equal(checked, true)
})
