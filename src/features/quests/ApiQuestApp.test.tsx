import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { StrictMode } from 'react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PublicArea, PublicQuest } from '../../shared/api/types'
import type { AuthClient } from '../auth/authTypes'
import { ApiQuestApp } from './ApiQuestApp'
import { ApiError } from '../../shared/api/client'

vi.mock('../explore/MapPreview', () => ({ MapPreview: (props: { areas?: PublicArea[]; selectedAreaId?: string; onSelectArea?: (id: string) => void }) =>
  <button type="button" aria-label="地図の公開地域を選択" onClick={() => props.onSelectArea?.('area-b')}>地図 {props.areas?.length ?? 0} {props.selectedAreaId}</button> }))

const first: PublicQuest = { questId: 'quest-a', version: 2, title: '川辺の謎', clue: '詳細版の手がかり', areaId: 'area-a', visitConditions: '訪問条件', hintCount: 0 }
const second: PublicQuest = { questId: 'quest-b', version: 1, title: '森の謎', clue: '森の手がかり', areaId: 'area-b', visitConditions: '訪問条件', hintCount: 0 }
const areas: PublicArea[] = [
  { areaId: 'area-a', label: '川辺エリア', publicGeometry: { type: 'Polygon', coordinates: [] }, marker: { latitude: 35, longitude: 139 }, publishedCount: 1 },
  { areaId: 'area-b', label: '森エリア', publicGeometry: { type: 'Polygon', coordinates: [] }, marker: { latitude: 36, longitude: 140 }, publishedCount: 1 },
]
const page = <T,>(items: T[]) => ({ items, nextCursor: null })

beforeEach(() => {
  window.history.replaceState(null, '', '/')
})

afterEach(() => {
  window.history.replaceState(null, '', '/')
})

function apiFixture() {
  return {
    listQuests: vi.fn().mockResolvedValue(page([{ ...first, title: '一覧表示用タイトル' }, second])),
    getQuest: vi.fn(async (id: string, _options?: { signal?: AbortSignal }) => id === first.questId ? first : second),
    listAreas: vi.fn().mockResolvedValue(page(areas)),
    getHint: vi.fn().mockResolvedValue({ questId: first.questId, version: first.version, index: 1, text: 'テストヒント' }),
  }
}

function signedOutAuth(): AuthClient {
  const snapshot = { status: 'signed-out' as const, user: null }
  return {
    getSnapshot: () => snapshot,
    subscribe: () => () => {}, signInWithGoogle: vi.fn(async () => {}),
    signOut: vi.fn(async () => {}), getIdToken: vi.fn(async () => null),
  }
}

