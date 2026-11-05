import { describe, expect, it } from 'vitest'
import { area, capture, challenge, correct, discovery, processing, quest } from './testFixtures'
import {
  ContractError, parseAttemptResult, parseCaptureMetadata, parseChallenge,
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
  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '1'])('rejects invalid public version %s', (version) => {
    expect(() => parsePublicQuest({ ...quest, version })).toThrow(ContractError)
  })
  it('validates geometry and permits a multipolygon', () => {
    expect(parsePublicArea({ ...area, publicGeometry: { type: 'MultiPolygon', coordinates: [area.publicGeometry.coordinates] } }).publicGeometry.type).toBe('MultiPolygon')
    expect(() => parsePublicArea({ ...area, publicGeometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1]]] } })).toThrow(ContractError)
    expect(() => parsePublicArea({ ...area, marker: { latitude: 91, longitude: 0 } })).toThrow(ContractError)
    expect(() => parsePublicArea({ ...area, publishedCount: -1 })).toThrow(ContractError)
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
