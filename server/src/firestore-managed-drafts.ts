import { randomUUID } from 'node:crypto'
import type { DocumentSnapshot, Firestore, Transaction } from 'firebase-admin/firestore'
import { CAPTURE_ZONE_RADIUS_METERS, parseCaptureZones, parseManagedQuestDraft, parseManagedQuest, parseUpdateShootingAreas, shootingAreaStatus } from '../../src/shared/api/admin'
import { isQuestNumber } from '../../src/shared/api/validation'
import type { AssetPurpose, ManagedQuest, ManagedQuestDraft, ManagedShootingAreas, ReviewSubmission, UpdateManagedQuest, UpdateShootingAreas } from '../../src/shared/api/admin'
import { isPhotoApproved, photoApprovalRequired } from './admin-photo-approvals'
import { missingReviewFields } from './admin-review'
import { HttpError, invalidInput } from './errors'
import { answerTransaction, notFound, processingError } from './firestore-answer-data'
import { readOrgAssetRecord } from './firestore-org-assets'
import { listOrgMemberships, requireOrgMember } from './firestore-org-memberships'
import { assertSpotInMunicipalArea, areaPrefectureCode, readMunicipalArea } from './municipal-areas'

function spotZones(draft: Pick<ManagedQuestDraft, 'afterClear'>) {
  const spot = draft.afterClear.spot
  return spot ? [{ ...spot.position, radiusMeters: CAPTURE_ZONE_RADIUS_METERS }] : []
}

export function hasSpotShootingArea(draft: Pick<ManagedQuestDraft, 'afterClear'>, zones: ReturnType<typeof parseCaptureZones>) {
  const [expected] = spotZones(draft)
  return Boolean(expected && zones.length === 1 && zones[0].latitude === expected.latitude &&
    zones[0].longitude === expected.longitude && zones[0].radiusMeters === expected.radiusMeters)
}

const maxOrgDrafts = 100
const maxDrafts = 1000

export class FirestoreManagedDraftStore {
  constructor(private readonly db: Firestore) {}

  listMemberships(uid: string) { return listOrgMemberships(this.db, uid) }

  assertMember(uid: string, orgId: string) {
    return answerTransaction(this.db, (tx) => requireOrgMember(this.db, tx, uid, orgId), true)
  }

  list(uid: string, orgId: string) {
    return answerTransaction(this.db, async (tx) => {
      await requireOrgMember(this.db, tx, uid, orgId)
      const snapshots = await tx.get(this.db.collection('quests').where('orgId', '==', orgId).where('managed', '==', true).limit(maxOrgDrafts + 1))
      if (snapshots.size > maxOrgDrafts) throw processingError()
      return snapshots.docs.map((row) => readDraft(row, orgId).quest)
    }, true)
  }

  get(uid: string, orgId: string, questId: string) {
    return answerTransaction(this.db, async (tx) => (await this.readOwned(tx, uid, orgId, questId)).quest, true)
  }

  getAtRevision(uid: string, orgId: string, questId: string, revision: number) {
    return answerTransaction(this.db, (tx) => this.readAtRevision(tx, uid, orgId, questId, revision), true)
  }

  async readAtRevision(tx: Transaction, uid: string, orgId: string, questId: string, revision: number) {
    const { quest } = await this.readOwned(tx, uid, orgId, questId)
    if (quest.draftRevision !== revision) throw new HttpError(409, 'DRAFT_CONFLICT', '下書きの版が変更されています。')
    return quest
  }

  getShootingAreas(uid: string, orgId: string, questId: string) {
    return answerTransaction(this.db, async (tx): Promise<ManagedShootingAreas> => {
      const { quest, zones } = await this.readOwned(tx, uid, orgId, questId)
      return { orgId, questId, draftRevision: quest.draftRevision, zones, source: 'real' }
    }, true)
  }

