import { describe, expect, it } from 'vitest'
import { area, capture, challenge, correct, discovery, processing, quest } from './testFixtures'
import {
  ContractError, formatQuestNumber, parseAttemptResult, parseCaptureMetadata, parseChallenge,
  parseDiscovery, parsePage, parsePublicArea, parsePublicQuest,
} from './validation'

describe('public data boundary', () => {
  it('accepts public data and returns a detached validated value', () => {
    const parsed = parsePublicQuest(quest)
    expect(parsed).toEqual(quest)
    expect(parsed).not.toBe(quest)
    expect(parsePublicArea(area)).toEqual(area)
  })
  it.each(['placeId', 'answerCoordinates', 'referenceImage', 'unexpected'])('rejects unexpected public field %s', (key) => {
    expect(() => parsePublicQuest({ ...quest, [key]: 'private-value' })).toThrow(ContractError)
  })
  it('accepts only the two public shooting condition flags', () => {
    const shootingConditions = { requiresBoat: true, requiresPaidFacility: false }
    expect(parsePublicQuest({ ...quest, shootingConditions }).shootingConditions).toEqual(shootingConditions)
    expect(() => parsePublicQuest({ ...quest, shootingConditions: { ...shootingConditions, requiresBoat: 'true' } })).toThrow(ContractError)
    expect(() => parsePublicQuest({ ...quest, shootingConditions: { ...shootingConditions, zones: [] } })).toThrow(ContractError)
  })
  it('validates nullable per-hint image paths without changing legacy image fields', () => {
    const value = { ...quest, optionalHintImage: '/legacy-image', hintImages: [null, '/hint-2-image', null] }
    expect(parsePublicQuest(value)).toEqual(value)
    expect(() => parsePublicQuest({ ...value, hintImages: ['/hint-1', '/hint-2'] })).toThrow(ContractError)
    expect(() => parsePublicQuest({ ...value, hintImages: ['//external.test/image', null, null] })).toThrow(ContractError)
  })
  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '1'])('rejects invalid public version %s', (version) => {
    expect(() => parsePublicQuest({ ...quest, version })).toThrow(ContractError)
  })
  it('validates geometry and permits a multipolygon', () => {
    expect(parsePublicArea({ ...area, publicGeometry: { type: 'MultiPolygon', coordinates: [area.publicGeometry.coordinates] } }).publicGeometry.type).toBe('MultiPolygon')
    expect(() => parsePublicArea({ ...area, publicGeometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1]]] } })).toThrow(ContractError)
    expect(() => parsePublicArea({ ...area, marker: { latitude: 91, longitude: 0 } })).toThrow(ContractError)
    expect(() => parsePublicArea({ ...area, publishedCount: -1 })).toThrow(ContractError)
  })
  it('keeps a valid prefecture code and rejects invalid ones', () => {
    expect(parsePublicArea({ ...area, prefectureCode: '13' })).toEqual({ ...area, prefectureCode: '13' })
    expect(parsePublicArea(area)).not.toHaveProperty('prefectureCode')
    for (const prefectureCode of ['1', '00', '48', 'ab', 13, null]) {
      expect(() => parsePublicArea({ ...area, prefectureCode })).toThrow(ContractError)
    }
  })
  it('keeps a valid boundary attribution and rejects invalid ones', () => {
    expect(parsePublicArea({ ...area, boundary: { source: 'N03', year: 2025 } })).toEqual({ ...area, boundary: { source: 'N03', year: 2025 } })
    expect(parsePublicArea({ ...area, boundary: { source: 'fixture' } })).toEqual({ ...area, boundary: { source: 'fixture' } })
    expect(parsePublicArea(area)).not.toHaveProperty('boundary')
    for (const boundary of [
      { source: 'N03' }, { source: 'N03', year: '2025' }, { source: 'N03', year: 999 }, { source: 'N03', year: 10_000 },
      { source: 'N03', year: 2025.5 }, { source: 'fixture', year: 2025 }, { source: 'other', year: 2025 }, { year: 2025 }, null, 'N03',
    ]) {
      expect(() => parsePublicArea({ ...area, boundary })).toThrow(ContractError)
    }
  })
  it('keeps a valid quest number and rejects invalid ones', () => {
    expect(parsePublicQuest({ ...quest, questNumber: '40-01' })).toEqual({ ...quest, questNumber: '40-01' })
    expect(parsePublicQuest(quest)).not.toHaveProperty('questNumber')
    for (const questNumber of ['40-1', '4-01', '4001', '40-00', '99-01', 4001, null]) {
      expect(() => parsePublicQuest({ ...quest, questNumber })).toThrow(ContractError)
    }
    expect(formatQuestNumber('07', 3)).toBe('07-03')
    expect(formatQuestNumber('40', 12)).toBe('40-12')
  })
  it('keeps a valid municipality code and rejects invalid ones', () => {
    expect(parsePublicArea({ ...area, municipalityCode: '07203' })).toEqual({ ...area, municipalityCode: '07203' })
    expect(parsePublicArea(area)).not.toHaveProperty('municipalityCode')
    for (const municipalityCode of ['7203', '072030', 'abcde', 7203, null]) {
      expect(() => parsePublicArea({ ...area, municipalityCode })).toThrow(ContractError)
    }
  })
  it('validates list items and cursors, including an empty final page', () => {
    expect(parsePage({ items: [], nextCursor: null }, parsePublicQuest)).toEqual({ items: [], nextCursor: null })
    expect(parsePage({ items: [quest], nextCursor: 'page-2' }, parsePublicQuest).items).toEqual([quest])
    expect(() => parsePage({ items: [quest, { ...quest, version: 0 }], nextCursor: null }, parsePublicQuest)).toThrow(ContractError)
    expect(() => parsePage({ items: [], nextCursor: 1 }, parsePublicQuest)).toThrow(ContractError)
  })
})

