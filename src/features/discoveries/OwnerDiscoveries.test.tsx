import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
    ...createApiClient(), getQuest: vi.fn().mockResolvedValue({ title: "テスト問題" }),
    listDiscoveries: vi.fn().mockResolvedValue({ items: [discovery], nextCursor: null }),
    getDiscovery: vi.fn().mockResolvedValue({ ...discovery, afterClear: { access: 'バス停から徒歩5分', hours: ' ', promoComment: '', explanation: '' } }),
    getDiscoveryPhoto: vi.fn().mockResolvedValue(new Blob(['fixture'])),
  }
  render(<OwnerDiscoveries onExplore={vi.fn()} api={api} />)
  await user.click(await screen.findByRole('button', { name: discovery.placeName }))
  expect(await screen.findByText('バス停から徒歩5分')).toBeVisible()
  expect(screen.getByText(discovery.descriptionSnapshot)).toBeVisible()
  expect(screen.queryByText('利用時間')).not.toBeInTheDocument()
  expect(screen.queryByText('紹介')).not.toBeInTheDocument()
})

it('shows the confirmed spot guidance with a fixed Google Maps search link', async () => {
  const user = userEvent.setup()
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = () => 'blob:synthetic-record'
    static revokeObjectURL = vi.fn()
  })
  const spot = { name: '架空の灯台', address: '架空県架空市1-1', position: { latitude: 35.5, longitude: 139.5 }, googlePlaceId: 'place-abc_123' }
  const api = {
    ...createApiClient(), getQuest: vi.fn().mockResolvedValue({ title: "テスト問題" }),
    listDiscoveries: vi.fn().mockResolvedValue({ items: [discovery], nextCursor: null }),
    getDiscovery: vi.fn().mockResolvedValue({ ...discovery, afterClear: { access: '', hours: '', promoComment: '', explanation: '', spot } }),
    getDiscoveryPhoto: vi.fn().mockResolvedValue(new Blob(['fixture'])),
  }
  render(<OwnerDiscoveries onExplore={vi.fn()} api={api} />)
  await user.click(await screen.findByRole('button', { name: discovery.placeName }))
  expect(await screen.findByText('架空の灯台')).toBeVisible()
  expect(screen.getByText('架空県架空市1-1')).toBeVisible()
  expect(screen.getByRole('link', { name: 'Google マップ' })).toHaveAttribute('href',
    'https://www.google.com/maps/search/?api=1&query=35.5,139.5&query_place_id=place-abc_123')
})

