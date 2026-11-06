import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { createApiClient } from '../../shared/api'
import { discovery } from '../../shared/api/testFixtures'
import { OwnerDiscoveries } from './OwnerDiscoveries'

it('keeps the earlier explanation and omits blank guidance fields', async () => {
  const user = userEvent.setup()
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = () => 'blob:synthetic-record'
    static revokeObjectURL = vi.fn()
  })
  const api = {
    ...createApiClient(),
    listDiscoveries: vi.fn().mockResolvedValue({ items: [discovery], nextCursor: null }),
    getDiscovery: vi.fn().mockResolvedValue({ ...discovery, afterClear: { access: 'バス停から徒歩5分', hours: ' ', promoComment: '', explanation: '' } }),
    getDiscoveryPhoto: vi.fn().mockResolvedValue(new Blob(['fixture'])),
  }
  render(<OwnerDiscoveries api={api} />)
  await user.click(await screen.findByRole('button', { name: discovery.placeName }))
  expect(await screen.findByText('バス停から徒歩5分')).toBeVisible()
  expect(screen.getByText(discovery.descriptionSnapshot)).toBeVisible()
  expect(screen.queryByText('利用時間')).not.toBeInTheDocument()
  expect(screen.queryByText('自治体からの紹介')).not.toBeInTheDocument()
})

it('confirms deletion, checks a known receipt without resending, and refreshes the list after completion', async () => {
  const user = userEvent.setup()
  const revokeObjectURL = vi.fn()
  vi.stubGlobal('URL', class extends URL { static createObjectURL = () => 'blob:synthetic-record'; static revokeObjectURL = revokeObjectURL })
  const listDiscoveries = vi.fn().mockResolvedValueOnce({ items: [discovery], nextCursor: null })
    .mockResolvedValue({ items: [], nextCursor: null })
  const deleteDiscovery = vi.fn().mockResolvedValue({ deletionId: 'demo-deletion' })
  const getDeletion = vi.fn().mockRejectedValueOnce(new Error('network'))
    .mockResolvedValueOnce({ deletionId: 'demo-deletion', state: 'pending', retryable: false })
    .mockResolvedValueOnce({ deletionId: 'demo-deletion', state: 'completed', retryable: false })
  const api = { ...createApiClient(), listDiscoveries, deleteDiscovery, getDeletion,
    getDiscovery: vi.fn().mockResolvedValue(discovery), getDiscoveryPhoto: vi.fn().mockResolvedValue(new Blob(['fixture'])) }
  render(<OwnerDiscoveries api={api} />)
  await user.click(await screen.findByRole('button', { name: discovery.placeName }))
  expect(await screen.findByText(discovery.descriptionSnapshot)).toBeVisible()
  await user.click(await screen.findByRole('button', { name: '記録を削除' }))
  expect(deleteDiscovery).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'キャンセル' }))
  expect(deleteDiscovery).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: '記録を削除' }))
  await user.click(screen.getByRole('button', { name: '記録と写真を削除する' }))
  await user.click(await screen.findByRole('button', { name: '削除状態を再確認' }))
  expect(await screen.findByText('削除を受け付けました。')).toBeVisible()
  expect(screen.queryByText('記録と写真の削除が完了しました。')).not.toBeInTheDocument()
  expect(deleteDiscovery).toHaveBeenCalledExactlyOnceWith(discovery.discoveryId, { signal: expect.any(AbortSignal) })
  await user.click(screen.getByRole('button', { name: '削除状態を確認' }))
  expect(await screen.findByText('記録と写真の削除が完了しました。')).toBeVisible()
  expect(await screen.findByText('自分の記録はまだありません。')).toBeVisible()
  expect(getDeletion).toHaveBeenCalledTimes(3)
  expect(deleteDiscovery).toHaveBeenCalledTimes(1)
  expect(listDiscoveries).toHaveBeenCalledTimes(2)
  expect(revokeObjectURL).toHaveBeenCalledWith('blob:synthetic-record')
})


it('reads and deletes durable owner records through the authenticated common HTTP client', async () => {
  const user = userEvent.setup()
  const revokeObjectURL = vi.fn()
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = () => 'blob:durable-record'
    static revokeObjectURL = revokeObjectURL
  })
  let deleted = false
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const path = String(input)
    const headers = { 'Content-Type': 'application/json', 'X-Quest-Data-Mode': 'durable-local' }
    if (path.endsWith('/photo')) return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), {
      headers: { ...headers, 'Content-Type': 'image/jpeg' },
    })
    let body: unknown
    if (path.startsWith('/api/v1/me/discoveries?')) body = { items: deleted ? [] : [discovery], nextCursor: null }
    else if (path === '/api/v1/me/deletions/durable-deletion') body = { deletionId: 'durable-deletion', state: 'completed', retryable: false }
    else if (path === '/api/v1/me/discoveries/' + discovery.discoveryId) {
      if (init?.method === 'DELETE') { deleted = true; body = { deletionId: 'durable-deletion' } }
      else body = discovery
    } else throw new Error('Unexpected owner request: ' + path)
    return new Response(JSON.stringify(body), { status: init?.method === 'DELETE' ? 202 : 200, headers })
  })
  const api = createApiClient({ fetch: fetcher, expectedDataMode: 'durable-local', getIdToken: async () => 'owner-token' })
  render(<OwnerDiscoveries api={api} />)
  await user.click(await screen.findByRole('button', { name: discovery.placeName }))
  expect(await screen.findByRole('img', { name: '本人の記録写真' })).toHaveAttribute('src', 'blob:durable-record')
  expect(screen.getByText(discovery.descriptionSnapshot)).toBeVisible()
  await user.click(screen.getByRole('button', { name: '記録を削除' }))
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toHaveLength(0)
  await user.click(screen.getByRole('button', { name: '記録と写真を削除する' }))
  expect(await screen.findByText('記録と写真の削除が完了しました。')).toBeVisible()
  expect(await screen.findByText('自分の記録はまだありません。')).toBeVisible()
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toHaveLength(1)
  expect(revokeObjectURL).toHaveBeenCalledWith('blob:durable-record')
  for (const [, init] of fetcher.mock.calls) expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer owner-token')
})
