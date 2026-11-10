import { randomUUID } from 'node:crypto'
import type { AssetPurpose, CaptureZone, ManagedAsset, ManagedQuest, ManagedQuestDraft, ManagedShootingAreas, OrgMembership, ReviewSubmission, UpdateManagedQuest, UpdateShootingAreas } from '../../src/shared/api/admin'
import { parseManagedAsset, parseManagedQuestDraft, parseUpdateShootingAreas, shootingAreaStatus } from '../../src/shared/api/admin'
import { HttpError, invalidInput } from './errors'
import { draftPhotoFeatures } from './photo-match'
import type { PauseManagedQuest, PhotoDecision, PublishManagedQuest } from '../../src/shared/api/admin'
import type { PublicQuest } from '../../src/shared/api/types'
import type { PhotoTestEvidence } from './admin-photo-tests'
import { projectManagedQuest } from './admin-publication'
import { missingReviewFields } from './admin-review'

interface AnswerMaterial {
  referenceAssetId: string
  features: string[]
  zones: CaptureZone[]
}

interface PublicPublication {
  quest: PublicQuest
  orgId: string
  hints: string[]
  hintAssetId: string | null
  hintAssetIds: (string | null)[]
}

interface Publication extends PublicPublication {
  answerMaterial: AnswerMaterial
  pauseReason: string | null
}

function evidenceFor(test: PhotoTestEvidence | undefined, quest: ManagedQuest, outcome: PhotoDecision): test is PhotoTestEvidence {
  return !!test && test.orgId === quest.orgId && test.questId === quest.questId && test.draftRevision === quest.draftRevision &&
    test.source === 'mock' && test.outcome === outcome && /^[a-f0-9]{64}$/.test(test.photoDigest)
}