it('links to the spot position without a place id, and omits the link when no spot was registered', async () => {
  const user = userEvent.setup()
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = () => 'blob:synthetic-record'
    static revokeObjectURL = vi.fn()
  })
  const spot = { name: '架空の灯台', address: '架空県架空市1-1', position: { latitude: 35.5, longitude: 139.5 } }
  const withSpot = {
    ...createApiClient(), getQuest: vi.fn().mockResolvedValue({ title: "テスト問題" }),
    listDiscoveries: vi.fn().mockResolvedValue({ items: [discovery], nextCursor: null }),
    getDiscovery: vi.fn().mockResolvedValue({ ...discovery, afterClear: { access: '', hours: '', promoComment: '', explanation: '', spot } }),
    getDiscoveryPhoto: vi.fn().mockResolvedValue(new Blob(['fixture'])),
  }
  const first = render(<OwnerDiscoveries onExplore={vi.fn()} api={withSpot} />)
  await user.click(await screen.findByRole('button', { name: discovery.placeName }))
  expect(await screen.findByRole('link', { name: 'Google マップ' })).toHaveAttribute('href',
    'https://www.google.com/maps/search/?api=1&query=35.5,139.5')
  first.unmount()

  const withoutSpot = {
    ...createApiClient(), getQuest: vi.fn().mockResolvedValue({ title: "テスト問題" }),
    listDiscoveries: vi.fn().mockResolvedValue({ items: [discovery], nextCursor: null }),
    getDiscovery: vi.fn().mockResolvedValue({ ...discovery, afterClear: { access: '徒歩5分', hours: '', promoComment: '', explanation: '' } }),
    getDiscoveryPhoto: vi.fn().mockResolvedValue(new Blob(['fixture'])),
  }
  render(<OwnerDiscoveries onExplore={vi.fn()} api={withoutSpot} />)
  await user.click(await screen.findByRole('button', { name: discovery.placeName }))
  expect(await screen.findByText('徒歩5分')).toBeVisible()
  expect(screen.queryByRole('link', { name: 'Google マップ' })).not.toBeInTheDocument()
  expect(screen.queryByText('住所情報なし')).not.toBeInTheDocument()
  expect(screen.queryByText('住所', { exact: true })).not.toBeInTheDocument()
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
  const api = { ...createApiClient(), getQuest: vi.fn().mockResolvedValue({ title: "テスト問題" }), listDiscoveries, deleteDiscovery, getDeletion,
    getDiscovery: vi.fn().mockResolvedValue(discovery), getDiscoveryPhoto: vi.fn().mockResolvedValue(new Blob(['fixture'])) }
  render(<OwnerDiscoveries onExplore={vi.fn()} api={api} />)
  await user.click(await screen.findByRole('button', { name: discovery.placeName }))
  expect(await screen.findByText(discovery.descriptionSnapshot)).toBeVisible()
  await user.click(await screen.findByRole('button', { name: '記録を削除' }))
  expect(deleteDiscovery).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'キャンセル' }))
  expect(deleteDiscovery).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: '記録を削除' }))
  expect(screen.getByRole('button', { name: '記録と写真を削除' })).toHaveClass('danger-button')
  await user.click(screen.getByRole('button', { name: '記録と写真を削除' }))
  await user.click(await screen.findByRole('button', { name: '削除状態を再確認' }))
  expect(await screen.findByText('削除受付済み')).toBeVisible()
  expect(screen.getByRole('button', { name: '閉じる' })).toBeEnabled()
  expect(screen.queryByText('削除完了')).not.toBeInTheDocument()
  expect(deleteDiscovery).toHaveBeenCalledExactlyOnceWith(discovery.discoveryId, { signal: expect.any(AbortSignal) })
  await user.click(screen.getByRole('button', { name: '削除状態を確認' }))
  expect(await screen.findByText('削除完了')).toBeVisible()
  expect(await screen.findByText('記録はまだない')).toBeVisible()
  expect(getDeletion).toHaveBeenCalledTimes(3)
  expect(deleteDiscovery).toHaveBeenCalledTimes(1)
  expect(listDiscoveries).toHaveBeenCalledTimes(2)
  expect(revokeObjectURL).toHaveBeenCalledWith('blob:synthetic-record')
})


it.each(['button', 'escape'])('refreshes records after closing a failed deletion check via %s', async (method) => {
  const user = userEvent.setup()
  const listDiscoveries = vi.fn().mockResolvedValueOnce({ items: [discovery], nextCursor: null })
    .mockResolvedValue({ items: [], nextCursor: null })
  const deleteDiscovery = vi.fn().mockResolvedValue({ deletionId: 'demo-deletion' })
  const api = {
    ...createApiClient(),
    listDiscoveries,
    deleteDiscovery,
    getDeletion: vi.fn().mockRejectedValue(new Error('network')),
    getQuest: vi.fn().mockResolvedValue({ title: 'テスト問題', version: discovery.questVersion }),
    getDiscovery: vi.fn().mockResolvedValue(discovery),
    getDiscoveryPhoto: vi.fn().mockResolvedValue(new Blob(['fixture'])),
  }
  render(<OwnerDiscoveries onExplore={vi.fn()} api={api} />)
  await user.click(await screen.findByRole('button', { name: discovery.placeName }))
  await user.click(await screen.findByRole('button', { name: '記録を削除' }))
  await user.click(screen.getByRole('button', { name: '記録と写真を削除' }))
  await screen.findByRole('button', { name: '削除状態を再確認' })
  const dialog = screen.getByRole('dialog', { name: '記録詳細' })
  if (method === 'button') await user.click(within(dialog).getByRole('button', { name: '閉じる' }))
  else fireEvent(dialog, new Event('cancel', { cancelable: true }))
  expect(await screen.findByText('削除中')).toBeVisible()
  expect(dialog).not.toBeInTheDocument()
  expect(screen.queryByText('削除完了')).not.toBeInTheDocument()
  expect(deleteDiscovery).toHaveBeenCalledTimes(1)
  expect(listDiscoveries).toHaveBeenCalledTimes(2)
  await user.click(screen.getByText(discovery.placeName))
  await user.click(await screen.findByRole('button', { name: '削除状態を再確認' }))
  expect(api.getDeletion).toHaveBeenLastCalledWith('demo-deletion', { signal: expect.any(AbortSignal) })
  expect(deleteDiscovery).toHaveBeenCalledTimes(1)
})

