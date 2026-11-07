import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createApiClient } from '../../shared/api'
import QuestDraftForm from './QuestDraftForm'
import { QuestTaskWorkspace } from './QuestTaskWorkspace'
import type { ManagedQuest, ManagedQuestDraft } from '../../shared/api'
afterEach(cleanup)
it('allows connected writing without reason or name and omits routine memo composition', () => {
  render(<QuestDraftForm connection={{ taskFocused: true, api: createApiClient(), initial: null,
    member: { orgId: 'org', areaId: 'area', label: '合成自治体', role: 'editor' }, onBack: vi.fn() }} />)
  fireEvent.click(screen.getByRole('button', { name: '下書き・編集へ' }))
  expect(screen.getByLabelText('問題タイトル')).toBeVisible()
  expect(screen.queryByLabelText('下書きの根拠・人のメモ')).not.toBeInTheDocument()
  expect(screen.getByLabelText('確認済み特徴')).toBeVisible()
})

it('keeps legacy evidence and memo while saving before a hint shortcut, and never navigates on failure', async () => {
  const initial = {
    orgId: 'org', questId: 'quest', areaId: 'area', draftRevision: 7, publishedVersion: null,
    status: 'draft' as const, source: 'real' as const, shootingAreaStatus: 'configured' as const,
    draft: { materials: { name: '合成対象', evidence: '既存資料', photoRights: '合成', price: '', photoNote: '', requiresBoat: false, requiresPaidFacility: false },
      content: { title: '題', question: '謎', hints: ['一', '二', '三'] as [string, string, string], verifiedFeatures: '赤い丸', draftingNotes: '保持するメモ' },
      afterClear: { access: '', hours: '09:30〜17:30', promoComment: '', explanation: '' }, referenceAssetId: 'reference', hintAssetId: null },
  }
  const updateManagedQuest = vi.fn().mockResolvedValue({ ...initial, draftRevision: 8 })
  const onContinue = vi.fn()
  render(<QuestDraftForm connection={{ taskFocused: true, api: { ...createApiClient(), updateManagedQuest }, initial,
    member: { orgId: 'org', areaId: 'area', label: '合成自治体', role: 'editor' }, onBack: vi.fn(), onContinue }} />)
  fireEvent.click(screen.getByRole('button', { name: '保存してヒント 2の画像へ' }))
  await screen.findByText('下書きを保存しました。')
  expect(updateManagedQuest.mock.calls[0][2]).toEqual({ expectedDraftRevision: 7, draft: initial.draft })
  expect(onContinue).toHaveBeenCalledExactlyOnceWith({ ...initial, draftRevision: 8 }, 2)
  updateManagedQuest.mockRejectedValue(new Error('synthetic offline'))
  fireEvent.click(screen.getByRole('button', { name: '保存して撮影範囲へ' }))
  await screen.findByRole('alert')
  expect(onContinue).toHaveBeenCalledTimes(1)
})

it('returns from range editing to fresh content in the same task without listing quests', async () => {
  let saved: ManagedQuest
  const createManagedQuest = vi.fn(async (_org: string, draft: ManagedQuestDraft): Promise<ManagedQuest> => {
    saved = { orgId: 'org', questId: 'quest', areaId: 'area', source: 'real', draftRevision: 1, publishedVersion: null, status: 'draft', shootingAreaStatus: 'unconfigured', draft }
    return saved
  })
  const getShootingAreas = vi.fn().mockResolvedValue({ orgId: 'org', questId: 'quest', draftRevision: 1, zones: [], source: 'real' })
  const updateShootingAreas = vi.fn(async () => { saved = { ...saved!, draftRevision: 2 }; return { orgId: 'org', questId: 'quest', draftRevision: 2, zones: [], source: 'real' as const } })
  const getManagedQuest = vi.fn(async () => saved!)
  const updateManagedQuest = vi.fn(async (_org: string, _id: string, _input: unknown) => ({ ...saved!, draftRevision: 3 }))
  const onBack = vi.fn()
  render(<QuestTaskWorkspace api={{ ...createApiClient(), createManagedQuest, getShootingAreas, updateShootingAreas, getManagedQuest, updateManagedQuest }} initial={null}
    member={{ orgId: 'org', areaId: 'area', label: '合成自治体', role: 'editor' }} onBack={onBack} />)
  fireEvent.click(screen.getByRole('button', { name: '下書き・編集へ' }))
  fireEvent.change(screen.getByLabelText('問題タイトル'), { target: { value: '保持する題' } })
  fireEvent.click(screen.getByRole('button', { name: '保存して撮影範囲へ' }))
  fireEvent.click(await screen.findByRole('button', { name: '撮影範囲を保存' }))
  await screen.findByText('非公開の撮影範囲を保存しました。')
  fireEvent.click(screen.getByRole('button', { name: '本文編集へ戻る' }))
  await screen.findByText('下書き版 2')
  fireEvent.click(screen.getByRole('button', { name: '下書き・編集へ' }))
  expect(screen.getByLabelText('問題タイトル')).toHaveValue('保持する題')
  fireEvent.click(screen.getByRole('button', { name: '下書きを保存' }))
  await screen.findByText('下書きを保存しました。')
  expect(updateManagedQuest.mock.calls[0][2]).toMatchObject({ expectedDraftRevision: 2 })
  expect(onBack).not.toHaveBeenCalled()
})
