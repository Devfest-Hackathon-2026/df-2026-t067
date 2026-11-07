import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createApiClient } from '../../shared/api'
import QuestDraftForm from './QuestDraftForm'
import type { ManagedQuest } from '../../shared/api'
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
function setup(hours = '', price = '', referenceAssetId: string | null = null) {
  const initial: ManagedQuest = { orgId: 'org', questId: 'q', areaId: 'area', draftRevision: 2, publishedVersion: null, source: 'real', status: 'draft', shootingAreaStatus: 'unconfigured', draft: {
    materials: { name: '', evidence: '', requiresBoat: false, requiresPaidFacility: false, price, photoNote: '撮影は日中のみ', photoRights: '既存権利' },
    afterClear: { hours, access: '', promoComment: '', explanation: '' },
    content: { title: '', question: '', hints: ['', '', ''], verifiedFeatures: '', draftingNotes: '' }, referenceAssetId, hintAssetId: null,
  } }
  const updateManagedQuest = vi.fn(async (_org, _id, input) => ({ ...initial, draftRevision: 3, draft: input.draft }))
  render(<QuestDraftForm connection={{ taskFocused: true, initial, api: { ...createApiClient(), uploadOrgAsset: vi.fn().mockResolvedValue({ assetId: 'synthetic' }), updateManagedQuest }, member: { orgId: 'org', areaId: 'area', label: '架空', role: 'editor' }, onBack: vi.fn() }} />)
  fireEvent.click(screen.getByText('クリア後の紹介・解説（任意）'))
  return updateManagedQuest
}
it('saves minute hours with weekday exceptions without changing photography hours', async () => {
  const save = setup()
  fireEvent.click(screen.getByRole('radio', { name: '時間を指定' }))
  expect(screen.getByLabelText('開始時刻')).toHaveAttribute('type', 'time')
  fireEvent.change(screen.getByLabelText('開始時刻'), { target: { value: '09:30' } })
  fireEvent.change(screen.getByLabelText('終了時刻'), { target: { value: '17:45' } })
  fireEvent.change(screen.getByLabelText('曜日・休業・例外'), { target: { value: '月曜休業、祝日は10時から' } })
  fireEvent.click(screen.getByRole('button', { name: '下書きを保存' }))
  await screen.findByText('下書きを保存しました。')
  expect(save.mock.calls[0][2].draft).toMatchObject({ afterClear: { hours: '09:30〜17:45\n月曜休業、祝日は10時から' }, materials: { photoNote: '撮影は日中のみ' } })
})
it('keeps partial optional hours while writing and saving, never inferring all-day', async () => {
  const save = setup()
  fireEvent.click(screen.getByRole('radio', { name: '時間を指定' }))
  fireEvent.change(screen.getByLabelText('開始時刻'), { target: { value: '22:15' } })
  fireEvent.click(screen.getByRole('button', { name: '下書き・編集へ' }))
  expect(screen.getByLabelText('問題タイトル')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '下書きを保存' }))
  await screen.findByText('下書きを保存しました。')
  expect(save.mock.calls[0][2].draft.afterClear.hours).toBe('22:15〜（終了未設定）')
})
it('retains complex legacy hours and price exactly without edits', async () => {
  const save = setup('平日09:35～17:10、日曜休業・臨時変更あり', '大人500円／子供200円（特別展別途）')
  fireEvent.click(screen.getByRole('button', { name: '下書きを保存' }))
  await screen.findByText('下書きを保存しました。')
  expect(save.mock.calls[0][2].draft.afterClear.hours).toBe('平日09:35～17:10、日曜休業・臨時変更あり')
  expect(save.mock.calls[0][2].draft.materials.price).toBe('大人500円／子供200円（特別展別途）')
})
it('chooses paid or unconfirmed without dropping existing price detail and never defaults blank to free', async () => {
  const save = setup('', '大人500円／子供200円')
  fireEvent.change(screen.getByLabelText('料金の区分'), { target: { value: '有料' } })
  expect(screen.getByLabelText('料金')).toHaveValue('有料：大人500円／子供200円')
  fireEvent.change(screen.getByLabelText('料金の区分'), { target: { value: '未確認' } })
  expect(screen.getByLabelText('料金')).toHaveValue('未確認：大人500円／子供200円')
  fireEvent.click(screen.getByRole('button', { name: '下書きを保存' }))
  await screen.findByText('下書きを保存しました。')
  expect(save.mock.calls[0][2].draft.materials.price).toBe('未確認：大人500円／子供200円')
})
it('saves overnight minute hours and keeps all-day exceptions distinct from an empty setting', async () => {
  const save = setup()
  expect(screen.getByLabelText('料金')).toHaveValue('')
  fireEvent.click(screen.getByRole('radio', { name: '時間を指定' }))
  fireEvent.change(screen.getByLabelText('開始時刻'), { target: { value: '22:15' } })
  fireEvent.change(screen.getByLabelText('終了時刻'), { target: { value: '01:45' } })
  fireEvent.click(screen.getByLabelText('終了は翌日'))
  fireEvent.click(screen.getByRole('button', { name: '下書きを保存' }))
  await screen.findByText('下書きを保存しました。')
  expect(save.mock.calls[0][2].draft.afterClear.hours).toBe('22:15〜翌日 01:45')
  expect(save.mock.calls[0][2].draft.materials.price).toBe('')
  fireEvent.click(screen.getByRole('radio', { name: /^終日$/ }))
  fireEvent.change(screen.getByLabelText('曜日・休業・例外'), { target: { value: '水曜休業' } })
  fireEvent.click(screen.getByRole('button', { name: '下書きを保存' }))
  expect(save.mock.calls[1][2].draft.afterClear.hours).toBe('終日\n水曜休業')
})
it('keeps writing available but rejects an assembled hours string exceeding the schema bound before saving', () => {
  const save = setup()
  fireEvent.click(screen.getByRole('radio', { name: /^終日$/ }))
  fireEvent.change(screen.getByLabelText('曜日・休業・例外'), { target: { value: '例'.repeat(2000) } })
  fireEvent.click(screen.getByRole('button', { name: '下書き・編集へ' }))
  expect(screen.getByLabelText('問題タイトル')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '下書きを保存' }))
  expect(save).not.toHaveBeenCalled()
  expect(screen.getByRole('alert')).toHaveTextContent('時間と料金はそれぞれ2000文字以内')
})
it('preserves structured hours when switching to free text and keeps legacy notes when choosing time inputs', () => {
  setup('09:30〜17:45\n月曜休業')
  fireEvent.click(screen.getByRole('radio', { name: '補足を入力' }))
  expect(screen.getByLabelText('時間の補足')).toHaveValue('09:30〜17:45\n月曜休業')
  cleanup()
  setup('平日は午前のみ、祝日は休業')
  fireEvent.click(screen.getByRole('radio', { name: '時間を指定' }))
  expect(screen.getByLabelText('曜日・休業・例外')).toHaveValue('平日は午前のみ、祝日は休業')
})
it('requires explicit rights reuse when replacing an existing reference photo', async () => {
  vi.stubGlobal('URL', { ...URL, createObjectURL: () => 'blob:synthetic', revokeObjectURL: vi.fn() })
  const save = setup()
  const field = screen.getByLabelText(/参考写真（/)
  fireEvent.change(field, { target: { files: [new File(['a'], 'a.png', { type: 'image/png' })] } })
  fireEvent.change(field, { target: { files: [new File(['b'], 'b.png', { type: 'image/png' })] } })
  fireEvent.click(screen.getByRole('button', { name: '下書きを保存' }))
  expect(save).not.toHaveBeenCalled()
  expect(screen.getByRole('alert')).toHaveTextContent('差し替えた写真')
  expect(screen.getByLabelText('写真の出典と利用権')).toHaveValue('既存権利')
  fireEvent.click(screen.getByLabelText('差し替えた写真を非公開照合に使う権利を確認し、入力済みの権利文を適用する'))
  fireEvent.click(screen.getByRole('button', { name: '下書きを保存' }))
  await screen.findByText('下書きを保存しました。')
  expect(save.mock.calls[0][2].draft.materials.photoRights).toBe('既存権利')
})

it('requires rights reuse even after removing the saved reference before selecting another photo', () => {
  vi.stubGlobal('URL', { ...URL, createObjectURL: () => 'blob:synthetic', revokeObjectURL: vi.fn() })
  const save = setup('', '', 'old-reference')
  fireEvent.click(screen.getByRole('button', { name: '参照を外す' }))
  fireEvent.change(screen.getByLabelText(/参考写真（/), { target: { files: [new File(['b'], 'b.png', { type: 'image/png' })] } })
  fireEvent.click(screen.getByRole('button', { name: '下書きを保存' }))
  expect(save).not.toHaveBeenCalled()
  expect(screen.getByRole('alert')).toHaveTextContent('差し替えた写真')
})
