import type { LocationValidation } from './location'

// Synthetic coordinates only; never use real answer locations in this public
// repository. These values exercise the algorithm and do not decide O-03.
export function createDemoLocationValidation(): LocationValidation {
  return { policyFor(questId, version) {
    if (version !== 1 || !['demo-quest', 'demo-quest-b', 'demo-quest-c'].includes(questId)) return undefined
    return {
      zones: [{ latitude: 0, longitude: 0, radiusMeters: 100 }],
      maxAccuracyMeters: 50, maxAgeMs: 120_000, maxFutureSkewMs: 5000, maxCaptureMeasurementGapMs: 30_000,
    }
  } }
}
