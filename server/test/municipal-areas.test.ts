import assert from 'node:assert/strict'
import test from 'node:test'
import { prepareN03Area, readMunicipalArea } from '../src/municipal-areas'

const outer = [[139, 35], [140, 35], [140, 36], [139, 36], [139, 35]]
const hole = [[139.2, 35.2], [139.3, 35.2], [139.3, 35.3], [139.2, 35.3], [139.2, 35.2]]
const island = [[141, 35], [142, 35], [142, 36], [141, 36], [141, 35]]

function record(patch: Record<string, unknown> = {}) {
  return {
    id: 'municipality-13101',
    data: {
      label: '千代田区', marker: { latitude: 35.68, longitude: 139.75 },
      publicGeometryJson: JSON.stringify({ type: 'MultiPolygon', coordinates: [[outer, hole], [island]] }),
      boundarySource: 'N03', municipalityCode: '13101', boundaryYear: 2024,
      privateMarker: 'must not be returned', ...patch,
    },
  }
}

test('returns validated public area and matched N03 provenance while preserving polygon rings and islands', () => {
  const result = readMunicipalArea(record(), { areaId: 'municipality-13101', municipalityCode: '13101' })
  assert(result)
  assert.deepEqual(result.boundary, { source: 'N03', municipalityCode: '13101', year: 2024 })
  assert.deepEqual(result.area.publicGeometry, { type: 'MultiPolygon', coordinates: [[outer, hole], [island]] })
  assert.equal(result.area.areaId, 'municipality-13101')
  assert.equal(result.area.label, '千代田区')
  assert.equal(result.area.publishedCount, 0)
  assert.equal(JSON.stringify(result).includes('privateMarker'), false)
})

test('fails closed for missing records, area ID mismatch, absent or mismatched municipality code', () => {
  assert.equal(readMunicipalArea(null, { areaId: 'municipality-13101', municipalityCode: '13101' }), null)
  assert.equal(readMunicipalArea(record(), { areaId: 'another-area', municipalityCode: '13101' }), null)
  assert.equal(readMunicipalArea(record(), { areaId: 'municipality-13101' }), null)
  assert.equal(readMunicipalArea(record({ municipalityCode: '13102' }), { areaId: 'municipality-13101', municipalityCode: '13101' }), null)
  assert.equal(readMunicipalArea(record({ boundarySource: 'fixture' }), { areaId: 'municipality-13101', municipalityCode: '13101' }), null)
})

test('rejects malformed provenance and malformed public area data', () => {
  for (const patch of [
    { boundarySource: 'other' },
    { municipalityCode: '1310' },
    { boundaryYear: '2024' },
    { boundaryYear: 999 },
    { boundaryYear: 10_000 },
    { publicGeometryJson: '{broken' },
    { publicGeometryJson: JSON.stringify({ type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1]]] }) },
    { marker: { latitude: 91, longitude: 0 } },
  ]) {
    assert.equal(readMunicipalArea(record(patch), { areaId: 'municipality-13101', municipalityCode: '13101' }), null)
  }
})

test('allows explicitly tagged fixtures only for memberships without municipality code', () => {
  const fixture = record({ boundarySource: 'fixture', municipalityCode: undefined, boundaryYear: undefined })
  assert.deepEqual(readMunicipalArea(fixture, { areaId: 'municipality-13101' })?.boundary, { source: 'fixture' })
  assert.equal(readMunicipalArea(fixture, { areaId: 'municipality-13101', municipalityCode: '13101' }), null)
  assert.equal(readMunicipalArea(record({ boundarySource: 'fixture' }), { areaId: 'municipality-13101' }), null)
  assert.equal(readMunicipalArea(record({ municipalityCode: undefined }), { areaId: 'municipality-13101' }), null)
})

test('prepares only the selected code and keeps every polygon and hole', () => {
  const options = { areaId: 'n03-00001-2025', municipalityCode: '00001', year: 2025, name: '区域試験',
    marker: { latitude: 35.1, longitude: 139.1 } }
  const data = { type: 'FeatureCollection', features: [
    { type: 'Feature', properties: { N03_007: '00001' }, geometry: { type: 'Polygon', coordinates: [outer, hole] } },
    { type: 'Feature', properties: { N03_007: '00001' }, geometry: { type: 'MultiPolygon', coordinates: [[island]] } },
    { type: 'Feature', properties: { N03_007: '00002' }, geometry: { type: 'Polygon', coordinates: [outer] } },
  ] }
  const prepared = prepareN03Area(data, options)
  assert.deepEqual(JSON.parse(prepared.data.publicGeometryJson), { type: 'MultiPolygon', coordinates: [[outer, hole], [island]] })
  assert.throws(() => prepareN03Area(data, { ...options, municipalityCode: '99999' }), /一致する区域がありません/)
})
