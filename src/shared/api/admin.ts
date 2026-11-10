import { NORMALIZED_PHOTO_MAX_BYTES, NORMALIZED_PHOTO_MAX_EDGE_PX } from '../mediaLimits'
import { ContractError, isPrefectureCode, isQuestNumber, parseAfterClearContent, parseShootingConditions } from './validation'
import type { AfterClearContent, ShootingConditions } from './types'

export type { AfterClearContent, ShootingConditions } from './types'
export interface CaptureZone { latitude: number; longitude: number; radiusMeters: number }
export const CAPTURE_ZONE_RADIUS_METERS = 1000
export interface ManagedShootingAreas {
  orgId: string; questId: string; draftRevision: number; zones: CaptureZone[]; source: 'real' | 'mock'
}
export interface UpdateShootingAreas { expectedDraftRevision: number; zones: CaptureZone[] }
export type PhotoDecision = 'MATCH' | 'WRONG_TARGET' | 'IMAGE_UNCERTAIN'
export interface PhotoTestMetadata { expectedDraftRevision: number; photoRights: string }
export interface PhotoTestResult {
  testId: string; orgId: string; questId: string; draftRevision: number; outcome: PhotoDecision; source: 'real' | 'mock'
}
export type AssetPurpose = 'reference' | 'public_hint'
export type ExplorationAreaStatus = { source: 'unavailable' } | { source: 'fixture'; name: string }
  | { source: 'N03'; name: string; municipalityCode: string; year: number }
export interface OrgMembership {
  orgId: string; label: string; role: 'editor' | 'publisher'; areaId: string
  municipalityCode?: string
  // 所属地域の都道府県コード（D-22）。サーバーが地域データから解決して返す。
  // 無い所属は「未分類」であり、実データ側では問題を作成・公開できない（D-33）。
  prefectureCode?: string
  exploration?: ExplorationAreaStatus
}
export interface ManagedAsset { assetId: string; orgId: string; purpose: AssetPurpose }
export interface OrgAssetMetadata { purpose: AssetPurpose; photoRights: string }
export interface UploadedOrgAsset extends ManagedAsset, OrgAssetMetadata {
  contentType: 'image/jpeg'; width: number; height: number; byteLength: number; source: 'real' | 'mock'
}
export interface ManagedQuestDraft {
  materials: ShootingConditions & {
    name: string; evidence: string; price: string; photoNote: string; photoRights: string
  }
  content: { title: string; question: string; hints: [string, string, string]; verifiedFeatures: string; draftingNotes: string }
  afterClear: AfterClearContent
  referenceAssetId: string | null
  hintAssetId: string | null
  hintAssetIds?: (string | null)[]
}
export interface ManagedQuest {
  questId: string; orgId: string; areaId: string; draftRevision: number
  publishedVersion: number | null; status: 'draft' | 'review_pending' | 'published' | 'paused'; shootingAreaStatus: 'unconfigured' | 'configured' | 'needs-review'
  draft: ManagedQuestDraft; source: 'real' | 'mock'
  questNumber?: string
}
export function shootingAreaStatus(zones: readonly CaptureZone[]): ManagedQuest['shootingAreaStatus'] {
  if (!zones.length) return 'unconfigured'
  return zones.every(({ radiusMeters }) => radiusMeters === CAPTURE_ZONE_RADIUS_METERS) ? 'configured' : 'needs-review'
}
export interface UpdateManagedQuest { expectedDraftRevision: number; draft: ManagedQuestDraft; deriveShootingArea?: true }
export interface DraftSuggestion {
  orgId: string; questId: string; draftRevision: number; content: ManagedQuestDraft['content']; source: 'mock' | 'real'
}
export const REVIEW_FIELDS = [
  'materials.name', 'materials.evidence', 'materials.photoRights', 'referenceAssetId', 'hintAssetId',
  'referenceApproval', 'hintApproval', 'targetSpot', 'shootingAreas', 'content.title', 'content.question', 'content.hints', 'content.verifiedFeatures',
] as const
export type ReviewField = typeof REVIEW_FIELDS[number]
export interface ReviewSubmission { quest: ManagedQuest; missing: ReviewField[] }
const PUBLISH_CONFIRMATIONS = ['fictionalData', 'visitConditions', 'photoRights', 'shootingArea', 'testCases'] as const
export interface PublishManagedQuest {
  expectedDraftRevision: number
  matchTestId: string
  mismatchTestId: string
  confirmations?: Record<Exclude<typeof PUBLISH_CONFIRMATIONS[number], 'photoRights'>, true> & { photoRights?: true }
}
export interface PauseManagedQuest { expectedPublishedVersion: number; reason: string }

