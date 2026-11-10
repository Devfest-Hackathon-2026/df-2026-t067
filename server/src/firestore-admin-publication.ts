import type { DocumentSnapshot, Firestore, Transaction } from 'firebase-admin/firestore'
import { CAPTURE_ZONE_RADIUS_METERS } from '../../src/shared/api/admin'
import type { AssetPurpose, ManagedQuest, PauseManagedQuest, PhotoDecision, PublishManagedQuest } from '../../src/shared/api/admin'
import { projectManagedQuest } from './admin-publication'
import { missingReviewFields } from './admin-review'
import type { AnswerPhotoStorage } from './answer-photo-storage'
import { HttpError } from './errors'
import { answerTransaction, processingError, questChanged, validDigest } from './firestore-answer-data'
import { hasSpotShootingArea } from './firestore-managed-drafts'
import type { FirestoreManagedDraftStore } from './firestore-managed-drafts'
import { readOrgAssetRecord } from './firestore-org-assets'
import { requirePublisher } from './firestore-org-memberships'
import { draftPhotoFeatures } from './photo-match'
import { maximumCatalogEntries } from './public-catalog-http'
import { assertSpotInMunicipalArea, areaPrefectureCode, readMunicipalArea } from './municipal-areas'
import { formatQuestNumber, isPrefectureCode } from '../../src/shared/api/validation'

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
      const { quest, ref, data, member, reference, hint, hintAssets, features, zones } = await prepare(tx)
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
      const exploration = readMunicipalArea({ id: area.id, data: area.data() }, member)
      if (!exploration) throw new HttpError(409, 'REVIEW_REQUIRED', '所属自治体と下書きの探索エリアの対応を確認してください。')
      assertSpotInMunicipalArea(exploration, quest.draft.afterClear.spot?.position)
      // 場所（都道府県コードで分類された地域）は必須（D-33）。未分類の地域に紐づく下書きは公開できない。
      // 既に公開済みの問題の表示・判定には影響しない（公開済みの版はそのまま残る）。
      if (!areaPrefectureCode(area.data())) throw new HttpError(409, 'AREA_UNCLASSIFIED', 'この地域は都道府県コードが未設定のため、公開できません。')
      const catalog = this.db.collection('questPublic')
      if (quest.publishedVersion === null && (await tx.get(catalog.limit(maximumCatalogEntries))).size >= maximumCatalogEntries) {
        throw new HttpError(429, 'RATE_LIMITED', '開発用の公開問題の上限に達しました。')
      }
      // 問題番号（D-31）: 初回公開時に、その都道府県コードを持つ地域の問題としての連番を
      // カウンタドキュメントで採番し、問題ドキュメントへ保存する。以後の版更新・休止・再公開では
      // 保存値をそのまま使うため、番号は動かない。都道府県コードの無い地域の問題には付けない。
      // 採番はカウンターを書き込むため、公開上限を含む他の読み取りを先に完了する。
      const questNumber = await ensureQuestNumber(tx, this.db, quest, area.get('prefectureCode'))
      const version = latestVersion(data.latestPublishedVersion, quest.publishedVersion) + 1
      if (!Number.isSafeInteger(version)) throw draftConflict()
      const { afterClear } = quest.draft
      const { latitude, longitude } = afterClear.spot?.position ?? zones[0]
      const snapshot = this.db.collection('questVersions').doc(questId + ':' + version)
      tx.create(snapshot, { draftRevision: quest.draftRevision, placeId: questId, areaId: quest.areaId,
        explorationBoundary: exploration.boundary,
        placeName: afterClear.spot?.name ?? quest.draft.materials.name.trim(), descriptionSnapshot: afterClear.explanation.trim(),
        revealedLocation: { latitude, longitude }, afterClear,
        answerMaterial: { orgId, referenceAssetId: reference.assetId, referenceGeneration: reference.generation, features, zones },
        ...(hint ? { publicHintImage: { orgId, ...hint } } : {}),
        ...(hintAssets.some(Boolean) ? { publicHintImages: hintAssets.map((asset) => asset ? { orgId, ...asset } : null) } : {}) })
      tx.set(catalog.doc(questId), projectManagedQuest(quest, version, questNumber))
      tx.update(ref, { publishedVersion: version, latestPublishedVersion: version, status: 'published', pauseReason: null,
        ...(questNumber ? { questNumber } : {}) })
      return { ...quest, publishedVersion: version, status: 'published', ...(questNumber ? { questNumber } : {}) }
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
    const { quest, zones, data } = owned
    if (quest.draftRevision !== revision) throw draftConflict()
    if (quest.status !== 'review_pending' && quest.status !== 'published') throw reviewRequired()
    if (data.shootingAreaSource === 'spot' && !hasSpotShootingArea(quest.draft, zones)) throw reviewRequired()
    const { referenceAssetId, hintAssetId, content } = quest.draft
    const hintAssetIds = (quest.draft.hintAssetIds ?? [null, null, null]).map((assetId, index) =>
      assetId ?? (index === 0 ? hintAssetId : null))
    const [reference, hint, ...hintAssets] = await Promise.all([
      this.readAsset(tx, orgId, referenceAssetId, 'reference'),
      this.readAsset(tx, orgId, hintAssetId, 'public_hint'),
      ...hintAssetIds.map((assetId) => this.readAsset(tx, orgId, assetId, 'public_hint')),
    ])
    const features = draftPhotoFeatures(content.verifiedFeatures)
    const missing = missingReviewFields(quest, { reference: reference !== null, public_hint: hint !== null }, { requirePhotoRights: false, hintsAvailable: true })
    if (!reference || !features || !zones.length || zones.some(({ radiusMeters }) => radiusMeters !== CAPTURE_ZONE_RADIUS_METERS) || missing.length ||
      hintAssetIds.some((assetId, index) => assetId !== null && hintAssets[index] === null)) throw reviewRequired()
    return { ...owned, reference, hint, hintAssets, features }
  }

  private async readAsset(tx: Transaction, orgId: string, assetId: string | null, purpose: AssetPurpose): Promise<AssetVersion | null> {
    if (!assetId) return null
    const asset = readOrgAssetRecord(await tx.get(this.db.collection('orgAssets').doc(assetId)), orgId)
    if (!asset?.generation || asset.asset.purpose !== purpose) return null
    return { assetId, generation: asset.generation }
  }
}

export async function ensureQuestNumber(tx: Transaction, db: Firestore, quest: ManagedQuest, prefectureCode: unknown): Promise<string | undefined> {
  if (quest.questNumber) return quest.questNumber
  if (!isPrefectureCode(prefectureCode)) return undefined
  const counterRef = db.collection('questNumberCounters').doc(prefectureCode)
  const counter = await tx.get(counterRef)
  const lastSerial = counter.get('lastSerial')
  const serial = (typeof lastSerial === 'number' && Number.isSafeInteger(lastSerial) && lastSerial >= 0 ? lastSerial : 0) + 1
  if (!Number.isSafeInteger(serial)) throw draftConflict()
  const questNumber = formatQuestNumber(prefectureCode, serial)
  tx.set(counterRef, { lastSerial: serial })
  return questNumber
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
