import { randomUUID } from 'node:crypto'
import type { AssetPurpose, CaptureZone, ManagedAsset, ManagedQuest, ManagedQuestDraft, ManagedShootingAreas, OrgMembership, ReviewField, ReviewSubmission, UpdateManagedQuest, UpdateShootingAreas } from '../../src/shared/api/admin'
import { parseManagedAsset, parseManagedQuestDraft, parseUpdateShootingAreas } from '../../src/shared/api/admin'
import { HttpError, invalidInput } from './errors'
import { draftPhotoFeatures } from './photo-match'
import type { PauseManagedQuest, PhotoDecision, PublishManagedQuest } from '../../src/shared/api/admin'
import type { PublicQuest } from '../../src/shared/api/types'
import { parsePublicQuest } from '../../src/shared/api/validation'
import type { PhotoTestEvidence } from './admin-photo-tests'

interface Publication {
  quest: PublicQuest
  orgId: string
  hints: string[]
  zones: CaptureZone[]
  hintAssetId: string | null
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
      shootingAreaStatus: parsed.zones.length ? 'configured' : 'unconfigured' })
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
    if ((quest.status !== 'review_pending' && quest.status !== 'published') || this.reviewMissing(quest).length) {
      throw new HttpError(409, 'REVIEW_REQUIRED', '必要な入力を揃えて、この下書き版の確認を依頼してください。')
    }
    if (!evidenceFor(match, quest, 'MATCH') || !evidenceFor(mismatch, quest, 'WRONG_TARGET') || match.photoDigest === mismatch.photoDigest) {
      throw new HttpError(409, 'PHOTO_TEST_REQUIRED', 'この下書き版で、異なる写真の一致と別対象の試験が必要です。')
    }
    if (quest.status === 'published') return quest
    const version = (this.publications.get(questId)?.quest.version ?? 0) + 1
    if (!Number.isSafeInteger(version)) throw new HttpError(409, 'DRAFT_CONFLICT', '公開版を更新できません。')
    const { materials, content, hintAssetId } = quest.draft
    const conditions = ['開発用の架空データです。実際の訪問・撮影には使えません。']
    if (materials.requiresBoat) conditions.push('船上・海上からの撮影が必要。')
    if (materials.requiresPaidFacility) conditions.push('有料施設内での撮影が必要。')
    if (materials.price.trim()) conditions.push('料金 ' + materials.price.trim())
    if (materials.photoNote.trim()) conditions.push('撮影時の注意 ' + materials.photoNote.trim())
    const visible = parsePublicQuest({ questId, version, title: content.title.trim(), clue: content.question.trim(), areaId: quest.areaId,
      visitConditions: conditions.join('\n'), hintCount: content.hints.length,
      ...(hintAssetId ? { optionalHintImage: '/api/v1/quests/' + questId + '/hint-image?expectedVersion=' + version } : {}) })
    const updated: ManagedQuest = { ...quest, status: 'published', publishedVersion: version }
    this.publications.set(questId, { quest: visible, orgId, hints: content.hints.map((hint) => hint.trim()),
      zones: structuredClone(this.shootingAreas.get(questId) ?? []), hintAssetId, pauseReason: null })
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
    return [...this.publications.values()].filter((publication) => publication.pauseReason === null).map(({ quest }) => ({ ...quest }))
  }
  getPublished(questId: string): Publication | undefined {
    const publication = this.publications.get(questId)
    return publication?.pauseReason === null ? structuredClone(publication) : undefined
  }
  isPaused(questId: string): boolean {
    const publication = this.publications.get(questId)
    return publication !== undefined && publication.pauseReason !== null
  }
  private reviewMissing(quest: ManagedQuest): ReviewField[] {
    const { orgId } = quest
    const { materials, content, referenceAssetId, hintAssetId } = quest.draft
    const missing: ReviewField[] = []
    if (!materials.name.trim()) missing.push('materials.name')
    if (!materials.evidence.trim()) missing.push('materials.evidence')
    if (!materials.photoRights.trim()) missing.push('materials.photoRights')
    if (!referenceAssetId || !this.hasAsset(orgId, referenceAssetId, 'reference')) missing.push('referenceAssetId')
    if (hintAssetId && !this.hasAsset(orgId, hintAssetId, 'public_hint')) missing.push('hintAssetId')
    if (quest.shootingAreaStatus !== 'configured') missing.push('shootingAreas')
    if (!content.title.trim()) missing.push('content.title')
    if (!content.question.trim()) missing.push('content.question')
    if (content.hints.some((hint) => !hint.trim())) missing.push('content.hints')
    if (!draftPhotoFeatures(content.verifiedFeatures)) missing.push('content.verifiedFeatures')
    return missing
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
  private checkedDraft(orgId: string, input: ManagedQuestDraft): ManagedQuestDraft {
    const draft = parseManagedQuestDraft(input)
    for (const [assetId, purpose] of [[draft.referenceAssetId, 'reference'], [draft.hintAssetId, 'public_hint']] as const) {
      if (assetId === null) continue
      if (!this.hasAsset(orgId, assetId, purpose)) invalidInput()
    }
    return draft
  }
}