describe('capture and result contracts', () => {
  it('accepts zero-valued coordinates and accuracy and a valid challenge', () => {
    expect(parseCaptureMetadata(capture)).toEqual(capture)
    expect(parseChallenge(challenge)).toEqual(challenge)
  })
  it.each([
    { latitude: 91 }, { latitude: NaN }, { longitude: -181 }, { longitude: Infinity },
    { accuracyMeters: -1 }, { accuracyMeters: '5' }, { measuredAt: '2026-02-30T00:00:00Z' },
  ])('rejects invalid captured position %j', (position) => {
    expect(() => parseCaptureMetadata({ ...capture, position: { ...capture.position, ...position } })).toThrow(ContractError)
  })
  it.each(['not-a-date', '2026-02-30T00:00:00Z', '2026-11-05T15:00:00+09:00'])('requires an actual UTC date: %s', (capturedAt) => {
    expect(() => parseCaptureMetadata({ ...capture, capturedAt })).toThrow(ContractError)
  })
  it('separates processing from completion and requires a saved discovery for success', () => {
    expect(parseAttemptResult(processing)).toEqual(processing)
    expect(parseAttemptResult(correct)).toEqual(correct)
    expect(() => parseAttemptResult({ ...correct, state: 'PROCESSING' })).toThrow(ContractError)
    expect(() => parseAttemptResult({ ...processing, state: 'COMPLETED' })).toThrow(ContractError)
    const { optionalDiscoveryId: _omitted, ...withoutDiscovery } = correct
    expect(() => parseAttemptResult(withoutDiscovery)).toThrow(ContractError)
    expect(() => parseAttemptResult({ ...processing, outcome: 'MADE_UP' })).toThrow(ContractError)
  })
  it('keeps uncertainty and system errors distinct from wrong targets', () => {
    for (const outcome of ['WRONG_TARGET', 'IMAGE_UNCERTAIN', 'LOCATION_UNCERTAIN', 'SYSTEM_ERROR']) {
      expect(parseAttemptResult({ ...processing, state: 'COMPLETED', outcome }).outcome).toBe(outcome)
    }
  })
  it('accepts private discoveries and rejects unsafe image locations', () => {
    expect(parseDiscovery(discovery)).toEqual(discovery)
    expect(parseDiscovery({ ...discovery, prefectureCode: '01' }).prefectureCode).toBe('01')
    expect(parseDiscovery(discovery)).not.toHaveProperty('prefectureCode')
    for (const prefectureCode of ['1', '00', '48', 13, null]) {
      expect(() => parseDiscovery({ ...discovery, prefectureCode })).toThrow(ContractError)
    }
    for (const ownerPhoto of ['javascript:alert(1)', '//elsewhere.example/photo', 'http://elsewhere.example/photo']) {
      expect(() => parseDiscovery({ ...discovery, ownerPhoto })).toThrow(ContractError)
    }
  })
  it('does not echo rejected values into validation errors', () => {
    try { parsePublicQuest({ ...quest, version: 'secret-value' }) }
    catch (error) {
      expect(error).toBeInstanceOf(ContractError)
      expect((error as Error).message).not.toContain('secret-value')
      return
    }
    throw new Error('Invalid data was accepted')
  })
})