function fields(input: unknown, keys: readonly string[], path: string): Record<string, unknown> {
  if (input === null || typeof input !== 'object' || Array.isArray(input) ||
    Object.keys(input).some((key) => !keys.includes(key))) throw new ContractError(path)
  return input as Record<string, unknown>
}
function text(input: unknown, path: string, maximum = 4000): string {
  if (typeof input !== 'string' || input.length > maximum) throw new ContractError(path)
  return input
}
function identifier(input: unknown, path: string): string {
  const result = text(input, path, 128)
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(result)) throw new ContractError(path)
  return result
}
function revision(input: unknown): number {
  if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < 1) throw new ContractError('draftRevision')
  return input
}

export function parseCaptureZones(input: unknown): CaptureZone[] {
  if (!Array.isArray(input) || input.length > 10) throw new ContractError('zones')
  return Array.from(input, (item) => {
    const zone = fields(item, ['latitude', 'longitude', 'radiusMeters'], 'zone')
    const { latitude, longitude, radiusMeters } = zone
    if (typeof latitude !== 'number' || !Number.isFinite(latitude) || Math.abs(latitude) > 90 ||
      typeof longitude !== 'number' || !Number.isFinite(longitude) || Math.abs(longitude) > 180 ||
      typeof radiusMeters !== 'number' || !Number.isFinite(radiusMeters) || radiusMeters <= 0) throw new ContractError('zone')
    return { latitude, longitude, radiusMeters }
  })
}
export function parseManagedShootingAreas(input: unknown): ManagedShootingAreas {
  const d = fields(input, ['orgId', 'questId', 'draftRevision', 'zones', 'source'], 'shootingAreas')
  if (d.source !== 'real' && d.source !== 'mock') throw new ContractError('source')
  return { orgId: identifier(d.orgId, 'orgId'), questId: identifier(d.questId, 'questId'),
    draftRevision: revision(d.draftRevision), zones: parseCaptureZones(d.zones), source: d.source }
}
export function parseUpdateShootingAreas(input: unknown): UpdateShootingAreas {
  const d = fields(input, ['expectedDraftRevision', 'zones'], 'shootingAreas')
  const zones = parseCaptureZones(d.zones)
  if (zones.some((zone) => zone.radiusMeters !== CAPTURE_ZONE_RADIUS_METERS)) throw new ContractError('zone.radiusMeters')
  return { expectedDraftRevision: revision(d.expectedDraftRevision), zones }
}
export function parsePhotoTestMetadata(input: unknown, approvedAssets = false): PhotoTestMetadata {
  const d = fields(input, ['expectedDraftRevision', 'photoRights'], 'photoTest')
  const photoRights = approvedAssets && d.photoRights === undefined ? '' : text(d.photoRights, 'photoRights', 2000)
  if (!approvedAssets && !photoRights.trim()) throw new ContractError('photoRights')
  return { expectedDraftRevision: revision(d.expectedDraftRevision), photoRights }
}
export function parsePhotoTestResult(input: unknown): PhotoTestResult {
  const d = fields(input, ['testId', 'orgId', 'questId', 'draftRevision', 'outcome', 'source'], 'photoTest')
  if (!['MATCH', 'WRONG_TARGET', 'IMAGE_UNCERTAIN'].includes(d.outcome as string) ||
    (d.source !== 'mock' && d.source !== 'real')) throw new ContractError('photoTest.result')
  return { testId: identifier(d.testId, 'testId'), orgId: identifier(d.orgId, 'orgId'), questId: identifier(d.questId, 'questId'),
    draftRevision: revision(d.draftRevision), outcome: d.outcome as PhotoDecision, source: d.source }
}

