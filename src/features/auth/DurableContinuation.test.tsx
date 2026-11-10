import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { createApiClient } from '../../shared/api'
import { challenge, quest } from '../../shared/api/testFixtures'
import type { AuthClient, AuthSnapshot } from './authTypes'
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
function fixture() {
  let snapshot: AuthSnapshot = { status: 'signed-out', user: null }
  const listeners = new Set<() => void>()
  const emit = (next: AuthSnapshot) => { snapshot = next; listeners.forEach(fn => fn()) }
  const signedIn: AuthSnapshot = { status: 'signed-in', user: { uid: 'synthetic-user', displayName: null } }
  const auth: AuthClient = { getSnapshot: () => snapshot, subscribe: fn => { listeners.add(fn); return () => { listeners.delete(fn) } }, getIdToken: vi.fn(), signOut: vi.fn(), signInWithGoogle: vi.fn(async () => emit(signedIn)) }
  const createChallenge = vi.fn().mockResolvedValue(challenge)
  const getSession = vi.fn().mockResolvedValue({ uid: 'synthetic-user' })
  const api = { ...createApiClient(), createChallenge, getSession }
  vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { mediaDevices: { getUserMedia: vi.fn().mockRejectedValue(new Error('synthetic denial')) } }))
  return { auth, api, emit, createChallenge, getSession, signedIn }
}
describe.each(['durable-local', 'team-preview'] as const)('%s continuation', dataMode => {
it('continues explicit intent after verified sign-in without a second start press', async () => {
  const f = fixture()
  render(<App authClient={f.auth} apiClient={f.api} quest={quest} apiMode apiDataMode={dataMode} teamAnswerTrial />)
  fireEvent.click(screen.getByRole('button', { name: '問題を見る' }))
  fireEvent.click(screen.getByRole('button', { name: 'Googleでログイン' }))
  await waitFor(() => expect(f.createChallenge).toHaveBeenCalledTimes(1))
  expect(f.createChallenge.mock.calls[0][0]).toEqual({ questId: quest.questId, expectedVersion: quest.version })
})
it('does not continue an intent after an account change during server verification', async () => {
  const f = fixture()
  let resolve!: (value: { uid: string }) => void
  f.getSession.mockImplementation(() => new Promise(r => { resolve = r }))
  render(<App authClient={f.auth} apiClient={f.api} quest={quest} apiMode apiDataMode={dataMode} teamAnswerTrial />)
  fireEvent.click(screen.getByRole('button', { name: '問題を見る' }))
  fireEvent.click(screen.getByRole('button', { name: 'Googleでログイン' }))
  await waitFor(() => expect(f.getSession).toHaveBeenCalled())
  await act(async () => f.emit({ status: 'signed-in', user: { uid: 'other-user', displayName: null } }))
  await act(async () => resolve({ uid: 'other-user' }))
  expect(f.createChallenge).not.toHaveBeenCalled()
})

it.each(['cancel', 'quest', 'version', 'slow', 'reopen'] as const)('drops explicit continuation on %s', async mode => {
  const f = fixture()
  let finish!: () => void
  f.auth.signInWithGoogle = vi.fn(() => new Promise<void>((resolve, reject) => {
    finish = () => { if (mode === 'cancel') reject(new Error('synthetic cancelled')); else { f.emit(f.signedIn); resolve() } }
  }))
  const view = render(<App authClient={f.auth} apiClient={f.api} quest={quest} apiMode apiDataMode={dataMode} teamAnswerTrial />)
  fireEvent.click(screen.getByRole('button', { name: '問題を見る' }))
  fireEvent.click(screen.getByRole('button', { name: 'Googleでログイン' }))
  if (mode === 'quest' || mode === 'version') view.rerender(<App authClient={f.auth} apiClient={f.api}
    quest={mode === 'quest' ? { ...quest, questId: 'other' } : { ...quest, version: quest.version + 1 }} apiMode apiDataMode={dataMode} teamAnswerTrial />)
  if (mode === 'reopen') {
    fireEvent.click(screen.getByRole('button', { name: '問題を見る' }))
    fireEvent.click(screen.getByRole('button', { name: '問題を見る' }))
  }
  const now = Date.now()
  const clock = mode === 'slow' ? vi.spyOn(Date, 'now').mockReturnValue(now + 31000) : null
  await act(async () => finish())
  await waitFor(() => expect(f.auth.getSnapshot().status).toBe(mode === 'cancel' ? 'signed-out' : 'signed-in'))
  await act(async () => new Promise(resolve => setTimeout(resolve, 20)))
  expect(f.createChallenge).not.toHaveBeenCalled()
  clock?.mockRestore()
})

it('rejects an account switch before the sign-in promise resolves', async () => {
  const f = fixture()
  let finish!: () => void
  f.auth.signInWithGoogle = vi.fn(() => new Promise<void>(resolve => { finish = resolve }))
  render(<App authClient={f.auth} apiClient={f.api} quest={quest} apiMode apiDataMode={dataMode} teamAnswerTrial />)
  fireEvent.click(screen.getByRole('button', { name: '問題を見る' }))
  fireEvent.click(screen.getByRole('button', { name: 'Googleでログイン' }))
  await act(async () => { f.emit(f.signedIn); f.emit({ status: 'signed-in', user: { uid: 'other-user', displayName: null } }); finish() })
  await act(async () => new Promise(resolve => setTimeout(resolve, 20)))
  expect(f.createChallenge).not.toHaveBeenCalled()
})

})
