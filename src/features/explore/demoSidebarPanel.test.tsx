import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { area, quest } from '../../shared/api/testFixtures'
import type { ApiQuestApp as ApiQuestAppComponent } from '../quests/ApiQuestApp'

/**
 * demo モードでも PC 幅では Cursor 風サイドバー（一覧＋開閉）が出ること。
 * 以前のスクショ失敗は team-preview 期待 × demo API の不一致だったが、
 * demo でもサイドバー殻を使う退行を防ぐ。
 */
let ApiQuestApp: typeof ApiQuestAppComponent
const headers = { 'X-Quest-Data-Mode': 'demo' }

function stubFetcher() {
  return vi.fn<typeof fetch>(async (input) => {
    const path = String(input)
    if (path.startsWith('/api/v1/areas?')) return Response.json({ items: [area], nextCursor: null }, { headers })
    if (path.startsWith('/api/v1/quests?')) return Response.json({ items: [quest], nextCursor: null }, { headers })
    if (path === '/api/v1/quests/' + quest.questId) return Response.json(quest, { headers })
    throw new Error('Unexpected request: ' + path)
  })
}

function stubMaps() {
  const mapInstance = { setZoom() {}, getZoom: () => 5, setCenter() {}, fitBounds() {}, addListener: () => ({ remove() {} }) }
  class Data { setMap() {} addGeoJson() {} setStyle() {} addListener() { return { remove() {} } } forEach() {} remove() {} }
  class Marker { setMap() {} addListener() { return { remove() {} } } }
  window.google = { maps: { Map: class { constructor() { return mapInstance } }, Data, Marker, LatLngBounds: class { extend() {} }, event: { addListener: () => ({ remove() {} }) } } as never }
}

beforeAll(async () => {
  vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-key')
  ;({ ApiQuestApp } = await import('../quests/ApiQuestApp'))
})

beforeEach(() => {
  window.history.replaceState(null, '', '/')
  stubMaps()
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(min-width: 981px)',
    media: query, onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
    addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(() => false),
  }))
  vi.stubGlobal('fetch', stubFetcher())
})

afterEach(() => {
  window.history.replaceState(null, '', '/')
  delete window.google
  vi.unstubAllGlobals()
})

describe('demo mode PC sidebar', () => {
  it('shows the side panel with quests, brand+nav chrome, and collapse icons', async () => {
    const user = userEvent.setup()
    const { container } = render(<ApiQuestApp dataMode="demo" />)
    await waitFor(() => expect(document.body).toHaveClass('explore-fullbleed'))
    const panel = container.querySelector('.explore-side-panel')
    expect(panel).not.toBeNull()
    const list = await screen.findByRole('region', { name: '選べる謎の一覧' })
    expect(within(list).getByRole('button', { name: quest.title + 'の詳細を見る' })).toBeVisible()
    expect(document.querySelector('.brand')).not.toBeNull()
    expect(document.querySelector('.brand-copy')?.textContent).toContain('NAZOP')
    const nav = document.querySelector('.desktop-nav') as HTMLElement
    expect(within(nav).getByRole('button', { name: '謎を探す' })).toHaveAttribute('aria-current', 'page')
    expect(within(nav).getByRole('button', { name: '自分の記録' })).toBeVisible()
    // 開閉
    await user.click(screen.getByRole('button', { name: 'サイドバーを閉じる' }))
    expect(document.body).toHaveClass('explore-sidebar-collapsed')
    // 畳みでもナビボタン（アイコン）は残る
    expect(within(document.querySelector('.desktop-nav') as HTMLElement).getByRole('button', { name: '謎を探す' })).toBeInTheDocument()
    expect(within(document.querySelector('.desktop-nav') as HTMLElement).getByRole('button', { name: '自分の記録' })).toBeInTheDocument()
    expect(document.querySelector('.brand-mark')).not.toBeNull()
  })
})
