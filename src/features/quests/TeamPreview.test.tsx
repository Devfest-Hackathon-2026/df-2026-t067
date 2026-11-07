import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { area, quest } from '../../shared/api/testFixtures'
import type { AuthClient } from '../auth/authTypes'
import { TeamPreview } from './TeamPreview'

const signedOut = { status: 'signed-out', user: null } as const
const headers = { 'X-Quest-Data-Mode': 'team-preview' }

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
  expect(await screen.findByRole('heading', { name: quest.title })).toBeVisible()
  expect(screen.getByRole('region', { name: '全国の謎' })).toBeVisible()
  await user.click(screen.getByRole('button', { name: '問題を見てみる' }))
  expect(screen.queryByRole('button', { name: 'Googleログインして挑戦する' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'ヒント画像を見る' }))
  const hint = await screen.findByAltText(quest.title + 'のヒント画像')
  fireEvent.load(hint)
  expect(hint).toBeVisible()
  expect(hint).toHaveAttribute('src', 'blob:team-hint')
  expect(auth.getIdToken).not.toHaveBeenCalled()
  view.unmount()
  expect(revokeObjectURL).toHaveBeenCalledWith('blob:team-hint')
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
    throw new Error('Unexpected request: ' + path)
  })
  vi.stubGlobal('fetch', fetcher)
  const user = userEvent.setup()
  render(<TeamPreview authClient={auth} />)
  expect(await screen.findByRole('heading', { name: quest.title })).toBeVisible()
  expect(screen.getAllByRole('button', { name: /自分の記録/ }).length).toBeGreaterThan(0)
  await user.click(screen.getByRole('button', { name: '問題を見てみる' }))
  expect(await screen.findByRole('button', { name: '挑戦を始める' })).toBeVisible()
  vi.unstubAllEnvs()
})

it('shows the nationwide map even before the first problem is published', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ items: [], nextCursor: null }, { headers })))
  render(<TeamPreview />)
  expect(await screen.findByRole('heading', { name: '公開問題はありません' })).toBeVisible()
  expect(screen.getByRole('heading', { name: '全国から謎を探す' })).toBeVisible()
  expect(screen.getByRole('region', { name: '全国の謎' })).toBeVisible()
  expect(screen.getByRole('button', { name: '公開情報を更新' })).toBeVisible()
})
