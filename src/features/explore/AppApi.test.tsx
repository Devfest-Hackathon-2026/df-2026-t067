import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { createApiClient } from '../../shared/api'
import { challenge, discovery, quest } from '../../shared/api/testFixtures'
import type { AuthClient, AuthSnapshot } from '../auth/authTypes'

const apiQuest = { ...quest, title: 'APIで取得した架空の問題' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'X-Quest-Data-Mode': 'demo' },
})
const unavailable = () => json({ error: { code: 'AUTH_UNAVAILABLE', message: 'private-sdk-details', retryable: true } }, 503)

function authFixture(signedIn = false) {
  let snapshot: AuthSnapshot = signedIn ? { status: 'signed-in', user: { uid: 'test-user', displayName: null } } : { status: 'signed-out', user: null }
  const listeners = new Set<() => void>()
  const emit = (next: AuthSnapshot) => { snapshot = next; listeners.forEach((listener) => listener()) }
  const client: AuthClient = {
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
    signInWithGoogle: vi.fn(async () => emit({ status: 'signed-in', user: { uid: 'test-user', displayName: null } })),
    signOut: vi.fn(async () => emit({ status: 'signed-out', user: null })),
    getIdToken: vi.fn(async () => 'current-token'),
  }
  return { client, emit }
}

function mount(fetcher: typeof fetch, signedIn = false) {
  vi.stubEnv('VITE_QUEST_DATA_SOURCE', 'local-api')
  const auth = authFixture(signedIn)
  const api = createApiClient({ fetch: fetcher, getIdToken: auth.client.getIdToken, expectedDataMode: 'demo' })
  const rendered = render(<App authClient={auth.client} apiClient={api} />)
  return { auth, user: userEvent.setup(), unmount: rendered.unmount }
}

async function openQuest(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole('heading', { name: apiQuest.title })
  await user.click(screen.getByRole('button', { name: '問題を見てみる' }))
  return screen.getByRole('region', { name: 'サンプル問題の詳細' })
}

