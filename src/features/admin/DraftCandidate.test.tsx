import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { createApiClient } from '../../shared/api'
import type { ManagedQuest } from '../../shared/api'
import { DraftCandidate } from './DraftCandidate'

const saved: ManagedQuest = {
  orgId: 'org', questId: 'q', areaId: 'area', draftRevision: 2, publishedVersion: null,
  status: 'draft', source: 'mock', shootingAreaStatus: 'configured',
  draft: {
    materials: { name: '架空の対象', evidence: '確認材料', price: '', photoNote: '', photoRights: '自作',
      requiresBoat: false, requiresPaidFacility: false },
    content: { title: '今の題名', question: '今の本文', hints: ['a', 'b', 'c'], verifiedFeatures: '今の特徴', draftingNotes: '今のメモ' },
    afterClear: { access: '', hours: '', promoComment: '', explanation: '' }, referenceAssetId: null, hintAssetId: null,
  },
}
const current = saved.draft.content
const candidate = { title: '案の題名', question: '案の本文', hints: ['1', '2', '3'] as [string, string, string],
  verifiedFeatures: '案の特徴', draftingNotes: '案のメモ' }

it('applies only the checked fields of a candidate', async () => {
  const user = userEvent.setup()
  const generateManagedQuestDraft = vi.fn().mockResolvedValue({ orgId: 'org', questId: 'q', draftRevision: 2, source: 'mock', content: candidate })
  const onApply = vi.fn()
  render(<DraftCandidate api={{ ...createApiClient(), generateManagedQuestDraft }} saved={saved} current={current} onApply={onApply} />)
  await user.click(screen.getByText('下書き案を取り込む'))
  await user.click(screen.getByRole('button', { name: '下書き案を取得' }))
  expect(await screen.findByText('案の題名')).toBeVisible()
  await user.click(screen.getByLabelText('タイトルを反映'))
  await user.click(screen.getByRole('button', { name: 'この案を編集欄に入れる' }))
  expect(onApply).toHaveBeenCalledExactlyOnceWith({ ...candidate, title: '今の題名' })
})

it('hides the creation notes in task-focused mode and never applies them there', async () => {
  const user = userEvent.setup()
  const generateManagedQuestDraft = vi.fn().mockResolvedValue({ orgId: 'org', questId: 'q', draftRevision: 2, source: 'mock', content: candidate })
  const onApply = vi.fn()
  render(<DraftCandidate api={{ ...createApiClient(), generateManagedQuestDraft }} saved={saved} current={current} omitNotes onApply={onApply} />)
  await user.click(screen.getByText('下書き案を取り込む'))
  await user.click(screen.getByRole('button', { name: '下書き案を取得' }))
  expect(await screen.findByText('案の題名')).toBeVisible()
  expect(screen.queryByText('案のメモ')).not.toBeInTheDocument()
  expect(screen.queryByLabelText('作成メモ')).not.toBeInTheDocument()
})
