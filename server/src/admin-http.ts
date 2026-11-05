import type { IncomingMessage, ServerResponse } from 'node:http'
import { parseCreateManagedQuest, parseDraftRevisionRequest, parseDraftSuggestion, parseOrgMembership, parsePauseManagedQuest, parsePublishManagedQuest, parseSubmitReview, parseUpdateManagedQuest, parseUpdateShootingAreas } from '../../src/shared/api/admin'
import type { OrgMembership } from '../../src/shared/api/admin'
import { ContractError } from '../../src/shared/api/validation'
import type { DemoAdminStore } from './admin'
import { handleAssetRequest } from './admin-assets-http'
import type { DemoAssetStore } from './admin-assets'
import { DemoPhotoTestStore } from './admin-photo-tests'
import { handlePhotoTest } from './admin-photo-tests-http'
import type { AdminPhotoTestOptions } from './admin-photo-tests-http'
import type { FixtureDraftSuggester } from './demo-draft-suggestions'
import { HttpError, invalidInput } from './errors'
import { readJsonObject } from './json-body'
import { paginate, parseId, validateQuery } from './query'
import type { DemoReportStore } from './reports'

export type MembershipLookup = (uid: string) => Promise<OrgMembership[]>
export function createAdminHandler(options: {
  store: DemoAdminStore; assets?: DemoAssetStore; memberships?: MembershipLookup; areaIds: ReadonlySet<string>
  photoTest?: AdminPhotoTestOptions; acquirePhotoTest?: (uid: string) => () => void
  suggestDraft?: FixtureDraftSuggester
  reports?: DemoReportStore
  authenticate: (request: IncomingMessage) => Promise<string>
  send: (response: ServerResponse, status: number, body: unknown) => void
}) {
  const store = options.store
  const photoTests = options.photoTest ? new DemoPhotoTestStore(options.photoTest.capacity) : undefined
  function requireMember(memberships: OrgMembership[], orgId: string): OrgMembership {
    const member = memberships.find((item) => item.orgId === orgId)
    if (!member) throw new HttpError(403, 'FORBIDDEN', 'この自治体の操作権限がありません。')
    if (!options.areaIds.has(member.areaId)) throw new HttpError(503, 'SYSTEM_ERROR', '自治体の公開エリア設定を利用できません。')
    return member
  }
  function requirePublisher(member: OrgMembership): void {
    if (member.role !== 'publisher') throw new HttpError(403, 'FORBIDDEN', '公開担当者の権限が必要です。')
  }
  return async (request: IncomingMessage, response: ServerResponse, path: string, params: URLSearchParams): Promise<boolean> => {
    const isMemberships = path === '/api/v1/me/memberships'
    const route = /^\/api\/v1\/orgs\/([^/]+)\/quests(?:\/([^/]+))?$/.exec(path)
    const assetRoute = /^\/api\/v1\/orgs\/([^/]+)\/assets(?:\/([^/]+)(\/photo)?)?$/.exec(path)
    const shootingRoute = /^\/api\/v1\/orgs\/([^/]+)\/quests\/([^/]+)\/shooting-areas$/.exec(path)
    const actionRoute = /^\/api\/v1\/orgs\/([^/]+)\/quests\/([^/]+)\/(test|submit-review|publish|pause|generate)$/.exec(path)
    const reportsRoute = /^\/api\/v1\/orgs\/([^/]+)\/reports$/.exec(path)
    if (!isMemberships && !route && !assetRoute && !shootingRoute && !actionRoute && !reportsRoute) return false
    const allowed = actionRoute ? ['POST'] : shootingRoute ? ['GET', 'PUT'] : assetRoute ? (assetRoute[2] ? ['GET'] : ['POST']) : isMemberships || reportsRoute ? ['GET'] : route?.[2] ? ['GET', 'PATCH'] : ['GET', 'POST']
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
    const orgId = parseId(decodeURIComponent((route ?? assetRoute ?? shootingRoute ?? actionRoute ?? reportsRoute)![1]))
    let membership = requireMember(memberships, orgId)
    if (reportsRoute) {
      requirePublisher(membership)
      validateQuery(params, ['cursor', 'limit'])
      if (!options.reports) throw new HttpError(503, 'SYSTEM_ERROR', '報告の保存先が未接続です。')
      options.send(response, 200, options.reports.list(orgId, params))
      return true
    }
    if (actionRoute) {
      validateQuery(params, [])
      const questId = parseId(decodeURIComponent(actionRoute[2]))
      const action = actionRoute[3]
      const publisherOnly = action === 'publish' || action === 'pause'
      if (publisherOnly) requirePublisher(membership)
      store.get(orgId, questId)
      if (action !== 'test') {
        const body = await readJsonObject(request)
        const currentMember = requireMember((await options.memberships?.(uid) ?? []).map(parseOrgMembership), orgId)
        if (publisherOnly) requirePublisher(currentMember)
        if (response.destroyed) return true
        try {
          if (action === 'publish') {
            const input = parsePublishManagedQuest(body)
            const quest = store.getAtRevision(orgId, questId, input.expectedDraftRevision)
            const { hintAssetId, referenceAssetId } = quest.draft
            if (hintAssetId) {
              const asset = options.assets?.getOwned(orgId, hintAssetId)
              const image = options.assets?.getPhotoOwned(orgId, hintAssetId)
              const reference = referenceAssetId && options.assets?.getPhotoOwned(orgId, referenceAssetId)
              if (asset?.purpose !== 'public_hint' || !image || !reference || image.equals(reference)) {
                throw new HttpError(409, 'REVIEW_REQUIRED', '参考写真と異なる公開ヒント画像を確認してください。')
              }
            }
            options.send(response, 200, store.publish(orgId, questId, input,
              photoTests?.getEvidence(input.matchTestId), photoTests?.getEvidence(input.mismatchTestId)))
          } else if (action === 'pause') {
            options.send(response, 200, store.pause(orgId, questId, parsePauseManagedQuest(body)))
          } else if (action === 'generate') {
            const { expectedDraftRevision } = parseDraftRevisionRequest(body)
            const quest = store.getAtRevision(orgId, questId, expectedDraftRevision)
            if (!options.suggestDraft || !options.assets) throw new HttpError(503, 'SYSTEM_ERROR', '下書き生成が未接続です。')
            const { referenceAssetId, materials } = quest.draft
            if (!referenceAssetId || !materials.name.trim() || !materials.evidence.trim() || !materials.photoRights.trim() ||
              options.assets.getOwned(orgId, referenceAssetId)?.purpose !== 'reference') invalidInput()
            const reference = options.assets.getPhotoOwned(orgId, referenceAssetId)
            const content = reference && options.suggestDraft(reference)
            if (!content) throw new HttpError(400, 'INVALID_INPUT', '下書きの参考素材に指定の合成画像を登録してください。')
            options.send(response, 200, parseDraftSuggestion({ orgId, questId, draftRevision: expectedDraftRevision, content, source: 'mock' }))
          } else {
            const { expectedDraftRevision } = parseSubmitReview(body)
            options.send(response, 200, store.submitReview(orgId, questId, expectedDraftRevision))
          }
        } catch (error) { if (error instanceof ContractError) invalidInput(); throw error }
        return true
      }
      await handlePhotoTest(request, response, { store: photoTests, assets: options.assets, options: options.photoTest,
        acquire: options.acquirePhotoTest, uid, orgId, questId, send: options.send,
        recheck: async (expectedRevision) => {
          requireMember((await options.memberships?.(uid) ?? []).map(parseOrgMembership), orgId)
          return store.getAtRevision(orgId, questId, expectedRevision)
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