it('refetches the list when the records view is entered again', async () => {
  const listDiscoveries = vi.fn()
    .mockResolvedValueOnce({ items: [], nextCursor: null })
    .mockResolvedValue({ items: [discovery], nextCursor: null })
  const api = { ...createApiClient(), getQuest: vi.fn().mockResolvedValue({ title: "テスト問題" }), listDiscoveries }
  const { rerender } = render(<OwnerDiscoveries onExplore={vi.fn()} api={api} visit={1} />)
  expect(await screen.findByText('記録はまだない')).toBeVisible()
  expect(listDiscoveries).toHaveBeenCalledTimes(1)
  // 画面は常駐したままなので、入り直しの合図（visit の増加）で取り直されること。
  // 初回の空表示が居座らず、その間に増えた記録が出る。
  rerender(<OwnerDiscoveries onExplore={vi.fn()} api={api} visit={2} />)
  expect(await screen.findByRole('button', { name: discovery.placeName })).toBeVisible()
  expect(listDiscoveries).toHaveBeenCalledTimes(2)
  // 合図が変わらなければ余分な再取得はしない。
  rerender(<OwnerDiscoveries onExplore={vi.fn()} api={api} visit={2} />)
  expect(listDiscoveries).toHaveBeenCalledTimes(2)
})

it('keeps thumbnails behind the dialog and releases the detail photo on close', async () => {
  const user = userEvent.setup()
  const revokeObjectURL = vi.fn()
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = () => 'blob:record-thumb'
    static revokeObjectURL = revokeObjectURL
  })
  const api = {
    ...createApiClient(), getQuest: vi.fn().mockResolvedValue({ title: "テスト問題" }),
    listDiscoveries: vi.fn().mockResolvedValue({ items: [discovery], nextCursor: null }),
    getDiscovery: vi.fn().mockResolvedValue(discovery),
    getDiscoveryPhoto: vi.fn().mockResolvedValue(new Blob(['thumb'])),
  }
  const { container } = render(<OwnerDiscoveries onExplore={vi.fn()} api={api} />)
  const openRecord = await screen.findByRole('button', { name: discovery.placeName })
  await waitFor(() => expect(container.querySelector('.record-thumbnail')).toHaveAttribute('src', 'blob:record-thumb'))
  expect(openRecord).toBeEnabled()
  await user.click(openRecord)
  expect(await screen.findByRole('img', { name: '本人の記録写真' })).toBeVisible()
  expect(api.getDiscovery).toHaveBeenCalled()
  expect(revokeObjectURL).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: '閉じる' }))
  expect(container.querySelector('.record-thumbnail')).toHaveAttribute('src', 'blob:record-thumb')
  expect(revokeObjectURL).toHaveBeenCalledWith('blob:record-thumb')
})

