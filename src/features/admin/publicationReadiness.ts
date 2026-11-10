import type { ManagedQuest, ReviewField } from '../../shared/api'

// Mirrors the saved-data checks of server/src/admin-review.ts
// (missingReviewFields), minus the parts only the server can know:
// whether a registered asset still exists. Photo-test results are kept
// only in the publication screen's state, so they are never reported
// here as done or missing.
function hasValidFeatures(value: string): boolean {
  const features = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  return features.length >= 1 && features.length <= 20 && features.every((line) => line.length <= 300)
}

export function remainingWork(quest: ManagedQuest, approvedAssets = false): string[] {
  if (quest.status === 'published') return []
  const { materials, content, referenceAssetId } = quest.draft
  const items: string[] = []
  if (!materials.name.trim()) items.push('撮るもの')
  if (!approvedAssets && !materials.photoRights.trim()) items.push('写真の利用権')
  if (!referenceAssetId) items.push('正解の写真')
  if (quest.shootingAreaStatus !== 'configured') items.push('撮影範囲')
  if (!content.title.trim()) items.push('タイトル')
  if (!content.question.trim()) items.push('問題文')
  if (content.hints.some((hint) => !hint.trim())) items.push('3本のヒント')
  if (!hasValidFeatures(content.verifiedFeatures)) items.push('特徴')
  if (quest.status === 'draft') items.push(approvedAssets ? '写真試験と公開条件の確認' : '確認依頼')
  else if (quest.status === 'review_pending') items.push('写真試験と公開')
  else if (quest.status === 'paused') items.push('再公開の条件確認と写真試験')
  return items
}

export const reviewLabels: Record<ReviewField, string> = {
  'materials.name': '撮るもの', 'materials.evidence': '対象にした理由', 'materials.photoRights': '写真の利用権',
  targetSpot: '対象スポットの位置と住所',
  referenceApproval: '参考写真の事前承認', hintApproval: 'ヒント画像の事前承認',
  referenceAssetId: '正解の写真', hintAssetId: 'ヒント画像の用途', shootingAreas: '撮影範囲',
  'content.title': 'タイトル', 'content.question': '問題文', 'content.hints': '3本のヒント',
  'content.verifiedFeatures': '特徴',
}
