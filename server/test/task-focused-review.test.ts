import { test } from 'node:test'
import assert from 'node:assert/strict'
import { missingReviewFields } from '../src/admin-review'
import type { ManagedQuest } from '../../src/shared/api/admin'
test('optional evidence never substitutes for required rights, features or shooting areas', () => {
  const quest: ManagedQuest = { orgId: 'org', questId: 'quest', areaId: 'area', source: 'real',
    draftRevision: 1, publishedVersion: null, status: 'draft', shootingAreaStatus: 'unconfigured', draft: {
      materials: { name: '合成', evidence: '', photoRights: '', requiresBoat: false, requiresPaidFacility: false, price: '', photoNote: '' },
      content: { title: '題', question: '謎', hints: ['一', '二', '三'], verifiedFeatures: '', draftingNotes: '' },
      afterClear: { access: '', hours: '', promoComment: '', explanation: '' }, referenceAssetId: null, hintAssetId: null,
    } }
  assert.deepEqual(missingReviewFields(quest, { reference: false, public_hint: false }),
    ['materials.photoRights', 'referenceAssetId', 'shootingAreas', 'content.verifiedFeatures'])
  quest.shootingAreaStatus = 'configured'
  quest.draft.referenceAssetId = 'reference'
  quest.draft.materials.photoRights = '合成画像の権利を確認'
  quest.draft.content.verifiedFeatures = '赤い丸が一つ'
  assert.deepEqual(missingReviewFields(quest, { reference: true, public_hint: false }), [])
})
