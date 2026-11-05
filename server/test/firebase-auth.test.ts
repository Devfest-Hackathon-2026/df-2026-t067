import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { App, AppOptions } from 'firebase-admin/app'
import { createFirebaseVerifier } from '../src/firebase-auth'
import type { FirebaseBoundary } from '../src/firebase-auth'
import { HttpError } from '../src/errors'
import { expectError, startServer } from './helpers'

function boundary(verifyIdToken: ReturnType<FirebaseBoundary['getAuth']>['verifyIdToken']) {
  const initializations: { options: AppOptions; name: string }[] = []
  const app = {} as App
  let deletions = 0
  const sdk: FirebaseBoundary = {
    initializeApp(options, name) { initializations.push({ options, name }); return app },
    getAuth(value) { assert.equal(value, app); return { verifyIdToken } },
    async deleteApp(value) { assert.equal(value, app); deletions++ },
  }
  return { sdk, initializations, deletions: () => deletions }
}

test('real adapter delegates to Firebase verifyIdToken with explicit project and returns only verified uid', async () => {
  const calls: [string, boolean][] = []
  const fake = boundary(async (token, checkRevoked) => {
    calls.push([token, checkRevoked])
    return { uid: 'firebase-verified-user', role: 'admin', orgId: 'secret', email: 'private@example.invalid' }
  })
  const verifier = createFirebaseVerifier('demo-project', fake.sdk)
  assert.equal(fake.initializations.length, 0)
  assert.deepEqual(await verifier.verify('opaque-sdk-boundary-input'), { uid: 'firebase-verified-user' })
  assert.deepEqual(await verifier.verify('second-input'), { uid: 'firebase-verified-user' })
  assert.deepEqual(calls, [['opaque-sdk-boundary-input', false], ['second-input', false]])
  assert.equal(fake.initializations.length, 1)
  assert.deepEqual(fake.initializations[0].options, { projectId: 'demo-project' })
  assert.match(fake.initializations[0].name, /^quest-api-/)
  await verifier.close()
  assert.equal(fake.deletions(), 1)
  await assert.rejects(verifier.verify('after-close'), (error: unknown) => error instanceof HttpError && error.status === 503)
})

test('SDK credential failures map to 401 and remote/configuration failures map to 503 without details', async () => {
  for (const [code, status, resultCode] of [
    ['auth/argument-error', 401, 'UNAUTHENTICATED'],
    ['auth/invalid-argument', 401, 'UNAUTHENTICATED'],
    ['auth/invalid-id-token', 401, 'UNAUTHENTICATED'],
    ['auth/id-token-expired', 401, 'UNAUTHENTICATED'],
    ['auth/id-token-revoked', 401, 'UNAUTHENTICATED'],
    ['auth/internal-error', 503, 'AUTH_UNAVAILABLE'],
    ['app/network-error', 503, 'AUTH_UNAVAILABLE'],
    ['app/invalid-credential', 503, 'AUTH_UNAVAILABLE'],
  ] as const) {
    const fake = boundary(async () => { throw Object.assign(new Error('secret detail/token/project'), { code }) })
    const verifier = createFirebaseVerifier('demo-project', fake.sdk)
    await assert.rejects(verifier.verify('unverified-client-input'), (error: unknown) => {
      assert(error instanceof HttpError)
      assert.equal(error.status, status)
      assert.equal(error.code, resultCode)
      assert.equal(error.retryable, status === 503)
      assert.doesNotMatch(error.message, /secret|token|project/)
      return true
    })
    await verifier.close()
  }
})

test('SDK boundary failure reaches HTTP as 503; credentials are never converted to success', async (t) => {
  const fake = boundary(async () => { throw Object.assign(new Error('private detail'), { code: 'app/network-error' }) })
  const verifier = createFirebaseVerifier('demo-project', fake.sdk)
  t.after(() => verifier.close())
  const { base } = await startServer(t, { verifier })
  await expectError(await fetch(base + '/api/v1/session?uid=client-user', {
    headers: { Authorization: 'Bearer boundary-failure' },
  }), 503, 'AUTH_UNAVAILABLE', true)
})

test('installed Firebase Admin SDK rejects malformed input; no live token or network needed', async () => {
  const verifier = createFirebaseVerifier('demo-project')
  try {
    await assert.rejects(verifier.verify('not-a-firebase-jwt'), (error: unknown) =>
      error instanceof HttpError && error.status === 401 && error.code === 'UNAUTHENTICATED')
  } finally { await verifier.close() }
})

test('empty/oversized uid from a broken SDK boundary cannot become an identity', async () => {
  for (const uid of ['', ' ', 'x'.repeat(129)]) {
    const fake = boundary(async () => ({ uid }))
    const verifier = createFirebaseVerifier('demo-project', fake.sdk)
    await assert.rejects(verifier.verify('boundary-input'), (error: unknown) => error instanceof HttpError && error.status === 503)
    await verifier.close()
  }
})

test('Auth Emulator is rejected at initialization and if enabled after initialization', async () => {
  const previous = process.env.FIREBASE_AUTH_EMULATOR_HOST
  const fake = boundary(async () => ({ uid: 'must-not-accept' }))
  const verifier = createFirebaseVerifier('demo-project', fake.sdk)
  try {
    process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099'
    assert.throws(() => createFirebaseVerifier('demo-project', fake.sdk), /signed Firebase ID tokens/)
    await assert.rejects(verifier.verify('unsigned'), (error: unknown) => error instanceof HttpError && error.status === 503)
    assert.deepEqual(fake.initializations, [])
  } finally {
    if (previous === undefined) delete process.env.FIREBASE_AUTH_EMULATOR_HOST
    else process.env.FIREBASE_AUTH_EMULATOR_HOST = previous
    await verifier.close()
  }
})
