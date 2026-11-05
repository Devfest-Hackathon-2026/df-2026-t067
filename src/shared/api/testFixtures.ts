// テスト専用の架空データ。実認証・実判定の成功を示すものではない。
export const area = {
  areaId: 'demo-area', label: '架空のテスト地域',
  publicGeometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
  marker: { latitude: 0, longitude: 0 }, publishedCount: 1,
}
export const quest = {
  questId: 'demo-quest', version: 1, title: '架空の時計', clue: '架空の町の時計を探す問題',
  areaId: 'demo-area', visitConditions: 'テスト専用。実在しません。', hintCount: 2,
}
export const capture = {
  capturedAt: '2026-11-05T06:00:00.000Z',
  position: { latitude: 0, longitude: 0, accuracyMeters: 0, measuredAt: '2026-11-05T06:00:00Z' },
}
export const challenge = {
  challengeId: 'demo-challenge', questId: 'demo-quest', version: 1, createdAt: '2026-11-05T06:00:00Z',
}
export const processing = {
  attemptId: 'demo-attempt', state: 'PROCESSING', outcome: null, nextAction: 'WAIT', source: 'real',
}
export const correct = {
  attemptId: 'demo-attempt', state: 'COMPLETED', outcome: 'CORRECT',
  nextAction: 'OPEN_DISCOVERY', source: 'real', optionalDiscoveryId: 'demo-discovery',
}
export const discovery = {
  discoveryId: 'demo-discovery', placeId: 'demo-place', questId: 'demo-quest', questVersion: 1,
  firstClearedAt: '2026-11-05T06:00:01Z', placeName: '架空の時計', descriptionSnapshot: 'テスト専用',
  ownerPhoto: '/api/v1/me/discoveries/demo-discovery/photo',
  revealedLocation: { latitude: 0, longitude: 0 },
}
