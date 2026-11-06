import { preparePhoto } from './photo-input'
import { photoSystemError } from './photo-match'
import type { PhotoMatcher } from './photo-match'

// Generated 2x2 pictures. The first is the reference and matching candidate.
export const syntheticPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAE0lEQVQImWP4z8DwnwGM/zMwAAAf7gP9qS/A4gAAAABJRU5ErkJggg==', 'base64')
export const otherSyntheticPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAD0lEQVQImWNgYPgPRmAKABf2A/38FIMyAAAAAElFTkSuQmCC', 'base64')
export const durableFixtureFeatures = ['合成の確認済み特徴'] as const

export async function createFixturePhotoMatcher(): Promise<PhotoMatcher> {
  const [match, mismatch] = await Promise.all([
    preparePhoto({ bytes: syntheticPng, mimeType: 'image/png' }),
    preparePhoto({ bytes: otherSyntheticPng, mimeType: 'image/png' }),
  ])
  // Reference uploads are normalized when stored and again when compared.
  const storedReference = await preparePhoto(match)
  return async ({ reference, candidate }, { signal }) => {
    signal.throwIfAborted()
    if (!reference.bytes.equals(storedReference.bytes)) throw photoSystemError(false)
    if (candidate.bytes.equals(match.bytes)) return 'MATCH'
    if (candidate.bytes.equals(mismatch.bytes)) return 'WRONG_TARGET'
    throw photoSystemError(false)
  }
}
