import assert from 'node:assert/strict'
import test from 'node:test'
import type { ReadMunicipalArea } from '../src/municipal-areas'
import { assertSpotInMunicipalArea } from '../src/municipal-areas'
const area: ReadMunicipalArea = { boundary: { source: 'fixture' }, area: { areaId: 'fixture', label: '架空', publishedCount: 0,
  marker: { latitude: 0, longitude: 0 }, publicGeometry: { type: 'Polygon', coordinates: [
    [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]], [[1, 1], [2, 1], [2, 2], [1, 2], [1, 1]],
  ] } } }
test('spot boundary accepts inside and boundary, rejects outside and holes, tolerates absent boundary', () => {
  for (const position of [{ latitude: 3, longitude: 3 }, { latitude: 0, longitude: 2 }]) assert.doesNotThrow(() => assertSpotInMunicipalArea(area, position))
  for (const position of [{ latitude: 5, longitude: 3 }, { latitude: 1.5, longitude: 1.5 }]) assert.throws(() => assertSpotInMunicipalArea(area, position), { code: 'SPOT_OUTSIDE_AREA' })
  assert.doesNotThrow(() => assertSpotInMunicipalArea(null, { latitude: 5, longitude: 5 }))
  assert.doesNotThrow(() => assertSpotInMunicipalArea(area))
})

test('create and update reject an outside spot before any write using a mock transaction', async () => {
  const { FirestoreManagedDraftStore } = await import('../src/firestore-managed-drafts')
  type Firestore = import('firebase-admin/firestore').Firestore
  const draft: import('../../src/shared/api/admin').ManagedQuestDraft = {
    materials: { name: '架空', evidence: '', requiresBoat: false, requiresPaidFacility: false, price: '', photoNote: '', photoRights: '' },
    content: { title: '架空', question: '', hints: ['', '', ''], verifiedFeatures: '', draftingNotes: '' },
    afterClear: { access: '', hours: '', promoComment: '', explanation: '', spot: { name: '架空', address: '架空', position: { latitude: 8, longitude: 8 } } },
    referenceAssetId: null, hintAssetId: null,
  }
  const saved = { orgId: 'org', areaId: 'area', managed: true, draftRevision: 1, publishedVersion: null, status: 'draft', zones: [], draft }
  const tx = {
    get: async (ref: { collection: string; id: string }) => ({ ...ref, ref, exists: true, data: () => ref.collection === 'memberships'
      ? { uid: 'user', orgId: 'org', role: 'editor', active: true, areaId: 'area', label: '架空' }
      : ref.collection === 'areas' ? { boundarySource: 'fixture', label: '架空', marker: area.area.marker, prefectureCode: '01', publicGeometryJson: JSON.stringify(area.area.publicGeometry) } : saved }),
    create: () => assert.fail('unexpected write'), update: () => assert.fail('unexpected write'),
  }
  const db = { collection: (collection: string) => ({ doc: (id: string) => ({ collection, id }) }), runTransaction: (work: (value: unknown) => unknown) => work(tx) } as unknown as Firestore
  const store = new FirestoreManagedDraftStore(db)
  await assert.rejects(store.create('user', 'org', draft), { code: 'SPOT_OUTSIDE_AREA' })
  await assert.rejects(store.update('user', 'org', 'quest', { expectedDraftRevision: 1, draft }), { code: 'SPOT_OUTSIDE_AREA' })
})
