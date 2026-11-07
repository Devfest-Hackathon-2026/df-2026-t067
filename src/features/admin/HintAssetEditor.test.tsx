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
