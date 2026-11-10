import { render, screen, within } from '@testing-library/react'
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
  render(<PublicationWorkspace api={api} initial={initial} onBack={vi.fn()} onPublished={published} />)
  const publish = screen.getByRole('button', { name: '公開' })
  expect(publish).toBeDisabled()
  const match = new File(['match'], 'match.png', { type: 'image/png' })
  const other = new File(['other'], 'other-target.png', { type: 'image/png' })
  await user.type(screen.getByLabelText('利用権'), '自作の合成画像')
  expect(screen.getByLabelText('試験写真').closest('label')).toHaveTextContent('写真を選ぶ')
  await user.upload(screen.getByLabelText('試験写真'), match)
  expect(screen.getByText(match.name)).toBeVisible()
  expect(testManagedQuest).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: '写真試験を送信' }))
  expect(await screen.findByText('正解')).toBeVisible()
  expect(publish).toBeDisabled()
  await user.upload(screen.getByLabelText('試験写真'), other)
  await user.click(screen.getByRole('button', { name: '写真試験を送信' }))
  expect(await screen.findByText('別対象')).toBeVisible()
  expect(testManagedQuest.mock.calls.map((call) => call[2].expectedDraftRevision)).toEqual([4, 4])
  expect(testManagedQuest.mock.calls[0][2].idempotencyKey).not.toEqual(testManagedQuest.mock.calls[1][2].idempotencyKey)
  await user.click(screen.getByRole('button', { name: '公開条件を確認' }))
  expect(await screen.findByText('確認待ち')).toBeVisible()
  expect(publish).toBeDisabled()
  for (const field of screen.getAllByRole('checkbox')) await user.click(field)
  expect(publishManagedQuest).not.toHaveBeenCalled()
  await user.click(publish)
  expect(publishManagedQuest).not.toHaveBeenCalled()
  expect(screen.getByRole('dialog', { name: '公開の確認' })).toHaveTextContent('問題・ヒントを公開')
  expect(screen.getByRole('button', { name: 'やめる' })).toHaveFocus()
  await user.click(screen.getByRole('button', { name: 'やめる' }))
  expect(publish).toHaveFocus()
  await user.click(publish)
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '公開' }))
  expect(publishManagedQuest).toHaveBeenCalledExactlyOnceWith(org.orgId, initial.questId, {
    expectedDraftRevision: 4, matchTestId: 'match-test', mismatchTestId: 'other-test',
    confirmations: { fictionalData: true, visitConditions: true, photoRights: true, shootingArea: true, testCases: true },
  }, { signal: expect.any(AbortSignal) })
  expect(published).toHaveBeenCalledOnce()
})

it('keeps publishing unavailable without verification and stops work on an old draft', async () => {
  const user = userEvent.setup()
  const submitManagedQuestReview = vi.fn().mockRejectedValue(new ApiError('DRAFT_CONFLICT'))
  const api = { ...createApiClient(), submitManagedQuestReview }
  render(<PublicationWorkspace api={api} initial={initial} onBack={vi.fn()} onPublished={vi.fn()} />)
  expect(screen.getByRole('button', { name: '公開' })).toBeDisabled()
  for (const checkbox of screen.getAllByRole('checkbox')) expect(checkbox).toBeDisabled()
  const review = screen.getByRole('button', { name: '公開条件を確認' })
  await user.click(review)
  expect(await screen.findByRole('alert')).toHaveTextContent('下書きに変更')
  expect(review).toBeDisabled()
  expect(screen.getByRole('button', { name: '写真試験を送信' })).toBeDisabled()
})

it('requires explicit rights application to a replacement private test photo', async () => {
  const user = userEvent.setup()
  const testManagedQuest = vi.fn().mockResolvedValue({ orgId: org.orgId, questId: initial.questId, draftRevision: 4, source: 'mock', testId: 't', outcome: 'MATCH' })
  render(<PublicationWorkspace rightsAssist api={{ ...createApiClient(), testManagedQuest }} initial={initial} onBack={vi.fn()} onPublished={vi.fn()} />)
  await user.upload(screen.getByLabelText('試験写真'), new File(['a'], 'a.png', { type: 'image/png' }))
  await user.type(screen.getByLabelText('利用権'), 'A用の権利文')
  await user.upload(screen.getByLabelText('試験写真'), new File(['b'], 'b.png', { type: 'image/png' }))
  const send = screen.getByRole('button', { name: '写真試験を送信' })
  expect(send).toBeDisabled()
  await user.click(screen.getByLabelText('差し替え写真の利用権を確認'))
  await user.click(send)
  expect(testManagedQuest).toHaveBeenCalledOnce()
})

