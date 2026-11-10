import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import App from '../../App'
import type { AuthClient, AuthSnapshot } from './authTypes'
import { AuthError } from './firebaseAuth'

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
  return { client, emit }
}

async function openQuest() {
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: '問題を見る' }))
  return { user, details: screen.getByRole('region', { name: 'サンプル問題の詳細' }) }
}

describe('Google sign-in from the selected quest', () => {
  it('keeps browsing anonymous and starts sign-in only on the challenge action', async () => {
    const { client } = authFixture()
    render(<App authClient={client} />)
    const { user, details } = await openQuest()
    expect(client.signInWithGoogle).not.toHaveBeenCalled()
    await user.click(within(details).getByRole('button', { name: 'Googleでログイン' }))
    expect(client.signInWithGoogle).toHaveBeenCalledTimes(1)
    expect(details).toBeVisible()
    expect(details).toHaveTextContent('謎')
    // ログイン完了は、状態表示ではなくヘッダーのアカウントアイコンで分かる。
    expect(await screen.findByRole('button', { name: 'アカウントメニュー' })).toBeVisible()
    expect(screen.queryByText('Googleログイン済み')).not.toBeInTheDocument()
    expect(within(details).getByRole('button', { name: '撮影する' })).toBeEnabled()
  })
  it('keeps the selected question after cancellation and permits another attempt', async () => {
    const { client } = authFixture()
    vi.mocked(client.signInWithGoogle).mockRejectedValue(new AuthError('cancelled'))
    render(<App authClient={client} />)
    const { user, details } = await openQuest()
    await user.click(within(details).getByRole('button', { name: 'Googleでログイン' }))
    expect(await screen.findByText('ログインをキャンセルしました。問題の閲覧を続けられます。')).toBeVisible()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(details).toBeVisible()
    expect(within(details).getByRole('button', { name: 'Googleでログイン' })).toBeEnabled()
  })
  it('shows a useful error without losing the selected question', async () => {
    const { client } = authFixture()
    vi.mocked(client.signInWithGoogle).mockRejectedValue(new AuthError('popup-blocked'))
    render(<App authClient={client} />)
    const { user, details } = await openQuest()
    await user.click(within(details).getByRole('button', { name: 'Googleでログイン' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('ポップアップを許可')
    expect(details).toBeVisible()
    expect(within(details).getByRole('button', { name: 'Googleでログイン' })).toBeEnabled()
  })
  it('waits for session restoration without blocking reading', async () => {
    const { client } = authFixture({ status: 'checking', user: null })
    render(<App authClient={client} />)
    const { details } = await openQuest()
    expect(details).toBeVisible()
    // 確認中はヘッダーに状態表示を出さず、ログインアイコンは無効のままスロットに残る。
    expect(screen.queryByText('ログイン状態を確認中')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'ログイン' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'アカウントメニュー' })).not.toBeInTheDocument()
    expect(within(details).getByRole('button', { name: 'Googleでログイン' })).toBeDisabled()
  })
  it('restores an existing session, avoids another sign-in, and supports sign-out', async () => {
    const { client } = authFixture({ status: 'signed-in', user: { uid: 'restored-user', displayName: 'テスト利用者' } })
    render(<App authClient={client} />)
    const { user, details } = await openQuest()
    expect(screen.getByRole('button', { name: 'アカウントメニュー' })).toBeVisible()
    expect(within(details).getByRole('button', { name: '撮影する' })).toBeEnabled()
    expect(client.signInWithGoogle).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'アカウントメニュー' }))
    await user.click(screen.getByRole('menuitem', { name: 'ログアウト' }))
    await waitFor(() => expect(client.signOut).toHaveBeenCalledTimes(1))
    expect(await within(details).findByRole('button', { name: 'Googleでログイン' })).toBeEnabled()
    expect(details).toBeVisible()
  })
  it('does not echo unknown raw authentication errors into the page', async () => {
    const { client } = authFixture()
    vi.mocked(client.signInWithGoogle).mockRejectedValue(new Error('private-token-and-email'))
    render(<App authClient={client} />)
    const { user, details } = await openQuest()
    await user.click(within(details).getByRole('button', { name: 'Googleでログイン' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('ログイン処理を完了できませんでした')
    expect(document.body).not.toHaveTextContent('private-token-and-email')
  })
  it('shows the profile photo in the account icon and opens a small menu with the name and sign-out', async () => {
    const { client } = authFixture({ status: 'signed-in', user: { uid: 'photo-user', displayName: '写真利用者', photoURL: 'https://example.com/photo.png' } })
    render(<App authClient={client} />)
    const user = userEvent.setup()
    const button = screen.getByRole('button', { name: 'アカウントメニュー' })
    expect(button.querySelector('img')).toHaveAttribute('src', 'https://example.com/photo.png')
    await user.click(button)
    expect(screen.getByRole('menu')).toHaveTextContent('写真利用者')
    expect(screen.getByRole('menuitem', { name: 'ログアウト' })).toBeVisible()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
  it('falls back to the display name initial when there is no profile photo', async () => {
    const { client } = authFixture({ status: 'signed-in', user: { uid: 'initial-user', displayName: '頭文字の人' } })
    render(<App authClient={client} />)
    const button = screen.getByRole('button', { name: 'アカウントメニュー' })
    expect(button).toHaveTextContent('頭')
    expect(button.querySelector('img')).toBeNull()
  })
  it('keeps the signed-in state visible when sign-out fails', async () => {
    const { client } = authFixture({ status: 'signed-in', user: { uid: 'test-user', displayName: 'テスト利用者' } })
    vi.mocked(client.signOut).mockRejectedValue(new AuthError('network'))
    render(<App authClient={client} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'アカウントメニュー' }))
    await user.click(screen.getByRole('menuitem', { name: 'ログアウト' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('通信を確認')
    expect(screen.getByRole('button', { name: 'アカウントメニュー' })).toBeEnabled()
  })
})
