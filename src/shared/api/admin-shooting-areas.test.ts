import { expect, it } from 'vitest'
import { parseManagedShootingAreas, parseUpdateShootingAreas } from './admin'
import { ContractError } from './validation'
import { parsePublicQuest } from './validation'
import { createApiClient } from './client'
import { quest } from './testFixtures'

const zone = { latitude: 0.125, longitude: 0.25, radiusMeters: 25 }
const areas = { orgId: 'demo-org', questId: 'draft-a', draftRevision: 2, zones: [zone], source: 'mock' }

it('preserves detached private zones and accepts empty zones as an explicit removal', () => {
  const saved = parseManagedShootingAreas(areas)
  expect(saved).toEqual(areas)
  saved.zones[0].radiusMeters = 40
  expect(zone.radiusMeters).toBe(25)
  expect(parseUpdateShootingAreas({ expectedDraftRevision: 2, zones: [] })).toEqual({ expectedDraftRevision: 2, zones: [] })
  expect(parseUpdateShootingAreas({ expectedDraftRevision: 2,
    zones: Array.from({ length: 10 }, () => ({ latitude: -90, longitude: 180, radiusMeters: 1 })) }).zones.length).toBe(10)
})

it('rejects malformed coordinates, radii, excessive zones and authority claims', () => {
  for (const patch of [{ latitude: NaN }, { longitude: Infinity }, { latitude: 91 }, { longitude: -181 },
    { radiusMeters: 0 }, { radiusMeters: -1 }, { radiusMeters: '25' }, { orgId: 'other' }]) {
    expect(() => parseManagedShootingAreas({ ...areas, zones: [{ ...zone, ...patch }] })).toThrow(ContractError)
  }
  for (const zones of [null, 'zones', Array(2), Array.from({ length: 11 }, () => zone)]) {
    expect(() => parseUpdateShootingAreas({ expectedDraftRevision: 1, zones })).toThrow(ContractError)
  }
  for (const patch of [{ orgId: 'other' }, { isCorrect: true }, { expectedDraftRevision: 0 }]) {
    expect(() => parseUpdateShootingAreas({ expectedDraftRevision: 1, zones: [zone], ...patch })).toThrow(ContractError)
  }
})

it('binds private responses to org, quest, revision and explicit demo mode', async () => {
  const json = (data: unknown) => new Response(JSON.stringify(data), { headers: { 'X-Quest-Data-Mode': 'demo' } })
  const plain = createApiClient({ fetch: async () => json(areas), getIdToken: async () => 'token' })
  await expect(plain.getShootingAreas('demo-org', 'draft-a')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  for (const patch of [{ orgId: 'other' }, { questId: 'other' }, { source: 'pretend' }, { draftRevision: 0 }, { photo: 'private' }]) {
    const api = createApiClient({ fetch: async () => json({ ...areas, ...patch }), getIdToken: async () => 'token', expectedDataMode: 'demo' })
    await expect(api.getShootingAreas('demo-org', 'draft-a')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  }
  const stale = createApiClient({ fetch: async () => json(areas), getIdToken: async () => 'token', expectedDataMode: 'demo' })
  await expect(stale.updateShootingAreas('demo-org', 'draft-a', { expectedDraftRevision: 2, zones: [] })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
})

it('fetches fresh tokens for GET and PUT and rejects invalid writes before requesting', async () => {
  let tokens = 0
  const requests: { path: string; init?: RequestInit }[] = []
  const api = createApiClient({ expectedDataMode: 'demo', getIdToken: async () => 'token-' + ++tokens, fetch: async (input, init) => {
    requests.push({ path: String(input), init })
    return new Response(JSON.stringify({ ...areas, draftRevision: init?.method === 'PUT' ? 3 : 2 }), { headers: { 'X-Quest-Data-Mode': 'demo' } })
  } })
  await api.getShootingAreas('demo-org', 'draft-a')
  await api.updateShootingAreas('demo-org', 'draft-a', { expectedDraftRevision: 2, zones: [] })
  expect(requests.map((item) => new Headers(item.init?.headers).get('Authorization'))).toEqual(['Bearer token-1', 'Bearer token-2'])
  expect(requests[1].path).toBe('/api/v1/orgs/demo-org/quests/draft-a/shooting-areas')
  expect(requests[1].init?.method).toBe('PUT')
  expect(requests.every((item) => item.init?.cache === 'no-store')).toBe(true)
  expect(JSON.parse(String(requests[1].init?.body))).toEqual({ expectedDraftRevision: 2, zones: [] })
  await expect(api.updateShootingAreas('demo-org', 'draft-a', { expectedDraftRevision: 0, zones: [] })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  expect(requests.length).toBe(2)
  const signedOut = createApiClient({ fetch: async () => { throw new Error('must not request') } })
  await expect(signedOut.getShootingAreas('demo-org', 'draft-a')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
})

it('keeps capture zones and their coordinates out of the public contract', () => {
  for (const patch of [{ zones: [zone] }, { shootingAreas: areas }, { latitude: zone.latitude }, { radiusMeters: zone.radiusMeters }]) {
    expect(() => parsePublicQuest({ ...quest, ...patch })).toThrow(ContractError)
  }
})
