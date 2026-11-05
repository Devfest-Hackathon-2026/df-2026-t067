import { ContractError } from './validation'

export interface ShootingConditions { requiresBoat: boolean; requiresPaidFacility: boolean }
export interface AfterClearContent { access: string; hours: string; promoComment: string; explanation: string }
export interface CaptureZone { latitude: number; longitude: number; radiusMeters: number }
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
export interface OrgMembership { orgId: string; label: string; role: 'editor' | 'publisher'; areaId: string }
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
}
export interface ManagedQuest {
  questId: string; orgId: string; areaId: string; draftRevision: number
  publishedVersion: number | null; status: 'draft' | 'review_pending' | 'published' | 'paused'; shootingAreaStatus: 'unconfigured' | 'configured'
  draft: ManagedQuestDraft; source: 'real' | 'mock'
}
export interface UpdateManagedQuest { expectedDraftRevision: number; draft: ManagedQuestDraft }
export const REVIEW_FIELDS = [
  'materials.name', 'materials.evidence', 'materials.photoRights', 'referenceAssetId', 'hintAssetId',
  'shootingAreas', 'content.title', 'content.question', 'content.hints', 'content.verifiedFeatures',
] as const
export type ReviewField = typeof REVIEW_FIELDS[number]
export interface ReviewSubmission { quest: ManagedQuest; missing: ReviewField[] }
const PUBLISH_CONFIRMATIONS = ['fictionalData', 'visitConditions', 'photoRights', 'shootingArea', 'testCases'] as const
export interface PublishManagedQuest {
  expectedDraftRevision: number
  matchTestId: string
  mismatchTestId: string
  confirmations: Record<typeof PUBLISH_CONFIRMATIONS[number], true>
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
function flag(input: unknown, path: string): boolean {
  if (typeof input !== 'boolean') throw new ContractError(path)
  return input
}

function captureZones(input: unknown): CaptureZone[] {
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
    draftRevision: revision(d.draftRevision), zones: captureZones(d.zones), source: d.source }
}
export function parseUpdateShootingAreas(input: unknown): UpdateShootingAreas {
  const d = fields(input, ['expectedDraftRevision', 'zones'], 'shootingAreas')
  return { expectedDraftRevision: revision(d.expectedDraftRevision), zones: captureZones(d.zones) }
}
export function parsePhotoTestMetadata(input: unknown): PhotoTestMetadata {
  const d = fields(input, ['expectedDraftRevision', 'photoRights'], 'photoTest')
  const photoRights = text(d.photoRights, 'photoRights', 2000)
  if (!photoRights.trim()) throw new ContractError('photoRights')
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
  const d = fields(input, ['orgId', 'label', 'role', 'areaId'], 'membership')
  if (d.role !== 'editor' && d.role !== 'publisher') throw new ContractError('membership.role')
  const label = text(d.label, 'membership.label', 200)
  if (!label.trim()) throw new ContractError('membership.label')
  return { orgId: identifier(d.orgId, 'orgId'), label, role: d.role, areaId: identifier(d.areaId, 'areaId') }
}

export function parseManagedAsset(input: unknown): ManagedAsset {
  const d = fields(input, ['assetId', 'orgId', 'purpose'], 'asset')
  if (d.purpose !== 'reference' && d.purpose !== 'public_hint') throw new ContractError('asset.purpose')
  return { assetId: identifier(d.assetId, 'assetId'), orgId: identifier(d.orgId, 'orgId'), purpose: d.purpose }
}

export function parseOrgAssetMetadata(input: unknown): OrgAssetMetadata {
  const d = fields(input, ['purpose', 'photoRights'], 'assetMetadata')
  if (d.purpose !== 'reference' && d.purpose !== 'public_hint') throw new ContractError('asset.purpose')
  const photoRights = text(d.photoRights, 'photoRights', 2000)
  if (!photoRights.trim()) throw new ContractError('photoRights')
  return { purpose: d.purpose, photoRights }
}

export function parseUploadedOrgAsset(input: unknown): UploadedOrgAsset {
  const d = fields(input, ['assetId', 'orgId', 'purpose', 'photoRights', 'contentType', 'width', 'height', 'byteLength', 'source'], 'UploadedOrgAsset')
  const asset = parseManagedAsset({ assetId: d.assetId, orgId: d.orgId, purpose: d.purpose })
  const metadata = parseOrgAssetMetadata({ purpose: d.purpose, photoRights: d.photoRights })
  const width = revision(d.width), height = revision(d.height), byteLength = revision(d.byteLength)
  if (width > 1600 || height > 1600 || byteLength > 2 * 1024 * 1024 || d.contentType !== 'image/jpeg' ||
    (d.source !== 'real' && d.source !== 'mock')) throw new ContractError('UploadedOrgAsset.media')
  return { ...asset, ...metadata, contentType: 'image/jpeg', width, height, byteLength, source: d.source }
}

