import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { area, quest } from '../../shared/api/testFixtures'
import type { AuthClient, AuthSnapshot } from '../auth/authTypes'
import { TeamPreview } from './TeamPreview'

it('loads the catalog and hint photo only for a verified member and clears them on logout', async () => {
  const user = userEvent.setup()
  let snapshot: AuthSnapshot = { status: 'signed-out', user: null }
  const listeners = new Set<() => void>()
  function setAccount(uid?: string) {
    snapshot = uid ? { status: 'signed-in', user: { uid, displayName: null } } : { status: 'signed-out', user: null }
    listeners.forEach((listener) => listener())
  }
  const auth: AuthClient = {
    getSnapshot: () => snapshot,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    signInWithGoogle: async () => setAccount('member'), signOut: async () => setAccount(),
    getIdToken: async () => snapshot.user?.uid ?? null,
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
    const authorization = new Headers(init?.headers).get('Authorization')
    const headers = { 'X-Quest-Data-Mode': 'team-preview' }
    if (authorization === 'Bearer outsider' && path === '/api/v1/session') {
      return Response.json({ error: { code: 'FORBIDDEN', retryable: false } }, { status: 403, headers })
    }
    expect(authorization).toBe('Bearer member')
    if (path === '/api/v1/session') return Response.json({ uid: 'member' }, { headers })
    if (path.startsWith('/api/v1/areas?')) return Response.json({ items: [area], nextCursor: null }, { headers })
    if (path.startsWith('/api/v1/quests?')) return Response.json({ items: [published], nextCursor: null }, { headers })
    if (path === '/api/v1/quests/' + quest.questId) return Response.json(published, { headers })
    if (path === hintPath) return new Response(new Uint8Array([255, 216, 255, 217]), { headers: { ...headers, 'Content-Type': 'image/jpeg' } })
    throw new Error('Unexpected team request: ' + path)
  })
  vi.stubGlobal('fetch', fetcher)
  render(<TeamPreview authClient={auth} />)
  expect(fetcher).not.toHaveBeenCalled()
  act(() => setAccount('outsider'))
  expect(await screen.findByRole('alert')).toHaveTextContent('招待されていません')
  expect(fetcher.mock.calls.map(([path]) => path)).toEqual(['/api/v1/session'])
  await user.click(screen.getByRole('button', { name: 'ログアウト' }))
  await user.click(screen.getByRole('button', { name: 'Googleログイン' }))
  expect(await screen.findByRole('heading', { name: quest.title })).toBeVisible()
  await user.click(screen.getByRole('button', { name: '問題を見てみる' }))
  expect(screen.queryByRole('button', { name: '挑戦を始める' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'ヒント画像を見る' }))
  const hint = await screen.findByAltText(quest.title + 'のヒント画像')
  fireEvent.load(hint)
  expect(hint).toBeVisible()
  expect(hint).toHaveAttribute('src', 'blob:team-hint')
  expect(fetcher.mock.calls.filter(([path]) => path === hintPath)).toHaveLength(1)
  expect(revokeObjectURL).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'ログアウト' }))
  await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:team-hint'))
  expect(revokeObjectURL).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole('heading', { name: quest.title })).not.toBeInTheDocument()
})

