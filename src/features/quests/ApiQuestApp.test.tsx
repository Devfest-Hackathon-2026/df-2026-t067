import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { StrictMode } from 'react'
import type { ReactNode } from 'react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PublicArea, PublicQuest } from '../../shared/api/types'
import type { AuthClient, AuthSnapshot } from '../auth/authTypes'
import { ApiQuestApp } from './ApiQuestApp'
import { ApiError } from '../../shared/api/client'

vi.mock('../explore/MapPreview', () => ({ MapPreview: (props: { areas?: PublicArea[]; quests?: PublicQuest[]; selectedAreaId?: string; onSelectArea?: (id: string) => void; topOverlay?: ReactNode; questDetail?: ReactNode }) =>
  <div data-testid="map-state" data-area={props.selectedAreaId} data-quest-order={props.quests?.map((quest) => quest.questId).join(",")}><div className="explore-list-head">{props.quests?.length ?? 0}件</div>地図 {props.areas?.length ?? 0} {props.selectedAreaId}{props.areas?.map((area) => <button key={area.areaId} type="button" aria-label={area.areaId === 'area-b' ? '地図の公開地域を選択' : '地図の川辺エリアを選択'} onClick={() => props.onSelectArea?.(area.areaId)}>{area.label}のピン</button>)}{props.topOverlay}{props.questDetail}</div> }))

const first: PublicQuest = { questId: 'quest-a', version: 2, title: '川辺の謎', clue: '詳細版の手がかり', areaId: 'area-a', visitConditions: '訪問条件', hintCount: 0 }
const second: PublicQuest = { questId: 'quest-b', version: 1, title: '森の謎', clue: '森の手がかり', areaId: 'area-b', visitConditions: '訪問条件', hintCount: 0 }
const areas: PublicArea[] = [
  { areaId: 'area-a', label: '川辺エリア', publicGeometry: { type: 'Polygon', coordinates: [] }, marker: { latitude: 35, longitude: 139 }, publishedCount: 1 },
  { areaId: 'area-b', label: '森エリア', publicGeometry: { type: 'Polygon', coordinates: [] }, marker: { latitude: 36, longitude: 140 }, publishedCount: 1 },
]
const page = <T,>(items: T[]) => ({ items, nextCursor: null })

// 選択中も同じトグルから県のパネルを開く。
async function openFilterPanel(user: ReturnType<typeof userEvent.setup>) {
  const toggle = document.querySelector<HTMLButtonElement>('.filter-toggle')!
  if (toggle.getAttribute('aria-expanded') !== 'true') await user.click(toggle)
}
async function clearPlaceFilter(user: ReturnType<typeof userEvent.setup>) {
  await openFilterPanel(user)
  await user.click(screen.getByRole('button', { pressed: true }))
}
async function regionAccordionRow(name: string) {
  return screen.getByRole('button', {
    name: (_label, element) => element.classList.contains('filter-accordion-row')
      && element.querySelector('.filter-accordion-name')?.textContent === name,
  })
}
async function expandRegion(user: ReturnType<typeof userEvent.setup>, name: string) {
  await openFilterPanel(user)
  const row = await regionAccordionRow(name)
  if (row.getAttribute('aria-expanded') !== 'true') await user.click(row)
  return row
}
async function clickPrefecture(user: ReturnType<typeof userEvent.setup>, region: string, prefecture: string) {
  await expandRegion(user, region)
  await user.click(within(screen.getByRole('group', { name: `${region}の都道府県` })).getByRole('button', { name: prefecture }))
}

beforeEach(() => {
  window.history.replaceState(null, '', '/')
})

afterEach(() => {
  window.history.replaceState(null, '', '/')
})

