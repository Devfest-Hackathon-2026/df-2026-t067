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
