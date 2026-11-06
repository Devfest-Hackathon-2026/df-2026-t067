import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readConfig } from '../src/config'

test('demo is explicit, uses a local default port, and needs no auth config', () => {
  assert.deepEqual(readConfig({ QUEST_DATA_MODE: 'demo' }), { mode: 'demo', port: 8787 })
  assert.deepEqual(readConfig({ QUEST_DATA_MODE: 'demo', NODE_ENV: 'test', PORT: '12345', FIREBASE_PROJECT_ID: 'demo-project' }),
    { mode: 'demo', port: 12345, firebaseProjectId: 'demo-project' })
})

test('missing/real/unknown data modes never fall back to demo', () => {
  for (const mode of [undefined, '', 'real', 'firestore', 'DEMO']) {
    assert.throws(() => readConfig({ QUEST_DATA_MODE: mode }), /explicitly selected/)
  }
})

test('durable-local requires both loopback emulators and an explicit signed Auth project', () => {
  const env = { QUEST_DATA_MODE: 'durable-local', NODE_ENV: 'development', FIREBASE_PROJECT_ID: 'demo-auth-project',
    FIRESTORE_EMULATOR_HOST: '127.0.0.1:8688', QUEST_DURABLE_STORAGE_ENDPOINT: 'http://127.0.0.1:9688' }
  assert.deepEqual(readConfig(env), { mode: 'durable-local', port: 8787, firebaseProjectId: 'demo-auth-project',
    storageEndpoint: 'http://127.0.0.1:9688' })
  assert.throws(() => readConfig({ ...env, NODE_ENV: 'production' }), /production startup/)
  assert.throws(() => readConfig({ ...env, FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' }), /signed Firebase ID tokens/)
  assert.throws(() => readConfig({ ...env, FIREBASE_PROJECT_ID: undefined }), /FIREBASE_PROJECT_ID/)
  for (const host of [undefined, '127.0.0.1:65536', 'firestore.googleapis.com:443']) {
    assert.throws(() => readConfig({ ...env, FIRESTORE_EMULATOR_HOST: host }), /FIRESTORE_EMULATOR_HOST/)
  }
  for (const url of [undefined, 'http://localhost:9688', 'http://127.0.0.1:9688@storage.googleapis.com']) {
    assert.throws(() => readConfig({ ...env, QUEST_DURABLE_STORAGE_ENDPOINT: url }), /QUEST_DURABLE_STORAGE_ENDPOINT/)
  }
  assert.throws(() => readConfig({ ...env, STORAGE_EMULATOR_HOST: 'https://storage.googleapis.com' }), /Unset STORAGE_EMULATOR_HOST/)
})

test('GPS demo must be explicitly enabled and unknown modes never fall back', () => {
  const enabled = readConfig({ QUEST_DATA_MODE: 'demo', QUEST_LOCATION_MODE: 'demo' })
  assert.equal('demoLocation' in enabled && enabled.demoLocation, true)
  for (const mode of ['real', '', 'DEMO', 'unsafe-value']) {
    assert.throws(() => readConfig({ QUEST_DATA_MODE: 'demo', QUEST_LOCATION_MODE: mode }), /QUEST_LOCATION_MODE/)
  }
  assert.deepEqual(readConfig({ QUEST_DATA_MODE: 'demo', QUEST_LOCATION_MODE: 'off' }), { mode: 'demo', port: 8787 })
})

test('production/other deployment modes and Auth Emulator cannot start demo server', () => {
  for (const nodeEnv of ['production', 'staging', '']) {
    assert.throws(() => readConfig({ QUEST_DATA_MODE: 'demo', NODE_ENV: nodeEnv }), /production startup/)
  }
  for (const host of ['', '127.0.0.1:9099']) {
    assert.throws(() => readConfig({ QUEST_DATA_MODE: 'demo', FIREBASE_AUTH_EMULATOR_HOST: host }), /signed Firebase ID tokens/)
  }
})

test('invalid port and project ID configuration fail with names/constraints, never supplied values', () => {
  for (const port of ['', '0', '65536', '-1', '1.5', '1e3', ' 8787', 'invalid-port']) {
    assert.throws(() => readConfig({ QUEST_DATA_MODE: 'demo', PORT: port }), /PORT must/)
  }
  for (const project of ['', ' ', 'client/path', 'UPPERCASE', 'a', 'a'.repeat(31)]) {
    assert.throws(() => readConfig({ QUEST_DATA_MODE: 'demo', FIREBASE_PROJECT_ID: project }), /FIREBASE_PROJECT_ID must/)
  }
})

test('admin membership configuration is explicit and rejects relative or invalid file paths', () => {
  const config = readConfig({ QUEST_DATA_MODE: 'demo', QUEST_DEMO_MEMBERSHIPS_FILE: '/private/tmp/local.json' })
  assert(config.mode === 'demo')
  assert.equal(config.demoMembershipsFile, '/private/tmp/local.json')
  for (const file of ['', './local.json', 'https://example.invalid/local.json', '/tmp/' + String.fromCharCode(0), '/' + 'a'.repeat(4096)]) {
    assert.throws(() => readConfig({ QUEST_DATA_MODE: 'demo', QUEST_DEMO_MEMBERSHIPS_FILE: file }), /QUEST_DEMO_MEMBERSHIPS_FILE must/)
  }
})

test('discovery storage is disabled by default and memory storage must be explicitly selected', () => {
  const config = readConfig({ QUEST_DATA_MODE: 'demo', QUEST_DISCOVERIES_MODE: 'memory' })
  assert(config.mode === 'demo')
  assert.equal(config.demoDiscoveries, true)
  assert.deepEqual(readConfig({ QUEST_DATA_MODE: 'demo', QUEST_DISCOVERIES_MODE: 'off' }), { mode: 'demo', port: 8787 })
  for (const mode of ['', 'real', 'firestore', 'MEMORY']) {
    assert.throws(() => readConfig({ QUEST_DATA_MODE: 'demo', QUEST_DISCOVERIES_MODE: mode }), /QUEST_DISCOVERIES_MODE must/)
  }
})

test('a synthetic discovery owner is explicitly configured and never echoed in errors', () => {
  const demo = { QUEST_DATA_MODE: 'demo', QUEST_DISCOVERIES_MODE: 'memory' }
  assert.deepEqual(readConfig({ ...demo, QUEST_DEMO_DISCOVERY_OWNER_UID: 'example-owner' }),
    { mode: 'demo', port: 8787, demoDiscoveries: true, demoDiscoveryOwnerUid: 'example-owner' })
  assert.throws(() => readConfig({ QUEST_DATA_MODE: 'demo', QUEST_DEMO_DISCOVERY_OWNER_UID: 'example-owner' }),
    /requires QUEST_DISCOVERIES_MODE=memory/)
  for (const uid of ['', ' example-owner', 'example-owner\n', 'example-owner\u007f', 'x'.repeat(129)]) {
    assert.throws(() => readConfig({ ...demo, QUEST_DEMO_DISCOVERY_OWNER_UID: uid }), {
      message: 'QUEST_DEMO_DISCOVERY_OWNER_UID must be a valid local UID.',
    })
  }
})

test('admin asset storage requires an explicit memory mode and cannot silently use a real backend', () => {
  const config = readConfig({ QUEST_DATA_MODE: 'demo', QUEST_ADMIN_ASSETS_MODE: 'memory' })
  assert(config.mode === 'demo')
  assert.equal(config.demoAdminAssets, true)
  assert.deepEqual(readConfig({ QUEST_DATA_MODE: 'demo', QUEST_ADMIN_ASSETS_MODE: 'off' }), { mode: 'demo', port: 8787 })
  for (const mode of ['', 'storage', 'real', 'MEMORY']) {
    assert.throws(() => readConfig({ QUEST_DATA_MODE: 'demo', QUEST_ADMIN_ASSETS_MODE: mode }), /QUEST_ADMIN_ASSETS_MODE must/)
  }
})

test('admin photo tests only enable the local fixture matcher with memory assets', () => {
  const demo = { QUEST_DATA_MODE: 'demo', QUEST_ADMIN_ASSETS_MODE: 'memory' }
  assert.deepEqual(readConfig({ ...demo, QUEST_ADMIN_PHOTO_TEST_MODE: 'fixtures' }),
    { mode: 'demo', port: 8787, demoAdminAssets: true, demoAdminPhotoTest: true })
  assert.deepEqual(readConfig({ ...demo, QUEST_ADMIN_PHOTO_TEST_MODE: 'off' }),
    { mode: 'demo', port: 8787, demoAdminAssets: true })
  assert.throws(() => readConfig({ QUEST_DATA_MODE: 'demo', QUEST_ADMIN_PHOTO_TEST_MODE: 'fixtures' }), /QUEST_ADMIN_ASSETS_MODE=memory/)
  for (const mode of ['', 'real', 'vertex']) {
    assert.throws(() => readConfig({ ...demo, QUEST_ADMIN_PHOTO_TEST_MODE: mode }), /QUEST_ADMIN_PHOTO_TEST_MODE/)
  }
})

test('draft suggestions are opt-in and require memory assets', () => {
  const demo = { QUEST_DATA_MODE: 'demo', QUEST_ADMIN_ASSETS_MODE: 'memory' }
  assert.deepEqual(readConfig({ ...demo, QUEST_ADMIN_DRAFT_MODE: 'fixtures' }),
    { mode: 'demo', port: 8787, demoAdminAssets: true, demoDraftSuggestions: true })
  assert.deepEqual(readConfig({ ...demo, QUEST_ADMIN_DRAFT_MODE: 'off' }),
    { mode: 'demo', port: 8787, demoAdminAssets: true })
  assert.throws(() => readConfig({ QUEST_DATA_MODE: 'demo', QUEST_ADMIN_DRAFT_MODE: 'fixtures' }), /QUEST_ADMIN_ASSETS_MODE=memory/)
  assert.throws(() => readConfig({ ...demo, QUEST_ADMIN_DRAFT_MODE: 'vertex' }), /QUEST_ADMIN_DRAFT_MODE/)
})