it('recovers a protected published hint image after revision and removes it after publication is paused', async () => {
  const user = userEvent.setup()
  let snapshot: AuthSnapshot = { status: 'signed-in', user: { uid: 'member', displayName: null } }
  const listeners = new Set<() => void>()
  const auth: AuthClient = {
    getSnapshot: () => snapshot,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    signInWithGoogle: async () => {}, signOut: async () => {}, getIdToken: async () => 'member',
  }
  const headers = { 'X-Quest-Data-Mode': 'team-preview' }
  const imagePath = (version: number) => `/api/v1/quests/${quest.questId}/hint-image?expectedVersion=${version}`
  const publication = (version: number) => ({ ...quest, version, title: version === 1 ? quest.title : '改版後の問題', optionalHintImage: imagePath(version) })
  let current: ReturnType<typeof publication> | undefined = publication(1)
  let initialImageMissing = true
  let imageAuthError: 'UNAUTHENTICATED' | 'FORBIDDEN' | null = null
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const path = String(input)
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer member')
    if (path === '/api/v1/session') return Response.json({ uid: 'member' }, { headers })
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
    render(<TeamPreview authClient={auth} />)
    expect(await screen.findByRole('heading', { name: quest.title })).toBeVisible()
    await user.click(screen.getByRole('button', { name: '問題を見てみる' }))
    await user.click(screen.getByRole('button', { name: 'ヒント画像を見る' }))
    expect(await screen.findByText(/公開情報が変わった可能性があります/)).toBeVisible()
    expect(screen.getByRole('button', { name: '問題を読みなおす' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'ヒント画像を閉じる' }))
    await user.click(screen.getByRole('button', { name: 'ヒント画像を見る' }))
    expect(screen.queryByRole('button', { name: '問題を読みなおす' })).not.toBeInTheDocument()
    const firstImage = await screen.findByAltText(quest.title + 'のヒント画像')
    fireEvent.load(firstImage)
    expect(firstImage).toBeVisible()

    // A D-side publication replaces the image and increments the published version.
    current = publication(2)
    await user.click(screen.getByRole('button', { name: 'ヒント画像を閉じる' }))
    await user.click(screen.getByRole('button', { name: 'ヒント画像を見る' }))
    expect(await screen.findByText(/問題の版が変わりました/)).toBeVisible()
    expect(screen.getByRole('button', { name: '問題を読みなおす' })).toBeVisible()
    screen.getByRole('button', { name: '問題を読みなおす' }).focus()
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('heading', { name: '改版後の問題' })).toBeVisible()
    expect(screen.getByRole('button', { name: '公開情報を更新' })).toHaveFocus()
    await user.click(screen.getByRole('button', { name: '問題を見てみる' }))
    await user.click(screen.getByRole('button', { name: 'ヒント画像を見る' }))
    const revisedImage = await screen.findByAltText('改版後の問題のヒント画像')
    fireEvent.load(revisedImage)
    expect(revisedImage).toBeVisible()

    imageAuthError = 'UNAUTHENTICATED'
    await user.click(screen.getByRole('button', { name: 'ヒント画像を閉じる' }))
    await user.click(screen.getByRole('button', { name: 'ヒント画像を見る' }))
    expect(await screen.findByText(/画面上部のログアウトからGoogleログインし直した後/)).toBeVisible()
    expect(screen.queryByRole('button', { name: '問題を読みなおす' })).not.toBeInTheDocument()
    imageAuthError = 'FORBIDDEN'
    await user.click(screen.getByRole('button', { name: 'ヒント画像を再試行' }))
    expect(await screen.findByText(/共有検証の参加権限を確認/)).toBeVisible()
    expect(screen.queryByRole('button', { name: '問題を読みなおす' })).not.toBeInTheDocument()
    imageAuthError = null
    await user.click(screen.getByRole('button', { name: 'ヒント画像を再試行' }))
    const recoveredImage = await screen.findByAltText('改版後の問題のヒント画像')
    fireEvent.load(recoveredImage)
    expect(recoveredImage).toBeVisible()

    // A later pause makes the protected image unavailable; the existing reload action drops the listing.
    current = undefined
    await user.click(screen.getByRole('button', { name: 'ヒント画像を閉じる' }))
    await user.click(screen.getByRole('button', { name: 'ヒント画像を見る' }))
    expect(await screen.findByText(/公開情報が変わった可能性があります/)).toBeVisible()
    expect(screen.getByRole('button', { name: '問題を読みなおす' })).toBeVisible()
    screen.getByRole('button', { name: '問題を読みなおす' }).focus()
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('heading', { name: '公開問題はありません' })).toBeVisible()
    expect(screen.getByRole('button', { name: '公開情報を更新' })).toHaveFocus()
    expect(screen.getByText('現在選べる公開問題はありません。')).toBeVisible()
    expect(screen.queryByRole('heading', { name: '改版後の問題' })).not.toBeInTheDocument()
    expect(screen.queryByAltText('改版後の問題のヒント画像')).not.toBeInTheDocument()
    expect(fetcher).toHaveBeenCalledWith(imagePath(1), expect.anything())
    expect(fetcher).toHaveBeenCalledWith(imagePath(2), expect.anything())
  } finally { vi.unstubAllGlobals() }
})

