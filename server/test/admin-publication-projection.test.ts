import { parseManagedQuestDraft } from '../../src/shared/api/admin'
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

test('includes the quest number in the public projection only when assigned', () => {
  assert.equal(projectManagedQuest(base, 4, '40-01').quest.questNumber, '40-01')
  assert.equal(projectManagedQuest(base, 4).quest.questNumber, undefined)
})

test('preserves an independent legacy image when slot one has an explicitly different asset', () => {
  const { quest } = projectManagedQuest({ ...base, draft: { ...base.draft, hintAssetIds: ['new-hint', null, null] } }, 4)
  assert.equal(quest.hintImages?.[0], publicHintImagesPath('quest-a', 1, 4))
  assert.equal(quest.optionalHintImage, publicHintImagePath('quest-a', 4))
})


test('publishes the price without the paid category prefix or legacy photo notes', () => {
  const quest = { ...base, draft: { ...base.draft, materials: { ...base.draft.materials,
    requiresBoat: true, price: '有料：大人500円', photoNote: '足元に注意',
  } } }
  assert.equal(projectManagedQuest(quest, 4).quest.visitConditions,
    '料金：大人500円')
})

test('does not publish unconfirmed prices or their unverified details', () => {
  for (const price of ['', '未確認', ' 未確認：受付で確認 ']) {
    const quest = { ...base, draft: { ...base.draft, materials: { ...base.draft.materials, price } } }
    assert.equal(projectManagedQuest(quest, 4).quest.visitConditions, '')
  }
  const quest = { ...base, draft: { ...base.draft, materials: { ...base.draft.materials, price: '無料' } } }
  assert.equal(projectManagedQuest(quest, 4).quest.visitConditions, '料金：無料')
})

test('free prices omit legacy amounts from the public projection', () => {
  for (const price of ['無料：500', ' 無料：大人500円 ']) {
    const quest = { ...base, draft: { ...base.draft, materials: { ...base.draft.materials, price } } }
    assert.equal(projectManagedQuest(quest, 4).quest.visitConditions, '料金：無料')
  }
})

test('draft validation drops a free price amount before persistence', () => {
  const draft = parseManagedQuestDraft({ ...base.draft, materials: { ...base.draft.materials, price: '無料：500' } })
  assert.equal(draft.materials.price, '無料')
})

test('publishes selected prices and retains legacy text without accepting malformed selected prices', () => {
  for (const [price, expected] of [
    ['有料：一律 0円', '料金：一律 0円'],
    ['有料：大人 500円・子供 200円', '料金：大人 500円・子供 200円'],
    ['受付で確認', '料金：受付で確認'], ['未設定', ''],
  ]) {
    const draft = parseManagedQuestDraft({ ...base.draft, materials: { ...base.draft.materials, price } })
    assert.equal(draft.materials.price, price)
    assert.equal(projectManagedQuest({ ...base, draft }, 4).quest.visitConditions, expected)
  }
  for (const price of ['有料：', '有料：一律 -1円', '有料：大人 1.5円', '有料：子供 円', '有料：一律 1e3円', '有料：一律 9007199254740992円', '有料：大人 1円・大人 2円', '有料：一律 1円・子供 2円']) {
    assert.throws(() => parseManagedQuestDraft({ ...base.draft, materials: { ...base.draft.materials, price } }))
  }
})

test('accepts and discards legacy photo notes without publishing them', () => {
  const draft = parseManagedQuestDraft({ ...base.draft, materials: { ...base.draft.materials, photoNote: '旧注意\n自由記述' } })
  assert.equal(draft.materials.photoNote, '')
  assert.equal(projectManagedQuest({ ...base, draft }, 4).quest.visitConditions, '')
})