it.each([0, 1])('shows record details and validates the published title (version offset %i)', async (versionOffset) => {
  const user = userEvent.setup()
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = () => 'blob:record-thumb'
    static revokeObjectURL = vi.fn()
  })
  const spot = { name: '架空の灯台', address: '架空県架空市1-1', position: { latitude: 35.5, longitude: 139.5 } }
  const record = { ...discovery, afterClear: { access: '駅から徒歩5分', hours: '', promoComment: '', explanation: '', spot } }
  const api = {
    ...createApiClient(),
    listDiscoveries: vi.fn().mockResolvedValue({ items: [record], nextCursor: null }),
    getDiscovery: vi.fn().mockResolvedValue(record),
    getDiscoveryPhoto: vi.fn().mockResolvedValue(new Blob(['fixture'])),
    getQuest: vi.fn().mockResolvedValue({ title: '時計台を見つけよう', version: discovery.questVersion + versionOffset }),
  }
  render(<OwnerDiscoveries onExplore={vi.fn()} api={api} />)

  const list = await screen.findByRole('list', { name: '自分の記録一覧' })
  expect(screen.queryByRole('table')).not.toBeInTheDocument()
  const card = within(list).getByRole('listitem')
  expect(await within(card).findByAltText('')).toBeInTheDocument()
  expect(within(card).getByRole('button', { name: spot.name })).toHaveAttribute('aria-haspopup', 'dialog')
  expect(within(card).getByText(spot.name)).toBeVisible()
  expect(within(card).getByText('2026/11/5')).toBeVisible()

  await user.click(within(card).getByText('2026/11/5'))
  const dialog = await screen.findByRole('dialog', { name: '記録詳細' })
  expect(within(dialog).getByRole('img', { name: '本人の記録写真' })).toBeVisible()
  expect(within(dialog).getByText(discovery.descriptionSnapshot)).toBeVisible()
  expect(within(dialog).getByText('駅から徒歩5分')).toBeVisible()
  const title = versionOffset === 0 ? '時計台を見つけよう' : '問題名取得失敗'
  expect(await within(dialog).findByText(title)).toBeVisible()
  if (versionOffset !== 0) expect(within(dialog).queryByText('時計台を見つけよう')).not.toBeInTheDocument()
  expect(within(dialog).getByText('架空の灯台')).toBeVisible()
  expect(within(dialog).getByText('架空県架空市1-1')).toBeVisible()
  expect(within(dialog).getByRole('button', { name: '記録を削除' })).toBeVisible()
  await user.click(within(dialog).getByRole('button', { name: '閉じる' }))
  expect(screen.queryByRole('dialog', { name: '記録詳細' })).not.toBeInTheDocument()
})

it('keeps record navigation available when a thumbnail cannot be loaded', async () => {
  const user = userEvent.setup()
  const api = {
    ...createApiClient(), getQuest: vi.fn().mockResolvedValue({ title: "テスト問題" }),
    listDiscoveries: vi.fn().mockResolvedValue({ items: [discovery], nextCursor: null }),
    getDiscovery: vi.fn().mockResolvedValue(discovery),
    getDiscoveryPhoto: vi.fn().mockRejectedValueOnce(new Error('photo unavailable')).mockResolvedValue(new Blob(['detail photo'])),
  }
  render(<OwnerDiscoveries onExplore={vi.fn()} api={api} />)
  const openRecord = await screen.findByRole('button', { name: discovery.placeName })
  expect(await screen.findByText('写真なし')).toBeVisible()
  expect(openRecord).toBeEnabled()
  await user.click(openRecord)
  expect(await screen.findByRole('img', { name: '本人の記録写真' })).toBeVisible()
})

it('aborts thumbnail requests when changing pages', async () => {
  const user = userEvent.setup()
  let firstSignal: AbortSignal | undefined
  const api = {
    ...createApiClient(), getQuest: vi.fn().mockResolvedValue({ title: "テスト問題" }),
    listDiscoveries: vi.fn()
      .mockResolvedValueOnce({ items: [discovery], nextCursor: 'page-2' })
      .mockResolvedValue({ items: [], nextCursor: null }),
    getDiscoveryPhoto: vi.fn((_id: string, { signal }: { signal: AbortSignal }) => {
      firstSignal = signal
      return new Promise<Blob>(() => {})
    }),
  }
  render(<OwnerDiscoveries onExplore={vi.fn()} api={api} />)
  await screen.findByRole('button', { name: discovery.placeName })
  await user.click(screen.getByRole('button', { name: '次の記録' }))
  expect(await screen.findByText('記録はまだない')).toBeVisible()
  expect(firstSignal?.aborted).toBe(true)
})

