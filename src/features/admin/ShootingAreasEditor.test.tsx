import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { ApiError, createApiClient } from '../../shared/api'
import { ShootingAreasEditor } from './ShootingAreasEditor'

it('saves only valid coordinates using the loaded revision and keeps an edit on a conflict', async () => {
  const user = userEvent.setup()
  const initial = { questId: 'demo-quest', orgId: 'demo-org', draftRevision: 4, source: 'mock',
    zones: [{ latitude: 0, longitude: 0, radiusMeters: 80 }] }
  const getShootingAreas = vi.fn().mockResolvedValue(initial)
  const updateShootingAreas = vi.fn().mockResolvedValueOnce({ ...initial, draftRevision: 5,
    zones: [{ latitude: 1, longitude: 0, radiusMeters: 80 }] }).mockRejectedValueOnce(new ApiError('DRAFT_CONFLICT'))
  const api = { ...createApiClient(), getShootingAreas, updateShootingAreas }
  render(<ShootingAreasEditor api={api} orgId="demo-org" questId="demo-quest" onBack={vi.fn()} />)
  const latitude = await screen.findByLabelText('緯度')
  expect(latitude).toHaveValue(0)
  await user.clear(latitude)
  expect(screen.getByRole('button', { name: '撮影範囲を保存' })).toBeDisabled()
  await user.type(latitude, '1')
  await user.click(screen.getByRole('button', { name: '撮影範囲を保存' }))
  expect(await screen.findByText('非公開の撮影範囲を保存しました。')).toBeVisible()
  expect(updateShootingAreas.mock.calls[0][2]).toEqual({
    expectedDraftRevision: 4, zones: [{ latitude: 1, longitude: 0, radiusMeters: 80 }],
  })
  await user.click(screen.getByRole('button', { name: 'この範囲を外す' }))
  await user.click(screen.getByRole('button', { name: '撮影範囲を保存' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('下書きの版が変わりました')
  expect(updateShootingAreas.mock.calls[1][2]).toEqual({ expectedDraftRevision: 5, zones: [] })
  expect(screen.getByText('設定する範囲はありません。')).toBeVisible()
  expect(screen.getByRole('button', { name: '撮影範囲を保存' })).toBeDisabled()
})
