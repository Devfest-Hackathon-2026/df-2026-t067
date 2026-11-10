import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { area, discovery, quest } from '../../shared/api/testFixtures'
import type { AuthClient } from '../auth/authTypes'
import { TeamPreview } from './TeamPreview'

const signedOut = { status: 'signed-out', user: null } as const
const headers = { 'X-Quest-Data-Mode': 'team-preview' }

// URLの選択状態（?area= / ?quest=）はテスト間で持ち越さない。
beforeEach(() => {
  window.history.replaceState(null, '', '/')
})

afterEach(() => {
  window.history.replaceState(null, '', '/')
})

it('lets a signed-out traveler browse the map, published problem and public hint photo', async () => {
  const user = userEvent.setup()
  const auth: AuthClient = {
    getSnapshot: () => signedOut, subscribe: () => () => {},
    signInWithGoogle: vi.fn(), signOut: vi.fn(), getIdToken: vi.fn(async () => null),
  }
  const hintPath = '/api/v1/quests/' + quest.questId + '/hint-image?expectedVersion=1'
  const published = { ...quest, optionalHintImage: hintPath }
  const revokeObjectURL = vi.fn()
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = () => 'blob:team-hint'
    static revokeObjectURL = revokeObjectURL
  })
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const path = String(input)
    expect(new Headers(init?.headers).has('Authorization')).toBe(false)
    if (path.startsWith('/api/v1/areas?')) return Response.json({ items: [area], nextCursor: null }, { headers })
    if (path.startsWith('/api/v1/quests?')) return Response.json({ items: [published], nextCursor: null }, { headers })
    if (path === '/api/v1/quests/' + quest.questId) return Response.json(published, { headers })
    if (path === hintPath) return new Response(new Uint8Array([255, 216, 255, 217]), { headers: { ...headers, 'Content-Type': 'image/jpeg' } })
    throw new Error('Unexpected public traveler request: ' + path)
  })
  vi.stubGlobal('fetch', fetcher)
  const view = render(<TeamPreview authClient={auth} />)
  // 初期表示は未選択（D-56）のため、一覧の行から選んで詳細を開く。
  await user.click(await screen.findByRole('button', { name: quest.title + 'の詳細を見る' }))
  expect(await screen.findByRole('heading', { name: quest.title })).toBeVisible()
  expect(screen.getByRole('region', { name: '全国の謎' })).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Googleでログイン' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'ヒント画像' }))
  const hint = await screen.findByAltText(quest.title + 'のヒント画像')
  fireEvent.load(hint)
  expect(hint).toBeVisible()
  expect(hint).toHaveAttribute('src', 'blob:team-hint')
  expect(auth.getIdToken).not.toHaveBeenCalled()
  view.unmount()
  expect(revokeObjectURL).toHaveBeenCalledWith('blob:team-hint')
})

it('keeps the quest count and rows while the detail loads after a row tap (D-75)', async () => {
  const user = userEvent.setup()
  const auth: AuthClient = {
    getSnapshot: () => signedOut, subscribe: () => () => {},
    signInWithGoogle: vi.fn(), signOut: vi.fn(), getIdToken: vi.fn(async () => null),
  }
  let resolveQuest: ((response: Response) => void) | undefined
  const fetcher = vi.fn<typeof fetch>(async (input) => {
    const path = String(input)
    if (path.startsWith('/api/v1/areas?')) return Response.json({ items: [area], nextCursor: null }, { headers })
    if (path.startsWith('/api/v1/quests?')) return Response.json({ items: [quest], nextCursor: null }, { headers })
    if (path === '/api/v1/quests/' + quest.questId) return new Promise<Response>((resolve) => { resolveQuest = resolve })
    throw new Error('Unexpected public traveler request: ' + path)
  })
  vi.stubGlobal('fetch', fetcher)
  render(<TeamPreview authClient={auth} />)
  const row = await screen.findByRole('button', { name: quest.title + 'の詳細を見る' })
  expect(screen.getByText('1件')).toBeVisible()
  await user.click(row)
  // 詳細の取得が保留中でも、一覧の件数は「画像読込中」へ切り替わらず、行も残る。
  expect(screen.getByText('1件')).toBeVisible()
  expect(screen.queryByText('画像読込中')).not.toBeInTheDocument()
  expect(row).toBeVisible()
  resolveQuest!(Response.json(quest, { headers }))
  expect(await screen.findByRole('heading', { name: quest.title })).toBeVisible()
})