function apiFixture() {
  return {
    listQuests: vi.fn().mockImplementation(async (query?: { areaId?: string }) => page([{ ...first, title: '一覧表示用タイトル' }, second].filter(quest => !query?.areaId || quest.areaId === query.areaId))),
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
  it('公開情報更新で表示中の古いヒント画像と遅延イベントを破棄する', async () => {
    const user = userEvent.setup()
    const quest = { ...first, optionalHintImage: 'https://example.test/old.jpg' }
    const revised = { ...quest, version: quest.version + 1, optionalHintImage: 'https://example.test/new.jpg' }
    const api = apiFixture()
    api.getQuest.mockResolvedValueOnce(quest).mockResolvedValueOnce(revised)
    api.listQuests.mockResolvedValueOnce(page([quest])).mockResolvedValueOnce(page([revised, second]))
    render(<ApiQuestApp api={api} authClient={signedOutAuth()} />)
    // 初期表示は未選択（D-56）のため、一覧から選んで詳細を表示する。
    await user.click(await screen.findByRole('button', { name: '川辺の謎を開く' }))
    await user.click(await screen.findByRole('button', { name: '問題を見る' }))
    await user.click(screen.getByRole('button', { name: 'ヒント画像' }))
    const oldImage = await waitFor(() => {
      const image = document.querySelector<HTMLImageElement>('.optional-hint-image')
      expect(image).not.toBeNull()
      return image!
    })
    await user.click(screen.getByRole('button', { name: '更新する' }))
    expect(await screen.findByText(/問題更新/)).toBeVisible()
    expect(oldImage).not.toBeInTheDocument()
    fireEvent.load(oldImage)
    expect(document.querySelector('.optional-hint-image')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '問題を見る' }))
    expect(document.querySelector('.optional-hint-image')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'ヒント画像' }))
    const newImage = await waitFor(() => document.querySelector<HTMLImageElement>('.optional-hint-image'))
    expect(newImage).toHaveAttribute('src', revised.optionalHintImage)
  })

  it('公開情報の再取得中は前の一覧を残し、新しい一覧が届いたら差し替える（D-75）', async () => {
    const user = userEvent.setup()
    const api = apiFixture()
    render(<ApiQuestApp api={api} authClient={signedOutAuth()} />)
    expect(await screen.findByRole('button', { name: '一覧表示用タイトルを開く' })).toBeVisible()
    expect(screen.getByRole('button', { name: '森の謎を開く' })).toBeVisible()
    // 再取得側の一覧取得を保留し、その間も前の一覧が画面に残ることを見る。
    let resolveQuests: ((value: { items: PublicQuest[]; nextCursor: null }) => void) | undefined
    api.listQuests.mockImplementation(() => new Promise<{ items: PublicQuest[]; nextCursor: null }>((resolve) => { resolveQuests = resolve }))
    await user.click(screen.getByRole('button', { name: '更新する' }))
    expect(screen.getByRole('button', { name: '一覧表示用タイトルを開く' })).toBeVisible()
    expect(screen.getByRole('button', { name: '森の謎を開く' })).toBeVisible()
    resolveQuests!(page([{ ...first, title: '更新後タイトル' }, second]))
    expect(await screen.findByRole('button', { name: '更新後タイトルを開く' })).toBeVisible()
    expect(screen.queryByRole('button', { name: '一覧表示用タイトルを開く' })).not.toBeInTheDocument()
  })

  it('問題を切り替えると古いヒント画像要素を破棄する', async () => {
    const user = userEvent.setup()
    const quest = { ...first, optionalHintImage: 'https://example.test/a.jpg' }
    const forest = { ...second, optionalHintImage: 'https://example.test/b.jpg' }
    const api = apiFixture()
    api.listQuests.mockResolvedValue(page([quest, forest]))
    api.getQuest.mockImplementation(async (id) => id === quest.questId ? quest : forest)
    render(<ApiQuestApp api={api} authClient={signedOutAuth()} />)
    await user.click(await screen.findByRole('button', { name: '川辺の謎を開く' }))
    await user.click(await screen.findByRole('button', { name: '問題を見る' }))
    await user.click(screen.getByRole('button', { name: 'ヒント画像' }))
    const oldImage = await waitFor(() => {
      const image = document.querySelector<HTMLImageElement>('.optional-hint-image')
      expect(image).not.toBeNull()
      return image!
    })
    await user.click(screen.getByRole('button', { name: '森の謎を開く' }))
    expect(await screen.findByRole('heading', { name: forest.title })).toBeVisible()
    expect(oldImage).not.toBeInTheDocument()
    fireEvent.error(oldImage)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('問題詳細を閉じるとヒント画像を外し、遅延エラーを表示しない', async () => {
    const user = userEvent.setup()
    const quest = { ...first, optionalHintImage: 'https://example.test/hint.jpg' }
    const api = apiFixture()
    api.getQuest.mockResolvedValue(quest)
    render(<ApiQuestApp api={api} authClient={signedOutAuth()} />)
    await user.click(await screen.findByRole('button', { name: '一覧表示用タイトルを開く' }))
    await user.click(await screen.findByRole('button', { name: '問題を見る' }))
    await user.click(screen.getByRole('button', { name: 'ヒント画像' }))
    const oldImage = await waitFor(() => {
      const image = document.querySelector<HTMLImageElement>('.optional-hint-image')
      expect(image).not.toBeNull()
      return image!
    })
    await user.click(screen.getByRole('button', { name: '問題を見る' }))
    expect(oldImage).not.toBeInTheDocument()
    fireEvent.error(oldImage)
    expect(screen.queryByText('ヒント画像を読み込めませんでした。')).not.toBeInTheDocument()
  })

  it('404ヒントから手動更新し、完了後に公開情報更新へフォーカスを戻す', async () => {
    const user = userEvent.setup()
    const quest = { ...first, hintCount: 1 }
    const api = apiFixture()
    api.getQuest.mockResolvedValue(quest)
    api.getHint.mockRejectedValueOnce(new ApiError('NOT_FOUND', { status: 404 }))
    // 問題を指定して開いた状態から始める（ディープリンク到着時は詳細が開いている）。
    window.history.replaceState(null, '', '/?area=area-a&quest=quest-a')
    render(<ApiQuestApp api={api} authClient={signedOutAuth()} dataMode="durable-local" />)
    expect(await screen.findByRole('heading', { name: quest.title })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'ヒントを見る' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('ヒントなし')
    const reloadHintButton = screen.getByRole('button', { name: '問題を再読込' })
    reloadHintButton.focus()
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('button', { name: '更新する' })).toBeEnabled()
    await waitFor(() => expect(screen.getByRole('button', { name: '更新する' })).toHaveFocus())
    expect(api.listQuests).toHaveBeenCalledTimes(2)
  })

  it('地図の地域クリックで地域・問題・URL選択を同期する', async () => {
    const api = apiFixture()
    render(<ApiQuestApp api={api} authClient={signedOutAuth()} dataMode="durable-local" />)
    await userEvent.setup().click(await screen.findByRole('button', { name: '一覧表示用タイトルを開く' }))
    expect(await screen.findByRole('heading', { name: first.title })).toBeVisible()
    // 未ログインはヘッダーの「ログイン」ボタンで分かり、状態表示の説明文は出ない。
    expect(screen.getByRole('button', { name: 'ログイン' })).toBeVisible()
    expect(screen.queryByText('問題はログインなしで閲覧できます。', { exact: true })).not.toBeInTheDocument()
    api.listQuests.mockResolvedValueOnce(page([second]))
    await userEvent.setup().click(screen.getByRole('button', { name: '地図の公開地域を選択' }))
    expect(await screen.findByRole('heading', { name: second.title })).toBeVisible()
    expect(new URLSearchParams(window.location.search).get('area') ?? '').toBe('area-b')
    expect(screen.getByRole('button', { name: '森の謎を開く' })).toHaveAttribute('aria-pressed', 'true')
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
    await user.click(await screen.findByRole('button', { name: '川辺の謎を開く' }))
    expect(await screen.findByRole('heading', { name: first.title })).toBeVisible()
    await user.click(screen.getByRole('button', { name: '更新する' }))
    expect(await screen.findByText('問題更新')).toBeVisible()
    await user.click(screen.getByRole('button', { name: '地図の公開地域を選択' }))
    expect(screen.queryByText(/問題更新/)).not.toBeInTheDocument()
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
    // 問題を指定して開いた状態から始める（ディープリンク到着時は詳細が開いている）。
    window.history.replaceState(null, '', '/?area=area-a&quest=quest-a')
    render(<ApiQuestApp dataMode="durable-local" authClient={authClient} />)
    expect(await screen.findByRole('heading', { name: first.title })).toBeVisible()
    expect(screen.queryByText('永続API・ローカル')).not.toBeInTheDocument()
    // ログイン済みはヘッダーのアカウントアイコンで分かり、状態表示の説明文は出ない。
    expect(screen.getByRole('button', { name: 'アカウントメニュー' })).toBeVisible()
    expect(screen.queryByText('Googleアカウントでログインしています。', { exact: true })).not.toBeInTheDocument()
    const catalogCalls = fetcher.mock.calls.filter(([path]) => String(path).includes('/api/v1/quests'))
    expect(catalogCalls).toHaveLength(2)
    expect(catalogCalls.every(([, init]) => !new Headers(init?.headers).has('Authorization'))).toBe(true)
    expect(getUserMedia).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: '問題を報告' }))
    await user.type(await screen.findByRole('textbox', { name: '報告内容' }), '架空の報告')
    await user.click(screen.getByRole('button', { name: '送信する' }))
    expect(await screen.findByText('報告済み')).toBeVisible()
    const report = fetcher.mock.calls.find(([path]) => path === '/api/v1/reports')?.[1]
    expect(new Headers(report?.headers).get('Authorization')).toBe('Bearer test-token')
    expect(JSON.parse(String(report?.body))).toEqual({ questId: first.questId, category: 'PHOTO_UNAVAILABLE', text: '架空の報告' })
    await user.click(screen.getByRole('button', { name: '問題を報告' }))
    await user.click(await screen.findByRole('button', { name: '挑戦する' }))
    const start = fetcher.mock.calls.find(([path]) => path === '/api/v1/challenges')?.[1]
    expect(new Headers(start?.headers).get('Authorization')).toBe('Bearer test-token')
    expect(JSON.parse(String(start?.body))).toEqual({ questId: first.questId, expectedVersion: first.version })
    expect(getUserMedia).toHaveBeenCalledTimes(1)
    await user.click(within(screen.getByRole('navigation', { name: '主要ナビゲーション' })).getByRole('button', { name: '自分の記録' }))
    expect(await screen.findByText('記録はまだない')).toBeVisible()
    const read = fetcher.mock.calls.find(([path]) => String(path).startsWith('/api/v1/me/discoveries?'))
    expect(new Headers(read?.[1]?.headers).get('Authorization')).toBe('Bearer test-token')
  })

  it('rejects a demo server when the Web app selected the durable catalog', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(page([])), {
      headers: { 'Content-Type': 'application/json', 'X-Quest-Data-Mode': 'demo' },
    })))
    render(<ApiQuestApp dataMode="durable-local" authClient={signedOutAuth()} />)
    expect(await screen.findByRole('heading', { name: '問題読込失敗' })).toBeVisible()
    expect(screen.queryByRole('heading', { name: '問題なし' })).not.toBeInTheDocument()
  })

  it('記録が0件なら主ボタンから探索へ戻りURLとタブも切り替わる', async () => {
    const user = userEvent.setup()
    const snapshot = { status: 'signed-in' as const, user: { uid: 'owner', displayName: null } }
    const authClient = { ...signedOutAuth(), getSnapshot: () => snapshot, getIdToken: async () => 'test-token' }
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (path) => new Response(JSON.stringify(
      path === '/api/v1/session' ? { uid: snapshot.user.uid }
        : String(path).startsWith('/api/v1/quests?') ? page([first]) : page([]),
    ), { headers: { 'Content-Type': 'application/json', 'X-Quest-Data-Mode': 'durable-local' } })))
    window.history.replaceState(null, '', '/?view=records')
    render(<ApiQuestApp dataMode="durable-local" authClient={authClient} />)
    const records = screen.getByRole('region', { name: '自分の記録' })
    const explore = await within(records).findByRole('button', { name: '謎を探す' })
    expect(explore).toHaveClass('primary-button')
    expect(within(records).getByText('記録はまだない')).toBeVisible()
    await user.click(explore)
    expect(records).not.toBeVisible()
    expect(screen.getByRole('heading', { name: '全国から謎を探す' })).toBeVisible()
    expect(window.location.search).not.toContain('view=records')
    expect(within(screen.getByRole('navigation', { name: '主要ナビゲーション' }))
      .getByRole('button', { name: '謎を探す' })).toHaveAttribute('aria-current', 'page')
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
    await screen.findByRole('heading', { name: state === 'empty' ? '問題なし' : '問題読込失敗' })
    await user.click(within(screen.getByRole('navigation', { name: '主要ナビゲーション' })).getByRole('button', { name: '自分の記録' }))
    expect(await screen.findByText('記録はまだない')).toBeVisible()
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
    expect(await screen.findByText('記録はまだない')).toBeVisible()
    await act(async () => finishCatalog(page([first])))
    // カタログの読み込みが終わっても、未選択の間は詳細を取得しない（D-56）。
    expect(api.getQuest).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { name: '自分の記録' })).toBeVisible()
    expect(fetcher.mock.calls.filter(([path]) => String(path).startsWith('/api/v1/me/discoveries?'))).toHaveLength(1)
    await user.click(within(screen.getByRole('navigation', { name: '主要ナビゲーション' })).getByRole('button', { name: '謎を探す' }))
    await user.click(await screen.findByRole('button', { name: '川辺の謎を開く' }))
    expect(await screen.findByRole('heading', { name: first.title })).toBeVisible()
  })
  it('記録画面へ入り直すと一覧を取り直し、増えた記録が再読み込みなしで出る', async () => {
    const user = userEvent.setup()
    const api = apiFixture()
    const snapshot = { status: 'signed-in' as const, user: { uid: 'demo-owner', displayName: null } }
    const authClient = { ...signedOutAuth(), getSnapshot: () => snapshot, getIdToken: async () => 'demo-token' }
    // 記録は最初は0件で、途中で1件増える（挑戦のクリアを模す）。
    let cleared = false
    const record = { discoveryId: 'discovery-1', placeId: 'place-a', questId: first.questId, questVersion: first.version,
      firstClearedAt: '2026-11-09T00:00:00.000Z', placeName: '川辺の時計台', descriptionSnapshot: '説明',
      revealedLocation: { latitude: 35, longitude: 139 }, ownerPhoto: '/api/v1/me/discoveries/discovery-1/photo' }
    const fetcher = vi.fn<typeof fetch>(async (path) => {
      const data = path === '/api/v1/session' ? { uid: snapshot.user.uid }
        : String(path).startsWith('/api/v1/me/discoveries') ? page(cleared ? [record] : [])
          : page([])
      return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json', 'X-Quest-Data-Mode': 'demo' } })
    })
    vi.stubGlobal('fetch', fetcher)
    render(<ApiQuestApp api={api} authClient={authClient} />)
    const nav = () => within(screen.getByRole('navigation', { name: '主要ナビゲーション' }))
    const discoveryReads = () => fetcher.mock.calls.filter(([path]) => String(path).startsWith('/api/v1/me/discoveries?'))
    await user.click(nav().getByRole('button', { name: '自分の記録' }))
    expect(await screen.findByText('記録はまだない')).toBeVisible()
    expect(discoveryReads()).toHaveLength(1)
    // 探索へ戻り、記録が増えてから記録画面へ入り直す。画面は常駐したままなので、
    // 入り直しのたびに取り直されなければ、空表示が居座って新しい記録が出ない。
    await user.click(nav().getByRole('button', { name: '謎を探す' }))
    cleared = true
    await user.click(nav().getByRole('button', { name: '自分の記録' }))
    expect(await screen.findByRole('button', { name: '川辺の時計台' })).toBeVisible()
    expect(discoveryReads()).toHaveLength(2)
  })
  it('記録タブとの往復で地方の絞り込み・一覧・地図の選択とURLが一致したまま保たれる', async () => {
    const user = userEvent.setup()
    const hiroshimaQuest: PublicQuest = { questId: 'quest-hiroshima', version: 1, title: '広島のもみじを探せ', clue: '手がかり', areaId: 'area-hiroshima', visitConditions: '訪問条件', hintCount: 0, questNumber: '34-01' }
    const tokyoQuest: PublicQuest = { questId: 'quest-tokyo', version: 1, title: '東京の鯉を探せ', clue: '手がかり', areaId: 'area-tokyo', visitConditions: '訪問条件', hintCount: 0, questNumber: '13-01' }
    const regionAreas: PublicArea[] = [
      { areaId: 'area-hiroshima', label: '広島', prefectureCode: '34', publicGeometry: { type: 'Polygon', coordinates: [] }, marker: { latitude: 34.39, longitude: 132.45 }, publishedCount: 1 },
      { areaId: 'area-tokyo', label: '東京', prefectureCode: '13', publicGeometry: { type: 'Polygon', coordinates: [] }, marker: { latitude: 35.68, longitude: 139.76 }, publishedCount: 1 },
    ]
    const api = apiFixture()
    api.listAreas.mockResolvedValue(page(regionAreas))
    api.listQuests.mockImplementation(async (query?: { areaId?: string }) => query?.areaId === 'area-hiroshima' ? page([hiroshimaQuest])
      : query?.areaId === 'area-tokyo' ? page([tokyoQuest]) : page([hiroshimaQuest, tokyoQuest]))
    api.getQuest.mockImplementation(async (id: string) => id === hiroshimaQuest.questId ? hiroshimaQuest : tokyoQuest)
    const snapshot = { status: 'signed-in' as const, user: { uid: 'round-trip-owner', displayName: null } }
    const authClient = { ...signedOutAuth(), getSnapshot: () => snapshot, getIdToken: async () => 'demo-token' }
    const fetcher = vi.fn<typeof fetch>(async (path) => new Response(JSON.stringify(
      path === '/api/v1/session' ? { uid: snapshot.user.uid } : page([]),
    ), { headers: { 'Content-Type': 'application/json', 'X-Quest-Data-Mode': 'demo' } }))
    vi.stubGlobal('fetch', fetcher)
    render(<ApiQuestApp api={api} authClient={authClient} />)
    expect(await screen.findByRole('button', { name: '広島のもみじを探せを開く' })).toBeVisible()

    // 地方フィルタで中国を選び、広島の問題と所属地域を選択する。
    await clickPrefecture(user, '中国', '広島県')
    expect(screen.getByRole('button', { name: '広島県' })).toBeVisible()
    expect(screen.queryByRole('button', { name: '東京の鯉を探せを開く' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '広島のもみじを探せを開く' }))
    await screen.findByRole('heading', { name: hiroshimaQuest.title })
    expect(screen.getByTestId('map-state')).toHaveAttribute('data-area', 'area-hiroshima')
    expect(new URL(window.location.href).searchParams.get('area')).toBe('area-hiroshima')
    expect(new URL(window.location.href).searchParams.get('quest')).toBe('quest-hiroshima')

    // 記録タブへ行き、探索へ戻る。往復の前後で4つの状態が一致したままであること。
    const nav = () => within(screen.getByRole('navigation', { name: '主要ナビゲーション' }))
    await user.click(nav().getByRole('button', { name: '自分の記録' }))
    expect(await screen.findByText('記録はまだない')).toBeVisible()
    // 探索側はアンマウントされず、絞り込みも保持されている（隠れているだけ）。
    expect(screen.getByTestId('map-state')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '広島県', hidden: true })).toBeInTheDocument()
    await user.click(nav().getByRole('button', { name: '謎を探す' }))
    expect(await screen.findByRole('heading', { name: hiroshimaQuest.title })).toBeVisible()
    expect(screen.getByRole('button', { name: '広島県' })).toBeVisible()
    expect(screen.queryByRole('button', { name: '東京の鯉を探せを開く' })).not.toBeInTheDocument()
    expect(screen.getByTestId('map-state')).toHaveAttribute('data-area', 'area-hiroshima')
    // 表示されている問題は URL の ?quest= と必ず一致する。
    expect(new URL(window.location.href).searchParams.get('quest')).toBe(hiroshimaQuest.questId)
  })

  it('未ログインの記録画面では読み込みエラーではなくログインの案内を出す', async () => {
    const user = userEvent.setup()
    const api = apiFixture()
    render(<ApiQuestApp api={api} authClient={signedOutAuth()} />)
    expect(await screen.findByRole('button', { name: '一覧表示用タイトルを開く' })).toBeVisible()
    await user.click(within(screen.getByRole('navigation', { name: '主要ナビゲーション' })).getByRole('button', { name: '自分の記録' }))
    expect(await screen.findByRole('button', { name: 'Googleで続行' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Googleで続行' })).toBeVisible()
    expect(screen.queryByText(/記録を読み込めませんでした/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '記録を再読込' })).not.toBeInTheDocument()
    // 戻り導線はタブに一本化され、本文に重複した戻りボタンは置かない。
    expect(screen.queryByRole('button', { name: '地図へ戻る' })).not.toBeInTheDocument()
  })

  it.each(['unconfigured', 'unavailable'] as const)('ログイン設定が使えない記録画面でも案内を表示する (%s)', async (status) => {
    const user = userEvent.setup()
    const snapshot = { status, user: null, message: 'ログインを利用できません' }
    const authClient = { ...signedOutAuth(), getSnapshot: () => snapshot }
    render(<ApiQuestApp api={apiFixture()} authClient={authClient} />)
    await user.click(within(screen.getByRole('navigation', { name: '主要ナビゲーション' })).getByRole('button', { name: '自分の記録' }))
    const records = within(screen.getByRole('region', { name: '自分の記録' }))
    expect(records.getByText('ログイン')).toBeVisible()
    expect(records.queryByRole('button', { name: 'Googleでログイン' })).not.toBeInTheDocument()
    expect(records.queryByText(/ログインなしで閲覧|クリアした問題の写真/)).not.toBeInTheDocument()
  })

  it('一覧の中の詳細に閉じるボタンは無く、再タップで地域ごと選択解除まで完了する', async () => {
    const user = userEvent.setup()
    const api = apiFixture()
    render(<ApiQuestApp api={api} authClient={signedOutAuth()} dataMode="team-preview" teamAnswerTrial />)
    await user.click(await screen.findByRole('button', { name: '一覧表示用タイトルを開く' }))
    // 共有検証では選択と同時に詳細が開く。詳細の中に「問題を見る／見てみる」の
    // 開閉ボタンは出ない（閉じる受け口は再タップだけ）。
    expect(await screen.findByText('詳細版の手がかり')).toBeVisible()
    expect(screen.queryByRole('button', { name: '問題を見る' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '問題を見る' })).not.toBeInTheDocument()
    // 行選択も地域で一覧を絞る。
    expect(screen.queryByRole('button', { name: '森の謎を開く' })).not.toBeInTheDocument()
    expect(screen.getByTestId('map-state')).toHaveAttribute('data-area', 'area-a')
    // 選択でピッカーの置き場所が移りボタンは作り直されるため、押し直す要素は取り直す。
    await user.click(screen.getByRole('button', { name: '一覧表示用タイトルを開く' }))
    // 再タップで選択解除まで完了し、詳細は消える。
    await waitFor(() => expect(screen.queryByRole('heading', { name: first.title })).not.toBeInTheDocument())
    expect(screen.queryByText('詳細版の手がかり')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '一覧表示用タイトルを開く' })).toHaveAttribute('aria-pressed', 'false')
    expect(new URLSearchParams(window.location.search).get('quest') ?? '').toBe('')
  })

  it('地域（ピン）を選ぶと一覧はその地域だけに絞られ、先頭問題が開く（行と共通）', async () => {
    const user = userEvent.setup()
    const api = apiFixture()
    api.listQuests.mockImplementation(async (query?: { areaId?: string }) => query?.areaId === 'area-b' ? page([second]) : page([first, second]))
    render(<ApiQuestApp api={api} authClient={signedOutAuth()} dataMode="durable-local" />)
    expect(await screen.findByRole('button', { name: '川辺の謎を開く' })).toBeVisible()
    expect(screen.getByRole('button', { name: '森の謎を開く' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: '地図の公開地域を選択' }))
    expect(await screen.findByRole('heading', { name: second.title })).toBeVisible()
    // 行と同じく、地域の選択はサーバーへ渡して一覧を絞る。
    expect(api.listQuests).toHaveBeenCalledWith({ areaId: 'area-b', limit: 100, cursor: undefined }, expect.anything())
    expect(screen.getByTestId('map-state')).toHaveAttribute('data-area', 'area-b')
    expect(screen.queryByRole('button', { name: '川辺の謎を開く' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '森の謎を開く' })).toBeVisible()
  })

  it('一覧の並びは問題番号の昇順（北から南）に統一する', async () => {
    const fukuoka: PublicQuest = { ...second, questId: 'quest-fukuoka', title: '福岡の謎', questNumber: '40-01' }
    const sapporo: PublicQuest = { ...first, questId: 'quest-sapporo', title: '札幌の謎', questNumber: '01-01' }
    const tokyo: PublicQuest = { ...first, questId: 'quest-tokyo', title: '東京の謎', questNumber: '13-01' }
    const api = apiFixture()
    api.listQuests.mockResolvedValue(page([fukuoka, sapporo, tokyo]))
    api.getQuest.mockImplementation(async (id: string) => [fukuoka, sapporo, tokyo].find((quest) => quest.questId === id)!)
    render(<ApiQuestApp api={api} authClient={signedOutAuth()} />)
    const list = await screen.findByRole('list', { name: '問題一覧' })
    const labels = within(list).getAllByRole('button').map((button) => button.getAttribute('aria-label'))
    expect(labels).toEqual(['札幌の謎を開く', '東京の謎を開く', '福岡の謎を開く'])
  })

  it('履歴の復元では、復元された地域と両立する絞り込みを保持し、両立しない時だけ外す', async () => {
    const user = userEvent.setup()
    const hiroshimaQuest: PublicQuest = { questId: 'quest-hiroshima', version: 1, title: '広島のもみじを探せ', clue: '手がかり', areaId: 'area-hiroshima', visitConditions: '訪問条件', hintCount: 0, questNumber: '34-01' }
    const tokyoQuest: PublicQuest = { questId: 'quest-tokyo', version: 1, title: '東京の鯉を探せ', clue: '手がかり', areaId: 'area-tokyo', visitConditions: '訪問条件', hintCount: 0, questNumber: '13-01' }
    const regionAreas: PublicArea[] = [
      { areaId: 'area-hiroshima', label: '広島', prefectureCode: '34', publicGeometry: { type: 'Polygon', coordinates: [] }, marker: { latitude: 34.39, longitude: 132.45 }, publishedCount: 1 },
      { areaId: 'area-tokyo', label: '東京', prefectureCode: '13', publicGeometry: { type: 'Polygon', coordinates: [] }, marker: { latitude: 35.68, longitude: 139.76 }, publishedCount: 1 },
    ]
    const api = apiFixture()
    api.listAreas.mockResolvedValue(page(regionAreas))
    api.listQuests.mockImplementation(async (query?: { areaId?: string }) => query?.areaId === 'area-hiroshima' ? page([hiroshimaQuest])
      : query?.areaId === 'area-tokyo' ? page([tokyoQuest]) : page([hiroshimaQuest, tokyoQuest]))
    api.getQuest.mockImplementation(async (id: string) => id === hiroshimaQuest.questId ? hiroshimaQuest : tokyoQuest)
    render(<ApiQuestApp api={api} authClient={signedOutAuth()} />)
    expect(await screen.findByRole('button', { name: '広島のもみじを探せを開く' })).toBeVisible()
    await clickPrefecture(user, '中国', '広島県')
    await user.click(screen.getByRole('button', { name: '広島のもみじを探せを開く' }))
    // 行選択も所属地域を選択し、URLへ地域を含める。
    await screen.findByRole('heading', { name: hiroshimaQuest.title })
    expect(screen.getByTestId('map-state')).toHaveAttribute('data-area', 'area-hiroshima')
    expect(new URLSearchParams(window.location.search).get('quest')).toBe('quest-hiroshima')
    expect(new URLSearchParams(window.location.search).get('area') ?? '').toBe('area-hiroshima')

    // 同じ選択への履歴復元では、絞り込みはそのまま残る。
    act(() => { window.dispatchEvent(new PopStateEvent('popstate')) })
    expect(screen.getByRole('button', { name: '広島県' })).toBeVisible()

    // 絞り込みの外の地域が復元されたら、両立しないため絞り込みだけが外れる。
    window.history.pushState(null, '', '/?area=area-tokyo&quest=quest-tokyo')
    act(() => { window.dispatchEvent(new PopStateEvent('popstate')) })
    expect(await screen.findByRole('heading', { name: tokyoQuest.title })).toBeVisible()
    expect(screen.getByRole('button', { name: '場所で絞る' })).toBeVisible()
    expect(screen.queryByRole('button', { name: '広島県' })).not.toBeInTheDocument()
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

  it('問題だけのディープリンクでは所属地域へ選択を追随させず、一覧も絞らない（D-65）', async () => {
    window.history.replaceState(null, '', '/?quest=quest-b#map')
    const api = apiFixture()
    api.listQuests.mockImplementation(async (query?: { areaId?: string }) => query?.areaId === 'area-b' ? page([second]) : page([first, second]))
    const before = window.history.length
    render(<ApiQuestApp api={api} syncUrl />)
    expect(await screen.findByRole('heading', { name: second.title })).toBeVisible()
    // 地域は選択状態にならず、地図側にも地域選択は渡らない。URL に地域も足さない。
    expect(screen.getByTestId('map-state')).toHaveAttribute('data-area', '')
    expect(api.listQuests).not.toHaveBeenCalledWith({ areaId: 'area-b', limit: 100, cursor: undefined }, expect.anything())
    expect(api.listQuests).toHaveBeenCalledWith({ limit: 100, cursor: undefined }, expect.anything())
    expect(window.location.search).toBe('?quest=quest-b')
    expect(window.location.hash).toBe('#map')
    expect(window.history.length).toBe(before)
  })

  it('フォールバックのピッカーで問題を選ぶと所属地域を選択し、初期表示（未選択）では自動選択もしない', async () => {
    const user = userEvent.setup()
    const api = apiFixture()
    api.listQuests.mockImplementation(async (query?: { areaId?: string }) => query?.areaId === 'area-b' ? page([second])
      : query?.areaId === 'area-a' ? page([first]) : page([first, second]))
    render(<ApiQuestApp api={api} authClient={signedOutAuth()} dataMode="durable-local" />)
    // 初期表示では問題は自動で選ばれず、詳細も無い（D-56）。
    expect(await screen.findByRole('button', { name: '川辺の謎を開く' })).toBeVisible()
    expect(screen.queryByRole('heading', { name: first.title })).not.toBeInTheDocument()
    expect(api.getQuest).not.toHaveBeenCalled()
    expect(screen.getByTestId('map-state')).toHaveAttribute('data-area', '')
    await user.click(screen.getByRole('button', { name: '森の謎を開く' }))
    expect(await screen.findByRole('heading', { name: second.title })).toBeVisible()
    expect(screen.getByTestId('map-state')).toHaveAttribute('data-area', 'area-b')
    expect(api.listQuests).toHaveBeenCalledWith({ areaId: 'area-b', limit: 100, cursor: undefined }, expect.anything())
    expect(screen.queryByRole('button', { name: '川辺の謎を開く' })).not.toBeInTheDocument()
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
    await user.click(await screen.findByRole('button', { name: '一覧表示用タイトルを開く' }))
    await user.click(await screen.findByRole('button', { name: '問題を見る' }))
    await user.click(screen.getByRole('button', { name: 'ヒント画像' }))
    const oldImage = await waitFor(() => {
      const image = document.querySelector<HTMLImageElement>('.optional-hint-image')
      expect(image).not.toBeNull()
      return image!
    })
    expect(screen.getByRole('button', { name: 'Googleでログイン' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'ヒントを見る' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('問題更新')
    expect(oldImage).not.toBeInTheDocument()
    fireEvent.load(oldImage)
    expect(document.querySelector('.optional-hint-image')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '2' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Googleでログイン' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: '問題を見る' }))
    await user.click(screen.getByRole('button', { name: '問題を見る' }))
    expect(screen.queryByRole('button', { name: 'ヒントを見る' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'ヒント画像' })).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('問題更新')
    await user.click(screen.getByRole('button', { name: '問題を再読込' }))
    await waitFor(() => expect(api.getQuest).toHaveBeenCalledTimes(2))
    await user.click(screen.getByRole('button', { name: '問題を見る' }))
    expect(screen.getByRole('button', { name: 'Googleでログイン' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'ヒントを見る' }))
    expect(await screen.findByText('最新版ヒント')).toBeVisible()
  })

  it('地域・問題操作を履歴に積み、戻る・進むを選択へ反映する', async () => {
    window.history.replaceState(null, '', '/?keep=yes&view=list#top')
    const user = userEvent.setup()
    const api = apiFixture()
    api.listQuests.mockImplementation(async (query?: { areaId?: string }) => query?.areaId === 'area-a' ? page([first])
      : query?.areaId === 'area-b' ? page([second]) : page([first, second]))
    render(<ApiQuestApp api={api} syncUrl />)
    await screen.findByRole('button', { name: '川辺の謎を開く' })
    await user.click(screen.getByRole('button', { name: '地図の公開地域を選択' }))
    await screen.findByRole('heading', { name: second.title })
    expect(window.location.search).toBe('?keep=yes&view=list&area=area-b&quest=quest-b')
    await clickPrefecture(user, '関東', '東京都')
    expect(await screen.findByText('該当なし')).toBeVisible()
    expect(screen.getByText('森エリアのピン')).toBeVisible()
    // 絞り込みで選択が外れた後は未選択に戻り、先頭問題が自動で URL に付くことはない（D-56）。
    // 絞り込み自体は URL に残す。
    expect(window.location.search).toBe('?keep=yes&view=list&prefs=%E6%9D%B1%E4%BA%AC%E9%83%BD')

    await act(async () => {
      await new Promise<void>((resolve) => {
        window.addEventListener('popstate', () => resolve(), { once: true })
        window.history.back()
      })
    })
    expect(await screen.findByRole('heading', { name: second.title })).toBeVisible()
    expect(new URLSearchParams(window.location.search).get('area') ?? '').toBe('area-b')
    expect(screen.queryByRole('button', { name: '全国' })).not.toBeInTheDocument()
    await openFilterPanel(user)
    await expandRegion(user, '関東')
    await openFilterPanel(user)
    expect(within(screen.getByRole('group', { name: '関東の都道府県' })).getByRole('button', { name: '東京都' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByText('森エリアのピン')).toBeVisible()
    await act(async () => {
      await new Promise<void>((resolve) => {
        window.addEventListener('popstate', () => resolve(), { once: true })
        window.history.forward()
      })
    })
    // 進む先は「絞り込みで選択が外れた」履歴。area/quest は無く、絞り込みは URL に残る。
    expect(screen.queryByRole('heading', { name: first.title })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: second.title })).not.toBeInTheDocument()
    expect(new URLSearchParams(window.location.search).get('area') ?? '').toBe('')
    expect(new URLSearchParams(window.location.search).get('prefs')).toBe('東京都')
    expect(document.querySelector('.filter-toggle')).toHaveTextContent('東京都')
    expect(window.location.hash).toBe('#top')
  })

  it('0件の地域ではURLから問題IDを除く', async () => {
    window.history.replaceState(null, '', '/?source=link&area=area-b&quest=gone#map')
    const api = apiFixture()
    api.listQuests.mockImplementation(async (query?: { areaId?: string }) => query?.areaId === 'area-b' ? page([]) : page([first]))
    const before = window.history.length
    render(<ApiQuestApp api={api} syncUrl />)
    expect(await screen.findByRole('heading', { name: '問題なし' })).toBeVisible()
    expect(window.location.search).toBe('?source=link&area=area-b')
    expect(window.history.length).toBe(before)
    const user = userEvent.setup()
    await clickPrefecture(user, '関東', '東京都')
    expect(await screen.findByText('該当なし')).toBeVisible()
    await clearPlaceFilter(user)
    // 絞り込みを外しても自動では選ばれない（D-56）。一覧だけが全件に戻る。
    expect(await screen.findByRole('button', { name: '川辺の謎を開く' })).toBeVisible()
    expect(screen.queryByRole('heading', { name: first.title })).not.toBeInTheDocument()
    expect(window.location.search).toBe('?source=link')
  })

  it('一覧に存在しないURL問題を実在する先頭問題へ置換する', async () => {
    window.history.replaceState(null, '', '/?campaign=spring&area=area-b&quest=gone#map')
    const api = apiFixture()
    api.listQuests.mockImplementation(async (query?: { areaId?: string }) => query?.areaId === 'area-b' ? page([second]) : page([first, second]))
    const before = window.history.length
    render(<ApiQuestApp api={api} syncUrl />)
    expect(await screen.findByRole('heading', { name: second.title })).toBeVisible()
    await waitFor(() => expect(window.location.search).toBe('?campaign=spring&area=area-b&quest=quest-b'))
    expect(screen.getByRole('button', { name: '森の謎を開く' })).toHaveAttribute('aria-pressed', 'true')
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
      // 詳細の段階は、問題が選ばれていなければ詳細取得自体が始まらないため、
      // ディープリンクで問題を指定して開く（初期表示の未選択化、D-56）。
      if (stage === 'detail') window.history.replaceState(null, '', '/?quest=quest-a')
      unmount = render(<ApiQuestApp api={api} />).unmount
      await act(async () => {})
      expect(oldSignal?.aborted).toBe(false)
      await act(async () => vi.advanceTimersByTimeAsync(10_000))
      expect(screen.getByRole('alert')).toHaveTextContent('通信失敗')
      expect(oldSignal?.aborted).toBe(true)
      expect(screen.queryByText('港に時を知らせるもの')).not.toBeInTheDocument()
      api.getQuest.mockResolvedValue({ ...first, title: '再試行後の問題' })
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: '再試行' })) })
      if (stage !== 'detail') {
        // 未選択で開いた場合は再試行後も未選択のままなので、一覧から選び直す（D-56）。
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: '一覧表示用タイトルを開く' })) })
      }
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
      // 初期表示は未選択（D-56）：一覧は出るが、詳細の見出しは出ない。
      expect(screen.getByRole('button', { name: '一覧表示用タイトルを開く' })).toBeVisible()
      expect(screen.queryByRole('heading', { name: first.title })).not.toBeInTheDocument()
      await act(async () => vi.advanceTimersByTimeAsync(10_000))
      expect(screen.getByRole('button', { name: '一覧表示用タイトルを開く' })).toBeVisible()
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

    await user.click(await screen.findByRole('button', { name: '一覧表示用タイトルを開く' }))
    expect(await screen.findByRole('heading', { name: '川辺の謎' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: '問題を見る' }))
    expect(screen.getByText('詳細版の手がかり')).toBeVisible()
    expect(screen.queryByText('川辺エリア')).not.toBeInTheDocument()
    expect(api.listQuests).toHaveBeenCalledWith({ limit: 100, cursor: undefined }, expect.objectContaining({ signal: expect.any(AbortSignal) }))
    expect(api.getQuest).toHaveBeenCalledWith('quest-a', expect.objectContaining({ signal: expect.any(AbortSignal) }))
    expect(api.listAreas).toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'デモの謎を地図から見る' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '地図の公開地域を選択' }))
    expect(await screen.findByRole('heading', { name: '森の謎' })).toBeVisible()
    expect(screen.queryByText('森エリア')).not.toBeInTheDocument()
  })

  it('地域選択をサーバーへ渡し、地域変更で問題を選び直す', async () => {
    const user = userEvent.setup()
    const api = apiFixture()
    api.listQuests.mockImplementation(async (query?: { areaId?: string }) => query?.areaId === 'area-a'
      ? page([first]) : query?.areaId === 'area-b' ? page([second]) : page([first, second]))
    render(<ApiQuestApp api={api} />)
    await user.click(await screen.findByRole('button', { name: '川辺の謎を開く' }))
    expect(await screen.findByRole('heading', { name: first.title })).toBeVisible()
    await user.click(screen.getByRole('button', { name: '地図の公開地域を選択' }))
    expect(await screen.findByRole('heading', { name: second.title })).toBeVisible()
    expect(api.listQuests).toHaveBeenCalledWith({ areaId: 'area-b', limit: 100, cursor: undefined }, expect.anything())
    await user.click(screen.getByRole('button', { name: '地図の川辺エリアを選択' }))
    expect(await screen.findByRole('heading', { name: first.title })).toBeVisible()
  })

  it('地図の地域切替後に前の問題とヒントを破棄する', async () => {
    const user = userEvent.setup()
    const hinted = { ...first, hintCount: 1, hintImages: ['/region-a-hint', null, null] }
    const api = apiFixture()
    api.listQuests.mockImplementation(async (query?: { areaId?: string }) => query?.areaId === 'area-b'
      ? page([]) : page([hinted, second]))
    api.getQuest.mockImplementation(async (id: string) => id === hinted.questId ? hinted : second)
    api.getHint.mockResolvedValue({ questId: hinted.questId, version: hinted.version, index: 1, text: 'REGION_A_HINT' })
    render(<ApiQuestApp api={api} />)

    await user.click(await screen.findByRole('button', { name: '川辺の謎を開く' }))
    await user.click(await screen.findByRole('button', { name: '問題を見る' }))
    await user.click(screen.getByRole('button', { name: 'ヒントを見る' }))
    expect(await screen.findByText('REGION_A_HINT')).toBeVisible()
    const oldImage = document.querySelector('img.optional-hint-image')!
    expect(oldImage).toHaveAttribute('src', '/region-a-hint')

    await user.click(screen.getByRole('button', { name: '地図の公開地域を選択' }))
    expect(new URLSearchParams(window.location.search).get('area') ?? '').toBe('area-b')
    expect(api.listQuests).toHaveBeenCalledWith({ areaId: 'area-b', limit: 100, cursor: undefined }, expect.anything())
    expect(await screen.findByRole('heading', { name: '問題なし' })).toBeVisible()
    expect(screen.queryByText('REGION_A_HINT')).not.toBeInTheDocument()
    expect(oldImage).not.toBeInTheDocument()
    fireEvent.error(oldImage)
    expect(document.querySelector('img.optional-hint-image')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: hinted.title })).not.toBeInTheDocument()
    await clickPrefecture(user, '関東', '東京都')
    expect(await screen.findByText('該当なし')).toBeVisible()
    await clearPlaceFilter(user)
    // 絞り込みを外しても自動では選ばれない（D-56）。一覧が全件に戻るだけ。
    await screen.findByRole('button', { name: '川辺の謎を開く' })
    expect(screen.queryByRole('heading', { name: hinted.title })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '地図の川辺エリアを選択' }))
    expect(await screen.findByRole('heading', { name: hinted.title })).toBeVisible()
    expect(new URLSearchParams(window.location.search).get('area') ?? '').toBe('area-a')
  })




  it('絞り込み外の薄いピンも選択し、場所フィルタを外して対象を一覧に戻す', async () => {
    const user = userEvent.setup()
    const api = apiFixture()
    api.listAreas.mockResolvedValue(page([{ ...areas[0], prefectureCode: '13' }, { ...areas[1], prefectureCode: '27' }]))
    api.listQuests.mockResolvedValue(page([first, second]))
    render(<ApiQuestApp api={api} dataMode="team-preview" />)
    await screen.findByRole('button', { name: '川辺の謎を開く' })
    expect(document.querySelector('.map-filter-selection')).not.toBeInTheDocument()
    expect(document.querySelector('.map-filter-count')).not.toBeInTheDocument()
    await clickPrefecture(user, '関東', '東京都')
    expect(screen.queryByRole('button', { name: '森の謎を開く' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '地図の公開地域を選択' }))
    expect(screen.getByRole('button', { name: '場所で絞る' })).toBeVisible()
    expect(screen.getByTestId('map-state')).toHaveAttribute('data-area', 'area-b')
    expect(await screen.findByRole('button', { name: '森の謎を開く' })).toBeVisible()
  })


  it('選択中の問題をもう一度選ぶと選択が解除され、全件表示に戻る（D-55）', async () => {
    const user = userEvent.setup()
    const api = apiFixture()
    api.listQuests.mockImplementation(async (query?: { areaId?: string }) => query?.areaId === 'area-b' ? page([second]) : page([first, second]))
    render(<ApiQuestApp api={api} />)
    await user.click(await screen.findByRole('button', { name: `${first.title}を開く` }))
    expect(await screen.findByRole('heading', { name: first.title })).toBeVisible()
    await user.click(screen.getByRole('button', { name: `${first.title}を開く` }))
    await user.click(await screen.findByRole('button', { name: `${second.title}を開く` }))
    expect(await screen.findByRole('heading', { name: second.title })).toBeVisible()
    expect(screen.getByTestId('map-state')).toHaveAttribute('data-area', 'area-b')
    // 選択中の問題をもう一度選ぶと、ピンの再タップと同じく選択が外れる。
    await user.click(screen.getByRole('button', { name: `${second.title}を開く` }))
    // 解除後は未選択に戻り、先頭問題が自動で選ばれることもない（D-56）。
    await waitFor(() => expect(screen.queryByRole('heading', { name: second.title })).not.toBeInTheDocument())
    expect(screen.queryByRole('heading', { name: first.title })).not.toBeInTheDocument()
    expect(screen.getByTestId('map-state')).toHaveAttribute('data-area', '')
    expect(new URLSearchParams(window.location.search).get('quest') ?? '').toBe('')
    expect(screen.getByRole('button', { name: `${first.title}を開く` })).toHaveAttribute('aria-pressed', 'false')
  })

  it('地図のピンをもう一度押すと地域選択が解除され、全件表示に戻る', async () => {
    const user = userEvent.setup()
    const api = apiFixture()
    api.listQuests.mockImplementation(async (query?: { areaId?: string }) => query?.areaId === 'area-b' ? page([second]) : page([first, second]))
    render(<ApiQuestApp api={api} />)
    await screen.findByRole('button', { name: '川辺の謎を開く' })
    await user.click(screen.getByRole('button', { name: '地図の公開地域を選択' }))
    expect(await screen.findByRole('heading', { name: second.title })).toBeVisible()
    expect(screen.getByTestId('map-state')).toHaveAttribute('data-area', 'area-b')
    await user.click(screen.getByRole('button', { name: '地図の公開地域を選択' }))
    // 解除後は未選択に戻り、先頭問題が自動で選ばれることもない（D-56）。
    await waitFor(() => expect(screen.queryByRole('heading', { name: second.title })).not.toBeInTheDocument())
    expect(screen.queryByRole('heading', { name: first.title })).not.toBeInTheDocument()
    expect(screen.getByTestId('map-state')).toHaveAttribute('data-area', '')
  })

  it('絞り込みチップは「場所で絞る」の中だけに出て未分類チップは無く、未分類の地域の問題も未選択では全件に出る', async () => {
    const user = userEvent.setup()
    const api = apiFixture()
    render(<ApiQuestApp api={api} dataMode="team-preview" />)
    await screen.findByRole('button', { name: '一覧表示用タイトルを開く' })
    // 閉じている間はチップ自体を描画しない（D-48）。
    expect(screen.queryByRole('button', { name: (_l, el) => el.classList.contains('filter-accordion-row') && el.querySelector('.filter-accordion-name')?.textContent === '関東' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '全国' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '場所で絞る' }))
    // fixture の地域は都道府県コードを持たないが、全国では表示する。
    expect(screen.queryByRole('button', { name: '全国' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '未分類' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '一覧表示用タイトルを開く' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '森の謎を開く' })).toBeInTheDocument()
  })




  it('地域0件でも地方チップの再タップで全件へ戻れる', async () => {
    const user = userEvent.setup()
    const api = apiFixture()
    api.listQuests.mockImplementation(async (query?: { areaId?: string }) => query?.areaId ? page([]) : page([first, second]))
    render(<ApiQuestApp api={api} />)
    await screen.findByRole('button', { name: '川辺の謎を開く' })
    await user.click(screen.getByRole('button', { name: '地図の公開地域を選択' }))
    expect(await screen.findByRole('heading', { name: '問題なし' })).toBeVisible()
    expect(screen.queryByRole('button', { name: /を開く/ })).not.toBeInTheDocument()
    await clickPrefecture(user, '関東', '東京都')
    expect(await screen.findByText('該当なし')).toBeVisible()
    await clearPlaceFilter(user)
    // 絞り込みを外しても自動では選ばれない（D-56）。一覧だけが全件に戻る。
    expect(await screen.findByRole('button', { name: '川辺の謎を開く' })).toBeVisible()
    expect(screen.queryByRole('heading', { name: first.title })).not.toBeInTheDocument()
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
    // URLで問題を指定して開いたため、詳細は最初から開いている。
    expect(await screen.findByText('詳細版の手がかり')).toBeVisible()
    const refreshButton = screen.getByRole('button', { name: '更新する' })
    refreshButton.focus()
    await user.click(refreshButton)
    expect(await screen.findByRole('heading', { name: newer.title })).toBeVisible()
    expect(screen.getByRole('button', { name: '更新する' })).toHaveFocus()
    expect(screen.queryByText('詳細版の手がかり')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '問題を見る' }))
    expect(screen.getByText('新しい詳細本文')).toBeVisible()
    expect(screen.queryByText('新しい川辺エリア')).not.toBeInTheDocument()
    expect(new URLSearchParams(window.location.search).get('area') ?? '').toBe('area-a')
    expect(screen.getByRole('button', { name: '更新後の川辺の謎を開く' })).toHaveAttribute('aria-pressed', 'true')
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
    // URLで問題を指定して開いたため、詳細は最初から開いている。
    expect(await screen.findByText(initial.clue)).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'ヒントを見る' }))
    expect(await screen.findByText('公開版1のヒント')).toBeVisible()

    await user.click(screen.getByRole('button', { name: '更新する' }))
    expect(await screen.findByRole('heading', { name: '問題なし' })).toBeVisible()
    expect(screen.queryByText(initial.clue)).not.toBeInTheDocument()
    expect(screen.queryByText('公開版1のヒント')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '更新する' }))
    expect(await screen.findByRole('heading', { name: republished.title })).toBeVisible()
    expect(screen.queryByText('公開版1のヒント')).not.toBeInTheDocument()
    // 一覧の中の詳細は選択されている間は常に開いており、開閉ボタンは無い（D-65）。
    expect(screen.queryByRole('button', { name: '問題を見る' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '問題を見る' })).not.toBeInTheDocument()
    expect(await screen.findByText(republished.clue)).toBeVisible()
    expect(screen.queryByText(initial.clue)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'ヒントを見る' }))
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
    window.history.replaceState(null, '', '/?area=area-a&quest=quest-a')
    render(<ApiQuestApp api={api} />)
    await screen.findByRole('heading', { name: first.title })
    await user.click(screen.getByRole('button', { name: '更新する' }))
    await waitFor(() => expect(resolveRefresh).toBeDefined())
    const refreshing = screen.getByRole('button', { name: '更新中' })
    expect(refreshing).toBeDisabled()
    fireEvent.click(refreshing)
    expect(api.listQuests).toHaveBeenCalledTimes(2)
    await act(async () => resolveRefresh(page([])))
    expect(await screen.findByRole('heading', { name: '問題なし' })).toBeVisible()
    expect(api.listQuests).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('button', { name: /を開く/ })).not.toBeInTheDocument()
  })

  it('更新で選択中の問題が消えたら、代替詳細の取得完了後に通知する', async () => {
    const user = userEvent.setup()
    const api = apiFixture()
    let resolveFallback!: (value: PublicQuest) => void
    // 初期一覧・地域選択の取得後、更新で同地域の代替問題へ切り替える。
    const replacement = { ...second, questId: 'quest-c', areaId: first.areaId }
    let listCalls = 0
    api.listQuests.mockImplementation(async () => { listCalls += 1; return page(listCalls <= 2 ? [first, second] : [replacement]) })
    api.getQuest.mockResolvedValueOnce(first).mockImplementationOnce(() => new Promise((resolve) => { resolveFallback = resolve }))
    render(<ApiQuestApp api={api} />)
    await user.click(await screen.findByRole('button', { name: '川辺の謎を開く' }))
    expect(await screen.findByRole('heading', { name: first.title })).toBeVisible()
    await user.click(screen.getByRole('button', { name: '更新する' }))
    await waitFor(() => expect(resolveFallback).toBeDefined())
    expect(screen.getByRole('button', { name: '更新中' })).toBeDisabled()
    expect(screen.getByText('地域・問題一覧・選択中の詳細を取り直しています。')).toBeVisible()
    expect(screen.queryByText(/公開一覧からなくなった/)).not.toBeInTheDocument()
    await act(async () => resolveFallback(replacement))
    expect(await screen.findByText(/選択問題変更/)).toBeVisible()
    expect(screen.getByRole('heading', { name: second.title })).toBeVisible()
  })

  it('初期表示（未選択）では詳細を取得せず、更新通知も出さない', async () => {
    const user = userEvent.setup()
    const api = apiFixture()
    render(<ApiQuestApp api={api} />)
    expect(await screen.findByRole('button', { name: '一覧表示用タイトルを開く' })).toBeVisible()
    // パラメータなしの初期表示では、先頭問題を自動で選ばない（D-56）。
    expect(api.getQuest).not.toHaveBeenCalled()
    expect(screen.queryByRole('heading', { name: first.title })).not.toBeInTheDocument()
    expect(new URLSearchParams(window.location.search).get('quest') ?? '').toBe('')
    expect(screen.queryByText(/問題更新|公開一覧からなくなった/)).not.toBeInTheDocument()
    // 未選択のまま手動更新しても、表示中だった問題が無いため通知は出ない。
    await user.click(screen.getByRole('button', { name: '更新する' }))
    await waitFor(() => expect(api.listQuests).toHaveBeenCalledTimes(2))
    expect(api.getQuest).not.toHaveBeenCalled()
    expect(screen.queryByText(/問題更新|公開一覧からなくなった/)).not.toBeInTheDocument()
  })

  it('再試行を始めると前回の更新通知を消し、失敗時にも成功通知を残さない', async () => {
    const user = userEvent.setup()
    const api = apiFixture()
    const newer = { ...first, version: first.version + 1 }
    api.listQuests.mockResolvedValueOnce(page([first])).mockResolvedValueOnce(page([newer])).mockRejectedValueOnce(new Error('offline'))
    api.getQuest.mockResolvedValueOnce(first).mockResolvedValueOnce(newer)
    window.history.replaceState(null, '', '/?area=area-a&quest=quest-a')
    render(<ApiQuestApp api={api} />)
    expect(await screen.findByRole('heading', { name: first.title })).toBeVisible()
    await user.click(screen.getByRole('button', { name: '更新する' }))
    expect(await screen.findByText('問題更新')).toBeVisible()
    await user.click(screen.getByRole('button', { name: '更新する' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('通信失敗')
    expect(screen.queryByText(/問題更新/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '再試行' }))
    expect(await screen.findByRole('heading', { name: newer.title })).toBeVisible()
    expect(screen.queryByText(/問題更新/)).not.toBeInTheDocument()
  })

  it('手動で問題を選ぶと更新通知を消す', async () => {
    const user = userEvent.setup()
    const api = apiFixture()
    const newer = { ...first, version: first.version + 1 }
    api.listQuests.mockResolvedValueOnce(page([first, second])).mockResolvedValueOnce(page([newer, second]))
    api.getQuest.mockResolvedValueOnce(first).mockResolvedValueOnce(newer).mockResolvedValueOnce(second)
    render(<ApiQuestApp api={api} />)
    await user.click(await screen.findByRole('button', { name: '川辺の謎を開く' }))
    expect(await screen.findByRole('heading', { name: first.title })).toBeVisible()
    await user.click(screen.getByRole('button', { name: '更新する' }))
    expect(await screen.findByText('問題更新')).toBeVisible()
    await user.click(screen.getByRole('button', { name: '地図の公開地域を選択' }))
    expect(screen.queryByText(/問題更新/)).not.toBeInTheDocument()
  })

  it('手動更新失敗後は再試行できる', async () => {
    const user = userEvent.setup()
    const api = apiFixture()
    api.listAreas.mockResolvedValueOnce(page(areas)).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(page(areas))
    render(<ApiQuestApp api={api} />)
    await user.click(await screen.findByRole('button', { name: '一覧表示用タイトルを開く' }))
    await screen.findByRole('heading', { name: first.title })
    await user.click(screen.getByRole('button', { name: '更新する' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('通信失敗')
    const retryButton = screen.getByRole('button', { name: '再試行' })
    retryButton.focus()
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('heading', { name: first.title })).toBeVisible()
    expect(screen.getByRole('button', { name: '更新する' })).toHaveFocus()
  })

  it('手動更新のtimeout後に、signalを無視する旧応答を待たず再試行できる', async () => {
    vi.useFakeTimers()
    const api = apiFixture()
    let resolveOld!: (value: ReturnType<typeof page<PublicArea>>) => void
    api.listAreas.mockResolvedValueOnce(page(areas)).mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve }))
    try {
      render(<ApiQuestApp api={api} />)
      await act(async () => {})
      // 初期表示は未選択のため、一覧から選んで詳細を表示しておく（D-56）。
      fireEvent.click(screen.getByRole('button', { name: '一覧表示用タイトルを開く' }))
      await act(async () => {})
      expect(screen.getByRole('heading', { name: first.title })).toBeVisible()
      fireEvent.click(screen.getByRole('button', { name: '更新する' }))
      await act(async () => {})
      await act(async () => vi.advanceTimersByTimeAsync(10_000))
      expect(screen.getByRole('alert')).toHaveTextContent('通信失敗')
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
    render(<ApiQuestApp api={api} dataMode="team-preview" />)
    await screen.findByRole('button', { name: '川辺の謎を開く' })
    await user.click(screen.getByRole('button', { name: '地図の川辺エリアを選択' }))
    await waitFor(() => expect(resolveOld).toBeDefined())
    expect(screen.queryByRole('heading', { name: first.title })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '地図の公開地域を選択' }))
    await screen.findByRole('heading', { name: second.title })
    await act(async () => resolveOld(page([first])))
    expect(new URLSearchParams(window.location.search).get('area') ?? '').toBe('area-b')
    expect(screen.getByRole('heading', { name: second.title })).toBeVisible()
    expect(screen.queryByRole('heading', { name: first.title })).not.toBeInTheDocument()
  })

  it('地域の0件を再試行すると一覧を取り直して新しい問題を表示する', async () => {
    const user = userEvent.setup()
    const api = apiFixture()
    api.listQuests.mockResolvedValueOnce(page([first])).mockResolvedValueOnce(page([])).mockResolvedValueOnce(page([second]))
    render(<ApiQuestApp api={api} />)
    await screen.findByRole('button', { name: '川辺の謎を開く' })
    await user.click(screen.getByRole('button', { name: '地図の公開地域を選択' }))
    await screen.findByRole('heading', { name: '問題なし' })
    await user.click(screen.getByRole('button', { name: '再試行' }))
    expect(await screen.findByRole('heading', { name: second.title })).toBeVisible()
    expect(api.listQuests).toHaveBeenCalledTimes(3)
  })

  it('詳細の地域が選択地域と一致しなければ表示しない', async () => {
    const user = userEvent.setup()
    const api = apiFixture()
    api.listQuests.mockResolvedValue(page([first]))
    render(<ApiQuestApp api={api} />)
    await screen.findByRole('button', { name: '川辺の謎を開く' })
    await user.click(screen.getByRole('button', { name: '地図の公開地域を選択' }))
    await screen.findByRole('alert')
    expect(screen.queryByRole('heading', { name: first.title })).not.toBeInTheDocument()
  })

  it('空の一覧は成功した0件として表示する', async () => {
    const api = apiFixture()
    api.listQuests.mockResolvedValue(page([]))
    render(<ApiQuestApp api={api} />)
    expect(await screen.findByRole('heading', { name: '問題なし' })).toBeVisible()
    expect(api.getQuest).not.toHaveBeenCalled()
  })

  it('取得失敗をデモで置き換えず、再試行でAPIへ再接続する', async () => {
    const user = userEvent.setup()
    const api = apiFixture()
    api.listQuests.mockRejectedValueOnce(new Error('network failed'))
    render(<ApiQuestApp api={api} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('通信失敗')
    expect(screen.queryByText('川辺の謎')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '再試行' }))
    // 再試行で一覧は戻るが、未選択のままでは詳細は開かない（D-56）。
    await user.click(await screen.findByRole('button', { name: '一覧表示用タイトルを開く' }))
    expect(await screen.findByRole('heading', { name: '川辺の謎' })).toBeVisible()
  })

  it('詳細切替時に遅れて返る旧応答を表示しない', async () => {
    const user = userEvent.setup()
    const api = apiFixture()
    const sameAreaSecond = { ...second, areaId: first.areaId }
    api.listQuests.mockResolvedValue(page([{ ...first, title: '一覧表示用タイトル' }, sameAreaSecond]))
    api.getQuest.mockImplementation(async (id: string) => id === first.questId ? first : sameAreaSecond)
    let resolveOld!: (value: PublicQuest) => void
    api.getQuest.mockImplementation((id: string) => {
      if (id === first.questId) return new Promise((resolve) => { resolveOld = resolve })
      return Promise.resolve(sameAreaSecond)
    })
    render(<ApiQuestApp api={api} />)
    // 初期表示は未選択（D-56）のため、まず先頭問題を選んで詳細取得を始める。
    await user.click(await screen.findByRole('button', { name: '一覧表示用タイトルを開く' }))
    await user.click(screen.getByRole('button', { name: '森の謎を開く' }))
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
    await user.click(await screen.findByRole('button', { name: '一覧表示用タイトルを開く' }))
    await screen.findByRole('heading', { name: first.title })
    await user.click(screen.getByRole('button', { name: '地図の公開地域を選択' }))
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
    await screen.findByRole('button', { name: '川辺の謎を開く' })
    await user.click(screen.getByRole('button', { name: '地図の公開地域を選択' }))
    await screen.findByRole('heading', { name: second.title })

    rerender(<ApiQuestApp api={nextApi} />)
    expect(await screen.findByRole('heading', { name: second.title })).toBeVisible()
    expect(screen.getByTestId('map-state')).toHaveAttribute('data-area', 'area-b')
    expect(nextApi.listQuests).toHaveBeenCalledWith({ areaId: 'area-b', limit: 100, cursor: undefined }, expect.anything())
  })

  it('詳細404を0件や固定デモにせず、別の問題へ切り替えられる', async () => {
    const user = userEvent.setup()
    const api = apiFixture()
    const sameAreaSecond = { ...second, areaId: first.areaId }
    api.listQuests.mockResolvedValue(page([{ ...first, title: '一覧表示用タイトル' }, sameAreaSecond]))
    api.getQuest.mockImplementation(async (id: string) => id === first.questId ? first : sameAreaSecond)
    api.getQuest.mockRejectedValueOnce(new ApiError('NOT_FOUND', { status: 404 }))
    render(<ApiQuestApp api={api} />)
    // 未選択では詳細を取得しないため、一覧から選んで初めて404になる（D-56）。
    await user.click(await screen.findByRole('button', { name: '一覧表示用タイトルを開く' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('この問題は見つかりません')
    expect(screen.queryByText('港に時を知らせるもの')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '森の謎を開く' }))
    expect(await screen.findByRole('heading', { name: second.title })).toBeVisible()
  })

  it('再試行で選択中の問題が一覧から消えたら先頭の詳細と一覧の選択を一致させる', async () => {
    const user = userEvent.setup()
    const api = apiFixture()
    api.getQuest.mockImplementation(async (id: string) => {
      if (id === second.questId) throw new ApiError('NOT_FOUND', { status: 404 })
      return first
    })
    render(<ApiQuestApp api={api} />)
    await user.click(await screen.findByRole('button', { name: '一覧表示用タイトルを開く' }))
    await screen.findByRole('heading', { name: first.title })
    await user.click(screen.getByRole('button', { name: '地図の公開地域を選択' }))
    await screen.findByRole('alert')
    expect(screen.getByRole('button', { name: '森の謎を開く' })).toHaveAttribute('aria-pressed', 'true')

    // 再試行で、選択中の地域にある別の問題を先頭にする。
    const replacement = { ...second, questId: 'quest-c', title: '森の新しい謎' }
    api.listQuests.mockResolvedValue(page([replacement]))
    api.getQuest.mockImplementation(async (id: string) => id === replacement.questId ? replacement : first)
    await user.click(screen.getByRole('button', { name: '再試行' }))
    expect(await screen.findByRole('heading', { name: replacement.title })).toBeVisible()
    await waitFor(() => expect(screen.getByRole('button', { name: '森の新しい謎を開く' })).toHaveAttribute('aria-pressed', 'true'))
  })

  it('詳細や地域取得に失敗した場合も再試行できる', async () => {
    const user = userEvent.setup()
    const api = apiFixture()
    api.listAreas.mockRejectedValueOnce(new Error('network'))
    render(<ApiQuestApp api={api} />)
    await screen.findByRole('alert')
    await user.click(screen.getByRole('button', { name: '再試行' }))
    // 再試行後は未選択に戻るため、一覧から選ぶと詳細が開く（D-56）。
    await user.click(await screen.findByRole('button', { name: '一覧表示用タイトルを開く' }))
    expect(await screen.findByRole('heading', { name: first.title })).toBeVisible()
    expect(api.getQuest).toHaveBeenCalledTimes(1)
  })

  it('StrictModeの再実行でも初期取得が完了する', async () => {
    render(<StrictMode><ApiQuestApp api={apiFixture()} /></StrictMode>)
    expect(await screen.findByRole('button', { name: '一覧表示用タイトルを開く' })).toBeVisible()
  })

  it('一覧と地域の後続ページを読み、循環するcursorは停止する', async () => {
    const api = apiFixture()
    api.listQuests.mockResolvedValueOnce({ items: [], nextCursor: 'next' }).mockResolvedValueOnce(page([second]))
    api.listAreas.mockResolvedValueOnce({ items: [areas[0]], nextCursor: 'area-next' }).mockResolvedValueOnce(page([areas[1]]))
    const { unmount } = render(<ApiQuestApp api={api} />)
    fireEvent.click(await screen.findByRole('button', { name: '森の謎を開く' }))
    expect(await screen.findByRole('heading', { name: second.title })).toBeVisible()
    expect(screen.queryByText('森エリア')).not.toBeInTheDocument()
    expect(api.listQuests).toHaveBeenCalledWith({ limit: 100, cursor: 'next' }, expect.anything())
    unmount()
    const cyclic = apiFixture()
    cyclic.listQuests.mockResolvedValue({ items: [], nextCursor: 'same' })
    render(<ApiQuestApp api={cyclic} />)
    await screen.findByRole('alert')
    expect(cyclic.listQuests).toHaveBeenCalledTimes(2)
  })
})



