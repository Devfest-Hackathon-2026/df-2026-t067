import { describe, expect, it } from 'vitest'
import { readFirebaseConfig } from './config'
import { configuredEnv } from './testFixtures'

describe('Firebase environment configuration', () => {
  it('permits viewing without any Firebase settings', () => {
    expect(readFirebaseConfig({})).toEqual({ kind: 'missing' })
  })
  it('maps the six Vite settings without retaining unrelated values', () => {
    expect(readFirebaseConfig({ ...configuredEnv, UNRELATED_SECRET: 'not-used' })).toEqual({
      kind: 'configured',
      config: { apiKey: 'test-api-key', authDomain: 'test-project.firebaseapp.com', projectId: 'test-project',
        storageBucket: 'test-project.firebasestorage.app', messagingSenderId: '123456', appId: '1:123456:web:test' },
    })
  })
  it.each(Object.keys(configuredEnv))('rejects partially configured environment without %s', (key) => {
    const env = { ...configuredEnv, [key]: '' }
    expect(readFirebaseConfig(env).kind).toBe('invalid')
  })
  it.each(['https://example.com', 'example.com/path', 'user@example.com', 'example.com:123'])('rejects invalid auth domain %s', (domain) => {
    expect(readFirebaseConfig({ ...configuredEnv, VITE_FIREBASE_AUTH_DOMAIN: domain }).kind).toBe('invalid')
  })
})
