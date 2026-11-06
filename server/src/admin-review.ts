import type { AssetPurpose, ManagedQuest, ReviewField } from '../../src/shared/api/admin'
import { draftPhotoFeatures } from './photo-match'

export function missingReviewFields(quest: ManagedQuest, assets: Record<AssetPurpose, boolean>): ReviewField[] {
  const { materials, content, referenceAssetId, hintAssetId } = quest.draft
  const missing: ReviewField[] = []
  if (!materials.name.trim()) missing.push('materials.name')
  if (!materials.evidence.trim()) missing.push('materials.evidence')
  if (!materials.photoRights.trim()) missing.push('materials.photoRights')
  if (!referenceAssetId || !assets.reference) missing.push('referenceAssetId')
  if (hintAssetId && !assets.public_hint) missing.push('hintAssetId')
  if (quest.shootingAreaStatus !== 'configured') missing.push('shootingAreas')
  if (!content.title.trim()) missing.push('content.title')
  if (!content.question.trim()) missing.push('content.question')
  if (content.hints.some((hint) => !hint.trim())) missing.push('content.hints')
  if (!draftPhotoFeatures(content.verifiedFeatures)) missing.push('content.verifiedFeatures')
  return missing
}
