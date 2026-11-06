import type { IncomingMessage, ServerResponse } from 'node:http'
import { parseCreateManagedQuest, parseSubmitReview, parseUpdateManagedQuest, parseUpdateShootingAreas } from '../../src/shared/api/admin'
import { ContractError } from '../../src/shared/api/validation'
import { HttpError, invalidInput } from './errors'
import type { FirestoreManagedDraftStore } from './firestore-managed-drafts'
import { send } from './http-server'
import { readJsonObject } from './json-body'
import { paginate, parseId, validateQuery } from './query'

export function createDurableDraftHandler(store: FirestoreManagedDraftStore, authenticate: (request: IncomingMessage) => Promise<string>) {
  return async (request: IncomingMessage, response: ServerResponse, path: string, params: URLSearchParams): Promise<boolean> => {
    const memberships = path === '/api/v1/me/memberships'
    const quest = /^\/api\/v1\/orgs\/([^/]+)\/quests(?:\/([^/]+)(?:\/(shooting-areas|submit-review))?)?$/.exec(path)
    if (!memberships && !quest) return false

    const action = quest?.[3]
    const rawQuestId = quest?.[2]
    const allowed = memberships ? ['GET'] : action === 'shooting-areas' ? ['GET', 'PUT'] :
      action === 'submit-review' ? ['POST'] : rawQuestId ? ['GET', 'PATCH'] : ['GET', 'POST']
    if (!allowed.includes(request.method ?? '')) {
      response.setHeader('Allow', allowed.join(', '))
      throw new HttpError(405, 'HTTP_ERROR', 'このメソッドは利用できません。')
    }
    const uid = await authenticate(request)
    if (!quest) {
      validateQuery(params, ['cursor', 'limit'])
      const rows = await store.listMemberships(uid)
      send(response, 200, paginate(rows, params, 'memberships:' + uid, (row) => row.orgId))
      return true
    }

    const orgId = parseId(decodeURIComponent(quest[1]))
    const questId = rawQuestId === undefined ? undefined : parseId(decodeURIComponent(rawQuestId))
    if (request.method === 'GET' && questId === undefined) {
      validateQuery(params, ['cursor', 'limit'])
      const rows = await store.list(uid, orgId)
      send(response, 200, paginate(rows, params, 'managed:' + uid + ':' + orgId, (row) => row.questId))
      return true
    }
    validateQuery(params, [])
    if (request.method === 'GET' && questId !== undefined) {
      send(response, 200, action === 'shooting-areas' ? await store.getShootingAreas(uid, orgId, questId) : await store.get(uid, orgId, questId))
      return true
    }

    await store.assertMember(uid, orgId)
    const body = await readJsonObject(request, 65_536)
    if (response.destroyed) return true
    try {
      if (questId === undefined) {
        send(response, 201, await store.create(uid, orgId, parseCreateManagedQuest(body).draft))
      } else if (action === 'shooting-areas') {
        send(response, 200, await store.updateShootingAreas(uid, orgId, questId, parseUpdateShootingAreas(body)))
      } else if (action === 'submit-review') {
        const { expectedDraftRevision } = parseSubmitReview(body)
        send(response, 200, await store.submitReview(uid, orgId, questId, expectedDraftRevision))
      } else {
        send(response, 200, await store.update(uid, orgId, questId, parseUpdateManagedQuest(body)))
      }
    } catch (error) { if (error instanceof ContractError) invalidInput(); throw error }
    return true
  }
}
