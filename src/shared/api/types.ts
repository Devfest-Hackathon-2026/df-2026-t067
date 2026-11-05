export type LngLat = [longitude: number, latitude: number]
export type PublicGeometry =
  | { type: 'Polygon'; coordinates: LngLat[][] }
  | { type: 'MultiPolygon'; coordinates: LngLat[][][] }
export interface Position { latitude: number; longitude: number }
export interface SessionIdentity { uid: string }
export interface PublicArea {
  areaId: string
  label: string
  publicGeometry: PublicGeometry
  marker: Position
  publishedCount: number
}
export interface PublicQuest {
  questId: string
  version: number
  title: string
  clue: string
  areaId: string
  optionalHintImage?: string
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
export interface Discovery {
  discoveryId: string
  placeId: string
  questId: string
  questVersion: number
  firstClearedAt: string
  placeName: string
  descriptionSnapshot: string
  ownerPhoto: string
  revealedLocation: Position
}
export interface Page<T> { items: T[]; nextCursor: string | null }
export type Decoder<T> = (input: unknown) => T
