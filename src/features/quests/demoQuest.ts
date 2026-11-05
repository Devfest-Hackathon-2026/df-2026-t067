import type { PublicQuest } from '../../shared/api/types'

// 架空の画面確認データ。IDと版も実サービスでは使用しない。
export const demoQuest: PublicQuest = {
  questId: 'demo-harbor-clock',
  version: 1,
  title: '港に時を知らせるもの',
  clue: '船を見送り、街の人に時間を伝えてきた建物。三角屋根の下に、丸い顔が見えます。どんな場所でしょう？',
  visitConditions: '架空の問題です。実際に訪問・撮影できる場所ではありません。',
  areaId: 'demo-area',
  hintCount: 0,
}

export const demoAreaLabel = '架空のみなと町'
