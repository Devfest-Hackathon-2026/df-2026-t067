import { randomUUID } from 'node:crypto'
import { deleteApp, initializeApp } from 'firebase-admin/app'
import type { App, AppOptions } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import type { DecodedIdToken, UserRecord } from 'firebase-admin/auth'
import type { SessionIdentity } from '../../src/shared/api/types'
import { assertNoAuthEmulator, assertProjectId } from './config'
import { authUnavailable, unauthenticated } from './errors'

export interface IdTokenVerifier {
  verify(token: string): Promise<SessionIdentity>
}

// Only this Firebase SDK boundary is replaced in unit tests. The executable
// always uses the Admin SDK below; it has no environment-controlled auth bypass.
export interface FirebaseBoundary {
  initializeApp(options: AppOptions, name: string): App
  getAuth(app: App): {
    verifyIdToken(token: string, checkRevoked: boolean): Promise<Pick<DecodedIdToken, 'uid'>>
    getUser(uid: string): Promise<Pick<UserRecord, 'disabled'>>
  }
  deleteApp(app: App): Promise<void>
}

const firebase: FirebaseBoundary = { initializeApp, getAuth, deleteApp }
const invalidTokenCodes = new Set([
  'auth/argument-error', 'auth/invalid-argument', 'auth/invalid-id-token',
  'auth/id-token-expired', 'auth/id-token-revoked', 'auth/user-disabled', 'auth/user-not-found',
])

export function createFirebaseVerifier(projectId: string, sdk: FirebaseBoundary = firebase, checkRevoked = false) {
  assertProjectId(projectId)
  assertNoAuthEmulator(process.env)
  let app: App | undefined
  let closed = false
  function auth() {
    if (closed || process.env.FIREBASE_AUTH_EMULATOR_HOST !== undefined) throw authUnavailable()
    app ??= sdk.initializeApp({ projectId }, 'quest-api-' + randomUUID())
    return sdk.getAuth(app)
  }
  return {
    async verify(token: string): Promise<SessionIdentity> {
      let decoded: Pick<DecodedIdToken, 'uid'>
      try {
        decoded = await auth().verifyIdToken(token, checkRevoked)
      } catch (error) {
        const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
        if (typeof code === 'string' && invalidTokenCodes.has(code)) throw unauthenticated()
        throw authUnavailable()
      }
      if (typeof decoded.uid !== 'string' || !decoded.uid.trim() || decoded.uid.length > 128) throw authUnavailable()
      return { uid: decoded.uid }
    },
    async isActiveUser(uid: string): Promise<boolean> {
      try { return (await auth().getUser(uid)).disabled === false }
      catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'auth/user-not-found') return false
        throw authUnavailable()
      }
    },
    async close(): Promise<void> {
      closed = true
      if (app) await sdk.deleteApp(app)
    },
  }
}