export function parseOrgMembership(input: unknown): OrgMembership {
  const d = fields(input, ['orgId', 'label', 'role', 'areaId', 'municipalityCode', 'prefectureCode', 'exploration'], 'membership')
  if (d.role !== 'editor' && d.role !== 'publisher') throw new ContractError('membership.role')
  const label = text(d.label, 'membership.label', 200)
  if (!label.trim()) throw new ContractError('membership.label')
  const municipalityCode = d.municipalityCode === undefined ? undefined : text(d.municipalityCode, 'municipalityCode', 5)
  if (municipalityCode !== undefined && !/^\d{5}$/.test(municipalityCode)) throw new ContractError('municipalityCode')
  if (d.prefectureCode !== undefined && !isPrefectureCode(d.prefectureCode)) throw new ContractError('membership.prefectureCode')
  return { orgId: identifier(d.orgId, 'orgId'), label, role: d.role, areaId: identifier(d.areaId, 'areaId'),
    ...(municipalityCode ? { municipalityCode } : {}),
    ...(d.prefectureCode ? { prefectureCode: d.prefectureCode } : {}),
    ...(d.exploration === undefined ? {} : { exploration: parseExploration(d.exploration, municipalityCode) }) }
}

function parseExploration(input: unknown, code?: string): ExplorationAreaStatus {
  const d = fields(input, ['source', 'name', 'municipalityCode', 'year'], 'exploration')
  if (d.source === 'unavailable' && Object.keys(d).length === 1) return { source: d.source }
  const name = text(d.name, 'exploration.name', 200)
  if (!name.trim()) throw new ContractError('exploration.name')
  if (d.source === 'fixture' && code === undefined && Object.keys(d).length === 2) return { source: d.source, name }
  if (d.source === 'N03' && code !== undefined && d.municipalityCode === code && typeof d.year === 'number' &&
    Number.isInteger(d.year) && d.year >= 1000 && d.year <= 9999) {
    return { source: d.source, name, municipalityCode: code, year: d.year }
  }
  throw new ContractError('exploration')
}

export function parseManagedAsset(input: unknown): ManagedAsset {
  const d = fields(input, ['assetId', 'orgId', 'purpose'], 'asset')
  if (d.purpose !== 'reference' && d.purpose !== 'public_hint') throw new ContractError('asset.purpose')
  return { assetId: identifier(d.assetId, 'assetId'), orgId: identifier(d.orgId, 'orgId'), purpose: d.purpose }
}

export function parseOrgAssetMetadata(input: unknown, approvedAssets = false): OrgAssetMetadata {
  const d = fields(input, ['purpose', 'photoRights'], 'assetMetadata')
  if (d.purpose !== 'reference' && d.purpose !== 'public_hint') throw new ContractError('asset.purpose')
  const photoRights = approvedAssets && d.photoRights === undefined ? '' : text(d.photoRights, 'photoRights', 2000)
  if (!approvedAssets && !photoRights.trim()) throw new ContractError('photoRights')
  return { purpose: d.purpose, photoRights }
}

export function parseUploadedOrgAsset(input: unknown): UploadedOrgAsset {
  const d = fields(input, ['assetId', 'orgId', 'purpose', 'photoRights', 'contentType', 'width', 'height', 'byteLength', 'source'], 'UploadedOrgAsset')
  const asset = parseManagedAsset({ assetId: d.assetId, orgId: d.orgId, purpose: d.purpose })
  const metadata = parseOrgAssetMetadata({ purpose: d.purpose, photoRights: d.photoRights }, d.source === 'real')
  const width = revision(d.width), height = revision(d.height), byteLength = revision(d.byteLength)
  if (width > NORMALIZED_PHOTO_MAX_EDGE_PX || height > NORMALIZED_PHOTO_MAX_EDGE_PX || byteLength > NORMALIZED_PHOTO_MAX_BYTES || d.contentType !== 'image/jpeg' ||
    (d.source !== 'real' && d.source !== 'mock')) throw new ContractError('UploadedOrgAsset.media')
  return { ...asset, ...metadata, contentType: 'image/jpeg', width, height, byteLength, source: d.source }
}

function draftContent(input: unknown): ManagedQuestDraft['content'] {
  const c = fields(input, ['title', 'question', 'hints', 'verifiedFeatures', 'draftingNotes'], 'content')
  if (!Array.isArray(c.hints) || c.hints.length !== 3) throw new ContractError('hints')
  return { title: text(c.title, 'title', 200), question: text(c.question, 'question'),
    hints: Array.from(c.hints, (item) => text(item, 'hint', 2000)) as [string, string, string],
    verifiedFeatures: text(c.verifiedFeatures, 'verifiedFeatures'), draftingNotes: text(c.draftingNotes, 'draftingNotes') }
}

