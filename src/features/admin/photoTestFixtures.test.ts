import { expect, it } from 'vitest'
import { fixturePngUrl, matchFixturePngBase64, otherFixturePngBase64 } from './photoTestFixtures'

it('downloads exactly the PNG bytes the server fixture matcher accepts', () => {
  for (const base64 of [matchFixturePngBase64, otherFixturePngBase64]) {
    const url = fixturePngUrl(base64)
    expect(url.startsWith('data:image/png;base64,')).toBe(true)
    const binary = atob(url.split(',')[1])
    expect(binary).toBe(atob(base64))
    // PNG signature.
    expect([...binary.slice(0, 4)].map((char) => char.charCodeAt(0))).toEqual([0x89, 0x50, 0x4e, 0x47])
  }
  expect(matchFixturePngBase64).not.toBe(otherFixturePngBase64)
})
