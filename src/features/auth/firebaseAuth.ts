import { getApps, initializeApp } from 'firebase/app'
import {
  getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut,
} from 'firebase/auth'
import type { Auth } from 'firebase/auth'
import type { AuthClient, AuthSnapshot } from './authTypes'
import { readFirebaseConfig } from './config'

export type AuthErrorCode = 'cancelled' | 'popup-blocked' | 'unauthorized-domain' | 'network' | 'disabled' | 'unavailable' | 'unknown'
export class AuthError extends Error {
  readonly code: AuthErrorCode
  constructor(code: AuthErrorCode) {
    const messages: Record<AuthErrorCode, string> = {
      cancelled: 'ログインをキャンセルしました。問題の閲覧を続けられます。',
      'popup-blocked': 'ログイン画面を開けませんでした。ポップアップを許可して、もう一度お試しください。',
      'unauthorized-domain': 'このアクセス元からログインできません。設定担当者に確認してください。',
      network: '通信を確認して、もう一度お試しください。',
      disabled: 'Googleログインを利用できません。設定担当者に確認してください。',
      unavailable: 'ログインの準備ができていません。設定担当者に確認してください。',
      unknown: 'ログイン処理を完了できませんでした。もう一度お試しください。',
    }
    super(messages[code])
    this.name = 'AuthError'
    this.code = code
  }
}

function authError(error: unknown): AuthError {
  const code = error !== null && typeof error === 'object' && 'code' in error ? error.code : undefined
  const codes: Record<string, AuthErrorCode> = {
    'auth/popup-closed-by-user': 'cancelled', 'auth/cancelled-popup-request': 'cancelled',
    'auth/popup-blocked': 'popup-blocked', 'auth/unauthorized-domain': 'unauthorized-domain',
    'auth/network-request-failed': 'network', 'auth/operation-not-allowed': 'disabled',
    'auth/too-many-requests': 'network', 'auth/invalid-api-key': 'unavailable',
    'auth/auth-domain-config-required': 'unavailable', 'auth/web-storage-unsupported': 'unavailable',
  }
  return new AuthError(typeof code === 'string' ? codes[code] ?? 'unknown' : 'unknown')
}

function disabledClient(snapshot: AuthSnapshot): AuthClient {
  return {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    signInWithGoogle: () => Promise.reject(new AuthError('unavailable')),
    signOut: () => Promise.reject(new AuthError('unavailable')),
    getIdToken: async () => null,
  }
}

export function createFirebaseAuthClient(env: Readonly<Record<string, unknown>> = import.meta.env): AuthClient {
  if (typeof window === 'undefined') return disabledClient({ status: 'checking', user: null })
  const configuration = readFirebaseConfig(env)
  if (configuration.kind === 'missing') return disabledClient({ status: 'unconfigured', user: null })
  if (configuration.kind === 'invalid') return disabledClient({
    status: 'unavailable', user: null, message: 'Firebaseの接続設定を確認してください。',
  })
  let auth: Auth
  try {
    const config = configuration.config
    const existing = getApps().find((app) => app.name === 'tourism-quest-web')
    const identityFields = ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId'] as const
    if (existing && identityFields.some((field) => existing.options[field] !== config[field])) {
      return disabledClient({ status: 'unavailable', user: null, message: '接続設定が変わりました。ページを再読み込みしてください。' })
    }
    auth = getAuth(existing ?? initializeApp(config, 'tourism-quest-web'))
    auth.languageCode = 'ja'
  } catch {
    return disabledClient({ status: 'unavailable', user: null, message: 'Firebaseの接続を開始できませんでした。設定を確認してください。' })
  }
  const provider = new GoogleAuthProvider()
  provider.setCustomParameters({ prompt: 'select_account' })
  let snapshot: AuthSnapshot = { status: 'checking', user: null }
  const listeners = new Set<() => void>()
  let stop: (() => void) | undefined
  let pendingSignIn: Promise<void> | undefined
  function update(next: AuthSnapshot) {
    snapshot = next
    for (const listener of listeners) listener()
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      if (!stop) {
        stop = onAuthStateChanged(auth, (user) => {
          update(user
            ? { status: 'signed-in', user: { uid: user.uid, displayName: user.displayName,
                ...(user.photoURL ? { photoURL: user.photoURL } : {}) } }
            : { status: 'signed-out', user: null })
        }, () => update({ status: 'unavailable', user: null, message: 'ログイン状態を確認できませんでした。ページを再読み込みしてください。' }))
      }
      return () => {
        listeners.delete(listener)
        if (!listeners.size) {
          stop?.()
          stop = undefined
          snapshot = { status: 'checking', user: null }
        }
      }
    },
    signInWithGoogle() {
      if (!pendingSignIn) {
        // クリック中に直接呼ぶ。事前のawaitでポップアップの利用者操作を失わない。
        pendingSignIn = signInWithPopup(auth, provider).then(
          () => undefined,
          (error: unknown) => { throw authError(error) },
        ).finally(() => { pendingSignIn = undefined })
      }
      return pendingSignIn
    },
    async signOut() {
      try { await signOut(auth) } catch (error) { throw authError(error) }
    },
    async getIdToken() {
      try {
        await auth.authStateReady()
        return await auth.currentUser?.getIdToken() ?? null
      } catch (error) { throw authError(error) }
    },
  }
}
