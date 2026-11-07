import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { createApiClient } from '../../shared/api'
import type { ManagedQuest, OrgMembership, UpdateManagedQuest } from '../../shared/api'
import { HintAssetEditor } from './HintAssetEditor'

const member: OrgMembership = { orgId: 'demo-org', areaId: 'demo-area', label: '架空', role: 'editor' }
const initial: ManagedQuest = { questId: 'demo-quest', orgId: member.orgId, areaId: member.areaId, draftRevision: 2,
  publishedVersion: 1, status: 'draft', shootingAreaStatus: 'configured', source: 'mock',
  draft: {
    materials: { name: '架空の対象', evidence: '', price: '', photoNote: '', photoRights: '参考写真の権利',
      requiresBoat: false, requiresPaidFacility: false },
    content: { title: '架空の問題', question: '', hints: ['第一のヒント', '第二のヒント', '第三のヒント'], verifiedFeatures: '', draftingNotes: '' },
    afterClear: { access: '', hours: '', promoComment: '', explanation: '' },
    referenceAssetId: 'private-reference', hintAssetId: null,
  },
}

it('sets and removes a per-hint image while preserving the legacy image field', async () => {
  const user = userEvent.setup()
  const uploadOrgAsset = vi.fn().mockResolvedValue({ assetId: 'public-hint' })
  const updateManagedQuest = vi.fn().mockImplementation(async (_org: string, _quest: string, input: UpdateManagedQuest) => ({
    ...initial, draftRevision: input.expectedDraftRevision + 1, draft: input.draft,
  }))
  render(<HintAssetEditor api={{ ...createApiClient(), uploadOrgAsset, updateManagedQuest }}
    initial={initial} member={member} onBack={vi.fn()} />)
  const file = new File(['synthetic hint'], 'hint.png', { type: 'image/png' })
  await user.selectOptions(screen.getByLabelText('設定するヒント'), '2')
  await user.upload(screen.getByLabelText('公開ヒント画像'), file)
  await user.type(screen.getByLabelText('画像の出典と利用権'), '合成素材の利用権')
  expect(uploadOrgAsset).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'ヒント画像を保存' }))
  expect(await screen.findByText('ヒント画像の設定を保存しました。')).toBeVisible()
  expect(uploadOrgAsset).toHaveBeenCalledExactlyOnceWith(member.orgId, { photo: file, photoRights: '合成素材の利用権',
    purpose: 'public_hint', idempotencyKey: expect.any(String) }, { signal: expect.any(AbortSignal) })
  expect(updateManagedQuest.mock.calls[0][2]).toEqual({
    expectedDraftRevision: 2, draft: { ...initial.draft, hintAssetIds: [null, 'public-hint', null] },
  })
  await user.click(screen.getByRole('button', { name: 'ヒント 2の画像を外す' }))
  expect(await screen.findByText('ヒント画像の設定を保存しました。')).toBeVisible()
  expect(updateManagedQuest.mock.calls[1][2]).toEqual({ expectedDraftRevision: 3,
    draft: { ...initial.draft, hintAssetIds: [null, null, null] } })
  expect(uploadOrgAsset).toHaveBeenCalledTimes(1)
})

it.each([
  [undefined, ['L', 'C', null], null],
  [[null, 'B', null], ['L', 'C', null], null],
  [['A', 'B', null], ['A', 'C', null], 'L'],
] as const)('preserves legacy meaning when changing another slot (%j)', async (slots, changed, legacy) => {
  const user = userEvent.setup()
  const saved = { ...initial, draft: { ...initial.draft, hintAssetId: 'L',
    ...(slots ? { hintAssetIds: [...slots] } : {}) } }
  const updateManagedQuest = vi.fn().mockImplementation(async (_org: string, _quest: string, input: UpdateManagedQuest) => ({
    ...saved, draftRevision: input.expectedDraftRevision + 1, draft: input.draft,
  }))
  render(<HintAssetEditor api={{ ...createApiClient(), uploadOrgAsset: vi.fn().mockResolvedValue({ assetId: 'C' }), updateManagedQuest }}
    initial={saved} member={member} onBack={vi.fn()} />)
  await user.selectOptions(screen.getByLabelText('設定するヒント'), '2')
  await user.upload(screen.getByLabelText('公開ヒント画像'), new File(['fixture'], 'hint.png', { type: 'image/png' }))
  await user.type(screen.getByLabelText('画像の出典と利用権'), '合成素材')
  await user.click(screen.getByRole('button', { name: 'ヒント画像を保存' }))
  await screen.findByText('ヒント画像の設定を保存しました。')
  expect(updateManagedQuest.mock.calls[0][2].draft).toMatchObject({ hintAssetId: legacy, hintAssetIds: [...changed] })
  await user.click(screen.getByRole('button', { name: 'ヒント 2の画像を外す' }))
  expect(updateManagedQuest.mock.calls[1][2]).toMatchObject({ expectedDraftRevision: 3,
    draft: { hintAssetId: legacy, hintAssetIds: [changed[0], null, null] } })
  await user.click(screen.getByRole('button', { name: 'ヒント 1の画像を外す' }))
  expect(updateManagedQuest.mock.calls[2][2].draft).toMatchObject({ hintAssetId: legacy, hintAssetIds: [null, null, null] })
})

it.each([null, 'A'])('removes hint 2 directly without losing legacy (%s)', async (first) => {
  const user = userEvent.setup()
  const saved = { ...initial, draft: { ...initial.draft, hintAssetId: 'L', hintAssetIds: [first, 'B', null] } }
  const updateManagedQuest = vi.fn().mockResolvedValue(saved)
  render(<HintAssetEditor api={{ ...createApiClient(), updateManagedQuest }}
    initial={saved} member={member} onBack={vi.fn()} />)
  await user.click(screen.getByRole('button', { name: 'ヒント 2の画像を外す' }))
  expect(updateManagedQuest.mock.calls[0][2].draft).toMatchObject({
    hintAssetId: first ? 'L' : null, hintAssetIds: [first ?? 'L', null, null],
  })
})

it('requires explicit rights application to a replacement public hint photo', async () => {
  const user = userEvent.setup()
  const uploadOrgAsset = vi.fn().mockResolvedValue({ assetId: 'new-hint' })
  const updateManagedQuest = vi.fn().mockResolvedValue(initial)
  render(<HintAssetEditor rightsAssist api={{ ...createApiClient(), uploadOrgAsset, updateManagedQuest }} initial={initial} member={member} onBack={vi.fn()} />)
  await user.upload(screen.getByLabelText('公開ヒント画像'), new File(['a'], 'a.png', { type: 'image/png' }))
  await user.type(screen.getByLabelText('画像の出典と利用権'), 'A用の権利文')
  await user.upload(screen.getByLabelText('公開ヒント画像'), new File(['b'], 'b.png', { type: 'image/png' }))
  const save = screen.getByRole('button', { name: 'ヒント画像を保存' })
  expect(save).toBeDisabled()
  expect(screen.getByLabelText('画像の出典と利用権')).toHaveValue('A用の権利文')
  await user.click(screen.getByLabelText('差し替えた写真を公開ヒントに使う権利を確認し、入力済みの権利文を適用する'))
  await user.click(save)
  expect(uploadOrgAsset).toHaveBeenCalledOnce()
})
