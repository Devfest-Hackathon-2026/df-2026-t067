import { ATTEMPT_OUTCOMES, ATTEMPT_STATES } from './types'
import type {
  AttemptResult, CaptureMetadata, Challenge, Decoder, Discovery, LngLat,
  Page, Position, PublicArea, PublicGeometry, PublicQuest,
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

export function parsePublicQuest(input: unknown): PublicQuest {
  const d = object(input, ['questId', 'version', 'title', 'clue', 'areaId', 'optionalHintImage', 'visitConditions', 'hintCount'], 'PublicQuest')
  const result: PublicQuest = {
    questId: text(d.questId, 'questId'), version: integer(d.version, 'version', 1),
    title: text(d.title, 'title'), clue: text(d.clue, 'clue'), areaId: text(d.areaId, 'areaId'),
    visitConditions: text(d.visitConditions, 'visitConditions'), hintCount: integer(d.hintCount, 'hintCount'),
  }
  if (d.optionalHintImage !== undefined) result.optionalHintImage = imageUrl(d.optionalHintImage, 'optionalHintImage')
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

export function parseDiscovery(input: unknown): Discovery {
  const d = object(input, ['discoveryId', 'placeId', 'questId', 'questVersion', 'firstClearedAt',
    'placeName', 'descriptionSnapshot', 'ownerPhoto', 'revealedLocation'], 'Discovery')
  return {
    discoveryId: text(d.discoveryId, 'discoveryId'), placeId: text(d.placeId, 'placeId'),
    questId: text(d.questId, 'questId'), questVersion: integer(d.questVersion, 'questVersion', 1),
    firstClearedAt: utcDate(d.firstClearedAt, 'firstClearedAt'), placeName: text(d.placeName, 'placeName'),
    descriptionSnapshot: text(d.descriptionSnapshot, 'descriptionSnapshot', true),
    ownerPhoto: imageUrl(d.ownerPhoto, 'ownerPhoto'), revealedLocation: position(d.revealedLocation, 'revealedLocation'),
  }
}

export function parsePage<T>(input: unknown, parseItem: Decoder<T>): Page<T> {
  const d = object(input, ['items', 'nextCursor'], 'Page')
  return { items: list(d.items, parseItem, 'items'), nextCursor: d.nextCursor === null ? null : text(d.nextCursor, 'nextCursor') }
}
