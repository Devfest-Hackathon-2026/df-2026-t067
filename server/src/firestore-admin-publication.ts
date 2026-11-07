import type { DocumentSnapshot, Firestore, Transaction } from 'firebase-admin/firestore'
import type { AssetPurpose, ManagedQuest, PauseManagedQuest, PhotoDecision, PublishManagedQuest } from '../../src/shared/api/admin'
import { projectManagedQuest } from './admin-publication'
import { missingReviewFields } from './admin-review'
import type { AnswerPhotoStorage } from './answer-photo-storage'
import { HttpError } from './errors'
import { answerTransaction, processingError, questChanged, validDigest } from './firestore-answer-data'
import type { FirestoreManagedDraftStore } from './firestore-managed-drafts'
import { readOrgAssetRecord } from './firestore-org-assets'
import { requirePublisher } from './firestore-org-memberships'
import { draftPhotoFeatures } from './photo-match'
import { maximumCatalogEntries, readPublicArea } from './public-catalog-http'

export type PublicationPhotos = Pick<AnswerPhotoStorage, 'readReference' | 'readHint'>

interface AssetVersion { assetId: string; generation: string }

export class FirestoreManagedPublication {
  constructor(private readonly db: Firestore, private readonly drafts: FirestoreManagedDraftStore,
    private readonly photos: PublicationPhotos) {}

  async publish(uid: string, orgId: string, questId: string, input: PublishManagedQuest): Promise<ManagedQuest> {
    const prepare = (tx: Transaction) => this.readPublishable(tx, uid, orgId, questId, input.expectedDraftRevision)
    const verified = await answerTransaction(this.db, prepare, true)
    if (verified.hint || verified.hintAssets.some(Boolean)) {
      const reference = await this.photos.readReference(orgId, verified.reference.assetId, verified.reference.generation)
      const hints = await Promise.all(verified.hintAssets.map((asset) => asset && this.photos.readHint(orgId, asset.assetId, asset.generation)))
      const legacy = verified.hint && await this.photos.readHint(orgId, verified.hint.assetId, verified.hint.generation)
      if ([...hints, legacy].some((hint) => hint && reference.bytes.equals(hint.bytes))) throw new HttpError(409, 'REVIEW_REQUIRED', '参考写真と異なる公開ヒント画像を確認してください。')
    }
    return answerTransaction(this.db, async (tx) => {
      const { quest, ref, data, reference, hint, hintAssets, features, zones } = await prepare(tx)
      if (!sameAsset(reference, verified.reference) || !sameAsset(hint, verified.hint) ||
        hintAssets.some((asset, index) => !sameAsset(asset, verified.hintAssets[index]))) throw draftConflict()
      const evidence = this.db.collection('adminPhotoTestEvidence')
      const [match, mismatch] = await tx.getAll(evidence.doc(input.matchTestId), evidence.doc(input.mismatchTestId))
      const matchDigest = evidenceDigest(match, quest, reference, 'MATCH')
      const mismatchDigest = evidenceDigest(mismatch, quest, reference, 'WRONG_TARGET')
      if (!matchDigest || !mismatchDigest || matchDigest === mismatchDigest) {
        throw new HttpError(409, 'PHOTO_TEST_REQUIRED', 'この下書き版で、異なる写真の一致と別対象の試験が必要です。')
      }
      if (quest.status === 'published') return quest

      const area = await tx.get(this.db.collection('areas').doc(quest.areaId))
      if (!area.exists) throw reviewRequired()
      readPublicArea(area, 0)
      const catalog = this.db.collection('questPublic')
      if (quest.publishedVersion === null && (await tx.get(catalog.limit(maximumCatalogEntries))).size >= maximumCatalogEntries) {
        throw new HttpError(429, 'RATE_LIMITED', '開発用の公開問題の上限に達しました。')
      }
      const version = latestVersion(data.latestPublishedVersion, quest.publishedVersion) + 1
      if (!Number.isSafeInteger(version)) throw draftConflict()
      const { latitude, longitude } = zones[0]
      const { afterClear } = quest.draft
      const snapshot = this.db.collection('questVersions').doc(questId + ':' + version)
      tx.create(snapshot, { draftRevision: quest.draftRevision, placeId: questId, areaId: quest.areaId,
        placeName: quest.draft.materials.name.trim(), descriptionSnapshot: afterClear.explanation.trim(),
        revealedLocation: { latitude, longitude }, afterClear,
        answerMaterial: { orgId, referenceAssetId: reference.assetId, referenceGeneration: reference.generation, features, zones },
        ...(hint ? { publicHintImage: { orgId, ...hint } } : {}),
        ...(hintAssets.some(Boolean) ? { publicHintImages: hintAssets.map((asset) => asset ? { orgId, ...asset } : null) } : {}) })
      tx.set(catalog.doc(questId), projectManagedQuest(quest, version))
      tx.update(ref, { publishedVersion: version, latestPublishedVersion: version, status: 'published', pauseReason: null })
      return { ...quest, publishedVersion: version, status: 'published' }
    })
  }