export function parseManagedQuestDraft(input: unknown): ManagedQuestDraft {
  const d = fields(input, ['materials', 'content', 'afterClear', 'referenceAssetId', 'hintAssetId'], 'draft')
  const m = fields(d.materials, ['name', 'evidence', 'requiresBoat', 'requiresPaidFacility', 'price', 'photoNote', 'photoRights'], 'materials')
  const c = fields(d.content, ['title', 'question', 'hints', 'verifiedFeatures', 'draftingNotes'], 'content')
  const a = fields(d.afterClear, ['access', 'hours', 'promoComment', 'explanation'], 'afterClear')
  if (!Array.isArray(c.hints) || c.hints.length !== 3) throw new ContractError('hints')
  return {
    materials: { name: text(m.name, 'name', 200), evidence: text(m.evidence, 'evidence'),
      requiresBoat: flag(m.requiresBoat, 'requiresBoat'), requiresPaidFacility: flag(m.requiresPaidFacility, 'requiresPaidFacility'), price: text(m.price, 'price', 2000),
      photoNote: text(m.photoNote, 'photoNote', 2000), photoRights: text(m.photoRights, 'photoRights', 2000) },
    content: { title: text(c.title, 'title', 200), question: text(c.question, 'question'),
      hints: Array.from(c.hints, (item) => text(item, 'hint', 2000)) as [string, string, string],
      verifiedFeatures: text(c.verifiedFeatures, 'verifiedFeatures'), draftingNotes: text(c.draftingNotes, 'draftingNotes') },
    afterClear: { access: text(a.access, 'afterClear.access', 2000), hours: text(a.hours, 'afterClear.hours', 2000),
      promoComment: text(a.promoComment, 'afterClear.promoComment', 2000), explanation: text(a.explanation, 'afterClear.explanation') },
    referenceAssetId: d.referenceAssetId === null ? null : identifier(d.referenceAssetId, 'referenceAssetId'),
    hintAssetId: d.hintAssetId === null ? null : identifier(d.hintAssetId, 'hintAssetId'),
  }
}

export function parseCreateManagedQuest(input: unknown): { draft: ManagedQuestDraft } {
  const d = fields(input, ['draft'], 'createManagedQuest')
  return { draft: parseManagedQuestDraft(d.draft) }
}
export function parseUpdateManagedQuest(input: unknown): UpdateManagedQuest {
  const d = fields(input, ['expectedDraftRevision', 'draft'], 'updateManagedQuest')
  return { expectedDraftRevision: revision(d.expectedDraftRevision), draft: parseManagedQuestDraft(d.draft) }
}
export function parseSubmitReview(input: unknown): { expectedDraftRevision: number } {
  const d = fields(input, ['expectedDraftRevision'], 'submitReview')
  return { expectedDraftRevision: revision(d.expectedDraftRevision) }
}
export function parseReviewSubmission(input: unknown): ReviewSubmission {
  const d = fields(input, ['quest', 'missing'], 'reviewSubmission')
  const quest = parseManagedQuest(d.quest)
  if (!Array.isArray(d.missing) || d.missing.length > REVIEW_FIELDS.length) throw new ContractError('reviewSubmission.missing')
  const missing = Array.from(d.missing, (value) => {
    if (!REVIEW_FIELDS.includes(value as ReviewField)) throw new ContractError('reviewSubmission.missing')
    return value as ReviewField
  })
  if (new Set(missing).size !== missing.length || quest.status !== (missing.length === 0 ? 'review_pending' : 'draft')) {
    throw new ContractError('reviewSubmission.status')
  }
  return { quest, missing }
}
export function parsePublishManagedQuest(input: unknown): PublishManagedQuest {
  const d = fields(input, ['expectedDraftRevision', 'matchTestId', 'mismatchTestId', 'confirmations'], 'publish')
  const confirmations = fields(d.confirmations, PUBLISH_CONFIRMATIONS, 'publish.confirmations')
  if (PUBLISH_CONFIRMATIONS.some((key) => confirmations[key] !== true)) throw new ContractError('publish.confirmations')
  const matchTestId = identifier(d.matchTestId, 'matchTestId')
  const mismatchTestId = identifier(d.mismatchTestId, 'mismatchTestId')
  if (matchTestId === mismatchTestId) throw new ContractError('publish.testIds')
  return { expectedDraftRevision: revision(d.expectedDraftRevision), matchTestId, mismatchTestId,
    confirmations: { ...confirmations } as PublishManagedQuest['confirmations'] }
}
export function parsePauseManagedQuest(input: unknown): PauseManagedQuest {
  const d = fields(input, ['expectedPublishedVersion', 'reason'], 'pause')
  const reason = text(d.reason, 'reason', 1000).trim()
  if (!reason) throw new ContractError('reason')
  return { expectedPublishedVersion: revision(d.expectedPublishedVersion), reason }
}
export function parseManagedQuest(input: unknown): ManagedQuest {
  const d = fields(input, ['questId', 'orgId', 'areaId', 'draftRevision', 'publishedVersion', 'status', 'shootingAreaStatus', 'draft', 'source'], 'ManagedQuest')
  const publishedVersion = d.publishedVersion === null ? null : revision(d.publishedVersion)
  if ((d.status !== 'draft' && d.status !== 'review_pending' && d.status !== 'published' && d.status !== 'paused') ||
    (d.status === 'published' && publishedVersion === null) || (d.status === 'paused' && publishedVersion !== null) ||
    (d.shootingAreaStatus !== 'unconfigured' && d.shootingAreaStatus !== 'configured') ||
    (d.source !== 'mock' && d.source !== 'real')) throw new ContractError('ManagedQuest.state')
  return { questId: identifier(d.questId, 'questId'), orgId: identifier(d.orgId, 'orgId'), areaId: identifier(d.areaId, 'areaId'),
    draftRevision: revision(d.draftRevision), publishedVersion, status: d.status, shootingAreaStatus: d.shootingAreaStatus,
    draft: parseManagedQuestDraft(d.draft), source: d.source }
}