export class DemoAdminStore {
  private readonly quests = new Map<string, ManagedQuest>()
  private readonly assets = new Map<string, ManagedAsset>()
  private readonly shootingAreas = new Map<string, CaptureZone[]>()
  private readonly publications = new Map<string, Publication>()
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
    return structuredClone([...this.quests.values()].filter((quest) => quest.orgId === orgId).map((quest) => this.withAreaStatus(quest)))
  }
  get(orgId: string, questId: string): ManagedQuest {
    const quest = this.quests.get(questId)
    if (!quest || quest.orgId !== orgId) throw new HttpError(404, 'NOT_FOUND', '見つかりません。')
    return structuredClone(this.withAreaStatus(quest))
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
    const updated: ManagedQuest = { ...quest, status: 'draft', draftRevision: quest.draftRevision + 1, draft: this.checkedDraft(orgId, input.draft) }
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
    this.quests.set(questId, { ...quest, status: 'draft', draftRevision: quest.draftRevision + 1,
      shootingAreaStatus: shootingAreaStatus(parsed.zones) })
    return this.getShootingAreas(orgId, questId)
  }
  submitReview(orgId: string, questId: string, expectedRevision: number): ReviewSubmission {
    const quest = this.getAtRevision(orgId, questId, expectedRevision)
    if (quest.status === 'published') throw new HttpError(409, 'DRAFT_CONFLICT', 'この下書き版は公開済みです。')
    const missing = this.reviewMissing(quest)
    const status = missing.length ? 'draft' : 'review_pending'
    const updated: ManagedQuest = { ...quest, status }
    if (status !== quest.status) this.quests.set(questId, structuredClone(updated))
    return { quest: updated, missing }
  }
  publish(orgId: string, questId: string, input: PublishManagedQuest, match?: PhotoTestEvidence, mismatch?: PhotoTestEvidence): ManagedQuest {
    const quest = this.getAtRevision(orgId, questId, input.expectedDraftRevision)
    const { content, referenceAssetId, hintAssetId } = quest.draft
    const features = draftPhotoFeatures(content.verifiedFeatures)
    if ((quest.status !== 'review_pending' && quest.status !== 'published') ||
      !referenceAssetId || !features || this.reviewMissing(quest).length) {
      throw new HttpError(409, 'REVIEW_REQUIRED', '必要な入力を揃えて、この下書き版の確認を依頼してください。')
    }
    if (!evidenceFor(match, quest, 'MATCH') || !evidenceFor(mismatch, quest, 'WRONG_TARGET') || match.photoDigest === mismatch.photoDigest) {
      throw new HttpError(409, 'PHOTO_TEST_REQUIRED', 'この下書き版で、異なる写真の一致と別対象の試験が必要です。')
    }
    if (quest.status === 'published') return quest
    const version = (this.publications.get(questId)?.quest.version ?? 0) + 1
    if (!Number.isSafeInteger(version)) throw new HttpError(409, 'DRAFT_CONFLICT', '公開版を更新できません。')
    const updated: ManagedQuest = { ...quest, status: 'published', publishedVersion: version }
    this.publications.set(questId, {
      ...projectManagedQuest(quest, version), orgId, hintAssetId, hintAssetIds: (quest.draft.hintAssetIds ?? [null, null, null]).map((assetId, index) => assetId ?? (index === 0 ? hintAssetId : null)), pauseReason: null,
      answerMaterial: { referenceAssetId, features, zones: structuredClone(this.shootingAreas.get(questId) ?? []) },
    })
    this.quests.set(questId, updated)
    return structuredClone(updated)
  }
  pause(orgId: string, questId: string, input: PauseManagedQuest): ManagedQuest {
    const quest = this.get(orgId, questId)
    const publication = this.publications.get(questId)
    if (!publication) throw new HttpError(409, 'QUEST_UNAVAILABLE', '公開された版がありません。')
    if (publication.quest.version !== input.expectedPublishedVersion) throw new HttpError(409, 'QUEST_CHANGED', '公開版が変更されています。')
    if (publication.pauseReason !== null) {
      if (publication.pauseReason !== input.reason) throw new HttpError(409, 'QUEST_UNAVAILABLE', 'この版は休止済みです。')
      return quest
    }
    if (!Number.isSafeInteger(quest.draftRevision + 1)) throw new HttpError(409, 'DRAFT_CONFLICT', '下書きの版を更新できません。')
    const updated: ManagedQuest = { ...quest, publishedVersion: null, status: 'paused', draftRevision: quest.draftRevision + 1 }
    this.publications.set(questId, { ...publication, pauseReason: input.reason })
    this.quests.set(questId, updated)
    return structuredClone(updated)
  }
  listPublished(): PublicQuest[] {
    return [...this.publications.values()].filter((publication) => publication.pauseReason === null).map(({ quest }) => structuredClone(quest))
  }
  getPublished(questId: string): PublicPublication | undefined {
    const publication = this.publications.get(questId)
    if (publication?.pauseReason !== null) return undefined
    const { quest, orgId, hints, hintAssetId, hintAssetIds } = publication
    return structuredClone({ quest, orgId, hints, hintAssetId, hintAssetIds })
  }
  // This snapshot is for server-side answer checks only.
  getPublishedAnswerMaterial(questId: string, version: number): (AnswerMaterial & { orgId: string }) | undefined {
    const publication = this.publications.get(questId)
    if (publication?.pauseReason !== null || publication.quest.version !== version) return undefined
    return structuredClone({ orgId: publication.orgId, ...publication.answerMaterial })
  }
  isPaused(questId: string): boolean {
    const publication = this.publications.get(questId)
    return publication !== undefined && publication.pauseReason !== null
  }
  getReportTarget(questId: string): { orgId: string; questVersion: number } | undefined {
    const publication = this.publications.get(questId)
    return publication && { orgId: publication.orgId, questVersion: publication.quest.version }
  }
  private reviewMissing(quest: ManagedQuest) {
    const zones = this.shootingAreas.get(quest.questId) ?? []
    quest = { ...quest, shootingAreaStatus: shootingAreaStatus(zones) }
    const { orgId } = quest
    const { referenceAssetId, hintAssetId } = quest.draft
    return missingReviewFields(quest, {
      reference: referenceAssetId !== null && this.hasAsset(orgId, referenceAssetId, 'reference'),
      public_hint: hintAssetId !== null && this.hasAsset(orgId, hintAssetId, 'public_hint'),
    })
  }
  getAtRevision(orgId: string, questId: string, expectedRevision: number): ManagedQuest {
    const quest = this.get(orgId, questId)
    if (quest.draftRevision !== expectedRevision) {
      throw new HttpError(409, 'DRAFT_CONFLICT', '別の編集が保存されています。下書きを取得し直してください。')
    }
    return quest
  }
  private forUpdate(orgId: string, questId: string, expectedRevision: number): ManagedQuest {
    const quest = this.getAtRevision(orgId, questId, expectedRevision)
    if (!Number.isSafeInteger(quest.draftRevision + 1)) throw new HttpError(409, 'DRAFT_CONFLICT', '下書きの版を更新できません。')
    return quest
  }
  private hasAsset(orgId: string, assetId: string, purpose: AssetPurpose): boolean {
    const asset = this.assetLookup?.(assetId) ?? this.assets.get(assetId)
    return asset?.orgId === orgId && asset.purpose === purpose
  }
  private withAreaStatus(quest: ManagedQuest): ManagedQuest {
    return { ...quest, shootingAreaStatus: shootingAreaStatus(this.shootingAreas.get(quest.questId) ?? []) }
  }
  private checkedDraft(orgId: string, input: ManagedQuestDraft): ManagedQuestDraft {
    const draft = parseManagedQuestDraft(input)
    for (const [assetId, purpose] of [[draft.referenceAssetId, 'reference'], [draft.hintAssetId, 'public_hint'],
      ...(draft.hintAssetIds ?? []).map((assetId) => [assetId, 'public_hint'] as const)] as const) {
      if (assetId === null) continue
      if (!this.hasAsset(orgId, assetId, purpose)) invalidInput()
    }
    return draft
  }
}
