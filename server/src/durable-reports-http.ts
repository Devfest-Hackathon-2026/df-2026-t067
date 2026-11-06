import type { IncomingMessage, ServerResponse } from 'node:http'
import { ContractError, parseReportInput } from '../../src/shared/api/validation'
import { HttpError, invalidInput } from './errors'
import type { FirestoreReportStore } from './firestore-reports'
import { send } from './http-server'
import { readIdempotencyKey } from './idempotency-key'
import { readJsonObject } from './json-body'
import { paginate, parseId, validateQuery } from './query'

export function createDurableReportHandler(store: FirestoreReportStore, authenticate: (request: IncomingMessage) => Promise<string>) {
  return async (request: IncomingMessage, response: ServerResponse, path: string, params: URLSearchParams): Promise<boolean> => {
    const submit = path === '/api/v1/reports'
    const manage = /^\/api\/v1\/orgs\/([^/]+)\/reports$/.exec(path)
    if (!submit && !manage) return false
    const method = submit ? 'POST' : 'GET'
    if (request.method !== method) {
      response.setHeader('Allow', method)
      throw new HttpError(405, 'HTTP_ERROR', 'このメソッドは利用できません。')
    }
    const uid = await authenticate(request)
    if (manage) {
      validateQuery(params, ['cursor', 'limit'])
      const orgId = parseId(decodeURIComponent(manage[1]))
      const items = await store.list(uid, orgId)
      send(response, 200, paginate(items, params, 'reports:' + uid + ':' + orgId, (row) => row.reportId))
    } else {
      validateQuery(params, [])
      const key = readIdempotencyKey(request)
      const body = await readJsonObject(request)
      if (response.destroyed) return true
      let input
      try { input = parseReportInput(body) }
      catch (error) { if (error instanceof ContractError) invalidInput(); throw error }
      send(response, 202, await store.submit(uid, key, input))
    }
    return true
  }
}
