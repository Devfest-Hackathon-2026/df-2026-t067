import { randomUUID } from 'node:crypto'
import type { DocumentSnapshot, Firestore, Transaction } from 'firebase-admin/firestore'
import { parseCaptureZones, parseManagedQuest } from '../../src/shared/api/admin'
import type { AssetPurpose, ManagedQuestDraft, ManagedShootingAreas, ReviewSubmission, UpdateManagedQuest, UpdateShootingAreas } from '../../src/shared/api/admin'
import { missingReviewFields } from './admin-review'
import { HttpError, invalidInput } from './errors'
import { answerTransaction, notFound, processingError } from './firestore-answer-data'
import { readOrgAssetRecord } from './firestore-org-assets'
import { listOrgMemberships, requireOrgMember } from './firestore-org-memberships'

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
    return answerTransaction(this.db, async (tx) => (await this.getOwned(tx, uid, orgId, questId)).quest, true)
  }

  getShootingAreas(uid: string, orgId: string, questId: string) {
    return answerTransaction(this.db, async (tx): Promise<ManagedShootingAreas> => {
      const { quest, zones } = await this.getOwned(tx, uid, orgId, questId)
      return { orgId, questId, draftRevision: quest.draftRevision, zones, source: 'real' }
    }, true)
  }

  create(uid: string, orgId: string, draft: ManagedQuestDraft) {
    const ref = this.db.collection('quests').doc(randomUUID())
    return answerTransaction(this.db, async (tx) => {
      const member = await requireOrgMember(this.db, tx, uid, orgId)
      const area = await tx.get(this.db.collection('areas').doc(member.areaId))
      if (!area.exists) throw new HttpError(503, 'SYSTEM_ERROR', '自治体の公開エリア設定を利用できません。')
      await this.checkAssets(tx, orgId, draft)
      await this.reserveCapacity(tx, orgId)
      const data = { orgId, areaId: member.areaId, draftRevision: 1, publishedVersion: null, status: 'draft', draft, zones: [], managed: true }
      tx.create(ref, data)
      return managedQuest(ref.id, data, 'unconfigured')
    })
  }

  update(uid: string, orgId: string, questId: string, input: UpdateManagedQuest) {
    return answerTransaction(this.db, async (tx) => {
      const { ref, quest } = await this.getOwned(tx, uid, orgId, questId)
      const draftRevision = nextRevision(quest.draftRevision, input.expectedDraftRevision)
      await this.checkAssets(tx, orgId, input.draft)
      const changes = { draftRevision, status: 'draft' as const, draft: input.draft }
      tx.update(ref, changes)
      return { ...quest, ...changes }
    })
  }

  updateShootingAreas(uid: string, orgId: string, questId: string, input: UpdateShootingAreas) {
    return answerTransaction(this.db, async (tx): Promise<ManagedShootingAreas> => {
      const { ref, quest } = await this.getOwned(tx, uid, orgId, questId)
      const draftRevision = nextRevision(quest.draftRevision, input.expectedDraftRevision)
      tx.update(ref, { draftRevision, status: 'draft', zones: input.zones })
      return { orgId, questId, draftRevision, zones: input.zones, source: 'real' }
    })
  }

  submitReview(uid: string, orgId: string, questId: string, expectedRevision: number) {
    return answerTransaction(this.db, async (tx): Promise<ReviewSubmission> => {
      const { ref, quest } = await this.getOwned(tx, uid, orgId, questId)
      if (quest.draftRevision !== expectedRevision) throw new HttpError(409, 'DRAFT_CONFLICT', '下書きの版が変更されています。')
      if (quest.status === 'published') throw new HttpError(409, 'DRAFT_CONFLICT', 'この下書き版は公開済みです。')
      const { referenceAssetId, hintAssetId } = quest.draft
      const [reference, hint] = await Promise.all([
        this.hasAsset(tx, orgId, referenceAssetId, 'reference'),
        this.hasAsset(tx, orgId, hintAssetId, 'public_hint'),
      ])
      const missing = missingReviewFields(quest, { reference, public_hint: hint })
      const status = missing.length ? 'draft' : 'review_pending'
      if (status !== quest.status) tx.update(ref, { status })
      return { quest: { ...quest, status }, missing }
    })
  }

  private async getOwned(tx: Transaction, uid: string, orgId: string, questId: string) {
    await requireOrgMember(this.db, tx, uid, orgId)
    return readDraft(await tx.get(this.db.collection('quests').doc(questId)), orgId)
  }

  private async checkAssets(tx: Transaction, orgId: string, draft: ManagedQuestDraft) {
    for (const [assetId, purpose] of [[draft.referenceAssetId, 'reference'], [draft.hintAssetId, 'public_hint']] as const) {
      if (assetId !== null && !await this.hasAsset(tx, orgId, assetId, purpose)) invalidInput()
    }
  }

  private async hasAsset(tx: Transaction, orgId: string, assetId: string | null, purpose: AssetPurpose) {
    if (assetId === null) return false
    const record = readOrgAssetRecord(await tx.get(this.db.collection('orgAssets').doc(assetId)), orgId)
    return Boolean(record?.generation && record.asset.purpose === purpose)
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
  const quest = managedQuest(snapshot.id, data, zones.length ? 'configured' : 'unconfigured')
  return { ref: snapshot.ref, quest, zones }
}

function managedQuest(questId: string, data: Record<string, unknown>, shootingAreaStatus: 'configured' | 'unconfigured') {
  const { orgId, areaId, draftRevision, publishedVersion, status, draft } = data
  return parseManagedQuest({ questId, orgId, areaId, draftRevision, publishedVersion, status, draft, shootingAreaStatus, source: 'real' })
}

function nextRevision(current: number, expected: number): number {
  if (current !== expected || !Number.isSafeInteger(current + 1)) throw new HttpError(409, 'DRAFT_CONFLICT', '下書きの版が変更されています。')
  return current + 1
}
