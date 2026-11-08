import { ATTEMPT_OUTCOMES, ATTEMPT_STATES, REPORT_CATEGORIES } from './types'
import type {
  AfterClearContent, AttemptResult, CaptureMetadata, Challenge, Decoder, DeletionReceipt, DeletionStatus, Discovery, LngLat,
  ManagedReport, Page, Position, PublicArea, PublicGeometry, PublicQuest, QuestHint, ReportInput, ReportReceipt, SessionIdentity,
  ShootingConditions,
} from './types'

export class ContractError extends Error {
  readonly path: string
  constructor(path: string) {
    super('Invalid API data at ' + path)
    this.name = 'ContractError'
    this.path = path
  }
}

function object(input: unknown, keys: readonly string[], path: string): Record<string, unknown> {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new ContractError(path)
  if (Object.keys(input).some((key) => !keys.includes(key))) throw new ContractError(path)
  return input as Record<string, unknown>
}

function text(input: unknown, path: string, allowEmpty = false): string {
  if (typeof input !== 'string' || (!allowEmpty && input.trim().length === 0)) throw new ContractError(path)
  return input
}

export function parseSessionIdentity(input: unknown): SessionIdentity {
  const data = object(input, ['uid'], 'session')
  const uid = text(data.uid, 'session.uid')
  if (uid.length > 128) throw new ContractError('session.uid')
  return { uid }
}

function number(input: unknown, path: string, min: number, max = Infinity): number {
  if (typeof input !== 'number' || !Number.isFinite(input) || input < min || input > max) throw new ContractError(path)
  return input
}

function integer(input: unknown, path: string, min = 0): number {
  const value = number(input, path, min)
  if (!Number.isSafeInteger(value)) throw new ContractError(path)
  return value
}

function oneOf<const T extends readonly string[]>(input: unknown, values: T, path: string): T[number] {
  if (typeof input !== 'string' || !values.includes(input)) throw new ContractError(path)
  return input as T[number]
}

function list<T>(input: unknown, parse: Decoder<T>, path: string, min = 0): T[] {
  if (!Array.isArray(input) || input.length < min) throw new ContractError(path)
  return Array.from(input, parse)
}

function utcDate(input: unknown, path: string): string {
  const value = text(input, path)
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?Z$/.exec(value)
  const date = new Date(value)
  if (!parts || !Number.isFinite(date.getTime())) throw new ContractError(path)
  const actual = [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(),
    date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds()]
  if (actual.some((part, index) => part !== Number(parts[index + 1]))) throw new ContractError(path)
  return value
}

function imageUrl(input: unknown, path: string): string {
  const value = text(input, path)
  if (/\s/.test(value) || value.includes('\\') ||
    Array.from(value).some((char) => char.charCodeAt(0) < 32)) throw new ContractError(path)
  if (value.startsWith('/') && !value.startsWith('//')) return value
  let url: URL
  try { url = new URL(value) } catch { throw new ContractError(path) }
  if (url.protocol !== 'https:' || url.username || url.password) throw new ContractError(path)
  return value
}

function position(input: unknown, path: string): Position {
  const d = object(input, ['latitude', 'longitude'], path)
  return { latitude: number(d.latitude, path + '.latitude', -90, 90),
    longitude: number(d.longitude, path + '.longitude', -180, 180) }
}

function coordinates(input: unknown): LngLat {
  if (!Array.isArray(input) || input.length !== 2) throw new ContractError('geometry.position')
  return [number(input[0], 'geometry.longitude', -180, 180), number(input[1], 'geometry.latitude', -90, 90)]
}

function ring(input: unknown): LngLat[] {
  const points = list(input, coordinates, 'geometry.ring', 4)
  const first = points[0], last = points[points.length - 1]
  if (first[0] !== last[0] || first[1] !== last[1]) throw new ContractError('geometry.ring')
  return points
}

function polygon(input: unknown): LngLat[][] { return list(input, ring, 'geometry.polygon', 1) }

function geometry(input: unknown): PublicGeometry {
  const d = object(input, ['type', 'coordinates'], 'geometry')
  if (d.type === 'Polygon') return { type: 'Polygon', coordinates: polygon(d.coordinates) }
  if (d.type === 'MultiPolygon') return { type: 'MultiPolygon', coordinates: list(d.coordinates, polygon, 'geometry.multipolygon', 1) }
  throw new ContractError('geometry.type')
}

export function parsePublicArea(input: unknown): PublicArea {
  const d = object(input, ['areaId', 'label', 'publicGeometry', 'marker', 'publishedCount'], 'PublicArea')
  return {
    areaId: text(d.areaId, 'areaId'), label: text(d.label, 'label'),
    publicGeometry: geometry(d.publicGeometry), marker: position(d.marker, 'marker'),
    publishedCount: integer(d.publishedCount, 'publishedCount'),
  }
}