describe('APIから問題を表示', () => {
  it('404ヒントから手動更新し、完了後に公開情報更新へフォーカスを戻す', async () => {
    const user = userEvent.setup()
    const quest = { ...first, hintCount: 1 }
    const api = apiFixture()
    api.getQuest.mockResolvedValue(quest)
    api.getHint.mockRejectedValueOnce(new ApiError('NOT_FOUND', { status: 404 }))
    render(<ApiQuestApp api={api} authClient={signedOutAuth()} dataMode="durable-local" />)
    expect(await screen.findByRole('heading', { name: quest.title })).toBeVisible()
    await user.click(screen.getByRole('button', { name: '問題を見てみる' }))
    await user.click(screen.getByRole('button', { name: 'ヒント1を見る' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('見つかりません（404）')
    const reloadHintButton = screen.getByRole('button', { name: '問題を読みなおす' })
    reloadHintButton.focus()
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('button', { name: '公開情報を更新' })).toBeEnabled()
    await waitFor(() => expect(screen.getByRole('button', { name: '公開情報を更新' })).toHaveFocus())
    expect(api.listQuests).toHaveBeenCalledTimes(2)
  })

  it('地図の地域クリックで地域・問題・URL選択を同期する', async () => {
    const api = apiFixture()
    render(<ApiQuestApp api={api} authClient={signedOutAuth()} dataMode="durable-local" />)
    expect(await screen.findByRole('heading', { name: first.title })).toBeVisible()
    expect(screen.getByText('問題はログインなしで閲覧できます。', { exact: true })).toBeVisible()
    api.listQuests.mockResolvedValueOnce(page([second]))
    await userEvent.setup().click(screen.getByRole('button', { name: '地図の公開地域を選択' }))
    expect(await screen.findByRole('heading', { name: second.title })).toBeVisible()
    expect(screen.getByRole('combobox', { name: '地域を選択' })).toHaveValue('area-b')
    expect(screen.getByRole('combobox', { name: '公開APIの問題を選択' })).toHaveValue('quest-b')
    expect(new URL(window.location.href).searchParams.get('area')).toBe('area-b')
    expect(new URL(window.location.href).searchParams.get('quest')).toBe('quest-b')
  })

  it('地図から地域を選ぶと更新通知を消す', async () => {
    const user = userEvent.setup()
    const api = apiFixture()
    const newer = { ...first, version: first.version + 1 }
    api.listQuests.mockResolvedValueOnce(page([first, second])).mockResolvedValueOnce(page([newer, second]))
    api.getQuest.mockResolvedValueOnce(first).mockResolvedValueOnce(newer).mockResolvedValueOnce(second)
    render(<ApiQuestApp api={api} authClient={signedOutAuth()} dataMode="durable-local" />)
    expect(await screen.findByRole('heading', { name: first.title })).toBeVisible()
    await user.click(screen.getByRole('button', { name: '公開情報を更新' }))
    expect(await screen.findByText('問題が更新されました。詳細を開いて内容をご確認ください。')).toBeVisible()
    await user.click(screen.getByRole('button', { name: '地図の公開地域を選択' }))
    expect(screen.queryByText(/問題が更新されました/)).not.toBeInTheDocument()
  })

  it('uses the durable catalog anonymously and the same data mode for authenticated reports, challenge and records', async () => {
    const user = userEvent.setup()
    const getUserMedia = vi.fn(async () => ({ getTracks: () => [] }))
    vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { mediaDevices: { getUserMedia } }))
    const snapshot = { status: 'signed-in' as const, user: { uid: 'test-owner', displayName: null } }
    const authClient = { ...signedOutAuth(), getSnapshot: () => snapshot, getIdToken: async () => 'test-token' }
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const path = String(input)
      const data = path.startsWith('/api/v1/areas?') || path.startsWith('/api/v1/me/discoveries?') ? page([])
        : path.startsWith('/api/v1/quests?') ? page([first])
          : path === '/api/v1/session' ? { uid: snapshot.user.uid }
            : path === '/api/v1/reports' ? { reportId: 'durable-report', source: 'real' }
              : path === '/api/v1/challenges' ? { challengeId: 'durable-challenge', questId: first.questId,
              version: first.version, createdAt: '2026-11-06T00:00:00.000Z' }
              : first
      return new Response(JSON.stringify(data), { status: path === '/api/v1/reports' ? 202 : path === '/api/v1/challenges' ? 201 : 200,
        headers: { 'Content-Type': 'application/json', 'X-Quest-Data-Mode': 'durable-local' } })
    })
    vi.stubGlobal('fetch', fetcher)
    render(<ApiQuestApp dataMode="durable-local" authClient={authClient} />)
    expect(await screen.findByRole('heading', { name: first.title })).toBeVisible()
    expect(screen.getByText('永続API・ローカル')).toBeVisible()
    expect(screen.getByText('Googleアカウントでログインしています。', { exact: true })).toBeVisible()
    const catalogCalls = fetcher.mock.calls.filter(([path]) => String(path).includes('/api/v1/quests'))
    expect(catalogCalls).toHaveLength(2)
    expect(catalogCalls.every(([, init]) => !new Headers(init?.headers).has('Authorization'))).toBe(true)
    expect(getUserMedia).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: '問題を見てみる' }))
    await user.click(screen.getByRole('button', { name: '問題を報告' }))
    await user.type(await screen.findByRole('textbox', { name: '報告内容' }), '架空の報告')
    await user.click(screen.getByRole('button', { name: '報告を送信' }))
    expect(await screen.findByText('開発用の報告を受け付けました。')).toBeVisible()
    const report = fetcher.mock.calls.find(([path]) => path === '/api/v1/reports')?.[1]
    expect(new Headers(report?.headers).get('Authorization')).toBe('Bearer test-token')
    expect(JSON.parse(String(report?.body))).toEqual({ questId: first.questId, category: 'PHOTO_UNAVAILABLE', text: '架空の報告' })
    await user.click(screen.getByRole('button', { name: '報告を閉じる' }))
    await user.click(await screen.findByRole('button', { name: '挑戦を始める' }))
    const start = fetcher.mock.calls.find(([path]) => path === '/api/v1/challenges')?.[1]
    expect(new Headers(start?.headers).get('Authorization')).toBe('Bearer test-token')
    expect(JSON.parse(String(start?.body))).toEqual({ questId: first.questId, expectedVersion: first.version })
    expect(getUserMedia).toHaveBeenCalledTimes(1)
    await user.click(within(screen.getByRole('navigation', { name: '主要ナビゲーション' })).getByRole('button', { name: '自分の記録' }))
    expect(await screen.findByText('自分の記録はまだありません。')).toBeVisible()
    const read = fetcher.mock.calls.find(([path]) => String(path).startsWith('/api/v1/me/discoveries?'))
    expect(new Headers(read?.[1]?.headers).get('Authorization')).toBe('Bearer test-token')
  })

  it('rejects a demo server when the Web app selected the durable catalog', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(page([])), {
      headers: { 'Content-Type': 'application/json', 'X-Quest-Data-Mode': 'demo' },
    })))
    render(<ApiQuestApp dataMode="durable-local" authClient={signedOutAuth()} />)
    expect(await screen.findByRole('heading', { name: '公開問題を取得できませんでした' })).toBeVisible()
    expect(screen.queryByRole('heading', { name: '公開問題はありません' })).not.toBeInTheDocument()
  })

  it.each(['empty', 'error'] as const)('keeps owner records available when the public catalog is %s', async (state) => {
    const user = userEvent.setup()
    const api = apiFixture()
    if (state === 'empty') api.listQuests.mockResolvedValue(page([]))
    else api.listQuests.mockRejectedValue(new ApiError('NETWORK_ERROR'))
    const snapshot = { status: 'signed-in' as const, user: { uid: 'demo-owner', displayName: null } }
    const authClient = { ...signedOutAuth(), getSnapshot: () => snapshot, getIdToken: async () => 'demo-token' }
    const fetcher = vi.fn<typeof fetch>(async (path) => {
      const data = path === '/api/v1/session' ? { uid: snapshot.user.uid } : page([])
      return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json', 'X-Quest-Data-Mode': 'demo' } })
    })
    vi.stubGlobal('fetch', fetcher)
    render(<ApiQuestApp api={api} authClient={authClient} />)
    await screen.findByRole('heading', { name: state === 'empty' ? '公開問題はありません' : '公開問題を取得できませんでした' })
    await user.click(within(screen.getByRole('navigation', { name: '主要ナビゲーション' })).getByRole('button', { name: '自分の記録' }))
    expect(await screen.findByText('自分の記録はまだありません。')).toBeVisible()
    const read = fetcher.mock.calls.find(([path]) => String(path).startsWith('/api/v1/me/discoveries?'))
    expect(new Headers(read?.[1]?.headers).get('Authorization')).toBe('Bearer demo-token')
    expect(api.getQuest).not.toHaveBeenCalled()
  })
  it('stays on owner records while the public catalog finishes loading', async () => {
    const user = userEvent.setup()
    const api = apiFixture()
    let finishCatalog!: (value: ReturnType<typeof page<PublicQuest>>) => void
    api.listQuests.mockImplementationOnce(() => new Promise((resolve) => { finishCatalog = resolve }))
    const snapshot = { status: 'signed-in' as const, user: { uid: 'demo-owner', displayName: null } }
    const authClient = { ...signedOutAuth(), getSnapshot: () => snapshot, getIdToken: async () => 'demo-token' }
    const fetcher = vi.fn<typeof fetch>(async (path) => new Response(JSON.stringify(
      path === '/api/v1/session' ? { uid: snapshot.user.uid } : page([]),
    ), { headers: { 'Content-Type': 'application/json', 'X-Quest-Data-Mode': 'demo' } }))
    vi.stubGlobal('fetch', fetcher)
    render(<ApiQuestApp api={api} authClient={authClient} />)
    await waitFor(() => expect(finishCatalog).toBeTypeOf('function'))
    await user.click(within(screen.getByRole('navigation', { name: '主要ナビゲーション' })).getByRole('button', { name: '自分の記録' }))
    expect(await screen.findByText('自分の記録はまだありません。')).toBeVisible()
    await act(async () => finishCatalog(page([first])))
    await waitFor(() => expect(api.getQuest).toHaveBeenCalled())
    expect(screen.getByRole('heading', { name: '自分の記録' })).toBeVisible()
    expect(fetcher.mock.calls.filter(([path]) => String(path).startsWith('/api/v1/me/discoveries?'))).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: '地図へ戻る' }))
    expect(await screen.findByRole('heading', { name: first.title })).toBeVisible()
  })
  it('URLの地域・問題を復元し、初期読み込みでは履歴を追加しない', async () => {
    window.history.replaceState(null, '', '/?campaign=spring&area=area-b&quest=quest-b#map')
    const api = apiFixture()
    api.listQuests.mockImplementation(async (query?: { areaId?: string }) => query?.areaId === 'area-b' ? page([second]) : page([first, second]))
    const before = window.history.length
    render(<ApiQuestApp api={api} syncUrl />)
    expect(await screen.findByRole('heading', { name: second.title })).toBeVisible()
    expect(api.listQuests).toHaveBeenCalledWith({ areaId: 'area-b', limit: 100, cursor: undefined }, expect.anything())
    expect(window.location.search).toBe('?campaign=spring&area=area-b&quest=quest-b')
    expect(window.location.hash).toBe('#map')
    expect(window.history.length).toBe(before)
  })

  it('409で古いヒントと挑戦を止め、既存再読込を案内する', async () => {
    const user = userEvent.setup()
    const quest = { ...first, hintCount: 2, optionalHintImage: 'https://example.test/public-hint.jpg' }
    const api = apiFixture()
    const latest = { ...quest, version: quest.version + 1 }
    api.getQuest.mockResolvedValueOnce(quest).mockResolvedValue(latest)
    api.getHint.mockRejectedValueOnce(new ApiError('QUEST_CHANGED', { status: 409 }))
      .mockResolvedValue({ questId: latest.questId, version: latest.version, index: 1, text: '最新版ヒント' })
    render(<ApiQuestApp api={api} syncUrl={false} authClient={signedOutAuth()} />)
    await user.click(await screen.findByRole('button', { name: '問題を見てみる' }))
    expect(screen.getByRole('button', { name: 'Googleログインして挑戦する' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'ヒント1を見る' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('すべてのヒントと挑戦を無効にしました')
    expect(screen.queryByRole('button', { name: 'ヒント2を見る' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Googleログインして挑戦する' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: '問題を閉じる' }))
    await user.click(screen.getByRole('button', { name: '問題を見てみる' }))
    expect(screen.queryByRole('button', { name: 'ヒント1を見る' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'ヒント画像を見る' })).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('すべてのヒントと挑戦を無効にしました')
    await user.click(screen.getByRole('button', { name: '問題を読みなおす' }))
    await waitFor(() => expect(api.getQuest).toHaveBeenCalledTimes(2))
    await user.click(screen.getByRole('button', { name: '問題を見てみる' }))
    expect(screen.getByRole('button', { name: 'Googleログインして挑戦する' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'ヒント1を見る' }))
    expect(await screen.findByText('最新版ヒント')).toBeVisible()
  })

  it('地域・問題操作を履歴に積み、戻る・進むを選択へ反映する', async () => {
    window.history.replaceState(null, '', '/?keep=yes&view=list#top')
    const user = userEvent.setup()
    const api = apiFixture()
    api.listQuests.mockImplementation(async (query?: { areaId?: string }) => query?.areaId === 'area-a' ? page([first])
      : query?.areaId === 'area-b' ? page([second]) : page([first, second]))
    render(<ApiQuestApp api={api} syncUrl />)
    await screen.findByRole('heading', { name: first.title })
    await user.selectOptions(screen.getByRole('combobox', { name: '地域を選択' }), 'area-b')
    await screen.findByRole('heading', { name: second.title })
    expect(window.location.search).toBe('?keep=yes&view=list&area=area-b&quest=quest-b')
    await user.selectOptions(screen.getByRole('combobox', { name: '地域を選択' }), '')
    await screen.findByRole('heading', { name: first.title })
    expect(window.location.search).toBe('?keep=yes&view=list&quest=quest-a')

    await act(async () => {
      await new Promise<void>((resolve) => {
        window.addEventListener('popstate', () => resolve(), { once: true })
        window.history.back()
      })
    })
    expect(await screen.findByRole('heading', { name: second.title })).toBeVisible()
    expect(screen.getByRole('combobox', { name: '地域を選択' })).toHaveValue('area-b')
    await act(async () => {
      await new Promise<void>((resolve) => {
        window.addEventListener('popstate', () => resolve(), { once: true })
        window.history.forward()
      })
    })
    expect(await screen.findByRole('heading', { name: first.title })).toBeVisible()
    expect(screen.getByRole('combobox', { name: '地域を選択' })).toHaveValue('')
    expect(window.location.hash).toBe('#top')
  })

  it('0件の地域ではURLから問題IDを除く', async () => {
    window.history.replaceState(null, '', '/?source=link&area=area-b&quest=gone#map')
    const api = apiFixture()
    api.listQuests.mockImplementation(async (query?: { areaId?: string }) => query?.areaId === 'area-b' ? page([]) : page([first]))
    const before = window.history.length
    render(<ApiQuestApp api={api} syncUrl />)
    expect(await screen.findByRole('heading', { name: '公開問題はありません' })).toBeVisible()
    expect(window.location.search).toBe('?source=link&area=area-b')
    expect(window.history.length).toBe(before)
    await userEvent.setup().selectOptions(screen.getByRole('combobox', { name: '地域を選択' }), '')
    expect(await screen.findByRole('heading', { name: first.title })).toBeVisible()
    expect(window.location.search).toBe('?source=link&quest=quest-a')
  })

  it('一覧に存在しないURL問題を実在する先頭問題へ置換する', async () => {
    window.history.replaceState(null, '', '/?campaign=spring&area=area-b&quest=gone#map')
    const api = apiFixture()
    api.listQuests.mockImplementation(async (query?: { areaId?: string }) => query?.areaId === 'area-b' ? page([second]) : page([first, second]))
    const before = window.history.length
    render(<ApiQuestApp api={api} syncUrl />)
    expect(await screen.findByRole('heading', { name: second.title })).toBeVisible()
    await waitFor(() => expect(window.location.search).toBe('?campaign=spring&area=area-b&quest=quest-b'))
    expect(screen.getByRole('combobox', { name: '公開APIの問題を選択' })).toHaveValue(second.questId)
    expect(api.getQuest).toHaveBeenCalledWith(second.questId, expect.anything())
    expect(window.location.hash).toBe('#map')
    expect(window.history.length).toBe(before)
  })

  it.each(['areas', 'quests', 'detail'] as const)('%s取得が止まったら10秒で再試行へ戻り、遅い応答を捨てる', async (stage) => {
    vi.useFakeTimers()
    let unmount: (() => void) | undefined
    try {
      const api = apiFixture()
      let oldSignal: AbortSignal | undefined
      let resolveOld!: () => void
      if (stage === 'areas') {
        api.listAreas.mockImplementationOnce((_query, options) => new Promise(resolve => {
          oldSignal = options.signal
          resolveOld = () => resolve(page(areas))
        }))
      } else if (stage === 'quests') {
        api.listQuests.mockImplementationOnce((_query, options) => new Promise(resolve => {
          oldSignal = options.signal
          resolveOld = () => resolve(page([first, second]))
        }))
      } else {
        api.getQuest.mockImplementationOnce((_id, options) => new Promise<PublicQuest>(resolve => {
          oldSignal = options?.signal
          resolveOld = () => resolve({ ...first, title: '古い詳細' })
        }))
      }
      unmount = render(<ApiQuestApp api={api} />).unmount
      await act(async () => {})
      expect(oldSignal?.aborted).toBe(false)
      await act(async () => vi.advanceTimersByTimeAsync(10_000))
      expect(screen.getByRole('alert')).toHaveTextContent('サーバーとの通信を確認')
      expect(oldSignal?.aborted).toBe(true)
      expect(screen.queryByText('港に時を知らせるもの')).not.toBeInTheDocument()
      api.getQuest.mockResolvedValue({ ...first, title: '再試行後の問題' })
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: '再試行' })) })
      expect(screen.getByRole('heading', { name: '再試行後の問題' })).toBeVisible()
      await act(async () => resolveOld())
      expect(screen.getByRole('heading', { name: '再試行後の問題' })).toBeVisible()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(screen.queryByText('古い詳細')).not.toBeInTheDocument()
    } finally {
      unmount?.()
      vi.useRealTimers()
    }
  })

  it('取得成功後は待ち切りタイマーで表示をエラーに変えない', async () => {
    vi.useFakeTimers()
    let unmount: (() => void) | undefined
    try {
      unmount = render(<ApiQuestApp api={apiFixture()} />).unmount
      await act(async () => {})
      expect(screen.getByRole('heading', { name: first.title })).toBeVisible()
      await act(async () => vi.advanceTimersByTimeAsync(10_000))
      expect(screen.getByRole('heading', { name: first.title })).toBeVisible()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    } finally {
      unmount?.()
      vi.useRealTimers()
    }
  })

  it('匿名で一覧・詳細・地域名を取得し、選択変更で詳細を切り替える', async () => {
    const user = userEvent.setup()
    const api = apiFixture()
    render(<ApiQuestApp api={api} />)

    expect(await screen.findByRole('heading', { name: '川辺の謎' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: '問題を見てみる' }))
    expect(screen.getByText('詳細版の手がかり')).toBeVisible()
    expect(screen.getByText('川辺エリア')).toBeVisible()
    expect(api.listQuests).toHaveBeenCalledWith({ limit: 100, cursor: undefined }, expect.objectContaining({ signal: expect.any(AbortSignal) }))
    expect(api.getQuest).toHaveBeenCalledWith('quest-a', expect.objectContaining({ signal: expect.any(AbortSignal) }))
    expect(api.listAreas).toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'デモの謎を地図から見る' })).not.toBeInTheDocument()

    await user.selectOptions(screen.getByRole('combobox', { name: '公開APIの問題を選択' }), 'quest-b')
    expect(await screen.findByRole('heading', { name: '森の謎' })).toBeVisible()
    expect(screen.getByText('森エリア')).toBeVisible()
  })

  it('地域選択をサーバーへ渡し、地域変更で問題を選び直す', async () => {
    const user = userEvent.setup()
    const api = apiFixture()
    api.listQuests.mockImplementation(async (query?: { areaId?: string }) => query?.areaId === 'area-a'
      ? page([first]) : query?.areaId === 'area-b' ? page([second]) : page([first, second]))
    render(<ApiQuestApp api={api} />)
    expect(await screen.findByRole('heading', { name: first.title })).toBeVisible()
    const region = screen.getByRole('combobox', { name: '地域を選択' })
    await user.selectOptions(region, 'area-b')
    expect(await screen.findByRole('heading', { name: second.title })).toBeVisible()
    expect(api.listQuests).toHaveBeenCalledWith({ areaId: 'area-b', limit: 100, cursor: undefined }, expect.anything())
    await user.selectOptions(screen.getByRole('combobox', { name: '地域を選択' }), 'area-a')
    expect(await screen.findByRole('heading', { name: first.title })).toBeVisible()
  })

  it('地域0件でも全国へ戻れる', async () => {
    const user = userEvent.setup()
    const api = apiFixture()
    api.listQuests.mockImplementation(async (query?: { areaId?: string }) => query?.areaId ? page([]) : page([first, second]))
    render(<ApiQuestApp api={api} />)
    await screen.findByRole('heading', { name: first.title })
    await user.selectOptions(screen.getByRole('combobox', { name: '地域を選択' }), 'area-b')
    expect(await screen.findByRole('heading', { name: '公開問題はありません' })).toBeVisible()
    expect(screen.getByRole('combobox', { name: '公開APIの問題を選択' })).toBeDisabled()
    await user.selectOptions(screen.getByRole('combobox', { name: '地域を選択' }), '')
    expect(await screen.findByRole('heading', { name: first.title })).toBeVisible()
  })

  it('明示更新で地域・一覧・同じIDの新版詳細を取り直し、選択を保つ', async () => {
    const user = userEvent.setup()
    const api = apiFixture()
    const newer = { ...first, version: 9, title: '更新後の川辺の謎', clue: '新しい詳細本文' }
    api.listAreas.mockResolvedValueOnce(page(areas)).mockResolvedValueOnce(page([{ ...areas[0], label: '新しい川辺エリア' }]))
    api.listQuests.mockResolvedValueOnce(page([first, second])).mockResolvedValueOnce(page([newer, second]))
    api.getQuest.mockResolvedValueOnce(first).mockResolvedValueOnce(newer)
    window.history.replaceState(null, '', '/?area=area-a&quest=quest-a&other=keep#map')
    render(<ApiQuestApp api={api} />)
    expect(await screen.findByRole('heading', { name: first.title })).toBeVisible()
    await user.click(screen.getByRole('button', { name: '問題を見てみる' }))
    expect(screen.getByText('詳細版の手がかり')).toBeVisible()
    const refreshButton = screen.getByRole('button', { name: '公開情報を更新' })
    refreshButton.focus()
    await user.click(refreshButton)
    expect(await screen.findByRole('heading', { name: newer.title })).toBeVisible()
    expect(screen.getByRole('button', { name: '公開情報を更新' })).toHaveFocus()
    expect(screen.queryByText('詳細版の手がかり')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '問題を見てみる' }))
    expect(screen.getByText('新しい詳細本文')).toBeVisible()
    expect(screen.getByText('新しい川辺エリア')).toBeVisible()
    expect(screen.getByRole('combobox', { name: '地域を選択' })).toHaveValue('area-a')
    expect(screen.getByRole('combobox', { name: '公開APIの問題を選択' })).toHaveValue('quest-a')
    expect(window.location.search).toContain('other=keep')
    expect(window.location.hash).toBe('#map')
    expect(api.listAreas).toHaveBeenCalledTimes(2)
    expect(api.listQuests).toHaveBeenCalledTimes(2)
    expect(api.getQuest).toHaveBeenCalledTimes(2)
  })

  it('公開・休止・再公開後の更新で一覧件数と新しい公開版・ヒントへ追随する', async () => {
    const user = userEvent.setup()
    const api = apiFixture()
    const initial = { ...first, version: 1, hintCount: 1, clue: '公開版1の詳細' }
    const republished = { ...first, version: 2, hintCount: 1, title: '再公開された川辺の謎', clue: '公開版2の詳細' }
    const areaWithOne = { ...areas[0], publishedCount: 1 }
    const areaPaused = { ...areas[0], publishedCount: 0 }
    api.listAreas.mockResolvedValueOnce(page([areaWithOne]))
      .mockResolvedValueOnce(page([areaPaused]))
      .mockResolvedValueOnce(page([areaWithOne]))
    api.listQuests.mockResolvedValueOnce(page([initial])).mockResolvedValueOnce(page([])).mockResolvedValueOnce(page([republished]))
    api.getQuest.mockResolvedValueOnce(initial).mockResolvedValueOnce(republished)
    api.getHint.mockResolvedValueOnce({ questId: first.questId, version: 1, index: 1, text: '公開版1のヒント' })
      .mockResolvedValueOnce({ questId: first.questId, version: 2, index: 1, text: '公開版2のヒント' })
    window.history.replaceState(null, '', '/?area=area-a&quest=quest-a')
    render(<ApiQuestApp api={api} authClient={signedOutAuth()} dataMode="durable-local" />)
    expect(await screen.findByRole('heading', { name: initial.title })).toBeVisible()
    await user.click(screen.getByRole('button', { name: '問題を見てみる' }))
    expect(screen.getByText(initial.clue)).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'ヒント1を見る' }))
    expect(await screen.findByText('公開版1のヒント')).toBeVisible()

    await user.click(screen.getByRole('button', { name: '公開情報を更新' }))
    expect(await screen.findByRole('heading', { name: '公開問題はありません' })).toBeVisible()
    expect(screen.getByRole('option', { name: '川辺エリア（0問）' })).toBeInTheDocument()
    expect(screen.queryByText(initial.clue)).not.toBeInTheDocument()
    expect(screen.queryByText('公開版1のヒント')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '公開情報を更新' }))
    expect(await screen.findByRole('heading', { name: republished.title })).toBeVisible()
    expect(screen.getByRole('option', { name: '川辺エリア（1問）' })).toBeInTheDocument()
    expect(screen.queryByText('公開版1のヒント')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '問題を見てみる' }))
    expect(screen.getByText(republished.clue)).toBeVisible()
    expect(screen.queryByText(initial.clue)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'ヒント1を見る' }))
    expect(await screen.findByText('公開版2のヒント')).toBeVisible()
    expect(screen.queryByText('公開版1のヒント')).not.toBeInTheDocument()
    expect(api.getHint).toHaveBeenLastCalledWith({ questId: first.questId, expectedVersion: 2, index: 1 }, expect.anything())
    expect(window.location.search).toContain('area=area-a')
    expect(window.location.search).toContain('quest=quest-a')
  })

  it('手動更新中の連打を止め、更新後に消えた問題を0件として扱う', async () => {
    const user = userEvent.setup()
    const api = apiFixture()
    let resolveRefresh!: (value: ReturnType<typeof page<PublicQuest>>) => void
    api.listQuests.mockResolvedValueOnce(page([first])).mockImplementationOnce(() => new Promise((resolve) => { resolveRefresh = resolve }))
    render(<ApiQuestApp api={api} />)
    await screen.findByRole('heading', { name: first.title })
    await user.click(screen.getByRole('button', { name: '公開情報を更新' }))
    await waitFor(() => expect(resolveRefresh).toBeDefined())
    const refreshing = screen.getByRole('button', { name: '公開情報を更新中…' })
    expect(refreshing).toBeDisabled()
    fireEvent.click(refreshing)
    expect(api.listQuests).toHaveBeenCalledTimes(2)
    await act(async () => resolveRefresh(page([])))
    expect(await screen.findByRole('heading', { name: '公開問題はありません' })).toBeVisible()
    expect(api.listQuests).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('combobox', { name: '公開APIの問題を選択' })).toBeDisabled()
  })

  it('更新で選択中の問題が消えたら、代替詳細の取得完了後に通知する', async () => {
    const user = userEvent.setup()
    const api = apiFixture()
    let resolveFallback!: (value: PublicQuest) => void
    api.listQuests.mockResolvedValueOnce(page([first, second])).mockResolvedValueOnce(page([second]))
    api.getQuest.mockResolvedValueOnce(first).mockImplementationOnce(() => new Promise((resolve) => { resolveFallback = resolve }))
    render(<ApiQuestApp api={api} />)
    expect(await screen.findByRole('heading', { name: first.title })).toBeVisible()
    await user.click(screen.getByRole('button', { name: '公開情報を更新' }))
    await waitFor(() => expect(resolveFallback).toBeDefined())
    expect(screen.getByRole('button', { name: '公開情報を更新中…' })).toBeDisabled()
    expect(screen.getByText('地域・問題一覧・選択中の詳細を取り直しています。')).toBeVisible()
    expect(screen.queryByText(/公開一覧からなくなった/)).not.toBeInTheDocument()
    await act(async () => resolveFallback(second))
    expect(await screen.findByText(/公開一覧からなくなったため、別の問題を表示しています/)).toBeVisible()
    expect(screen.getByRole('heading', { name: second.title })).toBeVisible()
  })

  it('初回自動選択では更新通知を出さない', async () => {
    const api = apiFixture()
    render(<ApiQuestApp api={api} />)
    expect(await screen.findByRole('heading', { name: first.title })).toBeVisible()
    expect(screen.queryByText(/問題が更新されました|公開一覧からなくなった/)).not.toBeInTheDocument()
  })

  it('再試行を始めると前回の更新通知を消し、失敗時にも成功通知を残さない', async () => {
    const user = userEvent.setup()
    const api = apiFixture()
    const newer = { ...first, version: first.version + 1 }
    api.listQuests.mockResolvedValueOnce(page([first])).mockResolvedValueOnce(page([newer])).mockRejectedValueOnce(new Error('offline'))
    api.getQuest.mockResolvedValueOnce(first).mockResolvedValueOnce(newer)
    render(<ApiQuestApp api={api} />)
    expect(await screen.findByRole('heading', { name: first.title })).toBeVisible()
    await user.click(screen.getByRole('button', { name: '公開情報を更新' }))
    expect(await screen.findByText('問題が更新されました。詳細を開いて内容をご確認ください。')).toBeVisible()
    await user.click(screen.getByRole('button', { name: '公開情報を更新' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('サーバーとの通信を確認')
    expect(screen.queryByText(/問題が更新されました/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '再試行' }))
    expect(await screen.findByRole('heading', { name: newer.title })).toBeVisible()
    expect(screen.queryByText(/問題が更新されました/)).not.toBeInTheDocument()
  })

  it('手動で問題を選ぶと更新通知を消す', async () => {
    const user = userEvent.setup()
    const api = apiFixture()
    const newer = { ...first, version: first.version + 1 }
    api.listQuests.mockResolvedValueOnce(page([first, second])).mockResolvedValueOnce(page([newer, second]))
    api.getQuest.mockResolvedValueOnce(first).mockResolvedValueOnce(newer).mockResolvedValueOnce(second)
    render(<ApiQuestApp api={api} />)
    expect(await screen.findByRole('heading', { name: first.title })).toBeVisible()
    await user.click(screen.getByRole('button', { name: '公開情報を更新' }))
    expect(await screen.findByText('問題が更新されました。詳細を開いて内容をご確認ください。')).toBeVisible()
    await user.selectOptions(screen.getByRole('combobox', { name: '公開APIの問題を選択' }), second.questId)
    expect(screen.queryByText(/問題が更新されました/)).not.toBeInTheDocument()
  })

  it('手動更新失敗後は再試行できる', async () => {
    const user = userEvent.setup()
    const api = apiFixture()
    api.listAreas.mockResolvedValueOnce(page(areas)).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(page(areas))
    render(<ApiQuestApp api={api} />)
    await screen.findByRole('heading', { name: first.title })
    await user.click(screen.getByRole('button', { name: '公開情報を更新' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('サーバーとの通信を確認')
    const retryButton = screen.getByRole('button', { name: '再試行' })
    retryButton.focus()
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('heading', { name: first.title })).toBeVisible()
    expect(screen.getByRole('button', { name: '公開情報を更新' })).toHaveFocus()
  })

  it('手動更新のtimeout後に、signalを無視する旧応答を待たず再試行できる', async () => {
    vi.useFakeTimers()
    const api = apiFixture()
    let resolveOld!: (value: ReturnType<typeof page<PublicArea>>) => void
    api.listAreas.mockResolvedValueOnce(page(areas)).mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve }))
    try {
      render(<ApiQuestApp api={api} />)
      await act(async () => {})
      expect(screen.getByRole('heading', { name: first.title })).toBeVisible()
      fireEvent.click(screen.getByRole('button', { name: '公開情報を更新' }))
      await act(async () => {})
      await act(async () => vi.advanceTimersByTimeAsync(10_000))
      expect(screen.getByRole('alert')).toHaveTextContent('サーバーとの通信を確認')
      expect(screen.getByRole('button', { name: '再試行' })).toBeEnabled()
      api.listAreas.mockResolvedValueOnce(page(areas))
      fireEvent.click(screen.getByRole('button', { name: '再試行' }))
      await act(async () => {})
      expect(screen.getByRole('heading', { name: first.title })).toBeVisible()
      await act(async () => resolveOld(page([])))
      expect(screen.getByRole('heading', { name: first.title })).toBeVisible()
    } finally {
      vi.useRealTimers()
    }
  })

  it('遅れて返る旧地域の一覧が新しい地域を上書きしない', async () => {
    const user = userEvent.setup()
    const api = apiFixture()
    let resolveOld!: (value: ReturnType<typeof page<PublicQuest>>) => void
    api.listQuests.mockImplementation((query?: { areaId?: string }) => {
      if (query?.areaId === 'area-a') return new Promise((resolve) => { resolveOld = resolve })
      return Promise.resolve(page(query?.areaId ? [second] : [first, second]))
    })
    render(<ApiQuestApp api={api} />)
    await screen.findByRole('heading', { name: first.title })
    await user.selectOptions(screen.getByRole('combobox', { name: '地域を選択' }), 'area-a')
    await waitFor(() => expect(resolveOld).toBeDefined())
    expect(screen.queryByRole('heading', { name: first.title })).not.toBeInTheDocument()
    await user.selectOptions(screen.getByRole('combobox', { name: '地域を選択' }), 'area-b')
    await screen.findByRole('heading', { name: second.title })
    await act(async () => resolveOld(page([first])))
    expect(screen.getByRole('combobox', { name: '地域を選択' })).toHaveValue('area-b')
    expect(screen.getByRole('heading', { name: second.title })).toBeVisible()
    expect(screen.queryByRole('heading', { name: first.title })).not.toBeInTheDocument()
  })

  it('地域の0件を再試行すると一覧を取り直して新しい問題を表示する', async () => {
    const user = userEvent.setup()
    const api = apiFixture()
    api.listQuests.mockResolvedValueOnce(page([first])).mockResolvedValueOnce(page([])).mockResolvedValueOnce(page([second]))
    render(<ApiQuestApp api={api} />)
    await screen.findByRole('heading', { name: first.title })
    await user.selectOptions(screen.getByRole('combobox', { name: '地域を選択' }), 'area-b')
    await screen.findByRole('heading', { name: '公開問題はありません' })
    await user.click(screen.getByRole('button', { name: '再試行' }))
    expect(await screen.findByRole('heading', { name: second.title })).toBeVisible()
    expect(api.listQuests).toHaveBeenCalledTimes(3)
  })

  it('詳細の地域が選択地域と一致しなければ表示しない', async () => {
    const user = userEvent.setup()
    const api = apiFixture()
    api.listQuests.mockResolvedValue(page([first]))
    render(<ApiQuestApp api={api} />)
    await screen.findByRole('heading', { name: first.title })
    await user.selectOptions(screen.getByRole('combobox', { name: '地域を選択' }), 'area-b')
    await screen.findByRole('alert')
    expect(screen.queryByRole('heading', { name: first.title })).not.toBeInTheDocument()
  })

  it('空の一覧は成功した0件として表示する', async () => {
    const api = apiFixture()
    api.listQuests.mockResolvedValue(page([]))
    render(<ApiQuestApp api={api} />)
    expect(await screen.findByRole('heading', { name: '公開問題はありません' })).toBeVisible()
    expect(api.getQuest).not.toHaveBeenCalled()
  })

  it('取得失敗をデモで置き換えず、再試行でAPIへ再接続する', async () => {
    const user = userEvent.setup()
    const api = apiFixture()
    api.listQuests.mockRejectedValueOnce(new Error('network failed'))
    render(<ApiQuestApp api={api} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('サーバーとの通信を確認')
    expect(screen.queryByText('川辺の謎')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '再試行' }))
    expect(await screen.findByRole('heading', { name: '川辺の謎' })).toBeVisible()
  })

  it('詳細切替時に遅れて返る旧応答を表示しない', async () => {
    const user = userEvent.setup()
    const api = apiFixture()
    let resolveOld!: (value: PublicQuest) => void
    api.getQuest.mockImplementation((id: string) => {
      if (id === first.questId) return new Promise((resolve) => { resolveOld = resolve })
      return Promise.resolve(second)
    })
    render(<ApiQuestApp api={api} />)
    await waitFor(() => expect(screen.getByRole('combobox', { name: '公開APIの問題を選択' })).toHaveValue('quest-a'))
    await user.selectOptions(screen.getByRole('combobox', { name: '公開APIの問題を選択' }), 'quest-b')
    expect(await screen.findByRole('heading', { name: '森の謎' })).toBeVisible()
    await act(async () => resolveOld(first))
    expect(screen.queryByRole('heading', { name: '川辺の謎' })).not.toBeInTheDocument()
  })

  it('同じ選択IDでもAPIが変われば一覧と詳細を再取得する', async () => {
    const user = userEvent.setup()
    const oldApi = apiFixture()
    const nextApi = apiFixture()
    const updated = { ...second, title: '別APIの新版', version: 8 }
    nextApi.listQuests.mockResolvedValue(page([updated]))
    nextApi.getQuest.mockResolvedValue(updated)
    const { rerender } = render(<ApiQuestApp api={oldApi} />)
    await screen.findByRole('heading', { name: first.title })
    await user.selectOptions(screen.getByRole('combobox', { name: '公開APIの問題を選択' }), second.questId)
    await screen.findByRole('heading', { name: second.title })
    rerender(<ApiQuestApp api={nextApi} />)
    expect(screen.queryByRole('heading', { name: second.title })).not.toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: updated.title })).toBeVisible()
    expect(nextApi.listQuests).toHaveBeenCalledTimes(1)
    expect(nextApi.getQuest).toHaveBeenCalledWith(second.questId, expect.anything())
  })

  it('API切替後に選択中の地域が新しい地域一覧にない場合も選択値と絞り込みを保つ', async () => {
    const user = userEvent.setup()
    const oldApi = apiFixture()
    const nextApi = apiFixture()
    oldApi.listQuests.mockImplementation(async (query?: { areaId?: string }) => query?.areaId === 'area-b'
      ? page([second]) : page([first, second]))
    nextApi.listAreas.mockResolvedValue(page([areas[0]]))
    nextApi.listQuests.mockResolvedValue(page([second]))
    const { rerender } = render(<ApiQuestApp api={oldApi} />)
    await screen.findByRole('heading', { name: first.title })
    await user.selectOptions(screen.getByRole('combobox', { name: '地域を選択' }), 'area-b')
    await screen.findByRole('heading', { name: second.title })

    rerender(<ApiQuestApp api={nextApi} />)
    expect(await screen.findByRole('heading', { name: second.title })).toBeVisible()
    const region = screen.getByRole('combobox', { name: '地域を選択' })
    expect(region).toHaveValue('area-b')
    expect(screen.getByRole('option', { name: '選択中の地域（一覧にありません）' })).toHaveValue('area-b')
    expect(nextApi.listQuests).toHaveBeenCalledWith({ areaId: 'area-b', limit: 100, cursor: undefined }, expect.anything())
  })

  it('詳細404を0件や固定デモにせず、別の問題へ切り替えられる', async () => {
    const user = userEvent.setup()
    const api = apiFixture()
    api.getQuest.mockRejectedValueOnce(new ApiError('NOT_FOUND', { status: 404 }))
    render(<ApiQuestApp api={api} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('公開されていないか、見つかりません')
    expect(screen.queryByText('港に時を知らせるもの')).not.toBeInTheDocument()
    await user.selectOptions(screen.getByRole('combobox', { name: '公開APIの問題を選択' }), second.questId)
    expect(await screen.findByRole('heading', { name: second.title })).toBeVisible()
  })

  it('再試行で選択中の問題が一覧から消えたら先頭の詳細とselectを一致させる', async () => {
    const user = userEvent.setup()
    const api = apiFixture()
    api.getQuest.mockImplementation(async (id: string) => {
      if (id === second.questId) throw new ApiError('NOT_FOUND', { status: 404 })
      return first
    })
    render(<ApiQuestApp api={api} />)
    await screen.findByRole('heading', { name: first.title })
    const select = screen.getByRole('combobox', { name: '公開APIの問題を選択' })
    await user.selectOptions(select, second.questId)
    await screen.findByRole('alert')
    expect(select).toHaveValue(second.questId)

    api.listQuests.mockResolvedValue(page([first]))
    await user.click(screen.getByRole('button', { name: '再試行' }))
    expect(await screen.findByRole('heading', { name: first.title })).toBeVisible()
    await waitFor(() => expect(screen.getByRole('combobox', { name: '公開APIの問題を選択' })).toHaveValue(first.questId))
  })

  it('詳細や地域取得に失敗した場合も再試行できる', async () => {
    const user = userEvent.setup()
    const api = apiFixture()
    api.listAreas.mockRejectedValueOnce(new Error('network'))
    render(<ApiQuestApp api={api} />)
    await screen.findByRole('alert')
    await user.click(screen.getByRole('button', { name: '再試行' }))
    expect(await screen.findByRole('heading', { name: first.title })).toBeVisible()
    expect(api.getQuest).toHaveBeenCalledTimes(1)
  })

  it('StrictModeの再実行でも初期取得が完了する', async () => {
    render(<StrictMode><ApiQuestApp api={apiFixture()} /></StrictMode>)
    expect(await screen.findByRole('heading', { name: first.title })).toBeVisible()
  })

  it('一覧と地域の後続ページを読み、循環するcursorは停止する', async () => {
    const api = apiFixture()
    api.listQuests.mockResolvedValueOnce({ items: [], nextCursor: 'next' }).mockResolvedValueOnce(page([second]))
    api.listAreas.mockResolvedValueOnce({ items: [areas[0]], nextCursor: 'area-next' }).mockResolvedValueOnce(page([areas[1]]))
    const { unmount } = render(<ApiQuestApp api={api} />)
    expect(await screen.findByRole('heading', { name: second.title })).toBeVisible()
    expect(screen.getByText('森エリア')).toBeVisible()
    expect(api.listQuests).toHaveBeenCalledWith({ limit: 100, cursor: 'next' }, expect.anything())
    unmount()
    const cyclic = apiFixture()
    cyclic.listQuests.mockResolvedValue({ items: [], nextCursor: 'same' })
    render(<ApiQuestApp api={cyclic} />)
    await screen.findByRole('alert')
    expect(cyclic.listQuests).toHaveBeenCalledTimes(2)
  })
})

