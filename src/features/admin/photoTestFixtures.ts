export { matchFixturePngBase64, otherFixturePngBase64 } from '../../shared/syntheticPhotoFixtures'

export function fixturePngUrl(base64: string): string {
  return `data:image/png;base64,${base64}`
}