export function parseShootingConditions(input: unknown): ShootingConditions {
  const { requiresBoat, requiresPaidFacility } = object(input, ['requiresBoat', 'requiresPaidFacility'], 'shootingConditions')
  if (typeof requiresBoat !== 'boolean' || typeof requiresPaidFacility !== 'boolean') throw new ContractError('shootingConditions')
  return { requiresBoat, requiresPaidFacility }
}

export function parsePublicQuest(input: unknown): PublicQuest {
  const d = object(input, ['questId', 'version', 'title', 'clue', 'areaId', 'optionalHintImage', 'hintImages', 'visitConditions', 'hintCount', 'shootingConditions'], 'PublicQuest')
  const result: PublicQuest = {
    questId: text(d.questId, 'questId'), version: integer(d.version, 'version', 1),
    title: text(d.title, 'title'), clue: text(d.clue, 'clue'), areaId: text(d.areaId, 'areaId'),
    visitConditions: text(d.visitConditions, 'visitConditions'), hintCount: integer(d.hintCount, 'hintCount'),
  }
  if (d.optionalHintImage !== undefined) result.optionalHintImage = imageUrl(d.optionalHintImage, 'optionalHintImage')
  if (d.hintImages !== undefined) {
    if (!Array.isArray(d.hintImages) || d.hintImages.length !== 3) throw new ContractError('hintImages')
    result.hintImages = d.hintImages.map((value, index) => value === null ? null : imageUrl(value, 'hintImages.' + index))
  }
  if (d.shootingConditions !== undefined) result.shootingConditions = parseShootingConditions(d.shootingConditions)
  return result
}

export function parseChallenge(input: unknown): Challenge {
  const d = object(input, ['challengeId', 'questId', 'version', 'createdAt'], 'Challenge')
  return { challengeId: text(d.challengeId, 'challengeId'), questId: text(d.questId, 'questId'),
    version: integer(d.version, 'version', 1), createdAt: utcDate(d.createdAt, 'createdAt') }
}

export function parseCaptureMetadata(input: unknown): CaptureMetadata {
  const d = object(input, ['capturedAt', 'position'], 'CaptureMetadata')
  const p = object(d.position, ['latitude', 'longitude', 'accuracyMeters', 'measuredAt'], 'position')
  return {
    capturedAt: utcDate(d.capturedAt, 'capturedAt'),
    position: {
      latitude: number(p.latitude, 'position.latitude', -90, 90),
      longitude: number(p.longitude, 'position.longitude', -180, 180),
      accuracyMeters: number(p.accuracyMeters, 'position.accuracyMeters', 0),
      measuredAt: utcDate(p.measuredAt, 'position.measuredAt'),
    },
  }
}

export function parseAttemptResult(input: unknown): AttemptResult {
  const d = object(input, ['attemptId', 'state', 'outcome', 'nextAction', 'source', 'optionalDiscoveryId'], 'AttemptResult')
  const base = {
    attemptId: text(d.attemptId, 'attemptId'), nextAction: text(d.nextAction, 'nextAction'),
    source: oneOf(d.source, ['real', 'mock'], 'source'),
  }
  const state = oneOf(d.state, ATTEMPT_STATES, 'state')
  if (state !== 'COMPLETED') {
    if (d.outcome !== null || d.optionalDiscoveryId !== undefined) throw new ContractError('outcome')
    return { ...base, state, outcome: null }
  }
  const outcome = oneOf(d.outcome, ATTEMPT_OUTCOMES, 'outcome')
  if (outcome === 'CORRECT' || outcome === 'ALREADY_CLEARED') {
    return { ...base, state, outcome, optionalDiscoveryId: text(d.optionalDiscoveryId, 'optionalDiscoveryId') }
  }
  if (d.optionalDiscoveryId !== undefined) throw new ContractError('optionalDiscoveryId')
  return { ...base, state, outcome }
}

export function parseAfterClearContent(input: unknown): AfterClearContent {
  const d = object(input, ['access', 'hours', 'promoComment', 'explanation', 'spot'], 'afterClear')
  function read(key: Exclude<keyof AfterClearContent, 'spot'>, maximum: number) {
    const path = 'afterClear.' + key
    const value = text(d[key], path, true)
    if (value.length > maximum) throw new ContractError(path)
    return value
  }
  return { access: read('access', 2000), hours: read('hours', 2000), promoComment: read('promoComment', 2000), explanation: read('explanation', 4000),
    ...(d.spot === undefined ? {} : { spot: parseConfirmedSpot(d.spot) }) }
}

