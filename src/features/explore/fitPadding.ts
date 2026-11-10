import { SHEET_PEEK_HEIGHT } from './ExploreBottomSheet'

// フィット時のパディング。地図の上に重なる上部の帯・チップ、下のシートとタブバーの分を
// 差し引き、対象が「実際に見えている領域」の中央に来るようにする（Google マップの型）。
// PC幅のサイドバーは地図の上に重なるカラム（Cursor Web 風）。展開時は左パディングに
// パネル幅を見込む。畳んだレール（約56px）の間もその幅を見込む。
// 開閉そのものでは再フィットしない（地図の中心を動かさない、D-38）。
// スマホ幅で選択に伴うフィットをする時は、シートが half まで開いた後の高さを渡す
// （D-70）。peek 前提のままだと、開いたシートの裏にピンが隠れてしまう。
// スマホはフィルター下端112px＋ピン60px＋間隔12pxを最低限確保する。
const PC_SIDEBAR_FIT_LEFT = 280 + 12
const PC_SIDEBAR_FIT_LEFT_COLLAPSED = 56 + 12
export function visibleAreaFitPadding(wide: boolean, sidebarCollapsed = false, sheetHeight?: number, headerBottom = 0): { top: number; right: number; bottom: number; left: number } {
  return wide
    ? { top: 88, right: 48, bottom: 48, left: sidebarCollapsed ? PC_SIDEBAR_FIT_LEFT_COLLAPSED : PC_SIDEBAR_FIT_LEFT }
    : { top: Math.max(184, Math.ceil(headerBottom) + 60), right: 16, bottom: (sheetHeight ?? SHEET_PEEK_HEIGHT) + 84, left: 16 }
}
