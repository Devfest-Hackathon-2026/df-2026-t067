import type { IncomingMessage, ServerResponse } from 'node:http'
import { parseCreateManagedQuest, parseDraftRevisionRequest, parseDraftSuggestion, parsePauseManagedQuest, parsePublishManagedQuest, parseSubmitReview, parseUpdateManagedQuest, parseUpdateShootingAreas } from '../../src/shared/api/admin'
import { ContractError } from '../../src/shared/api/validation'
import type { AssetHttpStore } from './admin-assets-http'
import { handlePhotoTest } from './admin-photo-tests-http'
import type { DraftSuggester } from './draft-suggester'
import { HttpError, invalidInput } from './errors'
import type { FirestoreManagedPublication } from './firestore-admin-publication'
import type { FirestoreManagedDraftStore } from './firestore-managed-drafts'
import { send } from './http-server'
import { readJsonObject } from './json-body'
import { paginate, parseId, validateQuery } from './query'

type PhotoTestDependencies = Pick<Parameters<typeof handlePhotoTest>[2], 'assets' | 'options' | 'store' | 'acquire'>
type DraftSuggestionDependencies = {
  assets: Pick<AssetHttpStore, 'acquire' | 'getOwned' | 'getPhotoOwned'>
  generator: DraftSuggester
}

export function createDurableDraftHandler(store: FirestoreManagedDraftStore, authenticate: (request: IncomingMessage) => Promise<string>,
  photoTest?: PhotoTestDependencies, publication?: FirestoreManagedPublication, suggestion?: DraftSuggestionDependencies) {
  return async (request: IncomingMessage, response: ServerResponse, path: string, params: URLSearchParams): Promise<boolean> => {
    const memberships = path === '/api/v1/me/memberships'
    const quest = /^\/api\/v1\/orgs\/([^/]+)\/quests(?:\/([^/]+)(?:\/(shooting-areas|submit-review|test|publish|pause|generate))?)?$/.exec(path)
    if (!memberships && !quest) return false

    const action = quest?.[3]
    const rawQuestId = quest?.[2]
    const allowed = memberships ? ['GET'] : action === 'shooting-areas' ? ['GET', 'PUT'] :
      action ? ['POST'] : rawQuestId ? ['GET', 'PATCH'] : ['GET', 'POST']
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
    if (action === 'test' && questId !== undefined) {
      await store.get(uid, orgId, questId)
      await handlePhotoTest(request, response, { ...photoTest, uid, orgId, questId, send,
        recheck: (revision) => store.getAtRevision(uid, orgId, questId, revision) })
      return true
    }
    if (request.method === 'GET' && questId !== undefined) {
      send(response, 200, action === 'shooting-areas' ? await store.getShootingAreas(uid, orgId, questId) : await store.get(uid, orgId, questId))
      return true
    }

    await store.assertMember(uid, orgId)
    const body = await readJsonObject(request, action === 'generate' ? 4096 : 65_536)
    if (response.destroyed) return true
    try {
      if (questId === undefined) {
        send(response, 201, await store.create(uid, orgId, parseCreateManagedQuest(body).draft))
      } else if (action === 'shooting-areas') {
        send(response, 200, await store.updateShootingAreas(uid, orgId, questId, parseUpdateShootingAreas(body)))
      } else if (action === 'submit-review') {
        const { expectedDraftRevision } = parseSubmitReview(body)
        send(response, 200, await store.submitReview(uid, orgId, questId, expectedDraftRevision))
      } else if (action === 'generate') {
        const { expectedDraftRevision } = parseDraftRevisionRequest(body)
        const { draft } = await store.getAtRevision(uid, orgId, questId, expectedDraftRevision)
        if (!suggestion) throw new HttpError(503, 'SYSTEM_ERROR', '下書き生成が未接続です。')
        const { referenceAssetId, materials } = draft
        if (!referenceAssetId || !materials.name.trim() || !materials.photoRights.trim()) invalidInput()
        if (response.destroyed || response.writableEnded) return true
        const { assets, generator } = suggestion
        const release = assets.acquire(uid)
        const controller = new AbortController()
        const abort = () => controller.abort()
        response.once('close', abort)
        try {
          const asset = await assets.getOwned(orgId, referenceAssetId)
          if (asset?.purpose !== 'reference') invalidInput()
          const reference = await assets.getPhotoOwned(orgId, referenceAssetId)
          // Recheck access after Storage I/O before allowing an external request.
          await store.getAtRevision(uid, orgId, questId, expectedDraftRevision)
          if (controller.signal.aborted) return true
          const content = reference && await generator.suggest(reference, materials, controller.signal)
          if (controller.signal.aborted) return true
          if (!content) throw new HttpError(400, 'INVALID_INPUT', '下書きの参考素材に指定の合成画像を登録してください。')
          await store.getAtRevision(uid, orgId, questId, expectedDraftRevision)
          if (controller.signal.aborted) return true
          send(response, 200, parseDraftSuggestion({ orgId, questId, draftRevision: expectedDraftRevision, content, source: generator.source }))
        } catch (error) {
          if (controller.signal.aborted) return true
          throw error
        } finally {
          response.removeListener('close', abort)
          release()
        }
      } else if (action === 'publish' || action === 'pause') {
        if (!publication) throw new HttpError(503, 'SYSTEM_ERROR', '公開・休止の処理が未接続です。')
        const updated = action === 'publish'
          ? await publication.publish(uid, orgId, questId, parsePublishManagedQuest(body))
          : await publication.pause(uid, orgId, questId, parsePauseManagedQuest(body))
        send(response, 200, updated)
      } else {
        send(response, 200, await store.update(uid, orgId, questId, parseUpdateManagedQuest(body)))
      }
    } catch (error) { if (error instanceof ContractError) invalidInput(); throw error }
    return true
  }
}