function parseConfirmedSpot(input: unknown): NonNullable<AfterClearContent['spot']> {
  const d = object(input, ['name', 'address', 'position', 'googlePlaceId'], 'afterClear.spot')
  const name = text(d.name, 'spot.name').trim()
  const address = text(d.address, 'spot.address').trim()
  if (name.length > 200 || address.length > 1000) throw new ContractError('afterClear.spot')
  const googlePlaceId = d.googlePlaceId === undefined ? undefined : text(d.googlePlaceId, 'spot.googlePlaceId')
  if (googlePlaceId !== undefined && !/^[A-Za-z0-9_-]{1,512}$/.test(googlePlaceId)) throw new ContractError('spot.googlePlaceId')
  return { name, address, position: position(d.position, 'spot.position'), ...(googlePlaceId ? { googlePlaceId } : {}) }
}

export function parseDiscovery(input: unknown): Discovery {
  const d = object(input, ['discoveryId', 'placeId', 'questId', 'questVersion', 'firstClearedAt',
    'placeName', 'descriptionSnapshot', 'ownerPhoto', 'revealedLocation', 'afterClear'], 'Discovery')
  return {
    discoveryId: text(d.discoveryId, 'discoveryId'), placeId: text(d.placeId, 'placeId'),
    questId: text(d.questId, 'questId'), questVersion: integer(d.questVersion, 'questVersion', 1),
    firstClearedAt: utcDate(d.firstClearedAt, 'firstClearedAt'), placeName: text(d.placeName, 'placeName'),
    descriptionSnapshot: text(d.descriptionSnapshot, 'descriptionSnapshot', true),
    ownerPhoto: imageUrl(d.ownerPhoto, 'ownerPhoto'), revealedLocation: position(d.revealedLocation, 'revealedLocation'),
    ...(d.afterClear === undefined ? {} : { afterClear: parseAfterClearContent(d.afterClear) }),
  }
}

export function parsePage<T>(input: unknown, parseItem: Decoder<T>): Page<T> {
  const d = object(input, ['items', 'nextCursor'], 'Page')
  return { items: list(d.items, parseItem, 'items'), nextCursor: d.nextCursor === null ? null : text(d.nextCursor, 'nextCursor') }
}

export function parseReportInput(input: unknown): ReportInput {
  const d = object(input, ['questId', 'category', 'text'], 'report')
  const questId = text(d.questId, 'report.questId')
  const message = text(d.text, 'report.text').trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(questId) || message.length > 1000) throw new ContractError('report')
  return { questId, category: oneOf(d.category, REPORT_CATEGORIES, 'report.category'), text: message }
}

export function parseReportReceipt(input: unknown): ReportReceipt {
  const d = object(input, ['reportId', 'source'], 'reportReceipt')
  return { reportId: text(d.reportId, 'reportId'), source: oneOf(d.source, ['mock', 'real'], 'source') }
}

export function parseManagedReport(input: unknown): ManagedReport {
  const d = object(input, ['reportId', 'source', 'questId', 'category', 'text', 'orgId', 'questVersion', 'receivedAt'], 'managedReport')
  return { ...parseReportInput({ questId: d.questId, category: d.category, text: d.text }),
    ...parseReportReceipt({ reportId: d.reportId, source: d.source }), orgId: text(d.orgId, 'orgId'),
    questVersion: integer(d.questVersion, 'questVersion', 1), receivedAt: utcDate(d.receivedAt, 'receivedAt') }
}

export function parseQuestHint(input: unknown): QuestHint {
  const d = object(input, ['questId', 'version', 'index', 'text'], 'QuestHint')
  return { questId: text(d.questId, 'questId'), version: integer(d.version, 'version', 1),
    index: integer(d.index, 'index', 1), text: text(d.text, 'text') }
}

export function parseDeletionReceipt(input: unknown): DeletionReceipt {
  const d = object(input, ['deletionId'], 'DeletionReceipt')
  const deletionId = text(d.deletionId, 'deletionId')
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(deletionId)) throw new ContractError('deletionId')
  return { deletionId }
}

export function parseDeletionStatus(input: unknown): DeletionStatus {
  const d = object(input, ['deletionId', 'state', 'retryable'], 'DeletionStatus')
  const state = oneOf(d.state, ['pending', 'completed', 'failed'], 'state')
  if (typeof d.retryable !== 'boolean' || (state === 'completed' && d.retryable)) throw new ContractError('retryable')
  return { ...parseDeletionReceipt({ deletionId: d.deletionId }), state, retryable: d.retryable }
}
