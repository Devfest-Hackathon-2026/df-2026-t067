import type { IncomingMessage, ServerResponse } from 'node:http'
import { DISCOVERY_PHOTO_MAX_BYTES } from '../../src/shared/api/types'
import { parseDeletionReceipt, parseDeletionStatus, parseDiscovery, parsePage } from '../../src/shared/api/validation'
import type { DiscoveryReadRepository, DiscoveryRepository } from './discoveries'
import { parseDiscoverySort } from './discovery-sort'
import { HttpError } from './errors'
import { parseId, parseLimit, validateQuery } from './query'

export function createDiscoveryHandler(options: {
  repository?: DiscoveryReadRepository & Partial<Pick<DiscoveryRepository, 'deleteOwned' | 'getDeletionOwned'>>
  authenticate: (request: IncomingMessage) => Promise<string>
  send: (response: ServerResponse, status: number, body: unknown) => void
}) {
  return async (request: IncomingMessage, response: ServerResponse, path: string, params: URLSearchParams): Promise<boolean> => {
    const isList = path === '/api/v1/me/discoveries'
    const record = /^\/api\/v1\/me\/discoveries\/([^/]+)(\/photo)?$/.exec(path)
    const deletion = /^\/api\/v1\/me\/deletions\/([^/]+)$/.exec(path)
    if (!isList && !record && !deletion) return false
    const allowed = record && !record[2] ? ['GET', 'DELETE'] : ['GET']
    if (!allowed.includes(request.method ?? '')) {
      response.setHeader('Allow', allowed.join(', '))
      throw new HttpError(405, 'HTTP_ERROR', 'このメソッドは利用できません。')
    }
    const uid = await options.authenticate(request)
    const repository = options.repository
    if (!repository) throw new HttpError(503, 'SYSTEM_ERROR', '本人記録の保存先が未接続です。', true)
    if (repository.storageMode === 'memory') response.setHeader('X-Quest-Records-Mode', 'memory')
    try {
      if (isList) {
        validateQuery(params, ['areaId', 'cursor', 'limit', 'sort'])
        const rawArea = params.get('areaId')
        const query = { sort: parseDiscoverySort(params.get('sort') ?? undefined), areaId: rawArea === null ? undefined : parseId(rawArea),
          cursor: params.get('cursor') ?? undefined, limit: parseLimit(params) }
        options.send(response, 200, parsePage(await repository.listOwned(uid, query), parseDiscovery))
      } else {
        validateQuery(params, [])
        const id = parseId(decodeURIComponent((record ?? deletion)![1]))
        if (deletion) {
          if (!repository.getDeletionOwned) throw deletionUnavailable()
          const status = await repository.getDeletionOwned(uid, id)
          if (!status) throw missing()
          options.send(response, 200, parseDeletionStatus(status))
        } else if (request.method === 'DELETE') {
          if (!repository.deleteOwned) throw deletionUnavailable()
          const receipt = await repository.deleteOwned(uid, id)
          if (!receipt) throw missing()
          options.send(response, 202, parseDeletionReceipt(receipt))
        } else if (record![2]) {
          const photo = await repository.getPhotoOwned(uid, id)
          if (!photo) throw missing()
          if (photo.contentType !== 'image/jpeg' || photo.bytes.byteLength < 4 || photo.bytes.byteLength > DISCOVERY_PHOTO_MAX_BYTES ||
            photo.bytes[0] !== 0xff || photo.bytes[1] !== 0xd8 || photo.bytes[2] !== 0xff) {
            throw new HttpError(503, 'SYSTEM_ERROR', '本人写真を読み出せません。', true)
          }
          if (!response.destroyed && !response.writableEnded) {
            response.writeHead(200, { 'Content-Type': photo.contentType, 'Content-Length': photo.bytes.byteLength, 'Content-Disposition': 'inline' })
            response.end(photo.bytes)
          }
        } else {
          const discovery = await repository.getOwned(uid, id)
          if (!discovery) throw missing()
          options.send(response, 200, parseDiscovery(discovery))
        }
      }
      return true
    } catch (error) {
      if (error instanceof HttpError) throw error
      throw new HttpError(503, 'SYSTEM_ERROR', '本人記録の処理を完了できません。', true)
    }
  }
}

function missing(): HttpError { return new HttpError(404, 'NOT_FOUND', '見つかりません。') }

function deletionUnavailable(): HttpError {
  return new HttpError(503, 'SYSTEM_ERROR', '本人記録の削除は未接続です。')
}
