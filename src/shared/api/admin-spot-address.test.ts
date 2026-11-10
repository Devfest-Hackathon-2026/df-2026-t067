import { expect, it, vi } from 'vitest'
import { createApiClient } from './client'

it('authenticates the address lookup, binds the organization and rejects demo or foreign responses', async () => {
  let orgId = 'test-org'
  let dataMode = 'durable-local'
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({
    orgId, status: 'candidate', source: 'nearby', address: '合成候補住所',
  }, { headers: { 'X-Quest-Data-Mode': dataMode } }))
  const api = createApiClient({ expectedDataMode: 'durable-local', getIdToken: async () => 'synthetic-token', fetch: fetcher })
  const input = { position: { latitude: 35, longitude: 139 } }
  expect(await api.lookupSpotAddress('test-org', input)).toEqual({
    orgId, status: 'candidate', source: 'nearby', address: '合成候補住所',
  })
  expect(fetcher.mock.calls[0][0]).toBe('/api/v1/orgs/test-org/spot-address')
  const request = fetcher.mock.calls[0][1]
  expect(request).toMatchObject({ method: 'POST', cache: 'no-store', redirect: 'error', body: JSON.stringify(input) })
  expect(new Headers(request?.headers).get('Authorization')).toBe('Bearer synthetic-token')
  orgId = 'other-org'
  await expect(api.lookupSpotAddress('test-org', input)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  orgId = 'test-org'
  dataMode = 'demo'
  await expect(api.lookupSpotAddress('test-org', input)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  await expect(api.lookupSpotAddress('test-org', { googlePlaceId: '../invalid' })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  const demo = createApiClient({ expectedDataMode: 'demo', fetch: fetcher })
  expect(demo.canLookupSpotAddress).toBe(false)
  await expect(demo.lookupSpotAddress('test-org', input)).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  expect(fetcher).toHaveBeenCalledTimes(3)
})
