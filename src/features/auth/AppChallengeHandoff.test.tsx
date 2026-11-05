import { act, render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import App from '../../App'
import type { AuthClient, AuthSnapshot } from './authTypes'
import { AuthError } from './firebaseAuth'
import { demoQuest } from '../quests/demoQuest'

function authFixture(initial: AuthSnapshot = { status: 'signed-out', user: null }) {
  let snapshot = initial
  const listeners = new Set<() => void>()
  const emit = (next: AuthSnapshot) => {
    snapshot = next
    for (const listener of listeners) listener()
  }
  const client: AuthClient = {
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
    signInWithGoogle: vi.fn(async () => { emit({ status: 'signed-in', user: { uid: 'test-user', displayName: 'テスト利用者' } }) }),
    signOut: vi.fn(async () => { emit({ status: 'signed-out', user: null }) }),
    getIdToken: vi.fn(async () => 'test-token'),
  }
  return { client, emit, onStartChallenge: vi.fn() }
}

async function openQuest() {
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: '問題を見てみる' }))
  return { user, details: screen.getByRole('region', { name: 'サンプル問題の詳細' }) }
}

describe('Google sign-in from the selected quest', () => {
  it('keeps browsing anonymous and starts sign-in only on the challenge action', async () => {
    const { client, onStartChallenge } = authFixture()
    render(<App authClient={client} onStartChallenge={onStartChallenge} />)
    const { user, details } = await openQuest()
    expect(client.signInWithGoogle).not.toHaveBeenCalled()
    await user.click(within(details).getByRole('button', { name: 'Googleログインして挑戦する' }))
    expect(client.signInWithGoogle).toHaveBeenCalledTimes(1)
    expect(details).toBeVisible()
    expect(details).toHaveTextContent('この場所はどこ？')
    expect(await screen.findByText('Googleログイン済み')).toBeVisible()
    expect(within(details).getByRole('button', { name: '挑戦を開始する' })).toBeEnabled()
    expect(onStartChallenge).toHaveBeenCalledWith({ questId: 'demo-harbor-clock', expectedVersion: 1 })
  })
  it('keeps the selected question after cancellation and permits another attempt', async () => {
    const { client, onStartChallenge } = authFixture()
    vi.mocked(client.signInWithGoogle).mockRejectedValue(new AuthError('cancelled'))
    render(<App authClient={client} onStartChallenge={onStartChallenge} />)
    const { user, details } = await openQuest()
    await user.click(within(details).getByRole('button', { name: 'Googleログインして挑戦する' }))
    expect(await screen.findByText('ログインをキャンセルしました。問題の閲覧を続けられます。')).toBeVisible()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(details).toBeVisible()
    expect(within(details).getByRole('button', { name: 'Googleログインして挑戦する' })).toBeEnabled()
    expect(onStartChallenge).not.toHaveBeenCalled()
  })
  it('shows a useful error without losing the selected question', async () => {
    const { client, onStartChallenge } = authFixture()
    vi.mocked(client.signInWithGoogle).mockRejectedValue(new AuthError('popup-blocked'))
    render(<App authClient={client} onStartChallenge={onStartChallenge} />)
    const { user, details } = await openQuest()
    await user.click(within(details).getByRole('button', { name: 'Googleログインして挑戦する' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('ポップアップを許可')
    expect(details).toBeVisible()
    expect(within(details).getByRole('button', { name: 'Googleログインして挑戦する' })).toBeEnabled()
    expect(onStartChallenge).not.toHaveBeenCalled()
  })
  it('waits for session restoration without blocking reading', async () => {
    const { client, onStartChallenge } = authFixture({ status: 'checking', user: null })
    render(<App authClient={client} onStartChallenge={onStartChallenge} />)
    const { details } = await openQuest()
    expect(details).toBeVisible()
    expect(screen.getByText('ログイン状態を確認中')).toBeVisible()
    expect(within(details).getByRole('button', { name: 'Googleログインして挑戦する' })).toBeDisabled()
  })
  it('restores an existing session, avoids another sign-in, and supports sign-out', async () => {
    const { client, onStartChallenge } = authFixture({ status: 'signed-in', user: { uid: 'restored-user', displayName: 'テスト利用者' } })
    render(<App authClient={client} onStartChallenge={onStartChallenge} />)
    const { user, details } = await openQuest()
    expect(screen.getByText('Googleログイン済み')).toBeVisible()
    expect(within(details).getByRole('button', { name: '挑戦を開始する' })).toBeEnabled()
    expect(client.signInWithGoogle).not.toHaveBeenCalled()
    await user.click(within(details).getByRole('button', { name: '挑戦を開始する' }))
    expect(onStartChallenge).toHaveBeenCalledWith({ questId: 'demo-harbor-clock', expectedVersion: 1 })
    await user.click(screen.getByRole('button', { name: 'ログアウト' }))
    await waitFor(() => expect(client.signOut).toHaveBeenCalledTimes(1))
    expect(await within(details).findByRole('button', { name: 'Googleログインして挑戦する' })).toBeEnabled()
    expect(details).toBeVisible()
  })
  it('does not echo unknown raw authentication errors into the page', async () => {
    const { client, onStartChallenge } = authFixture()
    vi.mocked(client.signInWithGoogle).mockRejectedValue(new Error('private-token-and-email'))
    render(<App authClient={client} onStartChallenge={onStartChallenge} />)
    const { user, details } = await openQuest()
    await user.click(within(details).getByRole('button', { name: 'Googleログインして挑戦する' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('ログイン処理を完了できませんでした')
    expect(document.body).not.toHaveTextContent('private-token-and-email')
    expect(onStartChallenge).not.toHaveBeenCalled()
  })
  it('keeps the signed-in state visible when sign-out fails', async () => {
    const { client, onStartChallenge } = authFixture({ status: 'signed-in', user: { uid: 'test-user', displayName: 'テスト利用者' } })
    vi.mocked(client.signOut).mockRejectedValue(new AuthError('network'))
    render(<App authClient={client} onStartChallenge={onStartChallenge} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'ログアウト' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('通信を確認')
    expect(screen.getByText('Googleログイン済み')).toBeVisible()
    expect(screen.getByRole('button', { name: 'ログアウト' })).toBeEnabled()
  })


  it('waits for auth state confirmation and forwards the selected id and exact version', async () => {
    const { client, emit, onStartChallenge } = authFixture()
    let resolvePopup!: () => void
    vi.mocked(client.signInWithGoogle).mockImplementation(() => new Promise((resolve) => { resolvePopup = resolve }))
    const quest = { ...demoQuest, questId: 'published-quest-42', version: 7, title: '更新された問題' }
    render(<App authClient={client} onStartChallenge={onStartChallenge} quest={quest} areaLabel="テスト地域" />)
    const { user } = await openQuest()
    expect(screen.getByRole('heading', { name: '更新された問題' })).toBeVisible()
    expect(within(screen.getByRole('article', { name: '更新された問題' })).getByText('テスト地域')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Googleログインして挑戦する' }))
    resolvePopup()
    await waitFor(() => expect(client.signInWithGoogle).toHaveResolved())
    expect(onStartChallenge).not.toHaveBeenCalled()
    emit({ status: 'signed-in', user: { uid: 'confirmed-user', displayName: null } })
    await waitFor(() => expect(onStartChallenge).toHaveBeenCalledWith({ questId: 'published-quest-42', expectedVersion: 7 }))
  })

  it('does not forward a stale selection when the quest changes during sign-in', async () => {
    const { client, emit, onStartChallenge } = authFixture()
    let resolvePopup!: () => void
    vi.mocked(client.signInWithGoogle).mockImplementation(() => new Promise((resolve) => { resolvePopup = resolve }))
    const first = { ...demoQuest, questId: 'first', version: 1 }
    const { rerender } = render(<App authClient={client} onStartChallenge={onStartChallenge} quest={first} />)
    const { user } = await openQuest()
    await user.click(screen.getByRole('button', { name: 'Googleログインして挑戦する' }))
    rerender(<App authClient={client} onStartChallenge={onStartChallenge} quest={{ ...demoQuest, questId: 'second', version: 3 }} />)
    resolvePopup()
    emit({ status: 'signed-in', user: { uid: 'confirmed-user', displayName: null } })
    await waitFor(() => expect(client.getSnapshot().status).toBe('signed-in'))
    await new Promise((resolve) => window.setTimeout(resolve, 0))
    expect(onStartChallenge).not.toHaveBeenCalled()
  })

  it('does not forward an older version of the same quest after an update', async () => {
    const { client, emit, onStartChallenge } = authFixture()
    let resolvePopup!: () => void
    vi.mocked(client.signInWithGoogle).mockImplementation(() => new Promise((resolve) => { resolvePopup = resolve }))
    const { rerender } = render(<App authClient={client} onStartChallenge={onStartChallenge} quest={{ ...demoQuest, questId: 'same', version: 4 }} />)
    const { user } = await openQuest()
    await user.click(screen.getByRole('button', { name: 'Googleログインして挑戦する' }))
    rerender(<App authClient={client} onStartChallenge={onStartChallenge} quest={{ ...demoQuest, questId: 'same', version: 5 }} />)
    resolvePopup()
    emit({ status: 'signed-in', user: { uid: 'confirmed-user', displayName: null } })
    await waitFor(() => expect(client.getSnapshot().status).toBe('signed-in'))
    await new Promise((resolve) => window.setTimeout(resolve, 0))
    expect(onStartChallenge).not.toHaveBeenCalled()
  })

  it('does not forward a pending challenge when the quest is closed and reopened', async () => {
    const user = userEvent.setup()
    const { client, emit, onStartChallenge } = authFixture()
    let resolveSignIn!: () => void
    vi.mocked(client.signInWithGoogle).mockImplementation(() => new Promise<void>((resolve) => { resolveSignIn = resolve }))
    render(<App authClient={client} onStartChallenge={onStartChallenge} />)
    await user.click(screen.getByRole('button', { name: '問題を見てみる' }))
    await user.click(screen.getByRole('button', { name: 'Googleログインして挑戦する' }))
    await waitFor(() => expect(resolveSignIn).toBeDefined())
    await user.click(screen.getByRole('button', { name: '問題を閉じる' }))
    await user.click(screen.getByRole('button', { name: '問題を見てみる' }))
    await act(async () => {
      resolveSignIn()
      emit({ status: 'signed-in', user: { uid: 'test-user', displayName: null } })
    })
    await waitFor(() => expect(client.getSnapshot().status).toBe('signed-in'))
    expect(onStartChallenge).not.toHaveBeenCalled()
  })

  it('does not hand off after the problem is closed', async () => {
    const { client, emit, onStartChallenge } = authFixture()
    let resolvePopup!: () => void
    vi.mocked(client.signInWithGoogle).mockImplementation(() => new Promise((resolve) => { resolvePopup = resolve }))
    render(<App authClient={client} onStartChallenge={onStartChallenge} />)
    const { user } = await openQuest()
    await user.click(screen.getByRole('button', { name: 'Googleログインして挑戦する' }))
    await user.click(screen.getByRole('button', { name: '問題を閉じる' }))
    resolvePopup()
    emit({ status: 'signed-in', user: { uid: 'confirmed-user', displayName: null } })
    await waitFor(() => expect(client.getSnapshot().status).toBe('signed-in'))
    expect(onStartChallenge).not.toHaveBeenCalled()
  })

  it('prevents duplicate challenge handoffs while the first is pending', async () => {
    const { client, onStartChallenge } = authFixture({ status: 'signed-in', user: { uid: 'user', displayName: null } })
    let resolveStart!: () => void
    onStartChallenge.mockImplementation(() => new Promise<void>((resolve) => { resolveStart = resolve }))
    render(<App authClient={client} onStartChallenge={onStartChallenge} quest={{ ...demoQuest, questId: 'other', version: 8 }} />)
    const { user, details } = await openQuest()
    const start = within(details).getByRole('button', { name: '挑戦を開始する' })
    await user.click(start)
    await user.click(start)
    expect(onStartChallenge).toHaveBeenCalledTimes(1)
    expect(onStartChallenge).toHaveBeenCalledWith({ questId: 'other', expectedVersion: 8 })
    await act(async () => resolveStart())
  })

  it('allows a new auth client to start while an old popup is pending', async () => {
    const first = authFixture()
    const next = authFixture()
    let resolvePopup!: () => void
    vi.mocked(first.client.signInWithGoogle).mockImplementation(() => new Promise<void>((resolve) => { resolvePopup = resolve }))
    const { rerender } = render(<App authClient={first.client} onStartChallenge={first.onStartChallenge} />)
    const { user } = await openQuest()
    await user.click(screen.getByRole('button', { name: 'Googleログインして挑戦する' }))
    rerender(<App authClient={next.client} onStartChallenge={next.onStartChallenge} />)
    await user.click(screen.getByRole('button', { name: 'Googleログインして挑戦する' }))
    await waitFor(() => expect(next.onStartChallenge).toHaveBeenCalledTimes(1))
    await act(async () => {
      first.emit({ status: 'signed-in', user: { uid: 'old-user', displayName: null } })
      resolvePopup()
    })
    expect(first.onStartChallenge).not.toHaveBeenCalled()
  })

  it('discards a pending handoff when the component unmounts', async () => {
    const { client, emit, onStartChallenge } = authFixture()
    let resolvePopup!: () => void
    vi.mocked(client.signInWithGoogle).mockImplementation(() => new Promise<void>((resolve) => { resolvePopup = resolve }))
    const { unmount } = render(<App authClient={client} onStartChallenge={onStartChallenge} />)
    const { user } = await openQuest()
    await user.click(screen.getByRole('button', { name: 'Googleログインして挑戦する' }))
    unmount()
    await act(async () => {
      emit({ status: 'signed-in', user: { uid: 'test-user', displayName: null } })
      resolvePopup()
    })
    expect(onStartChallenge).not.toHaveBeenCalled()
  })
})
