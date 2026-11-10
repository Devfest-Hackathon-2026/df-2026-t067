import { normalizePrice } from '../../src/shared/api/admin'
import type { ManagedQuest } from '../../src/shared/api/admin'
import { parsePublicQuest } from '../../src/shared/api/validation'

export function publicHintImagePath(questId: string, version: number): string {
  return '/api/v1/quests/' + questId + '/hint-image?expectedVersion=' + version
}

export function publicHintImagesPath(questId: string, index: number, version: number): string {
  return '/api/v1/quests/' + questId + '/hint-images/' + index + '?expectedVersion=' + version
}

export function projectManagedQuest(quest: ManagedQuest, version: number, questNumber?: string) {
  const { questId, areaId, draft } = quest
  const { materials, content, hintAssetId } = draft
  const hintAssetIds = (draft.hintAssetIds ?? [null, null, null]).map((assetId, index) =>
    assetId ?? (index === 0 ? hintAssetId : null))
  const conditions: string[] = []
  const price = normalizePrice(materials.price).trim()
  if (price && !/^(?:未確認|未設定)(?:：|$)/.test(price)) conditions.push('料金：' + price.replace(/^有料：/, ''))
  const visible = parsePublicQuest({ questId, version, title: content.title.trim(), clue: content.question.trim(), areaId,
    ...(questNumber !== undefined ? { questNumber } : {}),
    visitConditions: conditions.join('\n'), hintCount: content.hints.length,
    shootingConditions: { requiresBoat: materials.requiresBoat, requiresPaidFacility: materials.requiresPaidFacility },
    ...(hintAssetId && hintAssetIds[0] !== hintAssetId ? { optionalHintImage: publicHintImagePath(questId, version) } : {}),
    ...(hintAssetIds.some(Boolean) ? { hintImages: hintAssetIds.map((assetId, index) =>
      assetId ? publicHintImagesPath(questId, index + 1, version) : null) } : {}) })
  return { quest: visible, hints: content.hints.map((hint) => hint.trim()) }
}
