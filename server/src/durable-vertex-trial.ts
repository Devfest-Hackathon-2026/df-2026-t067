import { createFixturePhotoMatcher, durableFixtureFeatures } from './demo-photo-test'
import { photoSystemError } from './photo-match'
import type { PhotoMatcher } from './photo-match'
import { createVertexPhotoMatcher } from './vertex-match'
import type { VertexTransport } from './vertex-match'

export async function createSyntheticVertexTrialMatcher(transport: VertexTransport): Promise<PhotoMatcher> {
  const checkFixture = await createFixturePhotoMatcher()
  const vertex = createVertexPhotoMatcher(transport)
  return async (input, call) => {
    if (input.features.length !== 1 || input.features[0] !== durableFixtureFeatures[0]) throw photoSystemError(false)
    // This verifies the exact prepared reference and either known candidate.
    // Only Vertex supplies the verdict in trial mode.
    await checkFixture(input, call)
    return vertex(input, call)
  }
}