  pause(uid: string, orgId: string, questId: string, input: PauseManagedQuest): Promise<ManagedQuest> {
    return answerTransaction(this.db, async (tx) => {
      const { ref, quest, data, member } = await this.drafts.readOwned(tx, uid, orgId, questId)
      requirePublisher(member)
      const version = latestVersion(data.latestPublishedVersion, quest.publishedVersion)
      if (version === 0) throw unavailable()
      if (version !== input.expectedPublishedVersion) throw questChanged()
      if (quest.publishedVersion === null) {
        if (data.pauseReason !== input.reason) throw unavailable()
        return quest
      }
      const draftRevision = quest.draftRevision + 1
      if (!Number.isSafeInteger(draftRevision)) throw draftConflict()
      tx.delete(this.db.collection('questPublic').doc(questId))
      tx.update(ref, { publishedVersion: null, status: 'paused', draftRevision, pauseReason: input.reason, latestPublishedVersion: version })
      return { ...quest, publishedVersion: null, status: 'paused', draftRevision }
    })
  }

  private async readPublishable(tx: Transaction, uid: string, orgId: string, questId: string, revision: number) {
    const owned = await this.drafts.readOwned(tx, uid, orgId, questId)
    const { quest, member, zones } = owned
    requirePublisher(member)
    if (quest.draftRevision !== revision) throw draftConflict()
    if (quest.status !== 'review_pending' && quest.status !== 'published') throw reviewRequired()
    const { referenceAssetId, hintAssetId, content } = quest.draft
    const hintAssetIds = (quest.draft.hintAssetIds ?? [null, null, null]).map((assetId, index) =>
      assetId ?? (index === 0 ? hintAssetId : null))
    const [reference, hint, ...hintAssets] = await Promise.all([
      this.readAsset(tx, orgId, referenceAssetId, 'reference'),
      this.readAsset(tx, orgId, hintAssetId, 'public_hint'),
      ...hintAssetIds.map((assetId) => this.readAsset(tx, orgId, assetId, 'public_hint')),
    ])
    const features = draftPhotoFeatures(content.verifiedFeatures)
    const missing = missingReviewFields(quest, { reference: reference !== null, public_hint: hint !== null })
    if (!reference || !features || !zones.length || missing.length ||
      hintAssetIds.some((assetId, index) => assetId !== null && hintAssets[index] === null)) throw reviewRequired()
    return { ...owned, reference, hint, hintAssets, features }
  }

  private async readAsset(tx: Transaction, orgId: string, assetId: string | null, purpose: AssetPurpose): Promise<AssetVersion | null> {
    if (!assetId) return null
    const asset = readOrgAssetRecord(await tx.get(this.db.collection('orgAssets').doc(assetId)), orgId)
    return asset?.generation && asset.asset.purpose === purpose ? { assetId, generation: asset.generation } : null
  }
}

function evidenceDigest(snapshot: DocumentSnapshot, quest: ManagedQuest, reference: AssetVersion, decision: PhotoDecision): string | undefined {
  const data = snapshot.data()
  if (data && data.testId === snapshot.id && data.orgId === quest.orgId && data.questId === quest.questId &&
    data.draftRevision === quest.draftRevision && data.outcome === decision && (data.source === 'mock' || data.source === 'real') &&
    data.referenceAssetId === reference.assetId && data.referenceGeneration === reference.generation &&
    validDigest(data.photoDigest)) return data.photoDigest
}

function sameAsset(first: AssetVersion | null, second: AssetVersion | null): boolean {
  return first?.assetId === second?.assetId && first?.generation === second?.generation
}

function latestVersion(stored: unknown, active: number | null): number {
  const latest = stored === undefined ? active ?? 0 : stored
  if (typeof latest !== 'number' || !Number.isSafeInteger(latest) || latest < 0 || (active !== null && active !== latest)) throw processingError()
  return latest
}

function draftConflict(): HttpError { return new HttpError(409, 'DRAFT_CONFLICT', '下書きの版が変更されています。') }
function reviewRequired(): HttpError { return new HttpError(409, 'REVIEW_REQUIRED', '必要な入力を揃えて、この下書き版の確認を依頼してください。') }
function unavailable(): HttpError { return new HttpError(409, 'QUEST_UNAVAILABLE', 'この問題は利用できません。') }