it('loads only thumbnails near the viewport and cancels observed requests on page change', async () => {
  const user = userEvent.setup()
  const observers: Array<{ callback: IntersectionObserverCallback; disconnect: ReturnType<typeof vi.fn>; target?: Element }> = []
  class TestIntersectionObserver {
    readonly disconnect = vi.fn()
    constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
      expect(options?.rootMargin).toBe('160px')
      observers.push({ callback, disconnect: this.disconnect })
    }
    observe = vi.fn((target: Element) => { observers[observers.length - 1].target = target })
    unobserve = vi.fn()
    takeRecords = () => []
  }
  vi.stubGlobal('IntersectionObserver', TestIntersectionObserver)
  const second = { ...discovery, discoveryId: 'record-2', placeName: '二つ目の場所' }
  let photoSignal: AbortSignal | undefined
  const api = {
    ...createApiClient(), getQuest: vi.fn().mockResolvedValue({ title: "テスト問題" }),
    listDiscoveries: vi.fn()
      .mockResolvedValueOnce({ items: [discovery, second], nextCursor: 'page-2' })
      .mockResolvedValue({ items: [], nextCursor: null }),
    getDiscoveryPhoto: vi.fn((_id: string, { signal }: { signal: AbortSignal }) => {
      photoSignal = signal
      return new Promise<Blob>(() => {})
    }),
  }
  render(<OwnerDiscoveries onExplore={vi.fn()} api={api} />)
  await screen.findByRole('button', { name: discovery.placeName })
  expect(api.getDiscoveryPhoto).not.toHaveBeenCalled()
  expect(observers).toHaveLength(2)
  observers[0].callback([{ isIntersecting: true, intersectionRatio: 1, target: observers[0].target! } as IntersectionObserverEntry], {} as IntersectionObserver)
  expect(api.getDiscoveryPhoto).toHaveBeenCalledExactlyOnceWith(discovery.discoveryId, { signal: expect.any(AbortSignal) })
  await user.click(screen.getByRole('button', { name: '次の記録' }))
  expect(await screen.findByText('記録はまだない')).toBeVisible()
  expect(photoSignal?.aborted).toBe(true)
  expect(observers.every(({ disconnect }) => disconnect.mock.calls.length > 0)).toBe(true)
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
  render(<OwnerDiscoveries onExplore={vi.fn()} api={api} />)
  await user.click(await screen.findByRole('button', { name: discovery.placeName }))
  expect(await screen.findByRole('img', { name: '本人の記録写真' })).toHaveAttribute('src', 'blob:durable-record')
  expect(screen.getByText(discovery.descriptionSnapshot)).toBeVisible()
  await user.click(screen.getByRole('button', { name: '記録を削除' }))
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toHaveLength(0)
  await user.click(screen.getByRole('button', { name: '記録と写真を削除' }))
  expect(await screen.findByText('削除完了')).toBeVisible()
  expect(await screen.findByText('記録はまだない')).toBeVisible()
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toHaveLength(1)
  expect(revokeObjectURL).toHaveBeenCalledWith('blob:durable-record')
  for (const [, init] of fetcher.mock.calls.filter(([path]) => String(path).startsWith('/api/v1/me/'))) expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer owner-token')
})


it('opens changed destinations and reopens the same destination on a new visit', async () => {
  const user = userEvent.setup()
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = () => 'blob:synthetic-record'
    static revokeObjectURL = vi.fn()
  })
  const api = { ...createApiClient(), getQuest: vi.fn().mockResolvedValue({ title: "テスト問題" }),
    listDiscoveries: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    getDiscovery: vi.fn(async (id: string) => ({ ...discovery, discoveryId: id, placeName: id })),
    getDiscoveryPhoto: vi.fn().mockResolvedValue(new Blob(['fixture'])),
  }
  const { rerender } = render(<OwnerDiscoveries onExplore={vi.fn()} api={api} visit={1} />)
  expect(await screen.findByText('記録はまだない')).toBeVisible()
  rerender(<OwnerDiscoveries onExplore={vi.fn()} api={api} visit={2} initialId="record-a" />)
  expect(await screen.findByText('record-a')).toBeVisible()
  rerender(<OwnerDiscoveries onExplore={vi.fn()} api={api} visit={3} initialId="record-b" />)
  expect(await screen.findByText('record-b')).toBeVisible()
  await user.click(screen.getByRole('button', { name: '閉じる' }))
  expect(await screen.findByText('記録はまだない')).toBeVisible()
  rerender(<OwnerDiscoveries onExplore={vi.fn()} api={api} visit={4} initialId="record-b" />)
  expect(await screen.findByText('record-b')).toBeVisible()
})