it('answer trial build lets an invited traveler open the capture flow and records', async () => {
  vi.stubEnv('VITE_QUEST_TEAM_ANSWER_TRIAL', 'true')
  const signedIn = { status: 'signed-in', user: { uid: 'traveler-a', displayName: null } } as const
  const auth: AuthClient = {
    getSnapshot: () => signedIn, subscribe: () => () => {},
    signInWithGoogle: vi.fn(), signOut: vi.fn(), getIdToken: vi.fn(async () => 'team-token'),
  }
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const path = String(input)
    if (path.startsWith('/api/v1/areas?')) return Response.json({ items: [area], nextCursor: null }, { headers })
    if (path.startsWith('/api/v1/quests?')) return Response.json({ items: [quest], nextCursor: null }, { headers })
    if (path === '/api/v1/quests/' + quest.questId) return Response.json(quest, { headers })
    if (path === '/api/v1/session') {
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer team-token')
      return Response.json({ uid: 'traveler-a' }, { headers })
    }
    if (path.startsWith('/api/v1/me/memberships?')) return Response.json({ items: [], nextCursor: null }, { headers })
    throw new Error('Unexpected request: ' + path)
  })
  vi.stubGlobal('fetch', fetcher)
  const user = userEvent.setup()
  render(<TeamPreview authClient={auth} />)
  await user.click(await screen.findByRole('button', { name: quest.title + 'の詳細を見る' }))
  expect(await screen.findByRole('heading', { name: quest.title })).toBeVisible()
  expect(screen.getAllByRole('button', { name: /自分の記録/ }).length).toBeGreaterThan(0)
  expect(await screen.findByRole('button', { name: '挑戦する' })).toBeVisible()
  vi.unstubAllEnvs()
})

it('answer trial build shows a cleared quest as cleared with no way to re-challenge (D-64)', async () => {
  vi.stubEnv('VITE_QUEST_TEAM_ANSWER_TRIAL', 'true')
  const signedIn = { status: 'signed-in', user: { uid: 'traveler-a', displayName: null } } as const
  const auth: AuthClient = {
    getSnapshot: () => signedIn, subscribe: () => () => {},
    signInWithGoogle: vi.fn(), signOut: vi.fn(), getIdToken: vi.fn(async () => 'team-token'),
  }
  const fetcher = vi.fn<typeof fetch>(async (input, _init) => {
    const path = String(input)
    if (path.startsWith('/api/v1/areas?')) return Response.json({ items: [area], nextCursor: null }, { headers })
    if (path.startsWith('/api/v1/quests?')) return Response.json({ items: [quest], nextCursor: null }, { headers })
    if (path === '/api/v1/quests/' + quest.questId) return Response.json(quest, { headers })
    if (path === '/api/v1/session') return Response.json({ uid: 'traveler-a' }, { headers })
    if (path.startsWith('/api/v1/me/memberships?')) return Response.json({ items: [], nextCursor: null }, { headers })
    if (path === '/api/v1/me/discoveries/' + discovery.discoveryId) return Response.json(discovery, { headers })
    if (path === '/api/v1/me/discoveries/' + discovery.discoveryId + '/photo') return new Response(new Uint8Array([255, 216, 255, 217]), { headers: { ...headers, 'Content-Type': 'image/jpeg' } })
    if (path.startsWith('/api/v1/me/discoveries?')) return Response.json({ items: [discovery], nextCursor: null }, { headers })
    throw new Error('Unexpected request: ' + path)
  })
  vi.stubGlobal('fetch', fetcher)
  const user = userEvent.setup()
  const view = render(<TeamPreview authClient={auth} />)
  await user.click(await screen.findByRole('button', { name: quest.title + 'の詳細を見る' }))
  expect(await screen.findByRole('heading', { name: quest.title })).toBeVisible()
  // 本人の記録からクリア状態が配線されると、開始導線は消えてクリア済み表示に替わる。
  expect(await screen.findByRole('button', { name: quest.title + 'の詳細を見る', description: 'クリア済み' })).toBeVisible()
  expect(screen.getByText('クリア済み', { selector: '.explore-row-copy .sr-only' })).toBeInTheDocument()
  expect(screen.getByRole('group', { name: 'クリア状況' })).toBeVisible()
  expect(view.container.querySelector('.quest-cleared-label')).toBeNull()
  expect(view.container.querySelector('.explore-quest-cleared')).toBeNull()
  expect(screen.queryByRole('button', { name: '挑戦する' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'スマホで挑戦する' })).not.toBeInTheDocument()
  // 記録への導線で本人の記録詳細まで進める。
  await user.click(screen.getByRole('button', { name: '記録を見る' }))
  expect(await screen.findByRole('img', { name: '本人の記録写真' })).toBeVisible()
  vi.unstubAllEnvs()
})

