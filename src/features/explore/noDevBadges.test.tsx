import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { area, quest } from '../../shared/api/testFixtures'
import type { AuthClient } from '../auth/authTypes'
import type { TeamPreview as TeamPreviewComponent } from '../quests/TeamPreview'

let TeamPreview: typeof TeamPreviewComponent
const headers = { 'X-Quest-Data-Mode': 'team-preview' }
const signedOut = { status: 'signed-out' as const, user: null }
const auth: AuthClient = {
  getSnapshot: () => signedOut, subscribe: () => () => {},
  signInWithGoogle: vi.fn(), signOut: vi.fn(), getIdToken: vi.fn(async () => null),
}

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
  vi.stubGlobal('fetch', stubFetcher())
})

afterEach(() => {
  window.history.replaceState(null, '', '/')
  delete window.google
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('traveler chrome has no prep/dev badges', () => {
  it('hides 準備中 and mode pills; keeps 自分の記録 disabled without badge text', async () => {
    vi.stubEnv('VITE_QUEST_TEAM_ANSWER_TRIAL', 'false')
    stubViewport(true)
    render(<TeamPreview authClient={auth} />)
    const desktopNav = await screen.findByRole('navigation', { name: '主要ナビゲーション' })
    const records = within(desktopNav).getByRole('button', { name: '自分の記録' })
    expect(records).toBeDisabled()
    expect(records).not.toHaveTextContent('準備中')
    expect(screen.queryByText('準備中')).not.toBeInTheDocument()
    expect(screen.queryByText('チーム共有検証')).not.toBeInTheDocument()
    expect(screen.queryByText('開発用プレビュー')).not.toBeInTheDocument()
    expect(screen.queryByText('永続API・ローカル')).not.toBeInTheDocument()
    expect(screen.queryByText('公開API・デモ')).not.toBeInTheDocument()
    expect(document.querySelector('.nav-prep')).toBeNull()
    expect(document.querySelector('.preview-label')).toBeNull()
    expect(document.querySelector('.demo-note')).toBeNull()
    expect(document.querySelector('.sample-label')).toBeNull()
  })
})

describe('source chrome templates drop prep badges', () => {
  it('App no longer embeds traveler prep/mode badge markup', () => {
    const app = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8')
    expect(app).not.toMatch(/nav-prep/)
    expect(app).not.toMatch(/>準備中</)
    expect(app).not.toMatch(/自分の記録（準備中）/)
    expect(app).not.toMatch(/preview-label/)
    expect(app).not.toMatch(/チーム共有検証/)
    expect(app).not.toMatch(/開発用プレビュー/)
    expect(app).not.toMatch(/demo-note/)
  })
})

describe('QuestDetails start-button notes drop login explainers', () => {
  it('App only keeps the stale blocking note for QuestDetails', () => {
    const app = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8')
    // QuestDetails note= に渡していたログイン補足は消えていること
    expect(app).not.toMatch(/問題の閲覧は続けられます。ログイン確認後に撮影できます/)
    expect(app).not.toMatch(/ログインを確認しました。写真はこの画面で確認するだけです/)
    expect(app).not.toMatch(/ログイン済みです。挑戦開始先へ選んだ問題を渡します/)
    expect(app).not.toMatch(/Googleのログイン画面を開きます。キャンセルしてもこの問題に戻れます/)
    expect(app).not.toMatch(/ログイン状態の確認後に操作できます/)
    // note は stale のときだけ
    expect(app).toMatch(/note=\{questStale \? '問題の再読込が必要/)
    expect(app).toMatch(/: undefined\}/)
  })
})
