import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { area, quest } from '../../shared/api/testFixtures'
import type { AuthClient } from '../auth/authTypes'
import type { TeamPreview as TeamPreviewComponent } from './TeamPreview'

// 探索画面の縁なし（全画面）表示は、地図が使える状態（シート表示）でのみ有効になる。
// Maps キーはモジュール読み込み時に固定されるため、env を差し替えてから動的に読み込む。
let TeamPreview: typeof TeamPreviewComponent
const headers = { 'X-Quest-Data-Mode': 'team-preview' }
const signedIn = { status: 'signed-in', user: { uid: 'editor-a', displayName: null } } as const
const auth: AuthClient = {
  getSnapshot: () => signedIn, subscribe: () => () => {},
  signInWithGoogle: vi.fn(), signOut: vi.fn(), getIdToken: vi.fn(async () => 'team-token'),
}
const membership = { orgId: 'demo-org', areaId: 'demo-area', label: '架空の自治体', role: 'publisher' }

function stubFetcher(memberships: unknown[] = [membership]) {
  return vi.fn<typeof fetch>(async (input) => {
    const path = String(input)
    if (path.startsWith('/api/v1/areas?')) return Response.json({ items: [area], nextCursor: null }, { headers })
    if (path.startsWith('/api/v1/quests?')) return Response.json({ items: [quest], nextCursor: null }, { headers })
    if (path === '/api/v1/quests/' + quest.questId) return Response.json(quest, { headers })
    if (path === '/api/v1/session') return Response.json({ uid: 'editor-a' }, { headers })
    if (path.startsWith('/api/v1/me/memberships?')) return Response.json({ items: memberships, nextCursor: null }, { headers })
    if (path.startsWith('/api/v1/me/discoveries')) return Response.json({ items: [], nextCursor: null }, { headers })
    throw new Error('Unexpected request: ' + path)
  })
}

function navOrder(nav: HTMLElement) {
  return [...nav.querySelectorAll('a, button')].map((el) => {
    const text = el.textContent ?? ''
    return text.includes('自治体画面') ? '自治体画面' : text.includes('自分の記録') ? '自分の記録' : '謎を探す'
  })
}

function stubMaps() {
  const mapInstance = { setZoom() {}, getZoom: () => 5, setCenter() {}, fitBounds() {}, addListener: () => ({ remove() {} }) }
  class Data { setMap() {} addGeoJson() {} setStyle() {} addListener() { return { remove() {} } } forEach() {} remove() {} }
  class Marker { setMap() {} addListener() { return { remove() {} } } }
  window.google = { maps: { Map: class { constructor() { return mapInstance } }, Data, Marker, LatLngBounds: class { extend() {} }, event: { addListener: () => ({ remove() {} }) } } as never }
}

function stubViewport(wide: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: wide && query === '(min-width: 981px)',
    media: query, onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
    addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(() => false),
  }))
}

beforeAll(async () => {
  // Maps キーはモジュール読み込み時に固定されるため、読み込み前に差し替える。
  vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-key')
  ;({ TeamPreview } = await import('./TeamPreview'))
})

beforeEach(() => {
  window.history.replaceState(null, '', '/')
  stubMaps()
  vi.stubGlobal('fetch', stubFetcher())
})

afterEach(() => {
  window.history.replaceState(null, '', '/')
  delete window.google
  vi.unstubAllGlobals()
})