describe('explicit local API integration', () => {
  it('logs in from the quest report form and reuses the same key after a network failure', async () => {
    let sends = 0
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      if (input === '/api/v1/session') return json({ uid: 'test-user' })
      if (input === '/api/v1/reports') {
        if (++sends === 1) throw new TypeError('network')
        return json({ reportId: 'demo-report', source: 'mock' }, 202)
      }
      return json(apiQuest)
    })
    const { auth, user } = mount(fetcher)
    const detail = await openQuest(user)
    await user.click(within(detail).getByRole('button', { name: '問題を報告' }))
    await user.click(within(detail).getByRole('button', { name: 'Googleログインして報告する' }))
    expect(auth.client.signInWithGoogle).toHaveBeenCalledTimes(1)
    await user.type(await screen.findByLabelText('報告内容'), '架空の撮影案内の報告')
    expect(sends).toBe(0)
    await user.selectOptions(screen.getByLabelText('分類'), 'UNSAFE_GUIDANCE')
    await user.click(screen.getByRole('button', { name: 'デモ報告を送信' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('通信状況')
    await user.click(screen.getByRole('button', { name: 'デモ報告を送信' }))
    expect(await screen.findByText('開発用の報告を受け付けました。')).toBeVisible()
    const requests = fetcher.mock.calls.filter(([url]) => url === '/api/v1/reports')
    expect(requests).toHaveLength(2)
    const first = requests[0][1]
    const second = requests[1][1]
    expect(first?.body).toBe(JSON.stringify({ questId: apiQuest.questId, category: 'UNSAFE_GUIDANCE', text: '架空の撮影案内の報告' }))
    expect(new Headers(first?.headers).get('Authorization')).toBe('Bearer current-token')
    expect(new Headers(first?.headers).get('Idempotency-Key')).toBeTruthy()
    expect(new Headers(second?.headers).get('Idempotency-Key')).toBe(new Headers(first?.headers).get('Idempotency-Key'))
  })
  it('cancels a pending quest report when the form closes and ignores its late receipt', async () => {
    let complete!: (response: Response) => void
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      if (input === '/api/v1/session') return json({ uid: 'test-user' })
      if (input === '/api/v1/reports') return new Promise((resolve) => { complete = resolve })
      return json(apiQuest)
    })
    const { user } = mount(fetcher, true)
    const detail = await openQuest(user)
    await user.click(within(detail).getByRole('button', { name: '問題を報告' }))
    await user.type(await screen.findByLabelText('報告内容'), '架空の報告')
    await user.click(screen.getByRole('button', { name: 'デモ報告を送信' }))
    await waitFor(() => expect(complete).toBeTypeOf('function'))
    const signal = fetcher.mock.calls.find(([input]) => input === '/api/v1/reports')?.[1]?.signal
    await user.click(screen.getByRole('button', { name: '報告を閉じる' }))
    expect(signal?.aborted).toBe(true)
    await act(async () => complete(json({ reportId: 'demo-report', source: 'mock' }, 202)))
    expect(screen.queryByText('開発用の報告を受け付けました。')).not.toBeInTheDocument()
  })
  it('opens only the verified owner records and releases the previous account photo', async () => {
    let uid = 'test-user'
    const photoPath = '/api/v1/me/discoveries/' + discovery.discoveryId + '/photo'
    let holdPhoto = false
    let finishPhoto!: (response: Response) => void
    const createObjectURL = vi.fn(() => 'blob:owner-fixture')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', class extends URL { static createObjectURL = createObjectURL; static revokeObjectURL = revokeObjectURL })
    const photoResponse = () => new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), { headers: {
      'Content-Type': 'image/jpeg', 'Content-Length': '4', 'X-Quest-Data-Mode': 'demo', 'X-Quest-Records-Mode': 'memory',
    } })
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const path = String(input)
      if (path === '/api/v1/session') return json({ uid })
      if (path.startsWith('/api/v1/me/discoveries?')) return json({ items: uid === 'test-user' ? [discovery] : [], nextCursor: null })
      if (path === '/api/v1/me/discoveries/' + discovery.discoveryId) return json(discovery)
      if (path === photoPath) return holdPhoto ? new Promise((resolve) => { finishPhoto = resolve }) : photoResponse()
      return json(apiQuest)
    })
    const { auth, user } = mount(fetcher)
    await user.click(within(screen.getByRole('navigation', { name: '主要ナビゲーション' })).getByRole('button', { name: '自分の記録' }))
    expect(fetcher.mock.calls.some(([path]) => String(path).includes('/me/discoveries'))).toBe(false)
    await user.click(screen.getByRole('button', { name: 'Googleログインして記録を見る' }))
    await user.click(await screen.findByRole('button', { name: discovery.placeName }))
    const photo = await screen.findByRole('img', { name: '本人の記録写真' })
    await waitFor(() => expect(photo).toHaveAttribute('src', 'blob:owner-fixture'))
    const photoCall = fetcher.mock.calls.find(([path]) => path === photoPath)
    expect(new Headers(photoCall?.[1]?.headers).get('Authorization')).toBe('Bearer current-token')
    await user.click(screen.getByRole('button', { name: '記録一覧へ戻る' }))
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:owner-fixture')
    holdPhoto = true
    await user.click(await screen.findByRole('button', { name: discovery.placeName }))
    await waitFor(() => expect(finishPhoto).toBeTypeOf('function'))
    const pending = fetcher.mock.calls.findLast(([path]) => path === photoPath)?.[1]?.signal
    uid = 'next-user'
    act(() => auth.emit({ status: 'signed-in', user: { uid, displayName: null } }))
    expect(await screen.findByText('自分の記録はまだありません。')).toBeVisible()
    expect(pending?.aborted).toBe(true)
    await act(async () => finishPhoto(photoResponse()))
    expect(screen.queryByRole('img', { name: '本人の記録写真' })).not.toBeInTheDocument()
    expect(createObjectURL).toHaveBeenCalledTimes(1)
  })
  it('checks the server identity for a B-supplied quest without loading the fixed quest again', async () => {
    const auth = authFixture(true)
    const fetcher = vi.fn<typeof fetch>(async () => json({ uid: 'another-user' }))
    const api = createApiClient({ fetch: fetcher, getIdToken: auth.client.getIdToken, expectedDataMode: 'demo' })
    render(<App authClient={auth.client} apiClient={api} quest={apiQuest} areaLabel="架空の探索地域" apiMode />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: '問題を見てみる' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('ログインを確認できませんでした')
    expect(screen.getByRole('button', { name: 'ログインの確認待ち' })).toBeDisabled()
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.calls[0][0]).toBe('/api/v1/session')
    expect(new Headers(fetcher.mock.calls[0][1]?.headers).get('Authorization')).toBe('Bearer current-token')
  })
  it('loads the API question anonymously and disables selection until it arrives', async () => {
    let resolve!: (response: Response) => void
    const fetcher = vi.fn<typeof fetch>(() => new Promise((done) => { resolve = done }))
    const { auth, user } = mount(fetcher)
    expect(screen.getByRole('status', { name: '問題の読み込み' })).toHaveTextContent('問題を読み込んでいます')
    expect(screen.queryByRole('button', { name: 'デモの謎を地図から見る' })).not.toBeInTheDocument()
    await act(async () => resolve(json(apiQuest)))
    const details = await openQuest(user)
    expect(details).toHaveTextContent(apiQuest.clue)
    expect(fetcher.mock.calls[0][0]).toBe('/api/v1/quests/demo-quest')
    expect(new Headers(fetcher.mock.calls[0][1]?.headers).has('Authorization')).toBe(false)
    expect(auth.client.getIdToken).not.toHaveBeenCalled()
    expect(auth.client.signInWithGoogle).not.toHaveBeenCalled()
  })

  it('keeps failures visible without substituting the preview and supports an explicit retry', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error('private-network-details')).mockResolvedValueOnce(json(apiQuest))
    const { user } = mount(fetcher)
    expect(await screen.findByRole('alert')).toHaveTextContent('問題を読み込めませんでした')
    expect(screen.queryByText('港に時を知らせるもの')).not.toBeInTheDocument()
    expect(document.body).not.toHaveTextContent('private-network-details')
    await user.click(screen.getByRole('button', { name: '問題を再読み込み' }))
    expect(await screen.findByRole('heading', { name: apiQuest.title })).toBeVisible()
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('refuses demo responses without provenance and responses for a different question', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify(apiQuest)))
      .mockResolvedValueOnce(json({ ...apiQuest, questId: 'other-question' }))
    const { user } = mount(fetcher)
    expect(await screen.findByRole('alert')).toHaveTextContent('問題を読み込めませんでした')
    await user.click(screen.getByRole('button', { name: '問題を再読み込み' }))
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
    expect(await screen.findByRole('alert')).toHaveTextContent('問題を読み込めませんでした')
    expect(screen.queryByRole('button', { name: '問題を見てみる' })).not.toBeInTheDocument()
  })

  it('confirms the Firebase identity on the server while retaining the selected question', async () => {
    const fetcher = vi.fn<typeof fetch>(async (url) => json(String(url).endsWith('/session') ? { uid: 'test-user' } : apiQuest))
    const { auth, user } = mount(fetcher)
    const details = await openQuest(user)
    await user.click(within(details).getByRole('button', { name: 'Googleログインして挑戦する' }))
    expect(await screen.findByText('ログインを確認しました。デモの回答受付を試せます。')).toBeVisible()
    expect(details).toHaveTextContent(apiQuest.clue)
    expect(auth.client.getIdToken).toHaveBeenCalledTimes(1)
    expect(new Headers(fetcher.mock.calls[1][1]?.headers).get('Authorization')).toBe('Bearer current-token')
  })

  it('distinguishes server auth failure from sign-in and retries without another Google popup', async () => {
    let count = 0
    const fetcher = vi.fn<typeof fetch>(async (url) => String(url).endsWith('/session') ? (++count === 1 ? unavailable() : json({ uid: 'test-user' })) : json(apiQuest))
    const { auth, user } = mount(fetcher, true)
    await openQuest(user)
    expect(await screen.findByRole('alert')).toHaveTextContent('ログインを確認できませんでした')
    expect(screen.getByRole('button', { name: 'ログインの確認待ち' })).toBeDisabled()
    expect(screen.queryByText('ログインを確認しました。デモの回答受付を試せます。')).not.toBeInTheDocument()
    expect(document.body).not.toHaveTextContent('private-sdk-details')
    await user.click(screen.getByRole('button', { name: 'ログインを確認し直す' }))
    expect(await screen.findByText('ログインを確認しました。デモの回答受付を試せます。')).toBeVisible()
    expect(screen.getByRole('button', { name: '挑戦を始める' })).toBeEnabled()
    expect(auth.client.signInWithGoogle).not.toHaveBeenCalled()
    expect(auth.client.getIdToken).toHaveBeenCalledTimes(2)
  })

  it('rejects a verified identity that differs from the current Firebase user', async () => {
    const fetcher = vi.fn<typeof fetch>(async (url) => json(String(url).endsWith('/session') ? { uid: 'another-user' } : apiQuest))
    const { user } = mount(fetcher, true)
    await openQuest(user)
    expect(await screen.findByRole('alert')).toHaveTextContent('ログインを確認できませんでした')
    expect(document.body).not.toHaveTextContent('another-user')
  })

  it('discards a delayed confirmation when the user signs out', async () => {
    let resolve!: (response: Response) => void
    const fetcher = vi.fn<typeof fetch>(async (url) => String(url).endsWith('/session') ? new Promise((done) => { resolve = done }) : json(apiQuest))
    const { user } = mount(fetcher, true)
    const details = await openQuest(user)
    expect(screen.getByText('ログインを確認しています…')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'ログアウト' }))
    await act(async () => resolve(json({ uid: 'test-user' })))
    expect(within(details).getByRole('button', { name: 'Googleログインして挑戦する' })).toBeEnabled()
    expect(screen.queryByText('ログインを確認しました。デモの回答受付を試せます。')).not.toBeInTheDocument()
    expect(fetcher.mock.calls[1][1]?.signal?.aborted).toBe(true)
  })

  it('does not let a previous user’s delayed failure overwrite the new user’s confirmation', async () => {
    let resolve!: (response: Response) => void
    let count = 0
    const fetcher = vi.fn<typeof fetch>(async (url) => !String(url).endsWith('/session') ? json(apiQuest)
      : ++count === 1 ? new Promise((done) => { resolve = done }) : json({ uid: 'next-user' }))
    const { auth, user } = mount(fetcher, true)
    await openQuest(user)
    act(() => auth.emit({ status: 'signed-in', user: { uid: 'next-user', displayName: null } }))
    expect(await screen.findByText('ログインを確認しました。デモの回答受付を試せます。')).toBeVisible()
    await act(async () => resolve(json({ uid: 'wrong-old-user' })))
    expect(screen.getByText('ログインを確認しました。デモの回答受付を試せます。')).toBeVisible()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('times out a stalled read and offers retry instead of loading forever', async () => {
    vi.useFakeTimers()
    try {
      const fetcher = vi.fn<typeof fetch>(() => new Promise(() => {}))
      const { unmount } = mount(fetcher)
      await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
      expect(screen.getByRole('alert')).toHaveTextContent('問題を読み込めませんでした')
      expect(screen.getByRole('button', { name: '問題を再読み込み' })).toBeEnabled()
      expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true)
      unmount()
    } finally { vi.useRealTimers() }
  })

  it('starts the selected API version with a fresh token and accepts both 201 and reused 200', async () => {
    const stop = vi.fn()
    const getUserMedia = vi.fn(async () => ({ getTracks: () => [{ stop }] }) as unknown as MediaStream)
    vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { mediaDevices: { getUserMedia } }))
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
    let starts = 0
    const fetcher = vi.fn<typeof fetch>(async (url, init) => init?.method === 'POST' ? json(challenge, ++starts === 1 ? 201 : 200)
      : json(String(url).endsWith('/session') ? { uid: 'test-user' } : apiQuest))
    const { auth, user } = mount(fetcher, true)
    await openQuest(user)
    const start = await screen.findByRole('button', { name: '挑戦を始める' })
    expect(starts).toBe(0)
    vi.mocked(auth.client.getIdToken).mockResolvedValueOnce('refreshed-token')
    await user.click(start)
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1))
    const post = fetcher.mock.calls.find(([, init]) => init?.method === 'POST')!
    expect(post[0]).toBe('/api/v1/challenges')
    expect(JSON.parse(post[1]!.body as string)).toEqual({ questId: apiQuest.questId, expectedVersion: apiQuest.version })
    expect(new Headers(post[1]?.headers).get('Authorization')).toBe('Bearer refreshed-token')
    expect(document.body).not.toHaveTextContent('refreshed-token')
    await user.click(screen.getByRole('button', { name: '撮影を終了' }))
    expect(stop).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: '撮影を再開' }))
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2))
    expect(starts).toBe(2)
    expect(auth.client.signInWithGoogle).not.toHaveBeenCalled()
  })

  it('reloads a changed question and requires a new explicit start with the new version', async () => {
    let reads = 0
    let starts = 0
    const fetcher = vi.fn<typeof fetch>(async (url, init) => init?.method === 'POST'
      ? (++starts === 1 ? json({ error: { code: 'QUEST_CHANGED', message: 'private-version-details', retryable: false } }, 409) : json(challenge, 201))
      : json(String(url).endsWith('/session') ? { uid: 'test-user' } : { ...apiQuest, version: ++reads }))
    const { user } = mount(fetcher, true)
    await openQuest(user)
    await user.click(await screen.findByRole('button', { name: '挑戦を始める' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('問題が更新されました')
    await user.click(screen.getByRole('button', { name: '問題を読み直す' }))
    await screen.findByRole('button', { name: '挑戦を始める' })
    expect(reads).toBe(2)
    expect(starts).toBe(1)
    // Deliberately return an old version: the request must use v2 and the
    // response must be rejected before camera permission is requested.
    await user.click(screen.getByRole('button', { name: '挑戦を始める' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('開始を確認できませんでした')
    const posts = fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')
    expect(JSON.parse(posts[1][1]!.body as string)).toEqual({ questId: apiQuest.questId, expectedVersion: 2 })
    expect(document.body).not.toHaveTextContent('private-version-details')
  })

  it.each(['close', 'logout', 'switch-user', 'map'] as const)('discards a pending challenge after %s', async (leave) => {
    let resolve!: (response: Response) => void
    const fetcher = vi.fn<typeof fetch>(async (url, init) => init?.method === 'POST' ? new Promise((done) => { resolve = done })
      : json(String(url).endsWith('/session') ? { uid: 'test-user' } : apiQuest))
    const { auth, user } = mount(fetcher, true)
    await openQuest(user)
    await user.click(await screen.findByRole('button', { name: '挑戦を始める' }))
    const post = fetcher.mock.calls.find(([, init]) => init?.method === 'POST')!
    if (leave === 'close') await user.click(screen.getByRole('button', { name: '問題を閉じる' }))
    else if (leave === 'logout') await user.click(screen.getByRole('button', { name: 'ログアウト' }))
    else if (leave === 'map') await user.click(screen.getAllByRole('link', { name: '謎を探す' })[0])
    else act(() => auth.emit({ status: 'signed-in', user: { uid: 'next-user', displayName: null } }))
    expect(post[1]?.signal?.aborted).toBe(true)
    await act(async () => resolve(json(challenge, 201)))
    expect(screen.queryByRole('region', { name: '写真撮影と確認' })).not.toBeInTheDocument()
    expect(screen.queryByText('挑戦を開始しました。写真と位置を確認してからデモ送信できます。')).not.toBeInTheDocument()
  })

  it.each(['invalid', 'local-api'])('fails closed for invalid source or a production API demo: %s', async (source) => {
    vi.stubEnv('VITE_QUEST_DATA_SOURCE', source)
    if (source === 'local-api') vi.stubEnv('DEV', false)
    const fetcher = vi.fn<typeof fetch>()
    render(<App apiClient={createApiClient({ fetch: fetcher })} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('表示設定を確認してください')
    expect(fetcher).not.toHaveBeenCalled()
    expect(screen.queryByText('港に時を知らせるもの')).not.toBeInTheDocument()
  })
})
