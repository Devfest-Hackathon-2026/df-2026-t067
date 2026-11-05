import { ContractError } from './validation'

export interface ShootingConditions { requiresBoat: boolean; requiresPaidFacility: boolean }
export interface AfterClearContent { access: string; hours: string; promoComment: string; explanation: string }
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
// The first management adapter supports drafts only. Publishing needs a separate
// reviewed contract, tests, durable storage and real membership authorization.
export interface ManagedQuest {
  questId: string; orgId: string; areaId: string; draftRevision: number
  publishedVersion: null; status: 'draft'; shootingAreaStatus: 'unconfigured'
  draft: ManagedQuestDraft; source: 'real' | 'mock'
}
export interface UpdateManagedQuest { expectedDraftRevision: number; draft: ManagedQuestDraft }

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
      hints: c.hints.map((item) => text(item, 'hint', 2000)) as [string, string, string],
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
export function parseManagedQuest(input: unknown): ManagedQuest {
  const d = fields(input, ['questId', 'orgId', 'areaId', 'draftRevision', 'publishedVersion', 'status', 'shootingAreaStatus', 'draft', 'source'], 'ManagedQuest')
  if (d.publishedVersion !== null || d.status !== 'draft' || d.shootingAreaStatus !== 'unconfigured' ||
    (d.source !== 'mock' && d.source !== 'real')) throw new ContractError('ManagedQuest.state')
  return { questId: identifier(d.questId, 'questId'), orgId: identifier(d.orgId, 'orgId'), areaId: identifier(d.areaId, 'areaId'),
    draftRevision: revision(d.draftRevision), publishedVersion: null, status: 'draft', shootingAreaStatus: 'unconfigured',
    draft: parseManagedQuestDraft(d.draft), source: d.source }
}
