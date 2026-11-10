import { expect, it } from 'vitest'
import type { ManagedQuest } from '../../shared/api'
import { remainingWork } from './publicationReadiness'

const complete: ManagedQuest = {
  orgId: 'demo-org', areaId: 'demo-area', questId: 'demo-quest', draftRevision: 1, status: 'draft', source: 'mock',
  publishedVersion: null, shootingAreaStatus: 'configured',
  draft: {
    materials: { name: '架空の対象', evidence: '', photoRights: '自作', price: '', photoNote: '', requiresBoat: false, requiresPaidFacility: false },
    content: { title: '架空の問題', question: '本文', hints: ['1', '2', '3'], verifiedFeatures: '確認済みの特徴', draftingNotes: '' },
    afterClear: { access: '', hours: '', promoComment: '', explanation: '' }, referenceAssetId: 'ref', hintAssetId: null,
  },
}

it('reports nothing remaining for a published quest', () => {
  expect(remainingWork({ ...complete, status: 'published', publishedVersion: 1 })).toEqual([])
})

it('lists every missing saved item plus the review step for a draft', () => {
  const empty: ManagedQuest = {
    ...complete, shootingAreaStatus: 'unconfigured',
    draft: {
      ...complete.draft, referenceAssetId: null,
      materials: { ...complete.draft.materials, name: '', photoRights: '' },
      content: { title: '', question: '', hints: ['', '', ''], verifiedFeatures: '', draftingNotes: '' },
    },
  }
  expect(remainingWork(empty)).toEqual([
    '撮るもの', '写真の利用権', '正解の写真', '撮影範囲',
    'タイトル', '問題文', '3本のヒント', '特徴', '確認依頼',
  ])
})

it('points at the publisher step once review is pending', () => {
  expect(remainingWork({ ...complete, status: 'review_pending' })).toEqual(['写真試験と公開'])
  expect(remainingWork(complete)).toEqual(['確認依頼'])
})

it('rejects feature text the server review would reject', () => {
  const tooMany = Array.from({ length: 21 }, (_, index) => `特徴${index}`).join('\n')
  expect(remainingWork({ ...complete, draft: { ...complete.draft, content: { ...complete.draft.content, verifiedFeatures: tooMany } } }))
    .toContain('特徴')
  const tooLong = 'あ'.repeat(301)
  expect(remainingWork({ ...complete, draft: { ...complete.draft, content: { ...complete.draft.content, verifiedFeatures: tooLong } } }))
    .toContain('特徴')
})