export function parseDraftSuggestion(input: unknown): DraftSuggestion {
  const d = fields(input, ['orgId', 'questId', 'draftRevision', 'content', 'source'], 'draftSuggestion')
  if (d.source !== 'mock' && d.source !== 'real') throw new ContractError('draftSuggestion.source')
  const content = draftContent(d.content)
  if ([content.title, content.question, ...content.hints, content.verifiedFeatures].some((value) => !value.trim())) {
    throw new ContractError('draftSuggestion.content')
  }
  return { orgId: identifier(d.orgId, 'orgId'), questId: identifier(d.questId, 'questId'),
    draftRevision: revision(d.draftRevision), content, source: d.source }
}

/** Free prices never retain a legacy amount or paid details. */
export function normalizePrice(value: string): string {
  const trimmed = value.trim()
  return /^無料(?:：|$)/.test(trimmed) ? '無料' : value
}

function validatePrice(value: string): string {
  const trimmed = value.trim()
  if (/^有料：(?:一律|大人|子供) /.test(trimmed) || trimmed === '有料：') {
    const parts = trimmed.slice(3).split('・')
    const targets = new Set<string>()
    for (const part of parts) {
      const match = /^(一律|大人|子供) (\d+)円$/.exec(part)
      if (!match || !Number.isSafeInteger(Number(match[2])) || targets.has(match[1])) throw new ContractError('price')
      targets.add(match[1])
    }
    if (targets.has('一律') && targets.size > 1) throw new ContractError('price')
  }
  return normalizePrice(value)
}

export function parseManagedQuestDraft(input: unknown): ManagedQuestDraft {
  const d = fields(input, ['materials', 'content', 'afterClear', 'referenceAssetId', 'hintAssetId', 'hintAssetIds'], 'draft')
  const m = fields(d.materials, ['name', 'evidence', 'requiresBoat', 'requiresPaidFacility', 'price', 'photoNote', 'photoRights'], 'materials')
  return {
    materials: { name: text(m.name, 'name', 200), evidence: text(m.evidence, 'evidence'),
      ...parseShootingConditions({ requiresBoat: m.requiresBoat, requiresPaidFacility: m.requiresPaidFacility }), price: validatePrice(text(m.price, 'price', 2000)),
      // 廃止済み。旧データ・省略を受理し、保存・応答には値を引き継がない。
      photoNote: '', photoRights: text(m.photoRights, 'photoRights', 2000) },
    content: draftContent(d.content),
    afterClear: parseAfterClearContent(d.afterClear),
    referenceAssetId: d.referenceAssetId === null ? null : identifier(d.referenceAssetId, 'referenceAssetId'),
    hintAssetId: d.hintAssetId === null ? null : identifier(d.hintAssetId, 'hintAssetId'),
    ...(d.hintAssetIds === undefined ? {} : { hintAssetIds: parseHintAssetIds(d.hintAssetIds) }),
  }
}

function parseHintAssetIds(input: unknown): (string | null)[] {
  if (!Array.isArray(input) || input.length !== 3) throw new ContractError('hintAssetIds')
  return input.map((value, index) => value === null ? null : identifier(value, 'hintAssetIds.' + index))
}

export function parseCreateManagedQuest(input: unknown): { draft: ManagedQuestDraft; deriveShootingArea?: true } {
  const d = fields(input, ['draft', 'deriveShootingArea'], 'createManagedQuest')
  if (d.deriveShootingArea !== undefined && d.deriveShootingArea !== true) throw new ContractError('deriveShootingArea')
  return { draft: parseManagedQuestDraft(d.draft), ...(d.deriveShootingArea ? { deriveShootingArea: true } : {}) }
}
export function parseUpdateManagedQuest(input: unknown): UpdateManagedQuest {
  const d = fields(input, ['expectedDraftRevision', 'draft', 'deriveShootingArea'], 'updateManagedQuest')
  const { expectedDraftRevision, ...body } = d
  return { expectedDraftRevision: revision(expectedDraftRevision), ...parseCreateManagedQuest(body) }
}
export function parseDraftRevisionRequest(input: unknown): { expectedDraftRevision: number } {
  const d = fields(input, ['expectedDraftRevision'], 'draftRevisionRequest')
  return { expectedDraftRevision: revision(d.expectedDraftRevision) }
}
export const parseSubmitReview = parseDraftRevisionRequest
export function parseReviewSubmission(input: unknown): ReviewSubmission {
  const result = parsePublicationReadiness(input)
  if (result.quest.status !== (result.missing.length ? 'draft' : 'review_pending')) throw new ContractError('reviewSubmission.status')
  return result
}

