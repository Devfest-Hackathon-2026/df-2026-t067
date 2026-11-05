import { expect, it } from 'vitest'
import { parsePhotoTestMetadata, parsePhotoTestResult } from './admin'
import { ContractError } from './validation'
import { createApiClient } from './client'

const metadata = { expectedDraftRevision: 2, photoRights: '自作の合成画像' }
const result = { testId: 'test-a', orgId: 'demo-org', questId: 'draft-a', draftRevision: 2, outcome: 'MATCH', source: 'mock' }
it('accepts only a version-bound photo result and explicit rights metadata', () => {
  expect(parsePhotoTestMetadata(metadata)).toEqual(metadata)
  expect(parsePhotoTestResult(result)).toEqual(result)
})
it('rejects authority claims, clear claims and invalid trial metadata', () => {
  for (const patch of [{ expectedDraftRevision: 0 }, { photoRights: ' ' }, { photoRights: 'x'.repeat(2001) }, { orgId: 'other' }]) {
    expect(() => parsePhotoTestMetadata({ ...metadata, ...patch })).toThrow(ContractError)
  }
  for (const patch of [{ outcome: 'CORRECT' }, { source: 'pretend' }, { discoveryId: 'private' }, { referencePhoto: 'private' }]) {
    expect(() => parsePhotoTestResult({ ...result, ...patch })).toThrow(ContractError)
  }
})

const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'X-Quest-Data-Mode': 'demo' } })
const photo = new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' })
const input = { ...metadata, photo, idempotencyKey: 'trial-key' }

it('binds the result to the selected org, quest, draft revision and explicit demo mode', async () => {
  const plain = createApiClient({ getIdToken: async () => 'token', fetch: async () => json(result) })
  await expect(plain.testManagedQuest('demo-org', 'draft-a', input)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  for (const patch of [{ orgId: 'other' }, { questId: 'other' }, { draftRevision: 3 }, { outcome: 'CORRECT' }, { photo: 'private' }]) {
    const api = createApiClient({ expectedDataMode: 'demo', getIdToken: async () => 'token', fetch: async () => json({ ...result, ...patch }) })
    await expect(api.testManagedQuest('demo-org', 'draft-a', input)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  }
})

it('sends only trial metadata and photo with a fresh token and the retained idempotency key', async () => {
  let tokens = 0
  const requests: RequestInit[] = []
  const api = createApiClient({ expectedDataMode: 'demo', getIdToken: async () => 'token-' + ++tokens, fetch: async (path, init) => {
    expect(String(path)).toBe('/api/v1/orgs/demo-org/quests/draft-a/test')
    requests.push(init!)
    return json(result)
  } })
  expect(await api.testManagedQuest('demo-org', 'draft-a', input)).toEqual(result)
  await api.testManagedQuest('demo-org', 'draft-a', input)
  expect(requests.map((request) => new Headers(request.headers).get('Authorization'))).toEqual(['Bearer token-1', 'Bearer token-2'])
  expect(requests[0].method).toBe('POST')
  expect(requests[0].cache).toBe('no-store')
  expect(new Headers(requests[0].headers).get('Idempotency-Key')).toBe('trial-key')
  const body = requests[0].body as FormData
  expect([...body.keys()]).toEqual(['photo', 'metadata'])
  expect(JSON.parse(String(body.get('metadata')))).toEqual(metadata)
})

it('rejects invalid photos, keys and excessive UTF8 metadata without making a request', async () => {
  let calls = 0
  const api = createApiClient({ getIdToken: async () => 'token', fetch: async () => { calls++; return json(result) } })
  for (const patch of [{ idempotencyKey: '' }, { expectedDraftRevision: 0 }, { photoRights: ' ' },
    { photo: new Blob([], { type: 'image/png' }) }, { photo: new Blob(['x'], { type: 'image/gif' }) }]) {
    await expect(api.testManagedQuest('demo-org', 'draft-a', { ...input, ...patch })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  }
  await expect(api.testManagedQuest('demo-org', 'draft-a', { ...input, photoRights: 'あ'.repeat(1500) })).rejects.toMatchObject({ code: 'MEDIA_TOO_LARGE' })
  expect(calls).toBe(0)
  const signedOut = createApiClient({ fetch: async () => { calls++; return json(result) } })
  await expect(signedOut.testManagedQuest('demo-org', 'draft-a', input)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
  expect(calls).toBe(0)
})
