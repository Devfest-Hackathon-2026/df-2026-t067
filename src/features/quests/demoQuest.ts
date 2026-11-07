import type { PublicQuest } from '../../shared/api/types'

// 架空の画面確認データ。IDと版も実サービスでは使用しない。
export const demoQuest: PublicQuest = {
  questId: 'demo-harbor-clock',
  version: 1,
  title: '港に時を知らせるもの',
  clue: '船を見送り、街の人に時間を伝えてきた建物。三角屋根の下に、丸い顔が見えます。どんな場所でしょう？',
  visitConditions: '架空の問題です。実際に訪問・撮影できる場所ではありません。',
  areaId: 'demo-area',
  hintCount: 3,
}

export const demoQuestHints = [
  '港を見渡せる場所に立つ建物を探してみましょう。(仮)',
  '三角屋根の下にある、丸い文字盤が目印です。(仮)',
  '船の出入りとともに、街へ時を知らせる時計のある建物です。(仮)',
] as const

export const demoAreaLabel = '架空のみなと町'