it('shows the nationwide map even before the first problem is published', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ items: [], nextCursor: null }, { headers })))
  render(<TeamPreview />)
  expect(await screen.findByRole('heading', { name: '問題なし' })).toBeVisible()
  expect(screen.getByRole('heading', { name: '全国から謎を探す' })).toBeVisible()
  expect(screen.getByRole('region', { name: '全国の謎' })).toBeVisible()
  expect(screen.getByRole('button', { name: '更新する' })).toBeVisible()
})

it('recovers a public hint image after revision and removes it after publication is paused', async () => {
  const user = userEvent.setup()
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = () => 'blob:team-recovery-hint'
    static revokeObjectURL = vi.fn()
  })
  const imagePath = (version: number) => `/api/v1/quests/${quest.questId}/hint-image?expectedVersion=${version}`
  const publication = (version: number) => ({ ...quest, version, title: version === 1 ? quest.title : '改版後の問題', optionalHintImage: imagePath(version) })
  let current: ReturnType<typeof publication> | undefined = publication(1)
  let initialImageMissing = true
  let imageAuthError: 'UNAUTHENTICATED' | 'FORBIDDEN' | null = null
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const path = String(input)
    expect(new Headers(init?.headers).has('Authorization')).toBe(false)
    if (path.startsWith('/api/v1/areas?')) return Response.json({ items: current ? [area] : [{ ...area, publishedCount: 0 }], nextCursor: null }, { headers })
    if (path.startsWith('/api/v1/quests?')) return Response.json({ items: current ? [current] : [], nextCursor: null }, { headers })
    if (path === `/api/v1/quests/${quest.questId}`) {
      return current ? Response.json(current, { headers }) : Response.json({ error: { code: 'NOT_FOUND', retryable: false } }, { status: 404, headers })
    }
    if (path.startsWith(`/api/v1/quests/${quest.questId}/hint-image?expectedVersion=`)) {
      const version = Number(new URL(path, 'http://localhost').searchParams.get('expectedVersion'))
      if (!current) return Response.json({ error: { code: 'NOT_FOUND', retryable: false } }, { status: 404, headers })
      if (current.version !== version) return Response.json({ error: { code: 'QUEST_CHANGED', retryable: false } }, { status: 409, headers })
      if (imageAuthError) return Response.json({ error: { code: imageAuthError, retryable: false } }, { status: imageAuthError === 'UNAUTHENTICATED' ? 401 : 403, headers })
      if (version === 1 && initialImageMissing) {
        initialImageMissing = false
        return Response.json({ error: { code: 'NOT_FOUND', retryable: false } }, { status: 404, headers })
      }
      return new Response(new Uint8Array([255, 216, 255, 217]), { headers: { ...headers, 'Content-Type': 'image/jpeg' } })
    }
    throw new Error(`Unexpected request: ${path}`)
  })
  vi.stubGlobal('fetch', fetcher)
  try {
    render(<TeamPreview />)
    await user.click(await screen.findByRole('button', { name: quest.title + 'の詳細を見る' }))
    expect(await screen.findByRole('heading', { name: quest.title })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'ヒント画像' }))
    expect(await screen.findByText(/問題の再読込が必要/)).toBeVisible()
    expect(screen.getByRole('button', { name: '問題を再読込' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'ヒント画像' }))
    await user.click(screen.getByRole('button', { name: 'ヒント画像' }))
    expect(screen.queryByRole('button', { name: '問題を再読込' })).not.toBeInTheDocument()
    const firstImage = await screen.findByAltText(quest.title + 'のヒント画像')
    fireEvent.load(firstImage)
    expect(firstImage).toBeVisible()

    // A D-side publication replaces the image and increments the published version.
    current = publication(2)
    await user.click(screen.getByRole('button', { name: 'ヒント画像' }))
    await user.click(screen.getByRole('button', { name: 'ヒント画像' }))
    expect(await screen.findByText(/問題更新/)).toBeVisible()
    expect(screen.getByRole('button', { name: '問題を再読込' })).toBeVisible()
    screen.getByRole('button', { name: '問題を再読込' }).focus()
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('heading', { name: '改版後の問題' })).toBeVisible()
    expect(screen.getByRole('button', { name: '更新する' })).toHaveFocus()
    // 一覧の中の詳細には開閉ボタンは無く、選択中は常に開いている（D-65）。
    await user.click(screen.getByRole('button', { name: 'ヒント画像' }))
    const revisedImage = await screen.findByAltText('改版後の問題のヒント画像')
    fireEvent.load(revisedImage)
    expect(revisedImage).toBeVisible()

    imageAuthError = 'UNAUTHENTICATED'
    await user.click(screen.getByRole('button', { name: 'ヒント画像' }))
    await user.click(screen.getByRole('button', { name: 'ヒント画像' }))
    expect(await screen.findByText(/画像表示失敗。再読込/)).toBeVisible()
    expect(screen.queryByRole('button', { name: '問題を再読込' })).not.toBeInTheDocument()
    imageAuthError = 'FORBIDDEN'
    await user.click(screen.getByRole('button', { name: '再試行' }))
    expect(await screen.findByText(/画像アクセス拒否/)).toBeVisible()
    expect(screen.queryByRole('button', { name: '問題を再読込' })).not.toBeInTheDocument()
    imageAuthError = null
    await user.click(screen.getByRole('button', { name: '再試行' }))
    const recoveredImage = await screen.findByAltText('改版後の問題のヒント画像')
    fireEvent.load(recoveredImage)
    expect(recoveredImage).toBeVisible()

    // A later pause makes the public image unavailable; the existing reload action drops the listing.
    current = undefined
    await user.click(screen.getByRole('button', { name: 'ヒント画像' }))
    await user.click(screen.getByRole('button', { name: 'ヒント画像' }))
    expect(await screen.findByText(/問題の再読込が必要/)).toBeVisible()
    expect(screen.getByRole('button', { name: '問題を再読込' })).toBeVisible()
    screen.getByRole('button', { name: '問題を再読込' }).focus()
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('heading', { name: '問題なし' })).toBeVisible()
    expect(screen.getByRole('button', { name: '更新する' })).toHaveFocus()
    // 一覧の行から選んでも地域は選択されないため（D-65）、0件の文言は全域向けになる。
    expect(screen.getByText('問題なし')).toBeVisible()
    expect(screen.queryByRole('heading', { name: '改版後の問題' })).not.toBeInTheDocument()
    expect(screen.queryByAltText('改版後の問題のヒント画像')).not.toBeInTheDocument()
    expect(fetcher).toHaveBeenCalledWith(imagePath(1), expect.anything())
    expect(fetcher).toHaveBeenCalledWith(imagePath(2), expect.anything())
  } finally { vi.unstubAllGlobals() }
})

