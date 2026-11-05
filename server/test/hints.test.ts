import assert from 'node:assert/strict'
import test from 'node:test'
import { createApiClient } from '../../src/shared/api/client'
import { expectError, rawGet, startServer } from './helpers'

test('anonymous client requests a single numbered hint for the displayed quest version', async (t) => {
  const { base } = await startServer(t)
  const api = createApiClient({ expectedDataMode: 'demo',
    fetch: (input, init) => fetch(base + String(input), init),
    getIdToken: async () => { throw new Error('Hints must stay anonymous') },
  })
  const quest = await api.getQuest('demo-quest')
  assert.equal(quest.hintCount, 3)
  const hint = await api.getHint({ questId: quest.questId, expectedVersion: quest.version, index: 1 })
  assert.deepEqual(hint, { questId: 'demo-quest', version: 1, index: 1, text: '架空の町の広場にあるものを想像してください。' })
  const response = await fetch(base + '/api/v1/quests/demo-quest/hints/3?expectedVersion=1')
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('X-Quest-Data-Mode'), 'demo')
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store')
  assert.deepEqual(Object.keys(await response.json()).sort(), ['index', 'questId', 'text', 'version'])
  // Ordinary details must not preload hints or a private answer/reveal.
  assert.deepEqual(Object.keys(quest).sort(), ['areaId', 'clue', 'hintCount', 'questId', 'title', 'version', 'visitConditions'])
})

test('hint version mismatch is distinct from missing quest or hint', async (t) => {
  const { base } = await startServer(t)
  await expectError(await fetch(base + '/api/v1/quests/demo-quest/hints/1?expectedVersion=2'), 409, 'QUEST_CHANGED')
  await expectError(await fetch(base + '/api/v1/quests/missing/hints/1?expectedVersion=1'), 404, 'NOT_FOUND')
  await expectError(await fetch(base + '/api/v1/quests/demo-quest/hints/4?expectedVersion=1'), 404, 'NOT_FOUND')
})

test('hint routes reject ambiguous indexes, versions, queries and methods', async (t) => {
  const { base } = await startServer(t)
  for (const index of ['0', '-1', '01', '1.5', '1e0', 'NaN', '9007199254740992', 'a%2Fb']) {
    assert.equal((await rawGet(base, '/api/v1/quests/demo-quest/hints/' + index + '?expectedVersion=1')).status, 400, index)
  }
  for (const query of ['', '?expectedVersion=0', '?expectedVersion=01', '?expectedVersion=1.5',
    '?expectedVersion=1&expectedVersion=1', '?expectedVersion=1&orgId=other']) {
    await expectError(await fetch(base + '/api/v1/quests/demo-quest/hints/1' + query), 400, 'INVALID_INPUT')
  }
  const response = await fetch(base + '/api/v1/quests/demo-quest/hints/1?expectedVersion=1', { method: 'POST' })
  assert.equal(response.headers.get('Allow'), 'GET')
  await expectError(response, 405, 'HTTP_ERROR')
  await expectError(await fetch(base + '/api/v1/quests/demo-quest/reveal', { method: 'POST' }), 404, 'NOT_FOUND')
})
