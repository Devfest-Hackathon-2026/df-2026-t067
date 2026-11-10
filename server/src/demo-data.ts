import { parsePublicArea, parsePublicQuest } from '../../src/shared/api/validation'

// Fictional public map regions only. These synthetic coordinates do not identify
// any real destination or answer. There are deliberately no private answer records.
export function createDemoData() {
  const areas = [
    {
      areaId: 'demo-area', label: 'みなと町',
      publicGeometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] },
      marker: { latitude: 0.5, longitude: 0.5 }, publishedCount: 2,
    },
    {
      areaId: 'demo-area-b', label: '丘の町',
      publicGeometry: { type: 'Polygon', coordinates: [[[2, 0], [3, 0], [3, 1], [2, 1], [2, 0]]] },
      marker: { latitude: 0.5, longitude: 2.5 }, publishedCount: 1,
    },
  ].map(parsePublicArea)
  const quests = [
    {
      questId: 'demo-quest', version: 1, title: '広場の時計',
      clue: '町の広場で時を知らせるものを探してください。', areaId: 'demo-area',
      visitConditions: '', hintCount: 3,
    },
    {
      questId: 'demo-quest-b', version: 1, title: '広場の目印',
      clue: '広場を見渡す目印を探してください。', areaId: 'demo-area',
      visitConditions: '', hintCount: 3,
    },
    {
      questId: 'demo-quest-c', version: 1, title: '丘の目印',
      clue: '丘の上にある目印を探してください。', areaId: 'demo-area-b',
      visitConditions: '', hintCount: 3,
    },
  ].map(parsePublicQuest)
  // Only author-approved ordinary hint text belongs here; no automatic final reveal.
  const hints = new Map(quests.map((quest) => [quest.questId, [
    '町の広場にあるものを探してください。',
    '少し視線を上げてみましょう。',
    '遠くからも見える目印です。',
  ]]))
  const reportOrganizations = new Map([['demo-quest', 'demo-org'], ['demo-quest-b', 'demo-org'], ['demo-quest-c', 'demo-org-b']])
  return { areas, quests, hints, reportOrganizations }
}