it('hands the selected durable quest B and its version through login to challenge camera', async () => {
  const user = userEvent.setup()
  let snapshot: AuthSnapshot = { status: 'signed-out', user: null }
  const listeners = new Set<() => void>()
  const auth: AuthClient = {
    getSnapshot: () => snapshot,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    signInWithGoogle: vi.fn(async () => {
      snapshot = { status: 'signed-in', user: { uid: 'durable-traveler', displayName: null } }
      listeners.forEach((listener) => listener())
    }),
    signOut: async () => {}, getIdToken: async () => 'traveler-token',
  }
  const stop = vi.fn()
  const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream
  const getUserMedia = vi.fn(async () => stream)
  vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { mediaDevices: { getUserMedia } }))
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
  const fetcher = vi.fn<typeof fetch>(async (input) => {
    const path = String(input)
    let body: unknown
    if (path.startsWith('/api/v1/areas?')) body = page(areas.map((item) => ({ ...item, publicGeometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } })))
    else if (path.startsWith('/api/v1/quests?')) body = page([first, second])
    else if (path === '/api/v1/quests/' + first.questId) body = first
    else if (path === '/api/v1/quests/' + second.questId) body = second
    else if (path === '/api/v1/session') body = { uid: 'durable-traveler' }
    else if (path === '/api/v1/challenges') body = {
      challengeId: 'durable-challenge', questId: second.questId, version: second.version, createdAt: '2026-11-06T00:00:00Z',
    }
    else if (path.startsWith('/api/v1/me/discoveries?')) body = page([])
    else throw new Error('Unexpected traveler request: ' + path)
    return new Response(JSON.stringify(body), { status: path === '/api/v1/challenges' ? 201 : 200, headers: {
      'Content-Type': 'application/json', 'X-Quest-Data-Mode': 'durable-local',
    } })
  })
  vi.stubGlobal('fetch', fetcher)
  render(<ApiQuestApp authClient={auth} dataMode="durable-local" />)
  expect(await screen.findByRole('button', { name: `${second.title}を開く` })).toBeVisible()
  await user.click(screen.getByRole('button', { name: `${second.title}を開く` }))
  expect(await screen.findByRole('heading', { name: second.title })).toBeVisible()
  expect(getUserMedia).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Googleでログイン' }))
  expect(auth.signInWithGoogle).toHaveBeenCalledOnce()
  await waitFor(() => expect(screen.getByLabelText('カメラ映像')).toHaveProperty('srcObject', stream))
  expect(screen.queryByText(/挑戦を開始しました/)).not.toBeInTheDocument()
  const start = fetcher.mock.calls.find(([path]) => path === '/api/v1/challenges')!
  expect(JSON.parse(String(start[1]?.body))).toEqual({ questId: second.questId, expectedVersion: second.version })
  expect(new Headers(start[1]?.headers).get('Authorization')).toBe('Bearer traveler-token')
  expect(fetcher.mock.calls.findIndex(([path]) => path === '/api/v1/session')).toBeLessThan(fetcher.mock.calls.indexOf(start))
  await user.click(screen.getByRole('button', { name: '撮影を終了' }))
  expect(stop).toHaveBeenCalledOnce()
  await user.click(within(screen.getByRole('navigation', { name: '主要ナビゲーション' })).getByRole('button', { name: '自分の記録' }))
  expect(await screen.findByText('記録はまだない')).toBeVisible()
  const recordRead = fetcher.mock.calls.find(([path]) => String(path).startsWith('/api/v1/me/discoveries?'))!
  expect(new Headers(recordRead[1]?.headers).get('Authorization')).toBe('Bearer traveler-token')
})

