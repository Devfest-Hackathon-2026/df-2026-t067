import assert from 'node:assert/strict'
import test from 'node:test'
import { createApiClient } from '../../src/shared/api/client'
import type { ReportInput } from '../../src/shared/api/types'
import { expectError, startServer } from './helpers'

const verifier = { verify: async (token: string) => ({ uid: token }) }
const report: ReportInput = { questId: 'demo-quest', category: 'UNSAFE_GUIDANCE', text: '架空の試験報告' }

test('demo reports are disabled by default', async (t) => {
  const { base } = await startServer(t, { verifier })
  await expectError(await fetch(base + '/api/v1/reports', {
    method: 'POST', headers: { Authorization: 'Bearer traveler', 'Content-Type': 'application/json', 'Idempotency-Key': 'report-1' },
    body: JSON.stringify(report),
  }), 503, 'SYSTEM_ERROR')
})

test('only own publishers can read reports, with replay and bounded submission', async (t) => {
  const { base } = await startServer(t, {
    verifier, demoReports: true,
    memberships: async (uid) => uid === 'reporter' ? [] : [{
      orgId: uid === 'other-publisher' ? 'demo-org-b' : 'demo-org',
      areaId: uid === 'other-publisher' ? 'demo-area-b' : 'demo-area',
      label: '架空', role: uid === 'editor' ? 'editor' : 'publisher',
    }],
  })
  const api = (uid: string) => createApiClient({ expectedDataMode: 'demo', getIdToken: async () => uid,
    fetch: (url, init) => fetch(base + String(url), init) })
  const traveler = api('reporter')
  const publisher = api('publisher')
  const submit = (key: string) => traveler.submitReport({ ...report, idempotencyKey: key })
  const [first, replay] = await Promise.all([submit('same'), submit('same')])
  assert.deepEqual(replay, first)
  assert.equal(first.source, 'mock')
  await assert.rejects(traveler.submitReport({ ...report, text: '異なる内容', idempotencyKey: 'same' }), { code: 'IDEMPOTENCY_CONFLICT' })
  await assert.rejects(traveler.submitReport({ ...report, questId: 'unknown', idempotencyKey: 'unknown' }), { code: 'NOT_FOUND' })
  const page = await publisher.listManagedReports('demo-org')
  assert.equal(page.items.length, 1)
  assert.deepEqual(page.items[0], { ...report, ...first, orgId: 'demo-org', questVersion: 1, receivedAt: page.items[0].receivedAt })
  await assert.rejects(api('editor').listManagedReports('demo-org'), { code: 'FORBIDDEN' })
  await assert.rejects(traveler.listManagedReports('demo-org'), { code: 'FORBIDDEN' })
  await assert.rejects(api('other-publisher').listManagedReports('demo-org'), { code: 'FORBIDDEN' })
  assert.deepEqual((await api('other-publisher').listManagedReports('demo-org-b')).items, [])
  const headers = { 'Content-Type': 'application/json', 'Idempotency-Key': 'invalid' }
  await expectError(await fetch(base + '/api/v1/reports', { method: 'POST', headers, body: JSON.stringify(report) }), 401, 'UNAUTHENTICATED')
  await expectError(await fetch(base + '/api/v1/reports', { method: 'POST', headers: { ...headers, Authorization: 'Bearer reporter' },
    body: JSON.stringify({ ...report, photo: 'forbidden' }) }), 400, 'INVALID_INPUT')
  for (let i = 0; i < 9; i++) await submit('new-' + i)
  await assert.rejects(submit('limited'), { code: 'RATE_LIMITED' })
  assert.deepEqual(await submit('same'), first)
  const latest = await publisher.listManagedReports('demo-org', { limit: 9 })
  assert(latest.nextCursor)
  assert.deepEqual((await publisher.listManagedReports('demo-org', { cursor: latest.nextCursor })).items, page.items)
})
