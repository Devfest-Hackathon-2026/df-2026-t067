import { ContractError, parseCaptureMetadata } from '../../src/shared/api/validation'
import { HttpError, invalidInput } from './errors'

export interface CaptureZone { latitude: number; longitude: number; radiusMeters: number }
export interface LocationPolicy {
  zones: readonly CaptureZone[]
  maxAccuracyMeters: number
  maxAgeMs: number
  maxFutureSkewMs: number
  maxCaptureMeasurementGapMs: number
}
export type LocationDecision = 'WITHIN_AREA' | 'OUTSIDE_AREA' | 'LOCATION_UNCERTAIN'

export interface LocationValidation {
  policyFor: (questId: string, version: number) => LocationPolicy | undefined
  now?: () => number
}

function finite(value: unknown, minimum: number, maximum = Infinity): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum
}

function validPolicy(policy: LocationPolicy): boolean {
  return !!policy && Array.isArray(policy.zones) && policy.zones.length > 0 &&
    policy.zones.every((zone) => !!zone && finite(zone.latitude, -90, 90) && finite(zone.longitude, -180, 180) && finite(zone.radiusMeters, Number.MIN_VALUE)) &&
    finite(policy.maxAccuracyMeters, 0) &&
    [policy.maxAgeMs, policy.maxFutureSkewMs, policy.maxCaptureMeasurementGapMs].every((value) => Number.isSafeInteger(value) && value >= 0)
}

// Great-circle distance on a mean-radius sphere, not a geodetic survey or proof
// of presence. Trigonometric periodicity handles the date line; clamp rounding
// near coincident/antipodal points before taking square roots.
function distanceMeters(latitude: number, longitude: number, zone: CaptureZone): number {
  const radians = Math.PI / 180
  const deltaLat = (zone.latitude - latitude) * radians
  const deltaLng = (zone.longitude - longitude) * radians
  const haversine = Math.sin(deltaLat / 2) ** 2 + Math.cos(latitude * radians) * Math.cos(zone.latitude * radians) * Math.sin(deltaLng / 2) ** 2
  const clamped = Math.max(0, Math.min(1, haversine))
  return 2 * 6_371_008.8 * Math.atan2(Math.sqrt(clamped), Math.sqrt(1 - clamped))
}

export function evaluateLocation(metadata: unknown, policy: LocationPolicy, nowMs: number): LocationDecision {
  if (!validPolicy(policy) || !Number.isSafeInteger(nowMs) || Math.abs(nowMs) > 8_640_000_000_000_000) {
    throw new HttpError(503, 'SYSTEM_ERROR', '位置確認の設定を利用できません。')
  }
  let capture
  try { capture = parseCaptureMetadata(metadata) }
  catch (error) { if (error instanceof ContractError) invalidInput(); throw error }
  const capturedAt = Date.parse(capture.capturedAt)
  const measuredAt = Date.parse(capture.position.measuredAt)
  if (capture.position.accuracyMeters > policy.maxAccuracyMeters ||
    [capturedAt, measuredAt].some((time) => nowMs - time > policy.maxAgeMs || time - nowMs > policy.maxFutureSkewMs) ||
    Math.abs(capturedAt - measuredAt) > policy.maxCaptureMeasurementGapMs) return 'LOCATION_UNCERTAIN'

  let uncertain = false
  for (const zone of policy.zones) {
    const distance = distanceMeters(capture.position.latitude, capture.position.longitude, zone)
    if (distance + capture.position.accuracyMeters <= zone.radiusMeters) return 'WITHIN_AREA'
    if (distance - capture.position.accuracyMeters <= zone.radiusMeters) uncertain = true
  }
  return uncertain ? 'LOCATION_UNCERTAIN' : 'OUTSIDE_AREA'
}
