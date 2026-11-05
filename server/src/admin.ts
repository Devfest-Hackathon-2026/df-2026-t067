import { randomUUID } from 'node:crypto'
import type { CaptureZone, ManagedAsset, ManagedQuest, ManagedQuestDraft, ManagedShootingAreas, OrgMembership, UpdateManagedQuest, UpdateShootingAreas } from '../../src/shared/api/admin'
import { parseManagedAsset, parseManagedQuestDraft, parseUpdateShootingAreas } from '../../src/shared/api/admin'
import { HttpError, invalidInput } from './errors'

export class DemoAdminStore {
  private readonly quests = new Map<string, ManagedQuest>()
  private readonly assets = new Map<string, ManagedAsset>()
  private readonly shootingAreas = new Map<string, CaptureZone[]>()
  private readonly assetLookup?: (assetId: string) => ManagedAsset | undefined
  constructor(options: { assets?: readonly ManagedAsset[]; assetLookup?: (assetId: string) => ManagedAsset | undefined } = {}) {
    this.assetLookup = options.assetLookup
    for (const input of options.assets ?? []) {
      const asset = parseManagedAsset(input)
      if (this.assets.has(asset.assetId)) throw new Error('Duplicate demo asset ID.')
      this.assets.set(asset.assetId, asset)
    }
  }
  list(orgId: string): ManagedQuest[] {
    return structuredClone([...this.quests.values()].filter((quest) => quest.orgId === orgId))
  }
  get(orgId: string, questId: string): ManagedQuest {
    const quest = this.quests.get(questId)
    if (!quest || quest.orgId !== orgId) throw new HttpError(404, 'NOT_FOUND', '見つかりません。')
    return structuredClone(quest)
  }
  create(membership: OrgMembership, input: ManagedQuestDraft): ManagedQuest {
    if (this.quests.size >= 1000 || this.list(membership.orgId).length >= 100) {
      throw new HttpError(429, 'RATE_LIMITED', '開発用下書きの上限に達しました。')
    }
    const draft = this.checkedDraft(membership.orgId, input)
    const quest: ManagedQuest = { questId: randomUUID(), orgId: membership.orgId, areaId: membership.areaId,
      draftRevision: 1, publishedVersion: null, status: 'draft', shootingAreaStatus: 'unconfigured', draft, source: 'mock' }
    this.quests.set(quest.questId, quest)
    return structuredClone(quest)
  }
  update(orgId: string, questId: string, input: UpdateManagedQuest): ManagedQuest {
    const quest = this.forUpdate(orgId, questId, input.expectedDraftRevision)
    const updated = { ...quest, draftRevision: quest.draftRevision + 1, draft: this.checkedDraft(orgId, input.draft) }
    this.quests.set(questId, updated)
    return structuredClone(updated)
  }
  getShootingAreas(orgId: string, questId: string): ManagedShootingAreas {
    const quest = this.get(orgId, questId)
    return { orgId, questId, draftRevision: quest.draftRevision,
      zones: structuredClone(this.shootingAreas.get(questId) ?? []), source: 'mock' }
  }
  updateShootingAreas(orgId: string, questId: string, input: UpdateShootingAreas): ManagedShootingAreas {
    const parsed = parseUpdateShootingAreas(input)
    const quest = this.forUpdate(orgId, questId, parsed.expectedDraftRevision)
    this.shootingAreas.set(questId, parsed.zones)
    this.quests.set(questId, { ...quest, draftRevision: quest.draftRevision + 1,
      shootingAreaStatus: parsed.zones.length ? 'configured' : 'unconfigured' })
    return this.getShootingAreas(orgId, questId)
  }
  private forUpdate(orgId: string, questId: string, expectedRevision: number): ManagedQuest {
    const quest = this.get(orgId, questId)
    if (quest.draftRevision !== expectedRevision) {
      throw new HttpError(409, 'DRAFT_CONFLICT', '別の編集が保存されています。下書きを取得し直してください。')
    }
    if (!Number.isSafeInteger(quest.draftRevision + 1)) throw new HttpError(409, 'DRAFT_CONFLICT', '下書きの版を更新できません。')
    return quest
  }
  private checkedDraft(orgId: string, input: ManagedQuestDraft): ManagedQuestDraft {
    const draft = parseManagedQuestDraft(input)
    for (const [assetId, purpose] of [[draft.referenceAssetId, 'reference'], [draft.hintAssetId, 'public_hint']] as const) {
      if (assetId === null) continue
      const asset = this.assetLookup?.(assetId) ?? this.assets.get(assetId)
      if (!asset || asset.orgId !== orgId || asset.purpose !== purpose) invalidInput()
    }
    return draft
  }
}
