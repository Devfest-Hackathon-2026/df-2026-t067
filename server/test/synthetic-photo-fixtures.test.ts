import assert from 'node:assert/strict'
import { test } from 'node:test'
import { matchFixturePngBase64, otherFixturePngBase64 } from '../../src/shared/syntheticPhotoFixtures'
import { createFixturePhotoMatcher, syntheticPng, otherSyntheticPng } from '../src/demo-photo-test'
import { preparePhoto } from '../src/photo-input'

test('shared download bytes normalize to the fixture matcher decisions', async () => {
  assert.deepEqual(Buffer.from(matchFixturePngBase64, 'base64'), syntheticPng)
  assert.deepEqual(Buffer.from(otherFixturePngBase64, 'base64'), otherSyntheticPng)
  const match = await preparePhoto({ bytes: Buffer.from(matchFixturePngBase64, 'base64'), mimeType: 'image/png' })
  const other = await preparePhoto({ bytes: Buffer.from(otherFixturePngBase64, 'base64'), mimeType: 'image/png' })
  const reference = await preparePhoto(match)
  const matcher = await createFixturePhotoMatcher()
  const call = { signal: new AbortController().signal }
  assert.equal(await matcher({ reference, candidate: match, features: [] }, call), 'MATCH')
  assert.equal(await matcher({ reference, candidate: other, features: [] }, call), 'WRONG_TARGET')
  await assert.rejects(matcher({ reference: other, candidate: match, features: [] }, call), { code: 'SYSTEM_ERROR' })
})