it.each(['', '   '])('omits blank address and duplicate quest name in the detail (%j)', async (address) => {
  const user = userEvent.setup()
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = () => 'blob:synthetic-record'
    static revokeObjectURL = vi.fn()
  })
  const name = '架空の時計'
  const record = { ...discovery, descriptionSnapshot: ' ', afterClear: {
    access: ' ', hours: '', promoComment: ' ', explanation: '',
    spot: { name, address, position: { latitude: 35, longitude: 139 } },
  } }
  const api = { ...createApiClient(),
    listDiscoveries: vi.fn().mockResolvedValue({ items: [record], nextCursor: null }),
    getDiscovery: vi.fn().mockResolvedValue(record),
    getDiscoveryPhoto: vi.fn().mockResolvedValue(new Blob(['fixture'])),
    getQuest: vi.fn().mockResolvedValue({ title: name, version: record.questVersion }),
  }
  render(<OwnerDiscoveries onExplore={vi.fn()} api={api} />)
  await user.click(await screen.findByRole('button', { name }))
  const dialog = within(await screen.findByRole('dialog'))
  await waitFor(() => expect(dialog.queryByText('読込中')).not.toBeInTheDocument())
  expect(dialog.getAllByText(name)).toHaveLength(1)
  for (const label of ['問題名', '住所', 'アクセス', '利用時間', '紹介', '解説']) {
    expect(dialog.queryByText(label, { exact: true })).not.toBeInTheDocument()
  }
  expect(dialog.getByRole('button', { name: '記録を削除' })).toHaveClass('secondary-button', 'record-delete')
})

it('記録詳細は履歴を1つ積み、戻ると詳細だけ閉じる', async () => {
  vi.stubGlobal('URL', class extends URL { static createObjectURL = () => 'blob:record'; static revokeObjectURL = vi.fn() })
  const push = vi.spyOn(window.history, 'pushState')
  const api = { ...createApiClient(), listDiscoveries: vi.fn().mockResolvedValue({ items: [discovery], nextCursor: null }), getDiscovery: vi.fn().mockResolvedValue(discovery), getDiscoveryPhoto: vi.fn().mockResolvedValue(new Blob(['fixture'])), getQuest: vi.fn().mockResolvedValue({ title: '謎' }) }
  render(<OwnerDiscoveries api={api} onExplore={vi.fn()} />)
  await userEvent.setup().click(await screen.findByRole('button', { name: discovery.placeName }))
  expect(await screen.findByRole('dialog')).toBeVisible()
  expect(push).toHaveBeenCalledTimes(1)
  expect(window.history.state.recordDetail).toBe(discovery.discoveryId)
  window.history.back()
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(screen.getByRole('list', { name: '自分の記録一覧' })).toBeVisible()
})

it.each(['写真', 'カード', 'Enter', 'Space'])('%sから記録詳細を開ける', async (target) => {
  const user = userEvent.setup()
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = () => 'blob:record'
    static revokeObjectURL = vi.fn()
  })
  const api = {
    ...createApiClient(),
    listDiscoveries: vi.fn().mockResolvedValue({ items: [discovery], nextCursor: null }),
    getDiscovery: vi.fn().mockResolvedValue(discovery),
    getDiscoveryPhoto: vi.fn().mockResolvedValue(new Blob(['fixture'])),
    getQuest: vi.fn().mockResolvedValue({ title: 'テスト問題', version: discovery.questVersion }),
  }
  render(<OwnerDiscoveries onExplore={vi.fn()} api={api} />)
  const card = await screen.findByRole('button', { name: discovery.placeName })
  if (target === '写真') await user.click(await within(card).findByAltText(''))
  else if (target === 'カード') await user.click(card)
  else {
    await user.tab()
    expect(card).toHaveFocus()
    await user.keyboard(target === 'Enter' ? '{Enter}' : ' ')
  }
  expect(await screen.findByRole('dialog', { name: '記録詳細' })).toBeVisible()
  expect(api.getDiscovery).toHaveBeenCalledWith(discovery.discoveryId, { signal: expect.any(AbortSignal) })
})

it('空の記録は見出しと主操作だけを表示し、探索へ戻る', async () => {
  const onExplore = vi.fn()
  const api = { ...createApiClient(), listDiscoveries: vi.fn().mockResolvedValue({ items: [], nextCursor: null }) }
  render(<OwnerDiscoveries api={api} onExplore={onExplore} />)
  const heading = await screen.findByRole('heading', { name: '記録はまだない' })
  const empty = heading.parentElement!
  expect(empty.querySelector('.record-empty-icon')).toHaveAttribute('aria-hidden', 'true')
  expect(within(empty).getAllByRole('button')).toHaveLength(1)
  expect(empty.querySelector('p')).toBeNull()
  await userEvent.setup().click(within(empty).getByRole('button', { name: '謎を探す' }))
  expect(onExplore).toHaveBeenCalledOnce()
})
