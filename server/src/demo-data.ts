import { parsePublicArea, parsePublicQuest } from '../../src/shared/api/validation'

// Fictional public map regions only. These synthetic coordinates do not identify
// any real destination or answer. There are deliberately no private answer records.
export function createDemoData() {
  const areas = [
    {
      areaId: 'demo-area', label: '架空のデモ地域 A（実在しません）',
      publicGeometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] },
      marker: { latitude: 0.5, longitude: 0.5 }, publishedCount: 2,
    },
    {
      areaId: 'demo-area-b', label: '架空のデモ地域 B（実在しません）',
      publicGeometry: { type: 'Polygon', coordinates: [[[2, 0], [3, 0], [3, 1], [2, 1], [2, 0]]] },
      marker: { latitude: 0.5, longitude: 2.5 }, publishedCount: 1,
    },
  ].map(parsePublicArea)
  const quests = [
    {
      questId: 'demo-quest', version: 1, title: '架空のデモ問題 A',
      clue: '架空の町を想像するための表示サンプルです。', areaId: 'demo-area',
      visitConditions: 'デモ専用・実在しません。現地への移動や撮影はできません。', hintCount: 3,
    },
    {
      questId: 'demo-quest-b', version: 1, title: '架空のデモ問題 B',
      clue: '架空の広場を想像するための表示サンプルです。', areaId: 'demo-area',
      visitConditions: 'デモ専用・実在しません。現地への移動や撮影はできません。', hintCount: 3,
    },
    {
      questId: 'demo-quest-c', version: 1, title: '架空のデモ問題 C',
      clue: '別の架空地域を表示するためのサンプルです。', areaId: 'demo-area-b',
      visitConditions: 'デモ専用・実在しません。現地への移動や撮影はできません。', hintCount: 3,
    },
  ].map(parsePublicQuest)
  // Only author-approved ordinary hint text belongs here; no automatic final reveal.
  const hints = new Map(quests.map((quest) => [quest.questId, [
    '架空の町の広場にあるものを想像してください。',
    'これは表示を確かめるための架空の手がかりです。',
    '実在の目的地はありません。現地へ移動しないでください。',
  ]]))
  return { areas, quests, hints }
}
