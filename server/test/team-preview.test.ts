import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { Firestore } from 'firebase-admin/firestore'
import { publicHintImagePath } from '../src/admin-publication'
import { readConfig } from '../src/config'
import { createDemoData } from '../src/demo-data'
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

test('team preview serves public catalog reads and protects membership, private photos and writes', async (t) => {
  const webDirectory = await mkdtemp(join(tmpdir(), 't067-team-web-'))
  t.after(() => rm(webDirectory, { force: true, recursive: true }))
  await mkdir(join(webDirectory, 'assets'))
  await writeFile(join(webDirectory, 'index.html'), '<main>共有検証の画面</main>')
  await writeFile(join(webDirectory, 'assets/app.js'), 'export {}')
  const unexpected = async (): Promise<never> => { throw new Error('Unexpected access to data') }
  const policy = { maximum: 1, windowMs: 1000 }
  const { areas: [area], quests: [fixture], hints } = createDemoData()
  const hintImage = publicHintImagePath(fixture.questId, fixture.version)
  const quest = { ...fixture, optionalHintImage: hintImage }
  const published = { status: 'published', publishedVersion: quest.version, orgId: 'org-a', internal: '管理専用データ' }
  const rows = new Map<string, Record<string, unknown>>([
    ['areas/' + area.areaId, { label: area.label, marker: area.marker, publicGeometryJson: JSON.stringify(area.publicGeometry) }],
    ['quests/' + quest.questId, published],
    ['questPublic/' + quest.questId, { quest, hints: hints.get(quest.questId), internal: '管理専用データ' }],
    ['questVersions/' + quest.questId + ':' + quest.version, { publicHintImage: { orgId: 'org-a', assetId: 'hint', generation: '1' } }],
    ['quests/draft-only', { status: 'draft', publishedVersion: null }],
    ['questPublic/draft-only', { quest: { ...quest, questId: 'draft-only' } }],
  ])
  const snapshot = (path: string) => ({
    id: path.split('/')[1], data: () => rows.get(path), get: (field: string) => rows.get(path)?.[field],
  })
  const catalogDb = {
    collection(name: string) {
      return { limit: () => ({ name }), doc: (id: string) => name + '/' + id }
    },
    runTransaction: async (read: (tx: unknown) => unknown) => read({
      get: async (ref: string | { name: string }) => {
        if (typeof ref === 'string') return snapshot(ref)
        const docs = [...rows.keys()].filter((path) => path.startsWith(ref.name + '/')).map(snapshot)
        return { size: docs.length, docs }
      },
      getAll: async (...refs: string[]) => refs.map(snapshot),
    }),
  }
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9])
  const options = {
    db: catalogDb as unknown as Firestore, photos: { writeIncoming: unexpected, readRecord: unexpected, deleteRecord: unexpected },
    publication: { readReference: unexpected, readHint: async (...args: string[]) => {
      assert.deepEqual(args, ['org-a', 'hint', '1'])
      return { bytes: jpeg, mimeType: 'image/jpeg' }
    } },
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
  for (const [path, items] of [['/api/v1/areas', [{ ...area, publishedCount: 1 }]], ['/api/v1/quests', [quest]]] as const) {
    const catalog = await fetch(base + path)
    assert.equal(catalog.status, 200)
    assert.deepEqual(await catalog.json(), { items, nextCursor: null })
    assert.equal((await fetch(base + path, { headers: { Authorization: 'Bearer outsider' } })).status, 200)
    assert.equal((await fetch(base + path, { method: 'POST' })).status, 401)
  }
  const picture = await fetch(base + hintImage)
  assert.equal(picture.status, 200)
  assert.equal(picture.headers.get('content-type'), 'image/jpeg')
  assert.deepEqual(Buffer.from(await picture.arrayBuffer()), jpeg)
  assert.equal((await fetch(base + '/api/v1/quests/draft-only')).status, 404)
  published.status = 'paused'
  assert.equal((await fetch(base + hintImage)).status, 404)
  for (const path of ['/api/v1/session', '/api/v1/me/memberships', '/api/v1/orgs/fixture/quests', '/api/v1/orgs/fixture/assets/asset/photo']) {
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