it('hides account A and discards its late hint response while account B identity is pending', async () => {
  const user = userEvent.setup()
  let snapshot: AuthSnapshot = { status: 'signed-in', user: { uid: 'member-a', displayName: null } }
  const listeners = new Set<() => void>()
  const auth: AuthClient = {
    getSnapshot: () => snapshot,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    signInWithGoogle: async () => {}, signOut: async () => {},
    getIdToken: async () => snapshot.status === 'signed-in' ? snapshot.user.uid : null,
  }
  let resolveAccountB!: (response: Response) => void
  let resolveHintA!: (response: Response) => void
  const accountBSession = new Promise<Response>((resolve) => { resolveAccountB = resolve })
  const hintAResponse = new Promise<Response>((resolve) => { resolveHintA = resolve })
  const headers = { 'X-Quest-Data-Mode': 'team-preview' }
  const published = { ...quest, optionalHintImage: '/api/v1/quests/' + quest.questId + '/hint-image?expectedVersion=1' }
  const createObjectURL = vi.fn(() => 'blob:member-a-hint')
  const revokeObjectURL = vi.fn()
  vi.stubGlobal('URL', class extends URL { static createObjectURL = createObjectURL; static revokeObjectURL = revokeObjectURL })
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const path = String(input)
    const uid = new Headers(init?.headers).get('Authorization')?.replace('Bearer ', '')
    if (path === '/api/v1/session' && uid === 'member-a') return Response.json({ uid: 'member-a' }, { headers })
    if (path === '/api/v1/session' && uid === 'member-b') return accountBSession
    if (uid === 'member-a' && path === published.optionalHintImage) return hintAResponse
    if ((uid === 'member-a' || uid === 'member-b') && path.startsWith('/api/v1/areas?')) return Response.json({ items: [area], nextCursor: null }, { headers })
    if ((uid === 'member-a' || uid === 'member-b') && path.startsWith('/api/v1/quests?')) return Response.json({ items: [published], nextCursor: null }, { headers })
    if ((uid === 'member-a' || uid === 'member-b') && path === '/api/v1/quests/' + quest.questId) return Response.json(published, { headers })
    throw new Error('Unexpected account request: ' + path + ' for ' + uid)
  })
  vi.stubGlobal('fetch', fetcher)
  try {
    render(<TeamPreview authClient={auth} />)
    expect(await screen.findByRole('heading', { name: quest.title })).toBeVisible()
    await user.click(screen.getByRole('button', { name: '問題を見てみる' }))
    await user.click(screen.getByRole('button', { name: 'ヒント画像を見る' }))
    await waitFor(() => expect(fetcher).toHaveBeenCalledWith(published.optionalHintImage, expect.anything()))

    act(() => {
      snapshot = { status: 'signed-in', user: { uid: 'member-b', displayName: null } }
      listeners.forEach((listener) => listener())
    })
    expect(screen.queryByRole('heading', { name: quest.title })).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('確認しています')
    await act(async () => resolveHintA(new Response(new Uint8Array([255, 216, 255, 217]), { headers: { ...headers, 'Content-Type': 'image/jpeg' } })))
    expect(createObjectURL).not.toHaveBeenCalled()
    expect(screen.queryByRole('heading', { name: quest.title })).not.toBeInTheDocument()

    await act(async () => resolveAccountB(Response.json({ uid: 'member-b' }, { headers })))
    expect(await screen.findByRole('heading', { name: quest.title })).toBeVisible()
    expect(screen.queryByAltText(quest.title + 'のヒント画像')).not.toBeInTheDocument()
    expect(revokeObjectURL).not.toHaveBeenCalled()
  } finally { vi.unstubAllGlobals() }
})