describe('探索画面の縁なし（全画面）表示', () => {
  async function runScenario(wide: boolean) {
    // 回答試験の切り替えは描画時に読まれるため、描画前に差し替える。
    vi.stubEnv('VITE_QUEST_TEAM_ANSWER_TRIAL', 'true')
    stubViewport(wide)
    const user = userEvent.setup()
    const view = render(<TeamPreview authClient={auth} />)
    // 地図が使える状態になり、連動リストがボトムシートに入ると全画面化の目印が付く。
    expect(await screen.findByRole('region', { name: '選べる謎の一覧' })).toBeVisible()
    await waitFor(() => expect(document.body).toHaveClass('explore-fullbleed'))
    // 浮動化した導線：タブ／ナビは全ユーザー共通で「謎を探す／自分の記録」のみ（D-47）。
    // 自治体画面への入口はアカウントメニューの中だけにあり、所属がある時だけ出る。
    const desktopNav = screen.getByRole('navigation', { name: '主要ナビゲーション' })
    const mobileNav = screen.getByRole('navigation', { name: 'スマホ用ナビゲーション' })
    expect(navOrder(desktopNav)).toEqual(['謎を探す', '自分の記録'])
    expect(navOrder(mobileNav)).toEqual(['謎を探す', '自分の記録'])
    expect(within(desktopNav).queryByRole('link', { name: '自治体画面' })).not.toBeInTheDocument()
    expect(within(mobileNav).queryByRole('link', { name: '自治体画面' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'アカウントメニュー' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'アカウントメニュー' }))
    expect(await screen.findByRole('menuitem', { name: '自治体画面' })).toHaveAttribute('href', '/admin')
    await user.click(screen.getByRole('button', { name: 'アカウントメニュー' }))
    // スマホ用ナビ（スマホ幅では下部タブバー、D-32）から自分の記録へ到達でき、記録画面では目印が外れて従来シェルに戻る。
    await user.click(within(mobileNav).getByRole('button', { name: /自分の記録/ }))
    expect(await screen.findByRole('heading', { name: '自分の記録' })).toBeVisible()
    expect(document.body).not.toHaveClass('explore-fullbleed')
    view.unmount()
    expect(document.body).not.toHaveClass('explore-fullbleed')
  }

  it('PC幅（981px以上）でも全画面化され、浮動化した導線に到達できる', async () => {
    await runScenario(true)
  })

  it('選択中の探索タブではスクロールせず、記録画面から戻るタップでは見出しへ戻る', async () => {
    vi.stubEnv('VITE_QUEST_TEAM_ANSWER_TRIAL', 'true')
    stubViewport(false)
    const scrollIntoView = vi.fn()
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView })
    const user = userEvent.setup()
    render(<TeamPreview authClient={auth} />)
    const nav = await screen.findByRole('navigation', { name: 'スマホ用ナビゲーション' })
    await waitFor(() => expect(document.body).toHaveClass('explore-fullbleed'))

    await user.click(within(nav).getByRole('button', { name: '謎を探す' }))
    expect(scrollIntoView).not.toHaveBeenCalled()

    await user.click(within(nav).getByRole('button', { name: /自分の記録/ }))
    await screen.findByRole('heading', { name: '自分の記録' })
    await user.click(within(nav).getByRole('button', { name: '謎を探す' }))
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' }))
    if (original) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', original)
    else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
  })

  it('両タブともタッチスワイプ後のクリックを抑え、キーボード操作は通す', async () => {
    vi.stubEnv('VITE_QUEST_TEAM_ANSWER_TRIAL', 'true')
    stubViewport(false)
    const user = userEvent.setup()
    render(<TeamPreview authClient={auth} />)
    const nav = await screen.findByRole('navigation', { name: 'スマホ用ナビゲーション' })
    await waitFor(() => expect(document.body).toHaveClass('explore-fullbleed'))
    const explore = within(nav).getByRole('button', { name: '謎を探す' })
    const records = within(nav).getByRole('button', { name: /自分の記録/ })
    const swipeAndClick = (target: HTMLElement) => {
      fireEvent.pointerDown(target, { pointerId: 1, pointerType: 'touch', clientX: 20, clientY: 20 })
      fireEvent.pointerMove(target, { pointerId: 1, pointerType: 'touch', clientX: 21, clientY: 50 })
      fireEvent.pointerUp(target, { pointerId: 1, pointerType: 'touch', clientX: 21, clientY: 50 })
      fireEvent.click(target, { detail: 1 })
    }

    swipeAndClick(records)
    expect(screen.queryByRole('heading', { name: '自分の記録' })).not.toBeInTheDocument()
    records.focus()
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('heading', { name: '自分の記録' })).toBeVisible()

    swipeAndClick(explore)
    expect(screen.getByRole('heading', { name: '自分の記録' })).toBeVisible()
    explore.focus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(document.body).toHaveClass('explore-fullbleed'))
  })

  it('PC幅ではボトムシートではなく左パネルに一覧が出て、スマホ幅ではシートになる', async () => {
    vi.stubEnv('VITE_QUEST_TEAM_ANSWER_TRIAL', 'true')
    stubViewport(true)
    const wide = render(<TeamPreview authClient={auth} />)
    expect(await screen.findByRole('region', { name: '選べる謎の一覧' })).toBeVisible()
    const panel = wide.container.querySelector('.explore-side-panel')
    expect(panel).not.toBeNull()
    expect(panel?.querySelector('.explore-list')).not.toBeNull()
    expect(panel?.querySelector('.side-panel-filters')).not.toBeNull()
    expect(wide.container.querySelector('.explore-sheet')).toBeNull()
    wide.unmount()
    stubViewport(false)
    const narrow = render(<TeamPreview authClient={auth} />)
    expect(await screen.findByRole('region', { name: '選べる謎の一覧' })).toBeVisible()
    expect(narrow.container.querySelector('.explore-sheet')).not.toBeNull()
    expect(narrow.container.querySelector('.explore-side-panel')).toBeNull()
    narrow.unmount()
  })

  it('PC幅では詳細がサイドバー内に入り、地図が使える間はピッカーを出さない（スマホ幅のレールも同様）', async () => {
    vi.stubEnv('VITE_QUEST_TEAM_ANSWER_TRIAL', 'true')
    stubViewport(true)
    const wide = render(<TeamPreview authClient={auth} />)
    expect(await screen.findByRole('region', { name: '選べる謎の一覧' })).toBeVisible()
    const panel = wide.container.querySelector('.explore-side-panel')
    expect(panel).not.toBeNull()
    // 初期表示は未選択（D-56）のため、一覧の行から選んで初めて詳細がパネル内に出る。
    const user = userEvent.setup()
    await user.click(within(panel as HTMLElement).getByRole('button', { name: quest.title + 'の詳細を見る' }))
    // 詳細はサイドバー内の1か所だけに出る（タイトルの見出しは画面全体で1つだけ。
    // カード＋ピッカー＋詳細の三重表示にはしない、D-43）。
    expect(await within(panel as HTMLElement).findByRole('heading', { name: quest.title })).toBeVisible()
    expect(screen.getAllByRole('heading', { name: quest.title })).toHaveLength(1)
    // 地図が使える間は全件ピッカーと「更新する」を出さず、選択はカード一覧とピンに一本化する。
    // 閲覧の案内・デモの注記・フッターの文言も出さない（D-39）。
    await waitFor(() => expect(panel?.querySelector('.api-quest-picker')).toBeNull())
    expect(within(panel as HTMLElement).queryByRole('button', { name: '更新する' })).not.toBeInTheDocument()
    expect(wide.container.querySelector('.browse-note')).toBeNull()
    expect(wide.container.querySelector('.demo-note')).toBeNull()
    expect(wide.container.querySelector('.side-panel-footer-note')).toBeNull()
    expect(wide.container.querySelector('.site-footer')).toBeNull()
    // 地図の下のレールは出さない。
    expect(wide.container.querySelector('.quest-rail')).toBeNull()
    wide.unmount()
    // スマホ幅では詳細は従来どおり地図の下のレールに出るが、地図が使える間はピッカーを出さない。
    stubViewport(false)
    const narrow = render(<TeamPreview authClient={auth} />)
    expect(await screen.findByRole('region', { name: '選べる謎の一覧' })).toBeVisible()
    const rail = narrow.container.querySelector('.quest-rail')
    expect(rail).not.toBeNull()
    await waitFor(() => expect(rail?.querySelector('.api-quest-picker')).toBeNull())
    expect(within(rail as HTMLElement).queryByRole('button', { name: '更新する' })).not.toBeInTheDocument()
    // スマホ幅でも案内・注記類は出さない（D-39）。
    expect(narrow.container.querySelector('.demo-note')).toBeNull()
    expect(narrow.container.querySelector('.browse-note')).toBeNull()
    expect(narrow.container.querySelector('.explore-side-panel')).toBeNull()
    narrow.unmount()
  })

  it('スマホ幅（981px未満）でもシート表示の間は全画面化され、浮動化した導線に到達できる', async () => {
    await runScenario(false)
  })

  it('所属がない場合は入口が出ず、主要ナビの並びと位置は所属がある場合と同じになる', async () => {
    vi.stubEnv('VITE_QUEST_TEAM_ANSWER_TRIAL', 'true')
    stubViewport(true)
    vi.stubGlobal('fetch', stubFetcher([]))
    render(<TeamPreview authClient={auth} />)
    expect(await screen.findByRole('region', { name: '選べる謎の一覧' })).toBeVisible()
    const desktopNav = screen.getByRole('navigation', { name: '主要ナビゲーション' })
    const mobileNav = screen.getByRole('navigation', { name: 'スマホ用ナビゲーション' })
    // 所属の確認が終わっても入口は出ず、自分の記録は所属がある場合と同じ2番目のまま。
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(screen.queryByRole('link', { name: '自治体画面' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: '自治体画面' })).not.toBeInTheDocument()
    expect(navOrder(desktopNav)).toEqual(['謎を探す', '自分の記録'])
    expect(navOrder(mobileNav)).toEqual(['謎を探す', '自分の記録'])
    expect(screen.getByRole('button', { name: 'アカウントメニュー' })).toBeVisible()
  })
})
