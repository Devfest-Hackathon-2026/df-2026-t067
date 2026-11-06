import type { ManagedQuest } from '../../src/shared/api/admin'
import { parsePublicQuest } from '../../src/shared/api/validation'

export function publicHintImagePath(questId: string, version: number): string {
  return '/api/v1/quests/' + questId + '/hint-image?expectedVersion=' + version
}

export function projectManagedQuest(quest: ManagedQuest, version: number) {
  const { questId, areaId, draft } = quest
  const { materials, content, hintAssetId } = draft
  const conditions = ['開発用の架空データです。実際の訪問・撮影には使えません。']
  if (materials.requiresBoat) conditions.push('船上・海上からの撮影が必要。')
  if (materials.requiresPaidFacility) conditions.push('有料施設内での撮影が必要。')
  if (materials.price.trim()) conditions.push('料金 ' + materials.price.trim())
  if (materials.photoNote.trim()) conditions.push('撮影時の注意 ' + materials.photoNote.trim())
  const visible = parsePublicQuest({ questId, version, title: content.title.trim(), clue: content.question.trim(), areaId,
    visitConditions: conditions.join('\n'), hintCount: content.hints.length,
    shootingConditions: { requiresBoat: materials.requiresBoat, requiresPaidFacility: materials.requiresPaidFacility },
    ...(hintAssetId ? { optionalHintImage: publicHintImagePath(questId, version) } : {}) })
  return { quest: visible, hints: content.hints.map((hint) => hint.trim()) }
}