  create(uid: string, orgId: string, draft: ManagedQuestDraft, deriveShootingArea = false) {
    draft = parseManagedQuestDraft(draft)
    const ref = this.db.collection('quests').doc(randomUUID())
    return answerTransaction(this.db, async (tx) => {
      const member = await requireOrgMember(this.db, tx, uid, orgId)
      const area = await tx.get(this.db.collection('areas').doc(member.areaId))
      const exploration = readMunicipalArea({ id: area.id, data: area.data() }, member)
      if (!exploration) throw new HttpError(503, 'SYSTEM_ERROR', '所属自治体の行政区域を確認できません。')
      // 場所（都道府県コードで分類された地域）は必須（D-33）。未分類の地域では作成を拒否する。
      if (!areaPrefectureCode(area.data())) throw new HttpError(409, 'AREA_UNCLASSIFIED', 'この地域は都道府県コードが未設定のため、問題を作成できません。')
      assertSpotInMunicipalArea(exploration, draft.afterClear.spot?.position)
      await this.checkAssets(tx, orgId, draft)
      await this.reserveCapacity(tx, orgId)
      const data = { orgId, areaId: exploration.area.areaId, explorationBoundary: exploration.boundary,
        draftRevision: 1, publishedVersion: null, status: 'draft', draft, managed: true,
        ...(deriveShootingArea ? { zones: spotZones(draft), shootingAreaSource: 'spot' } : { zones: [] }) }
      tx.create(ref, data)
      return managedQuest(ref.id, data, shootingAreaStatus(data.zones))
    })
  }

  update(uid: string, orgId: string, questId: string, input: UpdateManagedQuest) {
    return answerTransaction(this.db, async (tx) => {
      const { ref, quest, data, member } = await this.readOwned(tx, uid, orgId, questId)
      const area = await tx.get(this.db.collection('areas').doc(member.areaId))
      assertSpotInMunicipalArea(readMunicipalArea({ id: area.id, data: area.data() }, member), input.draft.afterClear.spot?.position)
      const draftRevision = nextRevision(quest.draftRevision, input.expectedDraftRevision)
      await this.checkAssets(tx, orgId, input.draft)
      const changes = { draftRevision, status: 'draft' as const, draft: parseManagedQuestDraft(input.draft) }
      if (input.deriveShootingArea || data.shootingAreaSource === 'spot') {
        const zones = spotZones(input.draft)
        tx.update(ref, { ...changes, zones, shootingAreaSource: 'spot' })
        return { ...quest, ...changes, shootingAreaStatus: shootingAreaStatus(zones) }
      }
      tx.update(ref, changes)
      return { ...quest, ...changes }
    })
  }

  updateShootingAreas(uid: string, orgId: string, questId: string, input: UpdateShootingAreas) {
    const parsed = parseUpdateShootingAreas(input)
    return answerTransaction(this.db, async (tx): Promise<ManagedShootingAreas> => {
      const { ref, quest, data } = await this.readOwned(tx, uid, orgId, questId)
      const draftRevision = nextRevision(quest.draftRevision, parsed.expectedDraftRevision)
      if (data.shootingAreaSource === 'spot') throw new HttpError(400, 'INVALID_INPUT', '撮影範囲は対象スポットから設定されます。')
      tx.update(ref, { draftRevision, status: 'draft', zones: parsed.zones })
      return { orgId, questId, draftRevision, zones: parsed.zones, source: 'real' }
    })
  }

  readiness(uid: string, orgId: string, questId: string) {
    return answerTransaction(this.db, async (tx): Promise<ReviewSubmission> => {
      const { quest, zones } = await this.readOwned(tx, uid, orgId, questId)
      const missing = await this.missingForReview(tx, orgId, quest)
      if (!quest.draft.afterClear.spot) missing.push('targetSpot')
      if (!hasSpotShootingArea(quest.draft, zones) && !missing.includes('shootingAreas')) missing.push('shootingAreas')
      return { quest, missing }
    }, true)
  }

  submitReview(uid: string, orgId: string, questId: string, expectedRevision: number) {
    return answerTransaction(this.db, async (tx): Promise<ReviewSubmission> => {
      const { ref, quest, data, zones } = await this.readOwned(tx, uid, orgId, questId)
      if (quest.draftRevision !== expectedRevision) throw new HttpError(409, 'DRAFT_CONFLICT', '下書きの版が変更されています。')
      if (quest.status === 'published') throw new HttpError(409, 'DRAFT_CONFLICT', 'この下書き版は公開済みです。')
      const missing = await this.missingForReview(tx, orgId, quest)
      if (data.shootingAreaSource === 'spot' && !hasSpotShootingArea(quest.draft, zones) && !missing.includes('shootingAreas')) missing.push('shootingAreas')
      const status = missing.length ? 'draft' : 'review_pending'
      if (status !== quest.status) tx.update(ref, { status })
      return { quest: { ...quest, status }, missing }
    })
  }

