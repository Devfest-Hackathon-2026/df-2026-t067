// 地図の見た目はここに一本化する。旅行者の探索地図と管理側の撮影範囲地図で同じ顔を使う。
// ピンの色は旅行者 Google Maps の既存値が正。
// ピン本体の状態色：通常は MAP_PIN_COLOR（青）、ホバーと選択中は MAP_PIN_ACTIVE_COLOR（赤）、地域内がすべてクリア済みなら MAP_PIN_CLEARED_COLOR（黄緑）。
export const MAP_PIN_COLOR = '#4eb8d0'
export const MAP_PIN_ACTIVE_COLOR = '#e7473f'
export const MAP_PIN_CLEARED_COLOR = '#c7ed93'
// 黄色はピン本体には使わない。選択中地域の境界の塗り（D-29）と管理側の撮影範囲の選択中枠だけに使う。
export const MAP_PIN_SELECTED_COLOR = '#f6d84a'
export const MAP_PIN_STROKE = '#17212b'

// 地図の基調をアプリのテーマに薄く寄せる。水・土地はティール系、主要道路だけアクセント色を淡く使う。
export const MAP_STYLES: Array<Record<string, unknown>> = [
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#bcdfe8' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#2f6d7e' }] },
  { featureType: 'landscape', elementType: 'geometry', stylers: [{ color: '#edf3ee' }] },
  { featureType: 'landscape.natural', elementType: 'geometry', stylers: [{ color: '#e2eee1' }] },
  { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#e6efe8' }] },
  { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#f2dd8f' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#17212b' }] },
  { featureType: 'administrative', elementType: 'labels.text.fill', stylers: [{ color: '#17212b' }] },
  { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#8fb6bd' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#ffffff' }, { weight: 2 }] },
]
