import { createFixturePhotoMatcher, durableFixtureFeatures } from './demo-photo-test'
import { preparePhoto } from './photo-input'
import { photoSystemError } from './photo-match'
import type { PhotoMatcher } from './photo-match'
import { createVertexPhotoMatcher } from './vertex-match'
import type { VertexTransport } from './vertex-transport'
import { prepareVertexTrialFixture, vertexTrialCases, vertexTrialFeatures } from './vertex-trial-fixtures'

export async function createSyntheticVertexTrialMatcher(transport: VertexTransport): Promise<PhotoMatcher> {
  const [checkFixture, fixtures] = await Promise.all([
    createFixturePhotoMatcher(),
    Promise.all(vertexTrialCases.map(async (kind) => {
      const prepared = await prepareVertexTrialFixture(kind)
      return { kind, prepared, normalizedFromStorage: await preparePhoto(prepared) }
    })),
  ])
  const tower = fixtures.find(({ kind }) => kind === 'match')!
  const vertex = createVertexPhotoMatcher(transport)
  return async (input, call) => {
    if (input.features.length !== 1) throw photoSystemError(false)
    if (input.features[0] === durableFixtureFeatures[0]) {
      await checkFixture(input, call)
      return vertex(input, call)
    }
    if (input.features[0] !== vertexTrialFeatures[0] || !input.reference.bytes.equals(tower.normalizedFromStorage.bytes)) {
      throw photoSystemError(false)
    }
    const candidate = fixtures.find(({ prepared, normalizedFromStorage }) =>
      input.candidate.bytes.equals(prepared.bytes) || input.candidate.bytes.equals(normalizedFromStorage.bytes))
    if (!candidate) throw photoSystemError(false)
    // Submit the same JPEGs as the CLI after checking the actual local inputs.
    return vertex({ reference: tower.prepared, candidate: candidate.prepared, features: vertexTrialFeatures }, call)
  }
}