function adminGateFetcher(memberships: unknown[]) {
  return vi.fn<typeof fetch>(async (input) => {
    const path = String(input)
    if (path.startsWith('/api/v1/areas?')) return Response.json({ items: [area], nextCursor: null }, { headers })
    if (path.startsWith('/api/v1/quests?')) return Response.json({ items: [quest], nextCursor: null }, { headers })
    if (path === '/api/v1/quests/' + quest.questId) return Response.json(quest, { headers })
    if (path.startsWith('/api/v1/me/memberships?')) return Response.json({ items: memberships, nextCursor: null }, { headers })
    throw new Error('Unexpected request: ' + path)
  })
}

it('does not render the admin entrance while signed out and never asks for memberships', async () => {
  const auth: AuthClient = {
    getSnapshot: () => signedOut, subscribe: () => () => {},
    signInWithGoogle: vi.fn(), signOut: vi.fn(), getIdToken: vi.fn(async () => null),
  }
  const fetcher = adminGateFetcher([])
  vi.stubGlobal('fetch', fetcher)
  render(<TeamPreview authClient={auth} />)
  expect(await screen.findByRole('button', { name: quest.title + 'の詳細を見る' })).toBeVisible()
  expect(screen.queryByRole('link', { name: '自治体画面' })).not.toBeInTheDocument()
  expect(screen.queryByRole('menuitem', { name: '自治体画面' })).not.toBeInTheDocument()
  expect(fetcher.mock.calls.some(([path]) => String(path).startsWith('/api/v1/me/memberships'))).toBe(false)
  // 未ログイン時は、固定スロットに「ログイン」だけが出る（ログイン状態の常時表示は無い）。
  const accountArea = document.querySelector('.account-area')!
  const loginButton = screen.getByRole('button', { name: 'ログイン' })
  expect(loginButton.parentElement).toBe(accountArea)
  expect(accountArea.querySelector('.account-status')).not.toBeInTheDocument()
  expect(screen.queryByText('ゲストで閲覧中')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'ログアウト' })).not.toBeInTheDocument()
})