it('opens a durable quest directly from its public card with a region list fallback', async () => {
  const api = apiFixture()
  render(<ApiQuestApp api={api} authClient={signedOutAuth()} dataMode="durable-local" />)
  fireEvent.click(await screen.findByRole('button', { name: '森の謎を開く' }))
  expect(await screen.findByRole('region', { name: '問題の詳細' })).toBeVisible()
  expect(api.getQuest).toHaveBeenLastCalledWith(second.questId, expect.anything())
  // フォールバック表示でも絞り込みは「場所で絞る」から辿れる（D-48）。
  expect(screen.getByRole('button', { name: '場所で絞る' })).toBeVisible()
})


it('restores the records view from ?view=records on reload and keeps back/forward in sync', async () => {
  // Cloud Run の静的配信は深いパスを HTML に落とさないため、記録タブは ?view=records で持つ（t165u）。
  window.history.replaceState(null, '', '/?view=records')
  const user = userEvent.setup()
  const api = apiFixture()
  render(<ApiQuestApp api={api} syncUrl dataMode="durable-local" authClient={signedOutAuth()} />)
  expect(await screen.findByRole('heading', { name: '自分の記録' })).toBeVisible()
  expect(new URLSearchParams(window.location.search).get('view')).toBe('records')
  const nav = () => within(screen.getByRole('navigation', { name: '主要ナビゲーション' }))
  await user.click(nav().getByRole('button', { name: '謎を探す' }))
  await waitFor(() => expect(new URLSearchParams(window.location.search).get('view')).toBeNull())
  await waitFor(() => expect(screen.queryByRole('heading', { name: '自分の記録' })).toBeNull())
  await user.click(nav().getByRole('button', { name: '自分の記録' }))
  expect(await screen.findByRole('heading', { name: '自分の記録' })).toBeVisible()
  expect(new URLSearchParams(window.location.search).get('view')).toBe('records')
  await act(async () => { window.history.back() })
  await waitFor(() => expect(new URLSearchParams(window.location.search).get('view')).toBeNull())
  await waitFor(() => expect(screen.queryByRole('heading', { name: '自分の記録' })).toBeNull())
  await act(async () => { window.history.forward() })
  expect(await screen.findByRole('heading', { name: '自分の記録' })).toBeVisible()
  expect(new URLSearchParams(window.location.search).get('view')).toBe('records')
})

