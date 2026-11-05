import type { CaptureZone, LocationValidation } from './location'

// Synthetic coordinates only; never use real answer locations in this public
// repository. These values exercise the algorithm and do not decide O-03.
export function createDemoLocationValidation(zonesFor?: (questId: string, version: number) => readonly CaptureZone[] | undefined): LocationValidation {
  return { policyFor(questId, version) {
    const zones = zonesFor?.(questId, version) ?? (version === 1 && ['demo-quest', 'demo-quest-b', 'demo-quest-c'].includes(questId)
      ? [{ latitude: 0, longitude: 0, radiusMeters: 100 }] : undefined)
    if (!zones) return undefined
    return {
      zones,
      maxAccuracyMeters: 50, maxAgeMs: 120_000, maxFutureSkewMs: 5000, maxCaptureMeasurementGapMs: 30_000,
    }
  } }
}