export function parsePublicationReadiness(input: unknown): ReviewSubmission {
  const d = fields(input, ['quest', 'missing'], 'reviewSubmission')
  const quest = parseManagedQuest(d.quest)
  if (!Array.isArray(d.missing) || d.missing.length > REVIEW_FIELDS.length) throw new ContractError('reviewSubmission.missing')
  const missing = Array.from(d.missing, (value) => {
    if (!REVIEW_FIELDS.includes(value as ReviewField)) throw new ContractError('reviewSubmission.missing')
    return value as ReviewField
  })
  if (new Set(missing).size !== missing.length) {
    throw new ContractError('reviewSubmission.status')
  }
  return { quest, missing }
}
export function parsePublishManagedQuest(input: unknown, durable = false): PublishManagedQuest {
  const d = fields(input, ['expectedDraftRevision', 'matchTestId', 'mismatchTestId', 'confirmations'], 'publish')
  const confirmations = durable && d.confirmations === undefined ? undefined
    : fields(d.confirmations, PUBLISH_CONFIRMATIONS, 'publish.confirmations')
  if (confirmations && PUBLISH_CONFIRMATIONS.some((key) => confirmations[key] !== true &&
    !(durable && key === 'photoRights' && confirmations[key] === undefined))) throw new ContractError('publish.confirmations')
  const matchTestId = identifier(d.matchTestId, 'matchTestId')
  const mismatchTestId = identifier(d.mismatchTestId, 'mismatchTestId')
  if (matchTestId === mismatchTestId) throw new ContractError('publish.testIds')
  return { expectedDraftRevision: revision(d.expectedDraftRevision), matchTestId, mismatchTestId,
    ...(confirmations ? { confirmations: { ...confirmations } as NonNullable<PublishManagedQuest['confirmations']> } : {}) }
}
export function parsePauseManagedQuest(input: unknown): PauseManagedQuest {
  const d = fields(input, ['expectedPublishedVersion', 'reason'], 'pause')
  const reason = text(d.reason, 'reason', 1000).trim()
  if (!reason) throw new ContractError('reason')
  return { expectedPublishedVersion: revision(d.expectedPublishedVersion), reason }
}
export function parseManagedQuest(input: unknown): ManagedQuest {
  const d = fields(input, ['questId', 'orgId', 'areaId', 'draftRevision', 'publishedVersion', 'status', 'shootingAreaStatus', 'draft', 'source', 'questNumber'], 'ManagedQuest')
  const publishedVersion = d.publishedVersion === null ? null : revision(d.publishedVersion)
  if ((d.status !== 'draft' && d.status !== 'review_pending' && d.status !== 'published' && d.status !== 'paused') ||
    (d.status === 'published' && publishedVersion === null) || (d.status === 'paused' && publishedVersion !== null) ||
    (d.shootingAreaStatus !== 'unconfigured' && d.shootingAreaStatus !== 'configured' && d.shootingAreaStatus !== 'needs-review') ||
    (d.source !== 'mock' && d.source !== 'real')) throw new ContractError('ManagedQuest.state')
  if (d.questNumber !== undefined && !isQuestNumber(d.questNumber)) throw new ContractError('ManagedQuest.questNumber')
  return { questId: identifier(d.questId, 'questId'), orgId: identifier(d.orgId, 'orgId'), areaId: identifier(d.areaId, 'areaId'),
    draftRevision: revision(d.draftRevision), publishedVersion, status: d.status, shootingAreaStatus: d.shootingAreaStatus,
    draft: parseManagedQuestDraft(d.draft), source: d.source,
    ...(d.questNumber !== undefined ? { questNumber: d.questNumber } : {}) }
}
