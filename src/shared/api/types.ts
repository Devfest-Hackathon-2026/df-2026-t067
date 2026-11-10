import { NORMALIZED_PHOTO_MAX_BYTES } from '../mediaLimits'
export type LngLat = [longitude: number, latitude: number]
export type PublicGeometry =
  | { type: 'Polygon'; coordinates: LngLat[][] }
  | { type: 'MultiPolygon'; coordinates: LngLat[][][] }
export interface Position { latitude: number; longitude: number }
export interface SessionIdentity { uid: string }
/** 公開区域の境界の出典。N03 の場合は登録年度も併せて公開し、出典表示に使う（D-71）。 */
export type PublicAreaBoundary =
  | { source: 'N03'; year: number }
  | { source: 'fixture' }
export interface PublicArea {
  areaId: string
  label: string
  publicGeometry: PublicGeometry
  marker: Position
  publishedCount: number
  prefectureCode?: string
  municipalityCode?: string
  boundary?: PublicAreaBoundary
}
export interface ShootingConditions { requiresBoat: boolean; requiresPaidFacility: boolean }
export interface PublicQuest {
  questId: string
  version: number
  title: string
  clue: string
  areaId: string
  questNumber?: string
  optionalHintImage?: string
  hintImages?: (string | null)[]
  shootingConditions?: ShootingConditions
  visitConditions: string
  hintCount: number
}
export interface Challenge {
  challengeId: string
  questId: string
  version: number
  createdAt: string
}
export interface CaptureMetadata {
  capturedAt: string
  position: Position & { accuracyMeters: number; measuredAt: string }
}
export const ATTEMPT_STATES = ['RECEIVED', 'PROCESSING', 'IMAGE_EVALUATED', 'COMMITTING', 'COMPLETED'] as const
export const ATTEMPT_OUTCOMES = [
  'CORRECT', 'ALREADY_CLEARED', 'OUTSIDE_AREA', 'LOCATION_UNCERTAIN',
  'WRONG_TARGET', 'IMAGE_UNCERTAIN', 'QUEST_UNAVAILABLE', 'QUEST_CHANGED', 'SYSTEM_ERROR',
] as const
export type AttemptState = typeof ATTEMPT_STATES[number]
export type AttemptOutcome = typeof ATTEMPT_OUTCOMES[number]
interface AttemptBase { attemptId: string; nextAction: string; source: 'real' | 'mock' }
export type AttemptResult = AttemptBase & (
  | { state: Exclude<AttemptState, 'COMPLETED'>; outcome: null; optionalDiscoveryId?: never }
  | { state: 'COMPLETED'; outcome: 'CORRECT' | 'ALREADY_CLEARED'; optionalDiscoveryId: string }
  | { state: 'COMPLETED'; outcome: Exclude<AttemptOutcome, 'CORRECT' | 'ALREADY_CLEARED'>; optionalDiscoveryId?: never }
)
export interface ConfirmedSpot {
  name: string
  address: string
  position: Position
  googlePlaceId?: string
}
export interface AfterClearContent {
  access: string; hours: string; promoComment: string; explanation: string
  spot?: ConfirmedSpot
}

export interface Discovery {
  prefectureCode?: string
  discoveryId: string
  placeId: string
  questId: string
  questVersion: number
  firstClearedAt: string
  placeName: string
  descriptionSnapshot: string
  ownerPhoto: string
  revealedLocation: Position
  afterClear?: AfterClearContent
}
export interface Page<T> { items: T[]; nextCursor: string | null }
export const REPORT_CATEGORIES = ['PHOTO_UNAVAILABLE', 'MATCHING_PROBLEM', 'UNSAFE_GUIDANCE'] as const
export interface ReportInput { questId: string; category: typeof REPORT_CATEGORIES[number]; text: string }
export interface ReportReceipt { reportId: string; source: 'mock' | 'real' }
export interface ManagedReport extends ReportReceipt, ReportInput { orgId: string; questVersion: number; receivedAt: string }
export type Decoder<T> = (input: unknown) => T

export interface QuestHint { questId: string; version: number; index: number; text: string }

export const DISCOVERY_PHOTO_MAX_BYTES = NORMALIZED_PHOTO_MAX_BYTES
export interface DeletionReceipt { deletionId: string }
export interface DeletionStatus extends DeletionReceipt {
  state: 'pending' | 'completed' | 'failed'
  retryable: boolean
}
