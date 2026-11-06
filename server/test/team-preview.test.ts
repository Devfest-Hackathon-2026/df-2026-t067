import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { Firestore } from 'firebase-admin/firestore'
import { readConfig } from '../src/config'
import { createDurableAnswerServer } from '../src/durable-answer-http'
import { listenServer } from './helpers'

const teamEnv = {
  QUEST_DATA_MODE: 'team-preview', NODE_ENV: 'production', FIREBASE_PROJECT_ID: 'test-project',
  QUEST_TEAM_UIDS: 'editor,publisher,traveler-a,traveler-b', QUEST_TEAM_PROJECT_NUMBER: '123456789',
}

test('team preview requires four distinct accounts and rejects emulator and Vertex settings', () => {
  assert.equal(readConfig(teamEnv).mode, 'team-preview')
  for (const override of [
    { QUEST_TEAM_UIDS: 'editor,publisher,traveler-a,editor' },
    { QUEST_TEAM_UIDS: 'editor,publisher' },
    { QUEST_TEAM_PROJECT_NUMBER: '' },
    { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8688' },
    { QUEST_DURABLE_STORAGE_ENDPOINT: 'http://127.0.0.1:9688' },
    { QUEST_DURABLE_PHOTO_MATCHER: 'vertex-trial' },
  ]) assert.throws(() => readConfig({ ...teamEnv, ...override }))
})

test('team preview serves its shell and restricts catalog, photos and writes before accessing data', async (t) => {
  const webDirectory = await mkdtemp(join(tmpdir(), 't067-team-web-'))
  t.after(() => rm(webDirectory, { force: true, recursive: true }))
  await mkdir(join(webDirectory, 'assets'))
  await writeFile(join(webDirectory, 'index.html'), '<main>共有検証の画面</main>')
  await writeFile(join(webDirectory, 'assets/app.js'), 'export {}')
  const unexpected = async (): Promise<never> => { throw new Error('Unexpected access to data') }
  const policy = { maximum: 1, windowMs: 1000 }
  const options = {
    db: {} as Firestore, photos: { writeIncoming: unexpected, readRecord: unexpected, deleteRecord: unexpected },
    verifier: { verify: async (token: string) => ({ uid: token }) },
    challengePolicy: policy, answerPolicy: policy, acquireUpload: () => () => {},
    teamPreview: { allowedUids: new Set(['editor', 'publisher', 'traveler-a', 'traveler-b']), webDirectory },
  }
  const { base } = await listenServer(t, createDurableAnswerServer(options))
  for (const path of ['/', '/admin']) {
    const res = await fetch(base + path)
    assert.equal(res.status, 200)
    assert.match(await res.text(), /共有検証の画面/)
  }
  const asset = await fetch(base + '/assets/app.js')
  assert.match(asset.headers.get('content-type') ?? '', /javascript/)
  assert.equal((await fetch(base + '/assets/..%2findex.html')).status, 404)
  for (const path of ['/api/v1/areas', '/api/v1/quests/fixture/hint-image?expectedVersion=1', '/api/v1/me/memberships', '/api/v1/orgs/fixture/quests']) {
    assert.equal((await fetch(base + path)).status, 401)
    assert.equal((await fetch(base + path, { headers: { Authorization: 'Bearer outsider' } })).status, 403)
  }
  const session = await fetch(base + '/api/v1/session', { headers: { Authorization: 'Bearer publisher' } })
  assert.equal(session.headers.get('X-Quest-Data-Mode'), 'team-preview')
  assert.deepEqual(await session.json(), { uid: 'publisher' })
  for (const path of ['/api/v1/challenges', '/api/v1/challenges/fixture/answers', '/api/v1/reports', '/api/v1/me/discoveries']) {
    assert.equal((await fetch(base + path, { method: 'POST', headers: { Authorization: 'Bearer publisher' } })).status, 404)
  }
})