it('offers the exact fixture photos for download and explains fixtures-only recording', () => {
  render(<PublicationWorkspace api={createApiClient()} initial={initial} onBack={vi.fn()} onPublished={vi.fn()} />)
  expect(screen.getByText('合成写真限定・実写真未対応')).toBeVisible()
  const match = screen.getByRole('link', { name: /一致用の合成写真/ })
  expect(match).toHaveAttribute('download', 'match.png')
  expect(match.getAttribute('href')).toMatch(/^data:image\/png;base64,iVBORw0KGgo/)
  const other = screen.getByRole('link', { name: /別対象の合成写真/ })
  expect(other).toHaveAttribute('download', 'other-target.png')
  expect(other.getAttribute('href')).toMatch(/^data:image\/png;base64,iVBORw0KGgo/)
  expect(other.getAttribute('href')).not.toBe(match.getAttribute('href'))
})

it('guides real-photo tests and accepts real results in answer-trial photo test mode', async () => {
  const user = userEvent.setup()
  const testManagedQuest = vi.fn().mockResolvedValue({ orgId: org.orgId, questId: initial.questId, draftRevision: 4, source: 'real', testId: 'real-match', outcome: 'MATCH' })
  const api = { ...createApiClient(), testManagedQuest }
  render(<PublicationWorkspace photoTestSource="real" api={api} initial={initial} onBack={vi.fn()} onPublished={vi.fn()} />)
  expect(screen.queryByText(/検証用の環境です/)).not.toBeInTheDocument()
  expect(screen.getByText('実写真照合・送信枠を共用')).toBeVisible()
  expect(screen.queryByRole('link', { name: /合成写真/ })).not.toBeInTheDocument()
  await user.type(screen.getByLabelText('利用権'), '自作の対象を自分で撮影した写真')
  await user.upload(screen.getByLabelText('試験写真'), new File(['real'], 'real-photo.jpg', { type: 'image/jpeg' }))
  await user.click(screen.getByRole('button', { name: '写真試験を送信' }))
  expect(await screen.findByText('正解')).toBeVisible()
})

it('rejects a mock result in real photo test mode', async () => {
  const user = userEvent.setup()
  const testManagedQuest = vi.fn().mockResolvedValue({ orgId: org.orgId, questId: initial.questId, draftRevision: 4, source: 'mock', testId: 'mock-match', outcome: 'MATCH' })
  const api = { ...createApiClient(), testManagedQuest }
  render(<PublicationWorkspace photoTestSource="real" api={api} initial={initial} onBack={vi.fn()} onPublished={vi.fn()} />)
  await user.type(screen.getByLabelText('利用権'), '自作の対象を自分で撮影した写真')
  await user.upload(screen.getByLabelText('試験写真'), new File(['real'], 'real-photo.jpg', { type: 'image/jpeg' }))
  await user.click(screen.getByRole('button', { name: '写真試験を送信' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('結果未確認')
  expect(screen.queryByText('正解')).not.toBeInTheDocument()
})

it('explains a system error in real photo test mode without fixture wording', async () => {
  const user = userEvent.setup()
  const testManagedQuest = vi.fn().mockRejectedValue(new ApiError('SYSTEM_ERROR'))
  const api = { ...createApiClient(), testManagedQuest }
  render(<PublicationWorkspace photoTestSource="real" api={api} initial={initial} onBack={vi.fn()} onPublished={vi.fn()} />)
  await user.type(screen.getByLabelText('利用権'), '自作の対象を自分で撮影した写真')
  await user.upload(screen.getByLabelText('試験写真'), new File(['real'], 'real-photo.jpg', { type: 'image/jpeg' }))
  await user.click(screen.getByRole('button', { name: '写真試験を送信' }))
  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent('テスト失敗')
  expect(alert).not.toHaveTextContent('合成写真限定')
})

it('explains that a real photo leaves no record when the fixture matcher rejects it', async () => {
  const user = userEvent.setup()
  const testManagedQuest = vi.fn().mockRejectedValue(new ApiError('SYSTEM_ERROR'))
  const api = { ...createApiClient(), testManagedQuest }
  render(<PublicationWorkspace api={api} initial={initial} onBack={vi.fn()} onPublished={vi.fn()} />)
  await user.type(screen.getByLabelText('利用権'), '自分の写真')
  await user.upload(screen.getByLabelText('試験写真'), new File(['real'], 'real-photo.png', { type: 'image/png' }))
  await user.click(screen.getByRole('button', { name: '写真試験を送信' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('合成写真限定')
})
