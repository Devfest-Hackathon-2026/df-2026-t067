import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { ApiError, createApiClient } from '../../shared/api'
import { ShootingAreasEditor } from './ShootingAreasEditor'

vi.mock('./ShootingAreasMap', () => ({ ShootingAreasMap: ({ onSelect, disabled }: { onSelect: (lat: number, lng: number) => void; disabled: boolean }) => <button type="button" disabled={disabled} onClick={() => onSelect(36, 138)}>地図のテスト地点を選ぶ</button> }))

it('saves only valid coordinates using the loaded revision and keeps an edit on a conflict', async () => {
  const user = userEvent.setup()
  const initial = { questId: 'demo-quest', orgId: 'demo-org', draftRevision: 4, source: 'mock',
    zones: [{ latitude: 0, longitude: 0, radiusMeters: 1000 }] }
  const getShootingAreas = vi.fn().mockResolvedValue(initial)
  const updateShootingAreas = vi.fn().mockResolvedValueOnce({ ...initial, draftRevision: 5,
    zones: [{ latitude: 1, longitude: 0, radiusMeters: 1000 }] }).mockRejectedValueOnce(new ApiError('DRAFT_CONFLICT'))
  const api = { ...createApiClient(), getShootingAreas, updateShootingAreas }
  render(<ShootingAreasEditor enableMap api={api} orgId="demo-org" questId="demo-quest" onBack={vi.fn()} />)
  const latitude = await screen.findByLabelText('緯度')
  expect(latitude).toHaveValue(0)
  await user.clear(latitude)
  expect(screen.getByRole('button', { name: '撮影範囲を保存' })).toBeDisabled()
  await user.type(latitude, '1')
  await user.click(screen.getByRole('button', { name: '撮影範囲を保存' }))
  expect(await screen.findByText('非公開の撮影範囲を保存しました。')).toBeVisible()
  expect(updateShootingAreas.mock.calls[0][2]).toEqual({
    expectedDraftRevision: 4, zones: [{ latitude: 1, longitude: 0, radiusMeters: 1000 }],
  })
  await user.click(screen.getByRole('button', { name: 'この範囲を外す' }))
  await user.click(screen.getByRole('button', { name: '撮影範囲を保存' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('下書きの版が変わりました')
  expect(updateShootingAreas.mock.calls[1][2]).toEqual({ expectedDraftRevision: 5, zones: [] })
  expect(screen.getByText('設定する範囲はありません。')).toBeVisible()
  expect(screen.getByRole('button', { name: '撮影範囲を保存' })).toBeDisabled()
})

it('adds and moves private shooting positions on the map with the fixed radius', async () => {
  const user = userEvent.setup()
  const initial = { questId: 'demo-quest', orgId: 'demo-org', draftRevision: 7, source: 'mock', zones: [] }
  const updateShootingAreas = vi.fn().mockImplementation(async (_org, _quest, input) => ({ ...initial, draftRevision: 8, zones: input.zones }))
  render(<ShootingAreasEditor enableMap api={{ ...createApiClient(), getShootingAreas: vi.fn().mockResolvedValue(initial), updateShootingAreas }} orgId="demo-org" questId="demo-quest" onBack={vi.fn()} />)
  await user.click(await screen.findByRole('button', { name: '地図のテスト地点を選ぶ' }))
  expect(screen.getByLabelText('緯度')).toHaveValue(36)
  expect(screen.getByLabelText('経度')).toHaveValue(138)
  expect(screen.getByText('半径：1,000m（固定）')).toBeVisible()
  await user.click(screen.getByRole('button', { name: '地図のテスト地点を選ぶ' }))
  await user.click(screen.getByRole('button', { name: '撮影範囲を保存' }))
  expect(updateShootingAreas.mock.calls[0][2]).toEqual({ expectedDraftRevision: 7, zones: [{ latitude: 36, longitude: 138, radiusMeters: 1000 }] })
})

it('keeps ten-zone limit and allows deleting a zone before selecting a replacement', async () => {
  const user = userEvent.setup()
  const zones = Array.from({ length: 10 }, (_, index) => ({ latitude: index, longitude: 135, radiusMeters: 1000 }))
  const initial = { questId: 'demo-quest', orgId: 'demo-org', draftRevision: 2, source: 'mock', zones }
  render(<ShootingAreasEditor enableMap api={{ ...createApiClient(), getShootingAreas: vi.fn().mockResolvedValue(initial) }} orgId="demo-org" questId="demo-quest" onBack={vi.fn()} />)
  expect(await screen.findByRole('button', { name: '範囲を追加' })).toBeDisabled()
  await user.selectOptions(screen.getByLabelText('地図で編集する範囲'), '9')
  await user.click(screen.getByRole('button', { name: '地図のテスト地点を選ぶ' }))
  expect(screen.getAllByLabelText('緯度')).toHaveLength(10)
  expect(screen.getAllByLabelText('緯度')[9]).toHaveValue(36)
  await user.click(screen.getAllByRole('button', { name: 'この範囲を外す' })[9])
  expect(screen.getByRole('button', { name: '範囲を追加' })).toBeEnabled()
  await user.click(screen.getByRole('button', { name: '地図のテスト地点を選ぶ' }))
  expect(screen.getAllByLabelText('緯度')).toHaveLength(10)
})

it('keeps legacy radii visible and requires an explicit fixed-radius update before saving', async () => {
  const user = userEvent.setup()
  const initial = { questId: 'legacy-quest', orgId: 'demo-org', draftRevision: 8, source: 'real' as const,
    zones: [{ latitude: 35, longitude: 139, radiusMeters: 80 }] }
  const updateShootingAreas = vi.fn().mockImplementation(async (_org, _quest, input) => ({ ...initial, draftRevision: 9, zones: input.zones }))
  render(<ShootingAreasEditor api={{ ...createApiClient(), getShootingAreas: vi.fn().mockResolvedValue(initial), updateShootingAreas }} orgId="demo-org" questId="legacy-quest" onBack={vi.fn()} />)
  expect(await screen.findByText('保存済みの半径：80m（旧設定）')).toBeVisible()
  expect(screen.getByRole('button', { name: '撮影範囲を保存' })).toBeDisabled()
  expect(screen.getByRole('note')).toHaveTextContent('新しい公開には半径1,000mの確認が必要です')
  await user.click(screen.getByRole('button', { name: 'すべての半径を1,000mに変更' }))
  expect(screen.getByText('半径：1,000m（固定）')).toBeVisible()
  await user.click(screen.getByRole('button', { name: '撮影範囲を保存' }))
  expect(await screen.findByText('非公開の撮影範囲を保存しました。')).toBeVisible()
  expect(updateShootingAreas.mock.calls[0][2]).toEqual({ expectedDraftRevision: 8, zones: [{ latitude: 35, longitude: 139, radiusMeters: 1000 }] })
})
