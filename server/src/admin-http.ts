import type { IncomingMessage, ServerResponse } from 'node:http'
import { parseCreateManagedQuest, parseOrgMembership, parseUpdateManagedQuest, parseUpdateShootingAreas } from '../../src/shared/api/admin'
import type { OrgMembership } from '../../src/shared/api/admin'
import { ContractError } from '../../src/shared/api/validation'
import { DemoAdminStore } from './admin'
import { handleAssetRequest } from './admin-assets-http'
import type { DemoAssetStore } from './admin-assets'
import { DemoPhotoTestStore } from './admin-photo-tests'
import { handlePhotoTest } from './admin-photo-tests-http'
import type { AdminPhotoTestOptions } from './admin-photo-tests-http'
import { HttpError, invalidInput } from './errors'
import { readJsonObject } from './json-body'
import { paginate, parseId, validateQuery } from './query'

export type MembershipLookup = (uid: string) => Promise<OrgMembership[]>
export function createAdminHandler(options: {
  store?: DemoAdminStore; assets?: DemoAssetStore; memberships?: MembershipLookup; areaIds: ReadonlySet<string>
  photoTest?: AdminPhotoTestOptions; acquirePhotoTest?: (uid: string) => () => void
  authenticate: (request: IncomingMessage) => Promise<string>
  send: (response: ServerResponse, status: number, body: unknown) => void
}) {
  const store = options.store ?? new DemoAdminStore({ assetLookup: (assetId) => options.assets?.metadata(assetId) })
  const photoTests = options.photoTest ? new DemoPhotoTestStore(options.photoTest.capacity) : undefined
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
    const shootingRoute = /^\/api\/v1\/orgs\/([^/]+)\/quests\/([^/]+)\/shooting-areas$/.exec(path)
    const testRoute = /^\/api\/v1\/orgs\/([^/]+)\/quests\/([^/]+)\/test$/.exec(path)
    if (!isMemberships && !route && !assetRoute && !shootingRoute && !testRoute) return false
    const allowed = testRoute ? ['POST'] : shootingRoute ? ['GET', 'PUT'] : assetRoute ? (assetRoute[2] ? ['GET'] : ['POST']) : isMemberships ? ['GET'] : route?.[2] ? ['GET', 'PATCH'] : ['GET', 'POST']
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
    const orgId = parseId(decodeURIComponent((route ?? assetRoute ?? shootingRoute ?? testRoute)![1]))
    let membership = requireMember(memberships, orgId)
    if (testRoute) {
      validateQuery(params, [])
      const questId = parseId(decodeURIComponent(testRoute[2]))
      store.get(orgId, questId)
      await handlePhotoTest(request, response, { store: photoTests, assets: options.assets, options: options.photoTest,
        acquire: options.acquirePhotoTest, uid, orgId, questId, send: options.send,
        recheck: async (expectedRevision) => {
          requireMember((await options.memberships?.(uid) ?? []).map(parseOrgMembership), orgId)
          const current = store.get(orgId, questId)
          if (current.draftRevision !== expectedRevision) throw new HttpError(409, 'DRAFT_CONFLICT', '下書きの版が変更されています。')
          return current
        } })
      return true
    }
    if (assetRoute) {
      validateQuery(params, [])
      await handleAssetRequest(request, response, { store: options.assets, orgId, uid,
        assetId: assetRoute[2] === undefined ? undefined : parseId(decodeURIComponent(assetRoute[2])), photo: Boolean(assetRoute[3]),
        recheck: async () => { requireMember((await options.memberships?.(uid) ?? []).map(parseOrgMembership), orgId) }, send: options.send })
      return true
    }
    if (shootingRoute) {
      validateQuery(params, [])
      const questId = parseId(decodeURIComponent(shootingRoute[2]))
      store.get(orgId, questId)
      if (request.method === 'GET') options.send(response, 200, store.getShootingAreas(orgId, questId))
      else {
        const body = await readJsonObject(request)
        requireMember((await options.memberships?.(uid) ?? []).map(parseOrgMembership), orgId)
        try { options.send(response, 200, store.updateShootingAreas(orgId, questId, parseUpdateShootingAreas(body))) }
        catch (error) { if (error instanceof ContractError) invalidInput(); throw error }
      }
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
