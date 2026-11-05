import type { IncomingMessage, ServerResponse } from 'node:http'
import { parseCreateManagedQuest, parseOrgMembership, parseUpdateManagedQuest } from '../../src/shared/api/admin'
import type { OrgMembership } from '../../src/shared/api/admin'
import { ContractError } from '../../src/shared/api/validation'
import { DemoAdminStore } from './admin'
import { handleAssetRequest } from './admin-assets-http'
import type { DemoAssetStore } from './admin-assets'
import { HttpError, invalidInput } from './errors'
import { readJsonObject } from './json-body'
import { paginate, parseId, validateQuery } from './query'

export type MembershipLookup = (uid: string) => Promise<OrgMembership[]>
export function createAdminHandler(options: {
  store?: DemoAdminStore; assets?: DemoAssetStore; memberships?: MembershipLookup; areaIds: ReadonlySet<string>
  authenticate: (request: IncomingMessage) => Promise<string>
  send: (response: ServerResponse, status: number, body: unknown) => void
}) {
  const store = options.store ?? new DemoAdminStore({ assetLookup: (assetId) => options.assets?.metadata(assetId) })
  function requireMember(memberships: OrgMembership[], orgId: string): OrgMembership {
    const member = memberships.find((item) => item.orgId === orgId)
    if (!member) throw new HttpError(403, 'FORBIDDEN', 'この自治体の操作権限がありません。')
    if (!options.areaIds.has(member.areaId)) throw new HttpError(503, 'SYSTEM_ERROR', '自治体の公開エリア設定を利用できません。')
    return member
  }
  return async (request: IncomingMessage, response: ServerResponse, path: string, params: URLSearchParams): Promise<boolean> => {
    const isMemberships = path === '/api/v1/me/memberships'
    const route = /^\/api\/v1\/orgs\/([^/]+)\/quests(?:\/([^/]+))?$/.exec(path)
    const assetRoute = /^\/api\/v1\/orgs\/([^/]+)\/assets(?:\/([^/]+)(\/photo)?)?$/.exec(path)
    if (!isMemberships && !route && !assetRoute) return false
    const allowed = assetRoute ? (assetRoute[2] ? ['GET'] : ['POST']) : isMemberships ? ['GET'] : route?.[2] ? ['GET', 'PATCH'] : ['GET', 'POST']
    if (!allowed.includes(request.method ?? '')) {
      response.setHeader('Allow', allowed.join(', '))
      throw new HttpError(405, 'HTTP_ERROR', 'このメソッドは利用できません。')
    }
    const uid = await options.authenticate(request)
    const memberships = (await options.memberships?.(uid) ?? []).map(parseOrgMembership)
    if (isMemberships) {
      validateQuery(params, ['cursor', 'limit'])
      options.send(response, 200, paginate(memberships, params, 'memberships:' + uid, (item) => item.orgId))
      return true
    }
    const orgId = parseId(decodeURIComponent((route ?? assetRoute)![1]))
    let membership = requireMember(memberships, orgId)
    if (assetRoute) {
      validateQuery(params, [])
      await handleAssetRequest(request, response, { store: options.assets, orgId, uid,
        assetId: assetRoute[2] === undefined ? undefined : parseId(decodeURIComponent(assetRoute[2])), photo: Boolean(assetRoute[3]),
        recheck: async () => { requireMember((await options.memberships?.(uid) ?? []).map(parseOrgMembership), orgId) }, send: options.send })
      return true
    }
    const questId = route![2] === undefined ? undefined : parseId(decodeURIComponent(route![2]))
    if (request.method === 'GET') {
      if (questId) {
        validateQuery(params, [])
        options.send(response, 200, store.get(orgId, questId))
      } else {
        validateQuery(params, ['cursor', 'limit'])
        options.send(response, 200, paginate(store.list(orgId), params, 'managed:' + uid + ':' + orgId, (item) => item.questId))
      }
    } else {
      validateQuery(params, [])
      // Authorize before consuming the request; neither roles nor area IDs come from JSON.
      if (questId) store.get(orgId, questId)
      const body = await readJsonObject(request, 65_536)
      // Reading a body awaits I/O. Recheck membership just before the synchronous
      // commit so an in-flight request cannot outlive revocation.
      membership = requireMember((await options.memberships?.(uid) ?? []).map(parseOrgMembership), orgId)
      try {
        const quest = questId
          ? store.update(orgId, questId, parseUpdateManagedQuest(body))
          : store.create(membership, parseCreateManagedQuest(body).draft)
        options.send(response, questId ? 200 : 201, quest)
      } catch (error) {
        if (error instanceof ContractError) invalidInput()
        throw error
      }
    }
    return true
  }
}
