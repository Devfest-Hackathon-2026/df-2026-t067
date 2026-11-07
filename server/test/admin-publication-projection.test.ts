import assert from 'node:assert/strict'
import test from 'node:test'
import type { ManagedQuest } from '../../src/shared/api/admin'
import { projectManagedQuest, publicHintImagesPath, publicHintImagePath } from '../src/admin-publication'

const base: ManagedQuest = {
  questId: 'quest-a', orgId: 'org-a', areaId: 'area-a', draftRevision: 2, publishedVersion: null,
  status: 'review_pending', shootingAreaStatus: 'configured', source: 'mock',
  draft: {
    materials: { name: '内部対象', evidence: '確認済み', price: '', photoNote: '', photoRights: '合成',
      requiresBoat: false, requiresPaidFacility: false },
    content: { title: '問題', question: '問題文', hints: ['ヒント1', 'ヒント2', 'ヒント3'],
      verifiedFeatures: '特徴', draftingNotes: '' },
    afterClear: { access: '', hours: '', promoComment: '', explanation: '' },
    referenceAssetId: 'reference-a', hintAssetId: 'legacy-hint',
  },
}

test('projects legacy hint into slot one without duplicating its standalone control', () => {
  const { quest } = projectManagedQuest(base, 4)
  assert.equal(quest.hintImages?.[0], publicHintImagesPath('quest-a', 1, 4))
  assert.equal(quest.hintImages?.[1], null)
  assert.equal(quest.optionalHintImage, undefined)
})

test('preserves an independent legacy image when slot one has an explicitly different asset', () => {
  const { quest } = projectManagedQuest({ ...base, draft: { ...base.draft, hintAssetIds: ['new-hint', null, null] } }, 4)
  assert.equal(quest.hintImages?.[0], publicHintImagesPath('quest-a', 1, 4))
  assert.equal(quest.optionalHintImage, publicHintImagePath('quest-a', 4))
})
