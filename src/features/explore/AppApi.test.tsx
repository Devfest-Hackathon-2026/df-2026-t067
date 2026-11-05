import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { createApiClient } from '../../shared/api'
import { quest } from '../../shared/api/testFixtures'
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
  it('loads the API question anonymously and disables selection until it arrives', async () => {
    let resolve!: (response: Response) => void
    const fetcher = vi.fn<typeof fetch>(() => new Promise((done) => { resolve = done }))
    const { auth, user } = mount(fetcher)
    expect(screen.getByRole('status', { name: '問題の読み込み' })).toHaveTextContent('問題を読み込んでいます')
    expect(screen.getByRole('button', { name: 'デモの謎を地図から見る' })).toBeDisabled()
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
    expect(await screen.findByText('ログインを確認しました。撮影機能は準備中です。')).toBeVisible()
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
    expect(screen.queryByText('ログインを確認しました。撮影機能は準備中です。')).not.toBeInTheDocument()
    expect(document.body).not.toHaveTextContent('private-sdk-details')
    await user.click(screen.getByRole('button', { name: 'ログインを確認し直す' }))
    expect(await screen.findByText('ログインを確認しました。撮影機能は準備中です。')).toBeVisible()
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
    expect(screen.queryByText('ログインを確認しました。撮影機能は準備中です。')).not.toBeInTheDocument()
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
    expect(await screen.findByText('ログインを確認しました。撮影機能は準備中です。')).toBeVisible()
    await act(async () => resolve(json({ uid: 'wrong-old-user' })))
    expect(screen.getByText('ログインを確認しました。撮影機能は準備中です。')).toBeVisible()
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
