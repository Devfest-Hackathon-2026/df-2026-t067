import assert from 'node:assert/strict'
import test from 'node:test'
import { expectError, startServer } from './helpers'

test('new D draft fields round-trip privately through create/update without entering public quests', async (t) => {
  const { base } = await startServer(t, {
    verifier: { verify: async () => ({ uid: 'owner' }) },
    memberships: async () => [{ orgId: 'demo-org', label: '架空', role: 'editor', areaId: 'demo-area' }],
  })
  const draft = {
    materials: { name: '架空の対象', evidence: '架空の根拠', requiresBoat: true, requiresPaidFacility: true,
      price: '料金の公開案内', photoNote: '撮影の公開条件', photoRights: '自作' },
    content: { title: '', question: '', hints: ['', '', ''], verifiedFeatures: '', draftingNotes: '' },
    afterClear: { access: 'private-access', hours: 'private-hours', promoComment: 'private-promo', explanation: 'private-explanation' },
    referenceAssetId: null, hintAssetId: null,
  }
  const headers = { Authorization: 'Bearer token', 'Content-Type': 'application/json' }
  const path = '/api/v1/orgs/demo-org/quests'
  const response = await fetch(base + path, { method: 'POST', headers, body: JSON.stringify({ draft }) })
  assert.equal(response.status, 201)
  const created = await response.json() as { questId: string; draftRevision: number; draft: unknown }
  assert.deepEqual(created.draft, draft)
  const changed = { ...draft, materials: { ...draft.materials, requiresBoat: false }, afterClear: { ...draft.afterClear, explanation: 'private-new-explanation' } }
  const updated = await fetch(base + path + '/' + created.questId, {
    method: 'PATCH', headers, body: JSON.stringify({ expectedDraftRevision: created.draftRevision, draft: changed }),
  })
  assert.equal(updated.status, 200)
  assert.deepEqual((await updated.json() as { draft: unknown }).draft, changed)
  const restored = await fetch(base + path + '/' + created.questId, { headers })
  assert.equal(restored.status, 200)
  assert.deepEqual((await restored.json() as { draft: unknown }).draft, changed)
  for (const endpoint of ['/api/v1/quests', '/api/v1/quests/demo-quest', '/api/v1/quests/demo-quest/hints/1?expectedVersion=1']) {
    const publicResponse = await fetch(base + endpoint)
    assert.equal(publicResponse.status, 200, endpoint)
    const publicBody = await publicResponse.text()
    assert(!publicBody.includes('private-'))
    assert(!publicBody.includes('afterClear'))
  }
  await expectError(await fetch(base + path, { method: 'POST', headers,
    body: JSON.stringify({ draft: { ...draft, materials: { ...draft.materials, availableModes: ['徒歩'] } } }) }), 400, 'INVALID_INPUT')
})
