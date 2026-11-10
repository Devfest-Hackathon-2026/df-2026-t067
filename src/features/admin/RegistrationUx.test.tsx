import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createApiClient } from '../../shared/api'
import type { ManagedQuest } from '../../shared/api'
import QuestDraftForm from './QuestDraftForm'
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
it('identifies the missing target locally and focuses it; there is no evidence field', async () => {
  render(<QuestDraftForm />)
  expect(screen.queryByLabelText('対象にした理由')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '下書き・編集へ' }))
  expect(screen.getByLabelText('撮るもの')).toHaveAttribute('aria-invalid', 'true')
  await waitFor(() => expect(screen.getByLabelText('撮るもの')).toHaveFocus())
  fireEvent.change(screen.getByLabelText('撮るもの'), { target: { value: '時計' } })
  fireEvent.click(screen.getByRole('button', { name: '下書き・編集へ' }))
  expect(screen.getByLabelText('タイトル')).toBeVisible()
})
it('preserves optional values through collapse and navigation and explains incomplete previews', () => {
  render(<QuestDraftForm />)
  const summary = screen.getByText('クリア後')
  expect(summary.closest('details')).not.toHaveAttribute('open')
  fireEvent.click(summary)
  fireEvent.change(screen.getByLabelText('行き方'), { target: { value: '駅から徒歩' } })
  fireEvent.click(summary)
  fireEvent.click(screen.getByRole('button', { name: /3\/3/ }))
  expect(screen.getByRole('status')).toBeVisible()
  expect(screen.getByText(/タイトル・問題文・ヒント 1・ヒント 2・ヒント 3/)).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '素材と場所を編集' }))
  fireEvent.click(screen.getByText('クリア後'))
  expect(screen.getByLabelText('行き方')).toHaveValue('駅から徒歩')
  expect(screen.getByLabelText('写真の権利')).toBeVisible()
})

it('clears legacy photo notes and preserves other connected fields after visiting preview', async () => {
  const initial: ManagedQuest = {
    orgId: 'org', questId: 'quest', areaId: 'area', draftRevision: 7, publishedVersion: null,
    status: 'draft', source: 'mock', shootingAreaStatus: 'configured',
    draft: {
      materials: { name: '時計', evidence: '確認した根拠', requiresBoat: true, requiresPaidFacility: true, price: '500円', photoNote: '安全注意', photoRights: '合成素材' },
      content: { title: '', question: '', hints: ['', '', ''], verifiedFeatures: '丸い文字盤', draftingNotes: '非公開メモ' },
      afterClear: { access: '徒歩', hours: '09:30〜17:30', promoComment: '紹介', explanation: '背景' },
      referenceAssetId: 'reference', hintAssetId: 'legacy', hintAssetIds: ['one', null, 'three'],
    },
  }
  const updateManagedQuest = vi.fn().mockResolvedValue({ ...initial, draftRevision: 8 })
  render(<QuestDraftForm connection={{ api: { ...createApiClient(), updateManagedQuest }, initial,
    member: { orgId: 'org', areaId: 'area', label: '架空自治体', role: 'editor' }, onBack: vi.fn() }} />)
  fireEvent.click(screen.getByText('クリア後'))
  fireEvent.click(screen.getByText('クリア後'))
  fireEvent.click(screen.getByRole('button', { name: /3\/3/ }))
  fireEvent.click(screen.getByRole('button', { name: '下書きを保存' }))
  await screen.findByText('保存済み')
  expect(updateManagedQuest.mock.calls[0][2]).toEqual({ expectedDraftRevision: 7, draft: { ...initial.draft, materials: { ...initial.draft.materials, photoNote: '' } } })
})
it('opens collapsed hours and focuses its error when a partial range prevents navigation', async () => {
  render(<QuestDraftForm />)
  fireEvent.click(screen.getByText('クリア後'))
  fireEvent.click(screen.getByRole('radio', { name: '時刻指定' }))
  fireEvent.change(screen.getByLabelText('開始時刻'), { target: { value: '09:00' } })
  fireEvent.click(screen.getByText('クリア後'))
  fireEvent.click(screen.getByRole('button', { name: /3\/3/ }))
  await waitFor(() => expect(screen.getByRole('alert')).toHaveFocus())
  expect(screen.getByText('クリア後').closest('details')).toHaveAttribute('open')
})

it('reveals draft hints one at a time and shows the filled count', () => {
  render(<QuestDraftForm />)
  fireEvent.change(screen.getByLabelText('撮るもの'), { target: { value: '時計' } })
  fireEvent.click(screen.getByRole('button', { name: '下書き・編集へ' }))
  expect(screen.getByLabelText('ヒント 1')).toBeVisible()
  expect(screen.queryByLabelText('ヒント 2')).not.toBeInTheDocument()
  expect(screen.queryByLabelText('ヒント 3')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '次のヒントを書く' }))
  expect(screen.getByLabelText('ヒント 2')).toBeVisible()
})
it('does not offer the fictional sample loader in the connected form', () => {
  const initial: ManagedQuest = {
    orgId: 'org', questId: 'quest', areaId: 'area', draftRevision: 7, publishedVersion: null,
    status: 'draft', source: 'mock', shootingAreaStatus: 'configured',
    draft: {
      materials: { name: '時計', evidence: '確認した根拠', requiresBoat: false, requiresPaidFacility: false, price: '', photoNote: '', photoRights: '合成素材' },
      content: { title: '', question: '', hints: ['', '', ''], verifiedFeatures: '', draftingNotes: '' },
      afterClear: { access: '', hours: '', promoComment: '', explanation: '' },
      referenceAssetId: null, hintAssetId: null,
    },
  }
  render(<QuestDraftForm connection={{ api: createApiClient(), initial,
    member: { orgId: 'org', areaId: 'area', label: '架空自治体', role: 'editor' }, onBack: vi.fn() }} />)
  fireEvent.click(screen.getByRole('button', { name: '下書き・編集へ' }))
  expect(screen.getByLabelText('タイトル')).toBeVisible()
  expect(screen.queryByRole('button', { name: 'サンプル' })).not.toBeInTheDocument()
})
it('focuses the photo rights field before saving a newly selected connected photo', async () => {
  vi.stubGlobal('URL', { createObjectURL: () => 'blob:fixture', revokeObjectURL: vi.fn() })
  const createManagedQuest = vi.fn()
  const uploadOrgAsset = vi.fn()
  render(<QuestDraftForm connection={{ api: { ...createApiClient(), createManagedQuest, uploadOrgAsset }, initial: null,
    member: { orgId: 'org', areaId: 'area', label: '架空自治体', role: 'editor' }, onBack: vi.fn() }} />)
  fireEvent.change(screen.getByLabelText('正解の写真'), { target: { files: [new File(['fixture'], 'fixture.png', { type: 'image/png' })] } })
  fireEvent.click(screen.getByRole('button', { name: /3\/3/ }))
  fireEvent.click(screen.getByRole('button', { name: '下書きを保存' }))
  await waitFor(() => expect(screen.getByLabelText('写真の権利')).toHaveFocus())
  expect(screen.getByLabelText('写真の権利')).toHaveAttribute('aria-invalid', 'true')
  expect(createManagedQuest).not.toHaveBeenCalled()
  expect(uploadOrgAsset).not.toHaveBeenCalled()
})