describe('ディープリンク', () => {
  it('URLで問題を指定して開くと、その問題の詳細が最初から開いている', async () => {
    window.history.replaceState(null, '', '/?area=area-a&quest=quest-a')
    const api = apiFixture()
    render(<ApiQuestApp api={api} />)
    expect(await screen.findByRole('heading', { name: first.title })).toBeVisible()
    expect(await screen.findByText('詳細版の手がかり')).toBeVisible()
    expect(screen.getByRole('button', { name: '問題を見る' })).toBeVisible()
  })

  it('URL指定がなければ何も選択されず、詳細も開かれない', async () => {
    const user = userEvent.setup()
    const api = apiFixture()
    render(<ApiQuestApp api={api} />)
    expect(await screen.findByRole('button', { name: '一覧表示用タイトルを開く' })).toBeVisible()
    // 一覧は全件出るが、先頭問題は自動で選ばれず、URLにも ?quest= は付かない（D-56）。
    expect(screen.queryByRole('heading', { name: first.title })).not.toBeInTheDocument()
    expect(api.getQuest).not.toHaveBeenCalled()
    expect(new URLSearchParams(window.location.search).get('quest') ?? '').toBe('')
    // 一覧から選ぶと詳細は閉じた状態で表示される（ディープリンク到着時だけ最初から開く）。
    await user.click(screen.getByRole('button', { name: '一覧表示用タイトルを開く' }))
    expect(await screen.findByRole('heading', { name: first.title })).toBeVisible()
    expect(screen.getByRole('button', { name: '問題を見る' })).toBeVisible()
    expect(screen.queryByText('詳細版の手がかり')).not.toBeInTheDocument()
  })
})


