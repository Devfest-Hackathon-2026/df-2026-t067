import { randomUUID } from 'node:crypto'
import { deleteApp, initializeApp } from 'firebase-admin/app'
import type { App, AppOptions } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import type { DecodedIdToken } from 'firebase-admin/auth'
import { assertNoAuthEmulator, assertProjectId } from './config'
import { authUnavailable, unauthenticated } from './errors'

export interface IdTokenVerifier {
  verify(token: string): Promise<{ uid: string }>
}

// Only this Firebase SDK boundary is replaced in unit tests. The executable
// always uses the Admin SDK below; it has no environment-controlled auth bypass.
export interface FirebaseBoundary {
  initializeApp(options: AppOptions, name: string): App
  getAuth(app: App): {
    verifyIdToken(token: string, checkRevoked: boolean): Promise<Pick<DecodedIdToken, 'uid'>>
  }
  deleteApp(app: App): Promise<void>
}

const firebase: FirebaseBoundary = { initializeApp, getAuth, deleteApp }
const invalidTokenCodes = new Set([
  'auth/argument-error', 'auth/invalid-argument', 'auth/invalid-id-token',
  'auth/id-token-expired', 'auth/id-token-revoked', 'auth/user-disabled',
])

export function createFirebaseVerifier(projectId: string, sdk: FirebaseBoundary = firebase) {
  assertProjectId(projectId)
  assertNoAuthEmulator(process.env)
  let app: App | undefined
  let closed = false
  return {
    async verify(token: string): Promise<{ uid: string }> {
      if (closed || process.env.FIREBASE_AUTH_EMULATOR_HOST !== undefined) throw authUnavailable()
      let decoded: Pick<DecodedIdToken, 'uid'>
      try {
        app ??= sdk.initializeApp({ projectId }, 'quest-api-' + randomUUID())
        // Signature/issuer/audience/expiry verification only. With explicit
        // projectId, this SDK path fetches public signing certificates and does
        // not need ADC files or an authenticated user-management request.
        decoded = await sdk.getAuth(app).verifyIdToken(token, false)
      } catch (error) {
        const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
        if (typeof code === 'string' && invalidTokenCodes.has(code)) throw unauthenticated()
        throw authUnavailable()
      }
      if (typeof decoded.uid !== 'string' || !decoded.uid.trim() || decoded.uid.length > 128) throw authUnavailable()
      return { uid: decoded.uid }
    },
    async close(): Promise<void> {
      closed = true
      if (app) await sdk.deleteApp(app)
    },
  }
}
