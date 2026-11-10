import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { area, quest } from '../../shared/api/testFixtures'
import type { AuthClient } from '../auth/authTypes'
import type { TeamPreview as TeamPreviewComponent } from '../quests/TeamPreview'

let TeamPreview: typeof TeamPreviewComponent
const headers = { 'X-Quest-Data-Mode': 'team-preview' }
const signedIn = { status: 'signed-in', user: { uid: 'editor-a', displayName: null } } as const
const auth: AuthClient = {
  getSnapshot: () => signedIn, subscribe: () => () => {},
  signInWithGoogle: vi.fn(), signOut: vi.fn(), getIdToken: vi.fn(async () => 'team-token'),
}
const membership = { orgId: 'demo-org', areaId: 'demo-area', label: '架空の自治体', role: 'publisher' }

function stubFetcher() {
  return vi.fn<typeof fetch>(async (input) => {
    const path = String(input)
    if (path.startsWith('/api/v1/areas?')) return Response.json({ items: [area], nextCursor: null }, { headers })
    if (path.startsWith('/api/v1/quests?')) return Response.json({ items: [quest], nextCursor: null }, { headers })
    if (path === '/api/v1/quests/' + quest.questId) return Response.json(quest, { headers })
    if (path === '/api/v1/session') return Response.json({ uid: 'editor-a' }, { headers })
    if (path.startsWith('/api/v1/me/memberships?')) return Response.json({ items: [membership], nextCursor: null }, { headers })
    if (path.startsWith('/api/v1/me/discoveries')) return Response.json({ items: [], nextCursor: null }, { headers })
    throw new Error('Unexpected request: ' + path)
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
  vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-key')
  ;({ TeamPreview } = await import('../quests/TeamPreview'))
})

beforeEach(() => {
  window.history.replaceState(null, '', '/')
  stubMaps()
  stubViewport(true)
  vi.stubEnv('VITE_QUEST_TEAM_ANSWER_TRIAL', 'true')
  vi.stubGlobal('fetch', stubFetcher())
})

afterEach(() => {
  window.history.replaceState(null, '', '/')
  delete window.google
  vi.unstubAllGlobals()
})

describe('PC sidebar review flow', () => {
  it('covers select → detail → QR, records nav, and open/close without breaking', async () => {
    const user = userEvent.setup()
    render(<TeamPreview authClient={auth} />)

    const list = await screen.findByRole('region', { name: '選べる謎の一覧' })
    const panel = document.querySelector('.explore-side-panel') as HTMLElement
    expect(panel).not.toBeNull()
    await waitFor(() => expect(document.body).toHaveClass('explore-fullbleed'))

    // 開閉（畳むと explore-sidebar-collapsed、開くと外れる）
    await user.click(screen.getByRole('button', { name: 'サイドバーを閉じる' }))
    expect(document.body).toHaveClass('explore-sidebar-collapsed')
    const nav = document.querySelector('.desktop-nav')!
    expect(nav.nextElementSibling).toHaveAttribute('id', 'sidebar-toggle-slot')
    expect(nav.nextElementSibling).toContainElement(screen.getByRole('button', { name: 'サイドバーを開く' }))
    await user.click(screen.getByRole('button', { name: 'サイドバーを開く' }))
    expect(document.body).not.toHaveClass('explore-sidebar-collapsed')

    const desktopNav = document.querySelector('.desktop-nav') as HTMLElement
    const explore = within(desktopNav).getByRole('button', { name: '謎を探す' })
    const records = within(desktopNav).getByRole('button', { name: '自分の記録' })
    expect(explore).toHaveAttribute('aria-current', 'page')
    const explorePaths = [...explore.querySelectorAll('path')].map((el) => el.getAttribute('d')).join('|')
    const recordsPaths = [...records.querySelectorAll('path')].map((el) => el.getAttribute('d')).join('|')
    expect(explorePaths).not.toEqual(recordsPaths)

    // 問題選択→詳細
    await user.click(within(list).getByRole('button', { name: quest.title + 'の詳細を見る' }))
    expect(await within(panel).findByRole('heading', { name: quest.title })).toBeVisible()

    // PCでは詳細からスマホへ受け渡し、撮影操作は提供しない。
    expect(within(panel).queryByRole('button', { name: 'スマホで挑戦する' })).not.toBeInTheDocument()
    expect(within(panel).getByRole('img', { name: /QRコード/ })).toBeVisible()
    expect(within(panel).queryByRole('button', { name: '挑戦する' })).not.toBeInTheDocument()
    expect(panel.querySelector('input[type="file"], video')).toBeNull()

    // 記録へ（サイドバーナビは残る）
    await user.click(records)
    expect(await screen.findByRole('heading', { name: '自分の記録' })).toBeVisible()
    expect(document.querySelector('.desktop-nav')).not.toBeNull()
    expect(within(document.querySelector('.desktop-nav') as HTMLElement).getByRole('button', { name: '自分の記録' }))
      .toHaveAttribute('aria-current', 'page')

    // 探索側が hidden でも共通スロットのトグルは操作できる。
    const toggle = screen.getByRole('button', { name: 'サイドバーを閉じる' })
    expect(document.getElementById('sidebar-toggle-slot')).toContainElement(toggle)
    await user.click(toggle)
    expect(document.body).toHaveClass('explore-sidebar-collapsed')
    await user.click(screen.getByRole('button', { name: 'サイドバーを開く' }))
    expect(document.body).not.toHaveClass('explore-sidebar-collapsed')

    await user.click(within(document.querySelector('.desktop-nav') as HTMLElement).getByRole('button', { name: '謎を探す' }))
    await waitFor(() => expect(document.body).toHaveClass('explore-fullbleed'))
  })
})