it('does not render the admin entrance for a signed-in traveler without a membership', async () => {
  const signedIn = { status: 'signed-in', user: { uid: 'traveler-b', displayName: null } } as const
  const auth: AuthClient = {
    getSnapshot: () => signedIn, subscribe: () => () => {},
    signInWithGoogle: vi.fn(), signOut: vi.fn(), getIdToken: vi.fn(async () => 'team-token'),
  }
  vi.stubGlobal('fetch', adminGateFetcher([]))
  const user = userEvent.setup()
  render(<TeamPreview authClient={auth} />)
  expect(await screen.findByRole('button', { name: quest.title + 'の詳細を見る' })).toBeVisible()
  // 所属の確認が終わっても入口は出ない（DOMに存在しない）。アカウントメニューを開いても同様（D-47）。
  await new Promise((resolve) => setTimeout(resolve, 50))
  expect(screen.queryByRole('link', { name: '自治体画面' })).not.toBeInTheDocument()
  expect(screen.queryByRole('menuitem', { name: '自治体画面' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'アカウントメニュー' }))
  expect(await screen.findByRole('menuitem', { name: 'ログアウト' })).toBeVisible()
  expect(screen.queryByRole('link', { name: '自治体画面' })).not.toBeInTheDocument()
  expect(screen.queryByRole('menuitem', { name: '自治体画面' })).not.toBeInTheDocument()
})

it('renders the admin entrance only for a signed-in account with a membership', async () => {
  const signedIn = { status: 'signed-in', user: { uid: 'editor-a', displayName: null } } as const
  const auth: AuthClient = {
    getSnapshot: () => signedIn, subscribe: () => () => {},
    signInWithGoogle: vi.fn(), signOut: vi.fn(), getIdToken: vi.fn(async () => 'team-token'),
  }
  const membership = { orgId: 'demo-org', areaId: 'demo-area', label: '架空の自治体', role: 'publisher' }
  vi.stubGlobal('fetch', adminGateFetcher([membership]))
  const user = userEvent.setup()
  render(<TeamPreview authClient={auth} />)
  expect(await screen.findByRole('button', { name: quest.title + 'の詳細を見る' })).toBeVisible()
  // ログイン時は同じスロットにアカウントアイコンだけが出て、「ログイン」と状態表示は出ない。
  const accountArea = document.querySelector('.account-area')!
  const accountButton = screen.getByRole('button', { name: 'アカウントメニュー' })
  expect(accountArea.contains(accountButton)).toBe(true)
  expect(accountArea.querySelector('.account-status')).not.toBeInTheDocument()
  expect(screen.queryByText('Googleログイン済み')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'ログイン' })).not.toBeInTheDocument()
  // 自治体画面への入口はナビ／タブバーには出さず、アカウントメニューの中だけに置く（D-47）。
  const desktopNav = screen.getByRole('navigation', { name: '主要ナビゲーション' })
  const mobileNav = screen.getByRole('navigation', { name: 'スマホ用ナビゲーション' })
  expect(within(desktopNav).queryByRole('link', { name: '自治体画面' })).not.toBeInTheDocument()
  expect(within(mobileNav).queryByRole('link', { name: '自治体画面' })).not.toBeInTheDocument()
  await user.click(accountButton)
  const entrance = await screen.findByRole('menuitem', { name: '自治体画面' })
  expect(entrance).toHaveAttribute('href', '/admin')
  expect(document.querySelector('.account-menu')).toContainElement(entrance)
})
