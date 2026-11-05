import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PublicArea, PublicQuest } from '../../shared/api/types'
import type { AuthClient } from '../auth/authTypes'
import { ApiQuestApp } from './ApiQuestApp'
import { ApiError } from '../../shared/api/client'

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
    const quest = { ...first, hintCount: 2 }
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
    await user.click(screen.getByRole('button', { name: '最新版の問題を読み直す' }))
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

