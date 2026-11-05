import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getApps, initializeApp } from 'firebase/app'
import type { FirebaseApp } from 'firebase/app'
import { getAuth, onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth'
import type { Auth, User } from 'firebase/auth'
import { createFirebaseAuthClient } from './firebaseAuth'
import { configuredEnv } from './testFixtures'

vi.mock('firebase/app', () => ({ getApps: vi.fn(), initializeApp: vi.fn() }))
vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(), onAuthStateChanged: vi.fn(), signInWithPopup: vi.fn(), signOut: vi.fn(),
  GoogleAuthProvider: class { setCustomParameters = vi.fn() },
}))

let notify: (user: User | null) => void
let fail: (error: Error) => void
let auth: Auth
const stop = vi.fn()
const ready = vi.fn(async () => {})
const token = vi.fn(async () => 'firebase-id-token')
const user = { uid: 'test-user', displayName: 'テスト利用者', getIdToken: token } as unknown as User
const app = { name: 'tourism-quest-web', options: {
  apiKey: 'test-api-key', authDomain: 'test-project.firebaseapp.com', projectId: 'test-project',
  storageBucket: 'test-project.firebasestorage.app', messagingSenderId: '123456', appId: '1:123456:web:test',
} } as FirebaseApp

beforeEach(() => {
  auth = { currentUser: null, authStateReady: ready, languageCode: null } as unknown as Auth
  vi.mocked(getApps).mockReturnValue([])
  vi.mocked(initializeApp).mockReturnValue(app)
  vi.mocked(getAuth).mockReturnValue(auth)
  vi.mocked(signInWithPopup).mockResolvedValue({ user } as never)
  vi.mocked(signOut).mockResolvedValue(undefined)
  vi.mocked(onAuthStateChanged).mockImplementation((_auth, next, error) => {
    if (typeof next !== 'function') throw new Error('Expected auth callback')
    notify = next
    fail = error!
    return stop
  })
})

describe('Firebase Auth adapter', () => {
  it('does not initialize Firebase for missing or incomplete configuration', () => {
    expect(createFirebaseAuthClient({}).getSnapshot().status).toBe('unconfigured')
    expect(createFirebaseAuthClient({ VITE_FIREBASE_API_KEY: 'partial' }).getSnapshot().status).toBe('unavailable')
    expect(initializeApp).not.toHaveBeenCalled()
    expect(getAuth).not.toHaveBeenCalled()
  })
  it('initializes the configured app and reuses it during remounts', () => {
    const client = createFirebaseAuthClient(configuredEnv)
    expect(client.getSnapshot().status).toBe('checking')
    expect(initializeApp).toHaveBeenCalledWith(app.options, 'tourism-quest-web')
    vi.mocked(getApps).mockReturnValue([app])
    createFirebaseAuthClient(configuredEnv)
    expect(initializeApp).toHaveBeenCalledTimes(1)
  })
  it('does not reuse an app that belongs to a different project configuration', () => {
    vi.mocked(getApps).mockReturnValue([{ ...app, options: { ...app.options, projectId: 'different-project' } }])
    expect(createFirebaseAuthClient(configuredEnv).getSnapshot().status).toBe('unavailable')
    expect(getAuth).not.toHaveBeenCalled()
  })
  it('reflects only observed sign-in state and releases the observer', () => {
    const client = createFirebaseAuthClient(configuredEnv)
    const listener = vi.fn()
    const unsubscribe = client.subscribe(listener)
    notify(null)
    expect(client.getSnapshot()).toEqual({ status: 'signed-out', user: null })
    notify(user)
    expect(client.getSnapshot()).toEqual({ status: 'signed-in', user: { uid: 'test-user', displayName: 'テスト利用者' } })
    expect(listener).toHaveBeenCalledTimes(2)
    unsubscribe()
    expect(stop).toHaveBeenCalledTimes(1)
  })
  it('opens one Google popup directly from the click and does not fabricate signed-in state', async () => {
    const client = createFirebaseAuthClient(configuredEnv)
    const first = client.signInWithGoogle()
    const second = client.signInWithGoogle()
    expect(signInWithPopup).toHaveBeenCalledTimes(1)
    await Promise.all([first, second])
    expect(client.getSnapshot().status).toBe('checking')
  })
  it.each([
    ['auth/popup-closed-by-user', 'cancelled'],
    ['auth/cancelled-popup-request', 'cancelled'],
    ['auth/popup-blocked', 'popup-blocked'],
    ['auth/unauthorized-domain', 'unauthorized-domain'],
    ['auth/network-request-failed', 'network'],
    ['auth/operation-not-allowed', 'disabled'],
  ])('maps %s to a safe %s error', async (code, expected) => {
    vi.mocked(signInWithPopup).mockRejectedValue({ code, message: 'private-value', customData: { email: 'private@example.invalid' } })
    const client = createFirebaseAuthClient(configuredEnv)
    await expect(client.signInWithGoogle()).rejects.toMatchObject({ code: expected })
    await expect(client.signInWithGoogle()).rejects.not.toThrow('private-value')
  })
  it('waits for restored auth state before retrieving a Firebase ID token', async () => {
    const client = createFirebaseAuthClient(configuredEnv)
    let restore!: () => void
    ready.mockImplementationOnce(() => new Promise<void>((resolve) => { restore = resolve }))
    const result = client.getIdToken()
    expect(token).not.toHaveBeenCalled()
    Object.defineProperty(auth, 'currentUser', { value: user })
    restore()
    expect(await result).toBe('firebase-id-token')
    expect(ready).toHaveBeenCalledTimes(1)
    expect(token).toHaveBeenCalledWith()
  })
  it('signs out through Firebase and keeps observer failures distinct from successful auth', async () => {
    const client = createFirebaseAuthClient(configuredEnv)
    client.subscribe(() => {})
    notify(user)
    await client.signOut()
    expect(signOut).toHaveBeenCalledWith(auth)
    fail(new Error('private-value'))
    expect(client.getSnapshot()).toMatchObject({ status: 'unavailable', user: null })
    expect(JSON.stringify(client.getSnapshot())).not.toContain('private-value')
  })
})