it.each(['empty', 'error'] as const)('durable %s keeps the map and region recovery beside the catalog state', async state => {
  const api = apiFixture()
  if (state === 'empty') api.listQuests.mockResolvedValueOnce(page([]))
  else api.listQuests.mockRejectedValueOnce(new Error('synthetic failure'))
  api.listQuests.mockResolvedValue(page([second]))
  const user = userEvent.setup()
  const view = render(<ApiQuestApp api={api} authClient={signedOutAuth()} dataMode="durable-local" />)
  await screen.findByRole('heading', { name: state === 'empty' ? '問題なし' : '問題読込失敗' })
  expect(view.container.querySelector('.explore')).not.toBeNull()
  await user.click(await screen.findByRole('button', { name: '地図の公開地域を選択' }))
  expect(await screen.findByRole('heading', { name: second.title })).toBeVisible()
})

it('durable traveler chrome omits mode badges and synthetic-restriction banners', async () => {
  window.history.replaceState(null, '', '/?quest=quest-a')
  render(<ApiQuestApp api={apiFixture()} authClient={signedOutAuth()} dataMode="durable-local" />)
  await screen.findByRole('heading', { name: first.title })
  expect(screen.queryByText('公開APIデモデータ')).not.toBeInTheDocument()
  expect(screen.queryByText('架空のサンプル問題')).not.toBeInTheDocument()
  expect(screen.queryByText('永続APIの公開問題（検証用）')).not.toBeInTheDocument()
  expect(screen.queryByText('永続API・ローカル')).not.toBeInTheDocument()
  expect(screen.queryByText(/回答の送信には合成画像と架空の座標/)).not.toBeInTheDocument()
  expect(document.querySelector('.demo-note')).toBeNull()
  expect(document.querySelector('.preview-label')).toBeNull()
  expect(screen.getByRole('region', { name: '問題の詳細' })).toBeVisible()
})

