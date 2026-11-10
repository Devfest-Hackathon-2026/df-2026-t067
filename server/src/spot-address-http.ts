import type { IncomingMessage, ServerResponse } from 'node:http'
import { parseSpotAddressInput, parseSpotAddressLookup } from '../../src/shared/api/admin-spot-address'
import { ContractError } from '../../src/shared/api/validation'
import { HttpError, invalidInput } from './errors'
import { send } from './http-server'
import { readJsonObject } from './json-body'
import { parseId, validateQuery } from './query'
import type { createSpotAddressGeocoder } from './spot-address-geocoding'

export function createSpotAddressHandler(options: {
  authenticate(request: IncomingMessage): Promise<string>
  assertMember(uid: string, orgId: string): Promise<unknown>
  lookup?: ReturnType<typeof createSpotAddressGeocoder>
  now?: () => number
}) {
  let active = 0
  let minute = -1
  let count = 0
  const users = new Map<string, number>()

  return async (request: IncomingMessage, response: ServerResponse, path: string, params: URLSearchParams) => {
    const match = /^\/api\/v1\/orgs\/([^/]+)\/spot-address$/.exec(path)
    if (!match) return false
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST')
      throw new HttpError(405, 'HTTP_ERROR', 'このメソッドは利用できません。')
    }
    const uid = await options.authenticate(request)
    const orgId = parseId(decodeURIComponent(match[1]))
    await options.assertMember(uid, orgId)
    validateQuery(params, [])
    const body = await readJsonObject(request, 2048)
    let input
    try { input = parseSpotAddressInput(body) }
    catch (error) { if (error instanceof ContractError) invalidInput(); throw error }
    if (response.destroyed) return true
    await options.assertMember(uid, orgId)
    if (response.destroyed) return true
    if (!options.lookup) {
      send(response, 200, { orgId, status: 'unavailable' })
      return true
    }

    const now = options.now?.() ?? Date.now()
    if (Math.floor(now / 60_000) !== minute) {
      minute = Math.floor(now / 60_000)
      count = 0
      users.clear()
    }
    const userCount = users.get(uid) ?? 0
    if (active >= 4 || count >= 30 || userCount >= 6) {
      throw new HttpError(429, 'RATE_LIMITED', '時間をおいて再試行してください。', true,
        active >= 4 ? 1 : Math.ceil((60_000 - now % 60_000) / 1000))
    }
    count++
    users.set(uid, userCount + 1)
    active++
    const controller = new AbortController()
    const abort = () => controller.abort()
    response.once('close', abort)
    try {
      const result = await options.lookup(input, controller.signal)
      if (!controller.signal.aborted) await options.assertMember(uid, orgId)
      if (!controller.signal.aborted) send(response, 200, parseSpotAddressLookup({ orgId, ...result }))
      return true
    } finally {
      response.removeListener('close', abort)
      active--
    }
  }
}
