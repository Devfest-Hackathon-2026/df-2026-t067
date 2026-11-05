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
  assert.equal(readConfig({ QUEST_DATA_MODE: 'demo', QUEST_DEMO_MEMBERSHIPS_FILE: '/private/tmp/local.json' }).demoMembershipsFile, '/private/tmp/local.json')
  for (const file of ['', './local.json', 'https://example.invalid/local.json', '/tmp/' + String.fromCharCode(0), '/' + 'a'.repeat(4096)]) {
    assert.throws(() => readConfig({ QUEST_DATA_MODE: 'demo', QUEST_DEMO_MEMBERSHIPS_FILE: file }), /QUEST_DEMO_MEMBERSHIPS_FILE must/)
  }
})

test('discovery storage is disabled by default and memory storage must be explicitly selected', () => {
  assert.equal(readConfig({ QUEST_DATA_MODE: 'demo', QUEST_DISCOVERIES_MODE: 'memory' }).demoDiscoveries, true)
  assert.deepEqual(readConfig({ QUEST_DATA_MODE: 'demo', QUEST_DISCOVERIES_MODE: 'off' }), { mode: 'demo', port: 8787 })
  for (const mode of ['', 'real', 'firestore', 'MEMORY']) {
    assert.throws(() => readConfig({ QUEST_DATA_MODE: 'demo', QUEST_DISCOVERIES_MODE: mode }), /QUEST_DISCOVERIES_MODE must/)
  }
})

test('admin asset storage requires an explicit memory mode and cannot silently use a real backend', () => {
  assert.equal(readConfig({ QUEST_DATA_MODE: 'demo', QUEST_ADMIN_ASSETS_MODE: 'memory' }).demoAdminAssets, true)
  assert.deepEqual(readConfig({ QUEST_DATA_MODE: 'demo', QUEST_ADMIN_ASSETS_MODE: 'off' }), { mode: 'demo', port: 8787 })
  for (const mode of ['', 'storage', 'real', 'MEMORY']) {
    assert.throws(() => readConfig({ QUEST_DATA_MODE: 'demo', QUEST_ADMIN_ASSETS_MODE: mode }), /QUEST_ADMIN_ASSETS_MODE must/)
  }
})