it('does not show a place-name chip after pin selection and a second press restores the full list', async () => {
  const user = userEvent.setup()
  const api = apiFixture()
  api.listQuests.mockImplementation(async (params) => page(params?.areaId ? [second] : [first, second]))
  render(<ApiQuestApp api={api} authClient={signedOutAuth()} dataMode="durable-local" />)
  await user.click(await screen.findByRole('button', { name: '地図の公開地域を選択' }))
  await waitFor(() => expect(screen.getByTestId('map-state').querySelector('.explore-list-head')).toHaveTextContent('1件'))
  expect(screen.queryByRole('button', { name: '森エリアのしぼり込みを外す' })).not.toBeInTheDocument()
  expect(document.querySelector('.map-filter-selection')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '地図の公開地域を選択' }))
  await waitFor(() => expect(screen.getByTestId('map-state').querySelector('.explore-list-head')).toHaveTextContent('2件'))
  expect(screen.getByTestId('map-state')).toHaveAttribute('data-quest-order', 'quest-a,quest-b')
  expect(window.location.search).not.toContain('area=')
})

it('dismisses the place picker on selection, outside pointer and Escape', async () => {
  const user = userEvent.setup()
  render(<ApiQuestApp api={apiFixture()} authClient={signedOutAuth()} dataMode="durable-local" />)
  await screen.findByRole('button', { name: '地図の公開地域を選択' })
  await clickPrefecture(user, '関東', '神奈川県')
  const toggle = document.querySelector<HTMLButtonElement>('.filter-toggle')!
  expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await user.click(toggle)
  await user.keyboard('{Escape}')
  expect(toggle).toHaveAttribute('aria-expanded', 'false')
  expect(toggle).toHaveFocus()
  await user.click(toggle)
  await user.click(document.body)
  expect(toggle).toHaveAttribute('aria-expanded', 'false')
})


