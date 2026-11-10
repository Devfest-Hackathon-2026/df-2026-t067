import assert from 'node:assert/strict'
import type { DocumentSnapshot } from 'firebase-admin/firestore'
import test from 'node:test'
import { readPublicArea } from '../src/public-catalog-http'

const geometry = { type: 'Polygon', coordinates: [[[139, 35], [140, 35], [140, 36], [139, 36], [139, 35]]] }
const base = { label: '東京（架空デモ地域）', marker: { latitude: 35.5, longitude: 139.5 },
  publicGeometryJson: JSON.stringify(geometry) }

function row(fields: Record<string, unknown>): DocumentSnapshot {
  return { id: 'demo-area-tokyo', get: (name: string) => fields[name] } as unknown as DocumentSnapshot
}

test('readPublicArea exposes a stored prefecture code', () => {
  assert.equal(readPublicArea(row({ ...base, prefectureCode: '13' }), 1).prefectureCode, '13')
})

test('readPublicArea treats a missing or invalid stored code as unclassified', () => {
  assert.equal(readPublicArea(row(base), 1).prefectureCode, undefined)
  assert.equal(readPublicArea(row({ ...base, prefectureCode: '99' }), 1).prefectureCode, undefined)
  assert.equal(readPublicArea(row({ ...base, prefectureCode: 13 }), 1).prefectureCode, undefined)
})

test('readPublicArea exposes a stored N03 boundary source with its registered year', () => {
  assert.deepEqual(readPublicArea(row({ ...base, boundarySource: 'N03', boundaryYear: 2025 }), 1).boundary,
    { source: 'N03', year: 2025 })
})

test('readPublicArea leaves the boundary unstated for missing or invalid stored values', () => {
  assert.equal(readPublicArea(row(base), 1).boundary, undefined)
  assert.equal(readPublicArea(row({ ...base, boundarySource: 'fixture' }), 1).boundary, undefined)
  assert.equal(readPublicArea(row({ ...base, boundarySource: 'N03' }), 1).boundary, undefined)
  assert.equal(readPublicArea(row({ ...base, boundarySource: 'N03', boundaryYear: '2025' }), 1).boundary, undefined)
  assert.equal(readPublicArea(row({ ...base, boundarySource: 'N03', boundaryYear: 999 }), 1).boundary, undefined)
  assert.equal(readPublicArea(row({ ...base, boundarySource: 'other', boundaryYear: 2025 }), 1).boundary, undefined)
})

test('readPublicArea exposes a stored municipality code', () => {
  assert.equal(readPublicArea(row({ ...base, municipalityCode: '07203' }), 1).municipalityCode, '07203')
})

test('readPublicArea leaves a missing or invalid municipality code unset', () => {
  assert.equal(readPublicArea(row(base), 1).municipalityCode, undefined)
  assert.equal(readPublicArea(row({ ...base, municipalityCode: '7203' }), 1).municipalityCode, undefined)
  assert.equal(readPublicArea(row({ ...base, municipalityCode: 7203 }), 1).municipalityCode, undefined)
})
