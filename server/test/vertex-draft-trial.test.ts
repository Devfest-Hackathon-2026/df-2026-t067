import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createVertexTrialDraftSuggester, vertexDraftTrialMaterials } from '../src/vertex-draft-trial'
import { prepareVertexTrialFixture } from '../src/vertex-trial-fixtures'
import { initializeTrialLedger } from '../src/vertex-trial-ledger'
import { createVertexTrialTransport, trialEndpoint } from '../src/vertex-transport'

const materials = { ...vertexDraftTrialMaterials, requiresBoat: false, requiresPaidFacility: false,
  price: '', photoNote: '共有しない素材メモ', photoRights: '自作の合成素材' }
const candidate = { title: '塔の窓', question: '特徴に合う塔を見つけよう。', hints: ['色に注目', '屋根の形', '窓を数える'],
  featureIndexes: [2, 3], draftingNotes: '図形の屋根と窓から組み立てた候補。' }
const response = (value: unknown, finishReason = 'STOP') => ({
  candidates: [{ finishReason, content: { parts: [{ text: JSON.stringify(value) }] } }],
})

test('draft trial uses the shared ledger and sends only the checked fixture and facts', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'quest-vertex-draft-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const ledger = join(dir, 'ledger.json')
  await initializeTrialLedger(ledger, 7)
  const used = async () => (JSON.parse(await readFile(ledger, 'utf8')) as { used: number }).used
  const reference = await prepareVertexTrialFixture('match')
  let requests = 0
  const transport = createVertexTrialTransport(ledger, {
    getAccessToken: async () => 'synthetic-token',
    http: async (url, init) => {
      requests++
      assert.equal(await used(), 8)
      assert.equal(url, trialEndpoint)
      assert.equal(init?.redirect, 'error')
      const body = JSON.parse(String(init?.body))
      assert.deepEqual(body.contents[0].parts[1], { inlineData: { mimeType: 'image/jpeg', data: reference.bytes.toString('base64') } })
      assert.deepEqual(JSON.parse(body.contents[0].parts[0].text), {
        name: materials.name, verifiedFeatures: materials.evidence.split('\n'),
      })
      assert.equal(body.tools, undefined)
      assert(!String(init?.body).includes(materials.photoNote))
      assert(!String(init?.body).includes(materials.photoRights))
      return Response.json(response(candidate))
    },
  })
  const generator = await createVertexTrialDraftSuggester(transport)
  const signal = new AbortController().signal
  assert.equal(await generator.suggest((await prepareVertexTrialFixture('mismatch')).bytes, materials, signal), null)
  assert.equal(await generator.suggest(reference.bytes, { ...materials, evidence: '別の確認材料' }, signal), null)
  assert.equal(await used(), 7)
  assert.equal(requests, 0)
  const result = await generator.suggest(reference.bytes, materials, signal)
  assert.equal(generator.source, 'real')
  assert.deepEqual(result?.hints, candidate.hints)
  assert.equal(result?.verifiedFeatures, '三角の屋根\n縦に並ぶ白い窓が2つ')
  assert.equal(requests, 1)
  assert.equal(await used(), 8)
})

test('draft trial rejects invalid, unsafe and incomplete results without a fixture fallback', async () => {
  const reference = (await prepareVertexTrialFixture('match')).bytes
  const signal = new AbortController().signal
  for (const reply of [
    response({ ...candidate, featureIndexes: [4] }),
    response({ ...candidate, featureIndexes: [2, 2] }),
    response({ ...candidate, hints: ['1', '2'] }),
    response({ ...candidate, title: ' ' }),
    response({ ...candidate, draftingNotes: 'https://example.invalid/' }),
    response({ ...candidate, isCorrect: true }),
    response(candidate, 'MAX_TOKENS'),
    { ...response(candidate), promptFeedback: { blockReason: 'SAFETY' } },
  ]) {
    const generator = await createVertexTrialDraftSuggester(async () => reply)
    await assert.rejects(async () => generator.suggest(reference, materials, signal), { status: 503, code: 'SYSTEM_ERROR' })
  }
  const controller = new AbortController()
  const cancelled = await createVertexTrialDraftSuggester(async () => {
    controller.abort()
    return response(candidate)
  })
  await assert.rejects(async () => cancelled.suggest(reference, materials, controller.signal), { name: 'AbortError' })
})