describe('県の単一選択', () => {
  it('単一県の地方行は1回で県を適用し、再タップで全国に戻す', async () => {
    const user = userEvent.setup()
    const api = apiFixture()
    api.listAreas.mockResolvedValue(page([{ ...areas[0], prefectureCode: '01' }, { ...areas[1], prefectureCode: '13' }]))
    render(<ApiQuestApp api={api} dataMode="durable-local" />)
    await screen.findByRole('button', { name: '一覧表示用タイトルを開く' })
    await openFilterPanel(user)
    const row = await regionAccordionRow('北海道')
    expect(row).toHaveAttribute('aria-pressed', 'false')
    expect(row).not.toHaveAttribute('aria-expanded')
    expect(row).not.toHaveAttribute('aria-controls')
    expect(row.querySelector('.filter-accordion-chevron')).toBeNull()
    await user.click(row)
    const toggle = document.querySelector<HTMLButtonElement>('.filter-toggle')!
    expect(toggle).toHaveTextContent('北海道')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).toHaveFocus()
    expect(screen.getByTestId('map-state')).toHaveAttribute('data-quest-order', 'quest-a')
    expect(screen.getByRole('button', { name: '一覧表示用タイトルを開く' })).toBeVisible()
    expect(screen.queryByRole('button', { name: '森の謎を開く' })).not.toBeInTheDocument()
    expect(new URLSearchParams(window.location.search).get('prefs')).toBe('北海道')
    await openFilterPanel(user)
    const selectedRow = await regionAccordionRow('北海道')
    expect(selectedRow).toHaveAttribute('aria-pressed', 'true')
    expect(selectedRow).toHaveClass('filter-prefecture')
    expect(screen.queryByRole('group', { name: '北海道の都道府県' })).not.toBeInTheDocument()
    await user.click(selectedRow)
    expect(toggle).toHaveTextContent('場所で絞る')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).toHaveFocus()
    expect(screen.getByTestId('map-state')).toHaveAttribute('data-quest-order', 'quest-a,quest-b')
    expect(screen.getByRole('button', { name: '森の謎を開く' })).toBeVisible()
    expect(new URLSearchParams(window.location.search).has('prefs')).toBe(false)
  })

  it('地方は一つずつ開閉し、まるごと行・決定・チェックボックスを置かない', async () => {
    const user = userEvent.setup()
    render(<ApiQuestApp api={apiFixture()} dataMode="durable-local" />)
    await screen.findByRole('button', { name: '一覧表示用タイトルを開く' })
    await openFilterPanel(user)
    const kanto = await regionAccordionRow('関東')
    await user.click(kanto)
    expect(screen.getByRole('group', { name: '関東の都道府県' })).toBeVisible()
    await user.click(kanto)
    expect(screen.queryByRole('group', { name: '関東の都道府県' })).not.toBeInTheDocument()
    await user.click(kanto)
    await user.click(await regionAccordionRow('近畿'))
    expect(kanto).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('group', { name: '近畿の都道府県' })).toBeVisible()
    expect(screen.queryByRole('button', { name: /ぜんぶ|すべて|決定/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(document.querySelector('.filter-check-box')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '全国' })).not.toBeInTheDocument()
  })

  it('県を即適用して閉じ、別の県で置き換え、選択中チップの再タップで解除する', async () => {
    const user = userEvent.setup()
    const api = apiFixture()
    api.listAreas.mockResolvedValue(page([{ ...areas[0], prefectureCode: '13' }, { ...areas[1], prefectureCode: '27' }]))
    render(<ApiQuestApp api={api} dataMode="durable-local" />)
    await screen.findByRole('button', { name: '一覧表示用タイトルを開く' })
    await clickPrefecture(user, '関東', '東京都')
    const toggle = document.querySelector<HTMLButtonElement>('.filter-toggle')!
    expect(toggle).toHaveTextContent('東京都')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).toHaveFocus()
    expect(screen.getByTestId('map-state')).toHaveAttribute('data-quest-order', 'quest-a')
    expect(new URLSearchParams(window.location.search).get('prefs')).toBe('東京都')
    await clickPrefecture(user, '近畿', '大阪府')
    expect(toggle).toHaveTextContent('大阪府')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByTestId('map-state')).toHaveAttribute('data-quest-order', 'quest-b')
    expect(new URLSearchParams(window.location.search).get('prefs')).toBe('大阪府')
    await openFilterPanel(user)
    expect(screen.getByRole('button', { name: '大阪府', pressed: true })).toBeVisible()
    expect(screen.queryByRole('button', { name: '全国' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /絞り込みを解除|すべて解除/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '大阪府', pressed: true }))
    expect(toggle).toHaveTextContent('場所で絞る')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).toHaveFocus()
    expect(screen.getByRole('button', { name: '一覧表示用タイトルを開く' })).toBeVisible()
    expect(screen.getByRole('button', { name: '森の謎を開く' })).toBeVisible()
    expect(screen.getByTestId('map-state')).toHaveAttribute('data-quest-order', 'quest-a,quest-b')
    expect(window.location.search).not.toContain('prefs=')
  })

  it.each([
    ['?regions=関東&prefs=東京都,大阪府', '東京都'],
    ['?regions=関東,近畿', '場所で絞る'],
    ['?region=北海道', '場所で絞る'],
    ['?prefs=不明,大阪府', '大阪府'],
    ['?pref=東京都', '東京都'],
    ['?prefs=不明', '場所で絞る'],
  ])('旧URL %s を安全に復元する', async (search, label) => {
    window.history.replaceState(null, '', '/' + search)
    render(<ApiQuestApp api={apiFixture()} dataMode="durable-local" />)
    expect(document.querySelector('.filter-toggle')).toHaveTextContent(label)
    act(() => {
      window.history.replaceState(null, '', '/?prefs=大阪府,東京都&regions=関東')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    await waitFor(() => expect(document.querySelector('.filter-toggle')).toHaveTextContent('大阪府'))
  })
})

it.each(['row', 'pin'] as const)('%s selection shares area, URL, list and toggle behavior', async (entry) => {
  const user = userEvent.setup()
  const api = apiFixture()
  render(<ApiQuestApp api={api} syncUrl dataMode="team-preview" authClient={signedOutAuth()} />)
  await screen.findByRole('button', { name: '森の謎を開く' })
  const button = () => screen.getByRole('button', { name: entry === 'row' ? '森の謎を開く' : '地図の公開地域を選択' })
  await user.click(button())
  await screen.findByRole('heading', { name: second.title })
  expect(screen.getByTestId('map-state')).toHaveAttribute('data-area', 'area-b')
  expect(screen.getByTestId('map-state')).toHaveAttribute('data-quest-order', 'quest-b')
  expect(window.location.search).toBe('?area=area-b&quest=quest-b')
  await user.click(button())
  await waitFor(() => expect(screen.getByTestId('map-state')).toHaveAttribute('data-quest-order', 'quest-a,quest-b'))
  expect(screen.getByTestId('map-state')).toHaveAttribute('data-area', '')
  expect(screen.queryByRole('heading', { name: second.title })).not.toBeInTheDocument()
  expect(window.location.search).toBe('')
})

it('opens the clicked second quest in an area rather than replacing it with the first', async () => {
  const user = userEvent.setup()
  const next = { ...first, questId: 'quest-a2', title: '郡山の2問目' }
  const api = apiFixture()
  api.listQuests.mockImplementation(async (query?: { areaId?: string }) => page([first, next, second].filter(quest => !query?.areaId || quest.areaId === query.areaId)))
  api.getQuest.mockImplementation(async (id: string) => id === next.questId ? next : first)
  render(<ApiQuestApp api={api} syncUrl dataMode="team-preview" authClient={signedOutAuth()} />)
  await user.click(await screen.findByRole('button', { name: `${next.title}を開く` }))
  expect(await screen.findByRole('heading', { name: next.title })).toBeVisible()
  expect(window.location.search).toBe('?area=area-a&quest=quest-a2')
  expect(screen.getByTestId('map-state')).toHaveAttribute('data-area', 'area-a')
  expect(screen.getByTestId('map-state')).toHaveAttribute('data-quest-order', 'quest-a,quest-a2')
})

// ピンと行は同じ一つの選択処理を通り、選択中のものをもう一度押すと必ず解除する（2026-11-10 ゑんどくん）。
it.each([
  ['pin then the same quest row', 'pin', 'row'],
  ['row then the same area pin', 'row', 'pin'],
] as const)('%s deselects through the shared toggle', async (_name, firstEntry, secondEntry) => {
  const user = userEvent.setup()
  render(<ApiQuestApp api={apiFixture()} syncUrl dataMode="team-preview" authClient={signedOutAuth()} />)
  await screen.findByRole('button', { name: '森の謎を開く' })
  const press = (entry: 'pin' | 'row') => user.click(screen.getByRole('button', { name: entry === 'row' ? '森の謎を開く' : '地図の公開地域を選択' }))
  await press(firstEntry)
  await screen.findByRole('heading', { name: second.title })
  expect(window.location.search).toBe('?area=area-b&quest=quest-b')
  await press(secondEntry)
  await waitFor(() => expect(screen.getByTestId('map-state')).toHaveAttribute('data-area', ''))
  expect(screen.queryByRole('heading', { name: second.title })).not.toBeInTheDocument()
  expect(screen.getByTestId('map-state')).toHaveAttribute('data-quest-order', 'quest-a,quest-b')
  expect(window.location.search).toBe('')
})

it('pin A, pin B, then B again deselects instead of reselecting A', async () => {
  const user = userEvent.setup()
  render(<ApiQuestApp api={apiFixture()} syncUrl dataMode="team-preview" authClient={signedOutAuth()} />)
  await screen.findByRole('button', { name: '森の謎を開く' })
  await user.click(screen.getByRole('button', { name: '地図の川辺エリアを選択' }))
  await waitFor(() => expect(screen.getByTestId('map-state')).toHaveAttribute('data-area', 'area-a'))
  await user.click(screen.getByRole('button', { name: '地図の公開地域を選択' }))
  await waitFor(() => expect(screen.getByTestId('map-state')).toHaveAttribute('data-area', 'area-b'))
  await screen.findByRole('heading', { name: second.title })
  await user.click(screen.getByRole('button', { name: '地図の公開地域を選択' }))
  await waitFor(() => expect(screen.getByTestId('map-state')).toHaveAttribute('data-area', ''))
  expect(screen.queryByRole('heading', { name: first.title })).not.toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: second.title })).not.toBeInTheDocument()
  expect(window.location.search).toBe('')
})