  private async missingForReview(tx: Transaction, orgId: string, quest: ManagedQuest) {
    const { referenceAssetId, hintAssetId } = quest.draft
    const hintIds = [...new Set([hintAssetId, ...(quest.draft.hintAssetIds ?? [])].filter((id): id is string => id !== null))]
    const [reference, ...hints] = await Promise.all([
      this.readAsset(tx, orgId, referenceAssetId, 'reference'),
      ...hintIds.map((id) => this.readAsset(tx, orgId, id, 'public_hint')),
    ])
    return missingReviewFields(quest, { reference: Boolean(reference), public_hint: Boolean(hints[hintIds.indexOf(hintAssetId ?? '')]) }, {
      requirePhotoRights: false, hintsAvailable: hints.every(Boolean),
    })
  }

  async assertReferenceApproved(uid: string, orgId: string, questId: string, revision: number) {
    await answerTransaction(this.db, async (tx) => {
      const quest = await this.readAtRevision(tx, uid, orgId, questId, revision)
      const asset = await this.readAsset(tx, orgId, quest.draft.referenceAssetId, 'reference')
      if (!asset || !await isPhotoApproved(this.db, tx, orgId, 'reference', asset.approvalDigest)) throw photoApprovalRequired()
    }, true)
  }

  async readOwned(tx: Transaction, uid: string, orgId: string, questId: string) {
    const member = await requireOrgMember(this.db, tx, uid, orgId)
    return { ...readDraft(await tx.get(this.db.collection('quests').doc(questId)), orgId), member }
  }

  private async checkAssets(tx: Transaction, orgId: string, draft: ManagedQuestDraft) {
    for (const [assetId, purpose] of [[draft.referenceAssetId, 'reference'], [draft.hintAssetId, 'public_hint'],
      ...(draft.hintAssetIds ?? []).map((assetId) => [assetId, 'public_hint'] as const)] as const) {
      if (assetId !== null && !await this.hasAsset(tx, orgId, assetId, purpose)) invalidInput()
    }
  }

  private async hasAsset(tx: Transaction, orgId: string, assetId: string | null, purpose: AssetPurpose) {
    return Boolean(await this.readAsset(tx, orgId, assetId, purpose))
  }

  private async readAsset(tx: Transaction, orgId: string, assetId: string | null, purpose: AssetPurpose) {
    if (assetId === null) return null
    const record = readOrgAssetRecord(await tx.get(this.db.collection('orgAssets').doc(assetId)), orgId)
    return record?.generation && record.asset.purpose === purpose ? record : null
  }

  private async reserveCapacity(tx: Transaction, orgId: string) {
    const usage = this.db.collection('managedDraftUsage')
    const [all, org] = await tx.getAll(usage.doc('global'), usage.doc('org-' + orgId))
    const count = draftCount(all), orgCount = draftCount(org)
    if (count >= maxDrafts || orgCount >= maxOrgDrafts) throw new HttpError(429, 'RATE_LIMITED', '開発用下書きの上限に達しました。')
    tx.set(all.ref, { count: count + 1 })
    tx.set(org.ref, { count: orgCount + 1 })
  }
}

function draftCount(snapshot: DocumentSnapshot): number {
  if (!snapshot.exists) return 0
  const count: unknown = snapshot.get('count')
  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) throw processingError()
  return count
}

function readDraft(snapshot: DocumentSnapshot, orgId: string) {
  const data = snapshot.data()
  if (!data || data.orgId !== orgId || data.managed !== true) throw notFound()
  const zones = parseCaptureZones(data.zones)
  const quest = managedQuest(snapshot.id, data, shootingAreaStatus(zones))
  return { ref: snapshot.ref, quest, zones, data }
}

function managedQuest(questId: string, data: Record<string, unknown>, shootingAreaStatus: 'configured' | 'unconfigured' | 'needs-review') {
  const { orgId, areaId, draftRevision, publishedVersion, status, draft } = data
  // 問題番号は公開時にサーバーが確定して問題ドキュメントへ保存する（D-31）。妥当な保存値だけを読み出す。
  return parseManagedQuest({ questId, orgId, areaId, draftRevision, publishedVersion, status, draft, shootingAreaStatus, source: 'real',
    ...(isQuestNumber(data.questNumber) ? { questNumber: data.questNumber } : {}) })
}

function nextRevision(current: number, expected: number): number {
  if (current !== expected || !Number.isSafeInteger(current + 1)) throw new HttpError(409, 'DRAFT_CONFLICT', '下書きの版が変更されています。')
  return current + 1
}
