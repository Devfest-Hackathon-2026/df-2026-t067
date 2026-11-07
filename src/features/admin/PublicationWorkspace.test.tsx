import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { ApiError, createApiClient } from '../../shared/api'
import type { ManagedQuest, OrgMembership } from '../../shared/api'
import { PublicationWorkspace } from './PublicationWorkspace'

const org: OrgMembership = { orgId: 'demo-org', label: '架空自治体', areaId: 'demo-area', role: 'publisher' }
const initial: ManagedQuest = {
  orgId: org.orgId, areaId: org.areaId, questId: 'demo-quest', draftRevision: 4, status: 'draft', source: 'mock',
  publishedVersion: null, shootingAreaStatus: 'configured',
  draft: {
    materials: { name: '架空の対象', evidence: '根拠', photoRights: '自作', requiresBoat: false, requiresPaidFacility: false, price: '', photoNote: '' },
    content: { title: '架空の問題', question: '本文', hints: ['1', '2', '3'], verifiedFeatures: '確認済みの特徴', draftingNotes: '' },
    afterClear: { access: '', hours: '', promoComment: '', explanation: '' }, referenceAssetId: 'ref', hintAssetId: null,
  },
}

it('publishes only after both saved-version photo tests, review, and explicit confirmations', async () => {
  const user = userEvent.setup()
  const testResult = { orgId: org.orgId, questId: initial.questId, draftRevision: 4, source: 'mock' }
  const testManagedQuest = vi.fn().mockResolvedValueOnce({ ...testResult, testId: 'match-test', outcome: 'MATCH' })
    .mockResolvedValueOnce({ ...testResult, testId: 'other-test', outcome: 'WRONG_TARGET' })
  const submitManagedQuestReview = vi.fn().mockResolvedValue({ quest: { ...initial, status: 'review_pending' }, missing: [] })
  const publishManagedQuest = vi.fn().mockResolvedValue({ ...initial, status: 'published', publishedVersion: 1 })
  const api = { ...createApiClient(), testManagedQuest, submitManagedQuestReview, publishManagedQuest }
  const published = vi.fn()
  render(<PublicationWorkspace api={api} initial={initial} member={org} onBack={vi.fn()} onPublished={published} />)
  const publish = screen.getByRole('button', { name: 'この版を開発用に公開' })
  expect(publish).toBeDisabled()
  const match = new File(['match'], 'match.png', { type: 'image/png' })
  const other = new File(['other'], 'other-target.png', { type: 'image/png' })
  await user.type(screen.getByLabelText('試験写真の利用権'), '自作の合成画像')
  await user.upload(screen.getByLabelText('試験写真'), match)
  expect(testManagedQuest).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: '写真試験を送信' }))
  expect(await screen.findByText('一致試験を確認しました。')).toBeVisible()
  expect(publish).toBeDisabled()
  await user.upload(screen.getByLabelText('試験写真'), other)
  await user.click(screen.getByRole('button', { name: '写真試験を送信' }))
  expect(await screen.findByText('別対象の試験を確認しました。')).toBeVisible()
  expect(testManagedQuest.mock.calls.map((call) => call[2].expectedDraftRevision)).toEqual([4, 4])
  expect(testManagedQuest.mock.calls[0][2].idempotencyKey).not.toEqual(testManagedQuest.mock.calls[1][2].idempotencyKey)
  await user.click(screen.getByRole('button', { name: 'この版の確認を依頼' }))
  expect(await screen.findByText('この下書きは確認待ちです。')).toBeVisible()
  expect(publish).toBeDisabled()
  for (const field of screen.getAllByRole('checkbox')) await user.click(field)
  expect(publishManagedQuest).not.toHaveBeenCalled()
  await user.click(publish)
  expect(publishManagedQuest).toHaveBeenCalledExactlyOnceWith(org.orgId, initial.questId, {
    expectedDraftRevision: 4, matchTestId: 'match-test', mismatchTestId: 'other-test',
    confirmations: { fictionalData: true, visitConditions: true, photoRights: true, shootingArea: true, testCases: true },
  }, { signal: expect.any(AbortSignal) })
  expect(published).toHaveBeenCalledOnce()
})

it('keeps publishing unavailable for an editor and stops work on an old draft', async () => {
  const user = userEvent.setup()
  const submitManagedQuestReview = vi.fn().mockRejectedValue(new ApiError('DRAFT_CONFLICT'))
  const api = { ...createApiClient(), submitManagedQuestReview }
  render(<PublicationWorkspace api={api} initial={initial} member={{ ...org, role: 'editor' }} onBack={vi.fn()} onPublished={vi.fn()} />)
  expect(screen.queryByRole('button', { name: 'この版を開発用に公開' })).not.toBeInTheDocument()
  const review = screen.getByRole('button', { name: 'この版の確認を依頼' })
  await user.click(review)
  expect(await screen.findByRole('alert')).toHaveTextContent('下書きの版が変わりました')
  expect(review).toBeDisabled()
  expect(screen.getByRole('button', { name: '写真試験を送信' })).toBeDisabled()
})

it('requires explicit rights application to a replacement private test photo', async () => {
  const user = userEvent.setup()
  const testManagedQuest = vi.fn().mockResolvedValue({ orgId: org.orgId, questId: initial.questId, draftRevision: 4, source: 'mock', testId: 't', outcome: 'MATCH' })
  render(<PublicationWorkspace rightsAssist api={{ ...createApiClient(), testManagedQuest }} initial={initial} member={org} onBack={vi.fn()} onPublished={vi.fn()} />)
  await user.upload(screen.getByLabelText('試験写真'), new File(['a'], 'a.png', { type: 'image/png' }))
  await user.type(screen.getByLabelText('試験写真の利用権'), 'A用の権利文')
  await user.upload(screen.getByLabelText('試験写真'), new File(['b'], 'b.png', { type: 'image/png' }))
  const send = screen.getByRole('button', { name: '写真試験を送信' })
  expect(send).toBeDisabled()
  await user.click(screen.getByLabelText('差し替えた写真を非公開試験に使う権利を確認し、入力済みの権利文を適用する'))
  await user.click(send)
  expect(testManagedQuest).toHaveBeenCalledOnce()
})
