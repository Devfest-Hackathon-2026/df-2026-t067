import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { mapControlsPlacement } from './mapOverlayLayout'

const readCss = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8').replace(/\r\n?/g, '\n')
const css = readCss('src/App.css')
const MOBILE_CONTROL_RULE = '.map-preview-shell.has-sheet .map-controls { bottom: calc(var(--mobile-tabbar-h, 70px) + 168px + 12px); z-index: 3; }'
const mapPreview = readFileSync(resolve(process.cwd(), 'src/features/explore/MapPreview.tsx'), 'utf8')
const bottomSheet = readFileSync(resolve(process.cwd(), 'src/features/explore/ExploreBottomSheet.tsx'), 'utf8')

// CSS の実測は jsdom ではできないため、規則の置き場所（構造）で担保する。
// シートへの追従はバグのため、地図操作はpeek位置に固定する。
describe('map controls placement with the bottom sheet', () => {
  it('スマホ幅では開いた場所フィルターを一覧シートより手前に置く', () => {
    // jsdom は重なりを描画しないため、390pxに適用されるCSSと開状態の条件を検証する。
    const mobileCss = css.slice(css.indexOf('@media (max-width: 980px)'), css.indexOf('@media (max-width: 640px)'))
    const openFilter = mobileCss.match(/\.map-filter-overlay:has\(\.filter-toggle\[aria-expanded="true"\]\)\s*\{\s*z-index:\s*(\d+);\s*\}/)
    const sheet = css.match(/\.explore-sheet \{ left: 0; right: 0; bottom: 0; z-index: (\d+);/)
    expect(openFilter).not.toBeNull()
    expect(sheet).not.toBeNull()
    expect(Number(openFilter?.[1])).toBeGreaterThan(Number(sheet?.[1]))
    // フィルターが開いていない時は既存の順序に戻る。
    expect(css).toContain('.map-filter-overlay { position: absolute; top: 78px; left: 20px; right: 20px; z-index: 3;')
  })

  it('stays at peek height across the mobile range', () => {
    expect(css.split(MOBILE_CONTROL_RULE).length - 1).toBe(1)
    const mediaAt = css.indexOf('@media (max-width: 980px)')
    expect(mediaAt).toBeGreaterThan(-1)
    const phoneAt = css.indexOf('@media (max-width: 640px)')
    expect(css.indexOf(MOBILE_CONTROL_RULE)).toBeGreaterThan(mediaAt)
    expect(css.indexOf(MOBILE_CONTROL_RULE)).toBeLessThan(phoneAt)
    expect(css).not.toContain('.map-controls button.is-hidden')
    expect(css).toContain('.map-locate-fab:disabled:not([inert])')
    expect(css).toContain('.map-zoom button:disabled:not([inert])')
  })

  it('keeps the wide-layout controls at their fixed bottom position', () => {
    expect(css).toContain('.map-controls { position: absolute; right: 17px; bottom: 52px;')
  })

  it.each([568, 280])('keeps 44px landscape targets within a %ipx wide viewport when space is available', (viewportWidth) => {
    expect(css).toContain('@media (orientation: landscape)')
    expect(css).toContain('.map-preview-shell.has-sheet .map-zoom-group { display: flex; flex-direction: row; }')
    expect(css).toContain('right: 64px; bottom: calc(var(--mobile-tabbar-h, 70px) + 168px + 12px); flex-direction: row;')
    expect(css).toContain('.map-zoom button { width: 44px; height: 44px; }')
    const viewportHeight = 320
    const controlsHeight = 48
    const controlsWidth = 194
    const controlsRight = viewportWidth - 64
    expect(controlsRight - controlsWidth).toBeGreaterThanOrEqual(0)
    expect(controlsRight).toBeLessThanOrEqual(viewportWidth - 54)
    for (const sheetHeight of [168, 34]) {
      const sheetTop = viewportHeight - 70 - sheetHeight
      const placement = mapControlsPlacement(viewportHeight, sheetTop, controlsHeight, 124)
      const controlsBottom = viewportHeight - placement.bottom
      expect(controlsBottom).toBe(viewportHeight - 244)
      // 横向きでもシートに追従させず、ヘッダーと干渉する固定位置は隠す。
      expect(placement.hidden).toBe(true)
    }
    expect(mapPreview).toContain("controls.style.visibility = placement.hidden ? 'hidden' : ''")
    expect(mapPreview).toContain('if (placement.hidden || !available || covered)')
  })

  it('puts controls above the closed mobile handle and the sheet above controls while open or dragging', () => {
    const mobileAt = css.indexOf('@media (max-width: 640px)')
    const desktopSheetRule = '.explore-sheet { position: absolute; left: 12px; bottom: 12px; z-index: 4;'
    const mobileSheetRule = '.explore-sheet { left: 0; right: 0; bottom: 0; z-index: 7;'
    expect(css).toContain(desktopSheetRule)
    expect(css.indexOf(mobileSheetRule)).toBeGreaterThan(mobileAt)
    expect(css).toContain('.map-controls { position: absolute; right: 17px; bottom: 52px; z-index: 6;')
    const closedRule = '.explore-sheet[data-snap="closed"]:not(.is-dragging) { z-index: 5; }'
    expect(css.indexOf(closedRule)).toBeGreaterThan(mobileAt)
    expect(css).toContain('.explore-sheet[data-snap="closed"]:not(.is-dragging) .explore-sheet-body { visibility: hidden; transition: visibility 0s linear 300ms; }')
    expect(css).not.toContain('.explore-sheet[data-snap="closed"]:not(.is-dragging) { visibility: hidden; pointer-events: none; }')
  })
})

describe('mobile map control swipe handling', () => {
  it('prevents page scrolling from map controls throughout the mobile-width range while leaving the sheet and lists scrollable', () => {
    const touchRule = '.map-controls, .explore-sheet-reopen, .map-state button { touch-action: none; overscroll-behavior: none; }'
    const mobileWidthAt = css.indexOf('@media (max-width: 980px)')
    const phoneWidthAt = css.indexOf('@media (max-width: 640px)')
    expect(mobileWidthAt).toBeGreaterThan(-1)
    expect(phoneWidthAt).toBeGreaterThan(mobileWidthAt)
    expect(css.indexOf(touchRule)).toBeGreaterThan(mobileWidthAt)
    expect(css.indexOf(touchRule)).toBeLessThan(phoneWidthAt)
    expect(css).not.toContain('.explore-sheet { touch-action: none;')
    expect(css).not.toContain('.explore-quest-list { touch-action: none;')
    expect(mapPreview).toContain('const mapControlGestureProps = {')
    expect(mapPreview).toContain('onPointerDownCapture: (event: ReactPointerEvent<HTMLElement>) => {')
    expect(mapPreview).toContain('if (gesture?.moved && event.detail !== 0) {')
    expect(mapPreview).toContain('isMapControlWithin(rect, visibleBounds)')
    expect(mapPreview).toContain('<button type="button" {...mapControlGestureProps}')
    expect(bottomSheet).toContain('onUserClosedChange?: (closed: boolean) => void')
    expect(bottomSheet).toContain('onUserClosedChange?.(next === \'closed\')')
  })
})

describe('bottom sheet close visibility timing', () => {
  it('delays hiding through the 300ms close and removes that delay for reduced motion', () => {
    expect(css).toContain('.explore-sheet[data-snap="closed"]:not(.is-dragging) .explore-sheet-body { visibility: hidden; transition: visibility 0s linear 300ms; }')
    expect(css).toContain('@media (prefers-reduced-motion: reduce) { .explore-sheet { transition: height 120ms linear, visibility 0s; } .explore-sheet.is-dragging { transition: none; } .explore-sheet-body { transition: none !important; } }')
  })
})

// スマホ幅（981px未満）では主要ナビを画面下のタブバーに置く（D-32）。
// 縁なし表示でもタブバーは下に残り、シートと浮動要素はタブバーの高さぶん持ち上げる。
describe('mobile bottom tab bar (D-32)', () => {
  it('pins the mobile nav to the bottom as a tab bar with a shared height token', () => {
    expect(css).toContain(':root { --mobile-tabbar-h: calc(64px + env(safe-area-inset-bottom, 0px)); }')
    expect(css).toContain('.mobile-nav { height: var(--mobile-tabbar-h); position: fixed; bottom: 0; left: 0; right: 0;')
    // タブバー上で始まった縦ジェスチャーはページスクロールへ渡さない。
    // タップは通常の click として残り、地図シートのスクロール領域には適用しない。
    expect(css).toContain('background: var(--ui-surface); touch-action: none; overscroll-behavior: none; }')
    expect(css).toContain('.mobile-nav [aria-current="page"] { background: transparent;')
  })

  it('does not float the mobile nav over the map in full-bleed', () => {
    expect(css).not.toContain('body.explore-fullbleed .mobile-nav {')
  })

  it('stays at peek and keeps the sheet above the tab bar', () => {
    expect(css).toContain('body.explore-fullbleed .explore-sheet { bottom: var(--mobile-tabbar-h); padding-bottom: 0; }')
    expect(css).toContain('body.explore-fullbleed .map-preview-shell.has-sheet .map-controls { position: absolute; bottom: calc(var(--mobile-tabbar-h) + 168px + 12px); z-index: 3; }')
    expect(mapPreview).toContain('isMapControlFullyCovered(rect, sheetRect)')
    expect(mapPreview).toContain("inert={inactiveMapControls.has('地図を拡大')}")
    expect(mapPreview).toContain('new ResizeObserver(update)')
    expect(css).toContain('.map-preview-shell.has-sheet .map-controls { right: 64px; bottom: calc(var(--mobile-tabbar-h, 70px) + 168px + 12px); flex-direction: row; }')
    expect(css).toContain('body.explore-fullbleed .map-location-status.is-floating { bottom: calc(168px + var(--mobile-tabbar-h) + 14px); }')
    const reopenRule = 'body.explore-fullbleed .explore-sheet-reopen { position: absolute; left: 12px; bottom: calc(var(--mobile-tabbar-h) + 48px); z-index: 3; display: block; min-height: 44px;'
    expect(css).toContain(reopenRule)
    expect(css).toContain('body.explore-fullbleed .map-browse-shortcut { position: fixed; bottom: calc(var(--mobile-tabbar-h) + 48px); z-index: 3; }')
    expect(css).toContain('body.explore-fullbleed .map-browse-shortcut.is-return-to-map { bottom: calc(var(--mobile-tabbar-h) + 10px); z-index: 8; }')
    expect(css).toContain('body.explore-fullbleed .map-browse-shortcut[inert] { visibility: hidden; pointer-events: none; }')
    // 詳細末尾が「地図に戻る」に隠れないよう、表示中だけ下部余白を足す
    expect(css).toContain('body.explore-fullbleed:has(.map-browse-shortcut.is-return-to-map:not([inert])) .quest-rail {')
    expect(css).toContain('padding-bottom: calc(var(--mobile-tabbar-h) + 120px);')
    expect(css).toContain('body.explore-fullbleed:has(.map-browse-shortcut.is-return-to-map:not([inert])) .below-map-quests {')
    expect(css).not.toContain('bottom: calc(var(--sheet-h, 0px) + var(--mobile-tabbar-h) + 10px); z-index: 6;')
    // 通常時・ドラッグ中とも同じ重なり順を保つ。
    expect(css).toContain('.explore-sheet { position: absolute; left: 12px; bottom: 12px; z-index: 4;')
    expect(css).toContain('.explore-sheet { left: 0; right: 0; bottom: 0; z-index: 7;')
    expect(css).not.toContain('.explore-sheet.is-dragging { z-index:')
  })

  it('keeps the filter flow without a duplicate map area chip', () => {
    expect(mapPreview).toContain('<div className="map-filter-overlay">{topOverlay}</div>')
    expect(mapPreview).not.toContain('className="map-area-chip"')
    expect(css).toContain('.map-filter-overlay { position: absolute; top: 78px; left: 20px; right: 20px; z-index: 3; display: flex; flex-direction: column; align-items: flex-start; gap: var(--sp-8);')
    expect(css).toContain('body.explore-fullbleed .map-filter-overlay { top: calc(env(safe-area-inset-top, 0px) + 68px); left: 12px; right: 12px; }')
    expect(css).not.toContain('body.explore-fullbleed .map-topline { top:')
    expect(css).toContain('.map-topline.is-sidebar { position: absolute; top: calc(env(safe-area-inset-top) + 88px);')
    expect(css).toContain('.map-filter-panel { display: flex; flex-direction: column; align-items: flex-start; gap: var(--sp-8); width: 100%; min-width: 0; }')
  })

  it('keeps the records screen clear of the tab bar', () => {
    expect(css).toContain('.owner-records { padding-bottom: calc(var(--mobile-tabbar-h) + var(--sp-16)); }')
  })
})

// PC幅（981px以上）の縁なし表示は左サイドバー方式（D-34）。サイドバーは押し出し式ではなく、
// 地図の上に浮くカード型（D-38）で、地図は常に画面いっぱい。シート前提の規則とは幅で分ける。
describe('PC floating sidebar (D-38)', () => {
  it('floats the sidebar as a card over a full-width map instead of offsetting the stage', () => {
    const mediaAt = css.indexOf('@media (min-width: 981px)')
    expect(mediaAt).toBeGreaterThan(-1)
    // 地図ステージはオフセットしない。ワークスペースの padding やシェルへの inset で
    // 押し出すと、相対配置と重なって二重に効く（2026-11-08 の実機報告）。
    expect(css).not.toContain('body.explore-fullbleed .explore-workspace { padding-left:')
    expect(css).not.toContain('.map-preview-shell { inset: 0 0 0 var(--pc-sidebar-w); }')
    expect(css).toContain('body.explore-fullbleed .explore-side-panel {')
    expect(css).toContain('top: var(--pc-sidebar-chrome-h); bottom: 0; left: 0;')
    expect(css.indexOf('top: var(--pc-sidebar-chrome-h);')).toBeGreaterThan(mediaAt)
  })

  it('places the primary nav as vertical rows under the brand row', () => {
    expect(css).toContain('body.explore-fullbleed .desktop-nav {')
    expect(css).toContain('top: var(--pc-sidebar-brand-h); left: 0;')
    expect(css).toContain('flex-direction: column;')
    expect(css).toContain('font-size: var(--fs-14);')
    // シートの上角丸はボトムシート側で維持（サイドバーはフラットカラム）。
    expect(css).toContain('border-radius: var(--radius-l) var(--radius-l) 0 0;')
  })

  it('keeps map-side floating UI clear of the panel zone', () => {
    expect(css).toContain('body.explore-fullbleed .site-header {')
    expect(css).toContain('left: var(--pc-sidebar-offset);')
    expect(css).toContain('body.explore-fullbleed .map-topline { left: calc(var(--pc-sidebar-offset) + 12px); }')
    expect(css).toContain('left: calc(var(--pc-sidebar-offset) + 12px);')
  })
})

describe('rounded corner scale (D-35)', () => {
  const themeCss = readCss('src/theme.css')

  it('defines a three-step radius scale and keeps --ui-radius as the middle alias', () => {
    expect(themeCss).toContain('--radius-s: 10px;')
    expect(themeCss).toContain('--radius-m: 16px;')
    expect(themeCss).toContain('--radius-l: 24px;')
    expect(themeCss).toContain('--ui-radius: var(--radius-m);')
  })

  it('gives the bottom sheet the large radius on its top corners', () => {
    expect(css).toContain('border-radius: var(--radius-l) var(--radius-l) 0 0;')
  })
})

describe('PC sidebar layout integrity', () => {
  it('never offsets the map stage: no workspace padding, no shell inset', () => {
    // シェルは position: relative のため、inset を重ねると相対オフセットとして二重に効く。
    expect(css).not.toContain('.map-preview-shell { inset: 0 0 0 var(--pc-sidebar-w); }')
    expect(css).not.toContain('body.explore-fullbleed .explore-workspace { padding-left:')
  })

  it('keeps the floating brand a compact chip on mobile and a sidebar row on PC', () => {
    expect(css).toContain('body.explore-fullbleed .brand { justify-self: start;')
    expect(css).toContain('body.explore-fullbleed .brand {')
    expect(css).toContain('height: var(--pc-sidebar-brand-h);')
  })

  it('collapses to an icon rail (~56px): list hides, brand/nav/toggle stay, stage is not padded away', () => {
    expect(css).toContain('--pc-sidebar-rail-w: 56px;')
    expect(css).toContain('body.explore-fullbleed.explore-sidebar-collapsed {')
    expect(css).toContain('--pc-sidebar-w: var(--pc-sidebar-rail-w);')
    expect(css).toContain('body.explore-fullbleed.explore-sidebar-collapsed .explore-side-panel {')
    expect(css).toContain('opacity: 0; visibility: hidden;')
    expect(css).not.toContain('body.explore-fullbleed.explore-sidebar-collapsed .desktop-nav { opacity: 0;')
    expect(css).not.toContain('body.explore-fullbleed.explore-sidebar-collapsed .site-header { left: 0; }')
    expect(css).not.toContain('body.explore-fullbleed.explore-sidebar-collapsed .explore-workspace')
    expect(css).toContain('body.explore-fullbleed .sidebar-toggle {')
    expect(css).toContain('width: 44px; height: 44px;')
    expect(css).toContain('left: calc(var(--pc-sidebar-open-w) - 48px)')
    expect(css).not.toContain('left: 6px; top: 44px; width: 44px; height: 44px;')
    expect(css).not.toMatch(/explore-sidebar-collapsed \.sidebar-toggle[^}]*left: 6px/)
  })
})

// UI の動き（D-42）: 入場は CSS、開閉は transition、曲線と尺はトークンで統一する。
describe('UI motion (D-42)', () => {
  const themeCss = readCss('src/theme.css')

  it('defines the strong easing tokens in the theme', () => {
    expect(themeCss).toContain('--ease-out: cubic-bezier(0.23, 1, 0.32, 1);')
    expect(themeCss).toContain('--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);')
    expect(themeCss).toContain('--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);')
  })

  it('glides the sheet snap with the drawer curve and delays hiding until the close finishes', () => {
    expect(css).toContain('transition: height var(--sheet-release-ms, 300ms) var(--ease-drawer), visibility 0s;')
    expect(css).not.toContain('.explore-sheet[data-snap="closed"]:not(.is-dragging) { transition: height 300ms var(--ease-drawer), visibility 0s linear 300ms; }')
  })

  it('animates the quest details entrance and the view swap with the shared keyframes', () => {
    expect(css).toContain('@keyframes content-rise-in')
    expect(css).toContain('.quest-details { animation: content-rise-in 280ms var(--ease-out); }')
    expect(css).toContain('.view-enter { animation: view-fade-in 180ms var(--ease-out); }')
  })

  it('fades the list panel out on collapse while the icon rail width transitions', () => {
    expect(css).toContain('transition: width 200ms var(--ease-out), opacity 200ms var(--ease-out), visibility 0s;')
    expect(css).toContain('opacity: 0; visibility: hidden; pointer-events: none;')
  })
})

describe('mobile fullbleed finish', () => {
  it('keeps the peek sheet compact: two-line rows keep the same sheet height', () => {
    // 2行化しても抜粋・サムネイルは追加しない。
    expect(css).not.toContain('.explore-quest-clue')
    expect(css).not.toContain('.explore-quest-card > img')
    expect(css).toContain('.explore-quest-detail { margin-top: var(--sp-16); }')
  })

  it('keeps the same floating brand and account in mobile quest detail', () => {
    // 詳細状態による上書きを禁止し、一覧・記録と同じ共通ヘッダー規則を使う。
    for (const state of ['.explore-quest-detail-wrap.is-open', '.quest-card.is-open']) {
      for (const element of ['.brand', '.account-area']) {
        expect(css).not.toContain(`body.explore-fullbleed:has(${state}) ${element}`)
      }
    }
    expect(css).toContain('body.explore-fullbleed .brand, body.explore-fullbleed .desktop-nav, body.explore-fullbleed .account-area { pointer-events: auto; }')
    // 全開シートもフィルター下端112px＋間隔12pxを避ける。
    expect(css).toContain('body.explore-fullbleed .explore-sheet:has(.explore-quest-detail-wrap.is-open),')
    expect(css).toContain('body.explore-fullbleed .explore-sheet:has(.quest-card.is-open) {\n    max-height: calc(100% - var(--mobile-tabbar-h) - 124px - env(safe-area-inset-top, 0px));')
    expect(css).toContain('body.explore-fullbleed .map-filter-overlay { top: calc(env(safe-area-inset-top, 0px) + 68px);')
  })

  it('shrinks the floating brand into a small chip on narrow fullbleed screens', () => {
    expect(css).toContain('body.explore-fullbleed .brand-mark { width: 30px; height: 30px; border-radius: 12px; }')
    expect(css).toContain('body.explore-fullbleed .brand-copy { font-size: var(--fs-12); }')
    expect(css).toContain('body.explore-fullbleed .map-filter-overlay { top: calc(env(safe-area-inset-top, 0px) + 68px); left: 12px; right: 12px; }')
  })
})

// 見た目と余白（D-54）: 区切り線と影を絞り、チップの左ラインとパネル下部を整える。
describe('look and spacing (D-54)', () => {
  it('drops the half-length divider under the quest details and the offset shadows on rows, tabs and the account icon', () => {
    expect(css).not.toContain('.quest-details { border-top')
    expect(css).toMatch(/\.traveler-list-row \{[^}]*box-shadow: none;/)
    expect(css).not.toContain('body.explore-fullbleed .account-icon-button { box-shadow')
    expect(css).not.toContain('box-shadow: 6px 0 0 var(--ui-line)')
    // パネル本体の影は D-66 で外した（右端は枠線2pxだけになる）。
    expect(css).toContain('body.explore-fullbleed .explore-side-panel {')
    expect(css).toContain('position: fixed; top: var(--pc-sidebar-chrome-h); bottom: 0; left: 0;')
    expect(css).toContain('border-radius: 0; padding: 0 var(--sp-8) var(--sp-16);')
    expect(css).not.toContain('body.explore-fullbleed .explore-side-panel .explore-quest-card {')
    expect(css).toContain('border: 2px solid var(--ui-line); border-radius: 12px;')
  })

  it('aligns the floating title chip line with the panel side, open and collapsed', () => {
    expect(css).toContain('left: var(--pc-sidebar-offset); z-index: 32;')
    expect(css).toContain('grid-template-columns: 1fr auto; padding: var(--sp-8) var(--sp-16) var(--sp-8) var(--sp-12);')
    expect(css).toContain('body.explore-fullbleed.explore-sidebar-collapsed .site-header { left: var(--pc-sidebar-rail-w); }')
    expect(css).toContain('body.explore-fullbleed.explore-sidebar-collapsed .map-topline { left: calc(var(--pc-sidebar-rail-w) + 12px); }')
  })

  it('keeps a single panel scroller with a stable gutter (D-70 supersedes the D-54 list scroller)', () => {
    // スクロールはパネル本体だけが担い、一覧リスト側は伸縮もスクロールもしない。
    expect(css).toContain('body.explore-fullbleed .explore-side-panel .explore-list {')
    expect(css).toContain('position: relative; flex: 0 0 auto;')
    expect(css).toContain('flex: none; max-height: none; overflow: visible; padding-bottom: var(--sp-12);')
    expect(css).not.toContain('.explore-side-panel .explore-list::after')
    expect(css).toContain('.explore-quest-list { list-style: none; margin: var(--sp-8) 0 0; padding: 0; display: flex; flex-direction: column; gap: var(--sp-4); max-height: 344px; overflow: auto; scrollbar-gutter: stable; }')
    expect(css).toContain('overflow-y: auto; scrollbar-gutter: stable;')
    expect(css).toContain('display: flex; flex-direction: column;')
  })
})

// トグル化とアニメーション（D-55）: 「場所で絞る」の開閉を高さと透明度で滑らせる。
describe('filter motion (D-55)', () => {
  it('animates the filter chips wrap with the shared ease-out token and respects reduced motion', () => {
    expect(css).toContain('.map-filter-chips-wrap { display: grid; grid-template-rows: 0fr; opacity: 0; visibility: hidden; transition: grid-template-rows 250ms var(--ease-out), opacity 200ms var(--ease-out), visibility 0s linear 250ms; }')
    expect(css).toContain('.map-filter-chips-wrap.is-open { grid-template-rows: 1fr; opacity: 1; visibility: visible;')
    expect(css).toContain('@media (prefers-reduced-motion: reduce) { .map-filter-chips-wrap { transition: none; } }')
    expect(css).toContain('.filter-chip { flex: none; min-height: 44px; padding: var(--sp-4) var(--sp-12); border: var(--ui-border-width) solid var(--ui-line); border-radius: 999px; background: var(--ui-surface); color: var(--ui-ink); font-size: var(--fs-12); font-weight: var(--ui-weight-control); white-space: nowrap; cursor: pointer; transition: background-color 150ms var(--ease-out); }')
  })

  it('glides the floating elements sideways when the PC sidebar collapses', () => {
    expect(css).toContain('body.explore-fullbleed .site-header,')
    expect(css).toContain('body.explore-fullbleed .map-topline,')
    expect(css).toContain('transition: left 200ms var(--ease-out), width 200ms var(--ease-out), top 200ms var(--ease-out);')
  })
})

// 記録画面のタブ位置（D-60 追記）: 非探索画面でもタブ群を探索画面のナビカードと
// 同じ左のライン（左カラム上段）に置く。CSS の実測は jsdom ではできないため、
// 規則の置き場所（記録画面が表示されている間だけ・PC 幅だけ）で担保する。
describe('records view tab position (D-60 addendum)', () => {
  it('keeps a vertical left sidebar (brand + nav) while records are shown on PC', () => {
    expect(css).toContain('body:has(.traveler-shell) .desktop-nav,\n  body.explore-fullbleed .desktop-nav {')
    expect(css).toContain('flex-direction: column;')
    expect(css).toContain('body:has(.traveler-shell) .owner-records {')
    expect(css).toContain('margin: calc(var(--account-slot-top) + var(--account-slot-size) + var(--sp-24)) var(--sp-24) var(--sp-24) calc(var(--pc-sidebar-w) + var(--sp-24));')
    expect(mapPreview).toContain('{createPortal(<button type="button" className="sidebar-toggle"')
    expect(mapPreview).toContain("</button>, typeof document === 'undefined' ? null : document.getElementById('sidebar-toggle-slot') ?? document.body)}")
    expect(mapPreview).toContain('[panelMode, sidebarCollapsed])')
    expect(css).toContain('body.explore-fullbleed .desktop-nav {')
    expect(css).toContain('top: var(--pc-sidebar-brand-h); left: 0;')
  })
})

// 見た目の統一（D-66）: 中身とパネル本体のオフセットシャドウを全廃し、タイトルと
// アカウントアイコンを画面間で同位置・同形に固定する。実測はライブの画素測定
// （2026-11-09、revision 00097）に基づく。CSS の実測は jsdom ではできないため、
// 規則の置き場所と文字列で担保する。
describe('chrome consistency (D-66)', () => {
  const themeCss = readCss('src/theme.css')

  it('drops the offset shadow from the shared control rule (detail and hint buttons, account icon), including hover', () => {
    expect(themeCss).not.toContain('box-shadow: var(--ui-control-shadow)')
    expect(themeCss).not.toContain('box-shadow: var(--ui-hover-shadow)')
    // 共通規則は枠線だけで示し、押下時と同じく影なしに揃える。
    expect(themeCss).toContain('border-radius: var(--ui-radius);\n  box-shadow: none;')
  })

  it('drops the offset shadow from the title pill, the brand mark, the side panel and the sheet', () => {
    // スマホ幅フルブリードのタイトルピル（PCはサイドバー内ブランドへ上書き）。
    expect(css).toContain('body.explore-fullbleed .brand { justify-self: start; width: fit-content; padding: var(--sp-4) var(--sp-8) var(--sp-4) var(--sp-4); border: var(--ui-border-width) solid var(--ui-line); border-radius: var(--ui-radius); background: var(--ui-surface); box-shadow: none; }')
    expect(css).toContain('.brand-mark { border: 0; background: transparent; }')
    expect(css).not.toContain('border-radius: 0 0 var(--radius-l) var(--radius-l); box-shadow: var(--ui-shadow);')
    expect(css).toContain('border-radius: 0; padding: 0 var(--sp-8) var(--sp-16);')
    expect(css).not.toContain('background: var(--ui-surface); color: var(--ui-ink); box-shadow: var(--ui-shadow); transition: height 300ms var(--ease-drawer), visibility 0s; }')
  })

  it('keeps records chrome aligned: mobile title pill, PC left sidebar, account at the right edge', () => {
    expect(css).toContain('@media (max-width: 980px) {\n  body:has(.traveler-shell) .brand { justify-self: start; width: fit-content; padding: var(--sp-4) var(--sp-8) var(--sp-4) var(--sp-4); border: var(--ui-border-width) solid var(--ui-line); border-radius: var(--ui-radius); background: var(--ui-surface); }')
    expect(css).toContain('body:has(.traveler-shell) .brand,\n  body.explore-fullbleed .brand {')
    expect(css).toContain('body:has(.traveler-shell)::before,\n  body.explore-fullbleed::before {')
    expect(css).toContain('left: calc(var(--pc-sidebar-open-w) - 48px)')
    expect(css).not.toContain('left: 6px; top: 44px; width: 44px; height: 44px;')
  })
})

// パネルの単一スクロールと一覧内詳細の枠なし化（D-70）。CSS の実測は jsdom では
// できないため、規則の文字列と置き場所で担保する。
describe('panel single scroll and in-list detail (D-70)', () => {
  it('makes the PC side panel the only scroller for the quest list', () => {
    expect(css).toContain('body.explore-fullbleed .explore-side-panel .explore-list {')
    expect(css).toContain('position: relative; flex: 0 0 auto;')
    expect(css).toContain('flex: none; max-height: none; overflow: visible; padding-bottom: var(--sp-12);')
    expect(css).not.toContain('.explore-side-panel .explore-list::after')
  })

  it('drops the detail card frame inside the list accordion', () => {
    expect(css).toContain('.quest-card.is-in-list { border: 0; border-radius: 0; background: transparent; box-shadow: none; }')
    expect(css).toContain('.quest-card.is-in-list .quest-card-heading { padding: 0 var(--sp-16); border-bottom: 0; background: transparent; }')
    expect(css).toContain('.quest-card.is-in-list .quest-card-content { padding: 0 var(--sp-16) var(--sp-16); }')
  })

  it('raises the sheet for quest selection and fits selections above the raised sheet', () => {
    expect(mapPreview).toContain("selectedQuestId ? `quest:${selectedQuestId}` : null")
    expect(mapPreview).toContain('Math.max(SHEET_PEEK_HEIGHT, Math.round(stageHeight * 0.55))')
  })
})

// シートの高さ・はみ出し・チップの折り返し（D-73）。CSS の実測は jsdom ではできないため、
// 規則の文字列と定数で担保する。
describe('sheet peek height and overflow guards (D-73)', () => {
  it('clears the mobile map controls above the peek sheet via the sheet height variable', () => {
    expect(css).toContain('body.explore-fullbleed .map-controls { position: absolute; bottom: calc(var(--mobile-tabbar-h) + 168px + 12px); z-index: 3; }')
    expect(css).not.toContain('bottom: calc(var(--mobile-tabbar-h) + 58px)')
  })

  it('keeps the full-bleed page free of phantom vertical growth and puts the clearance on the rail', () => {
    expect(css).toContain('body.explore-fullbleed .page { padding-bottom: 0; }')
    expect(css).toContain('body.explore-fullbleed .quest-rail { padding: var(--sp-24) var(--sp-16) calc(var(--mobile-tabbar-h) + var(--sp-24)); }')
    expect(css).toContain('body.explore-fullbleed .quest-rail:empty { display: none; }')
  })

  it('clips horizontal overflow at the viewport and wraps the region chips', () => {
    expect(css).toContain('html, body { overflow-x: clip; }')
    expect(css).toContain('.map-filter-chips { display: flex; flex-wrap: wrap; gap: var(--sp-8); max-width: 100%; overflow: visible; padding: 2px; pointer-events: auto; }')
    expect(css).not.toContain('.map-filter-chips::-webkit-scrollbar')
  })
})

// ボタンの尺と記録画面の統一（D-74）。CSS の実測は jsdom ではできないため、
// 規則の文字列と置き場所で担保する。
describe('button widths and records alignment (D-74)', () => {
  it('stretches the hint buttons across their frame', () => {
    expect(css).toContain('.hint-open {')
    expect(css).toContain('width: 100%; min-height: 52px;')
    expect(css).toContain('.optional-hint-toggle, .optional-hint-content button { width: 100%; min-height: 52px;')
  })

  it('limits the records card to a readable column (D-82)', () => {
    const recordsRule = css.match(/^\.owner-records\s*\{([^}]+)\}/m)?.[1] ?? ''
    expect(recordsRule).toMatch(/\bdisplay:\s*grid\s*;/)
    expect(recordsRule).toMatch(/\bgap:\s*var\(--sp-16\)\s*;/)
    expect(recordsRule).toMatch(/\bmax-width:\s*720px\s*;/)
    expect(recordsRule).toMatch(/\bgrid-template-columns:\s*minmax\(0,\s*1fr\)\s*;/)
  })

  it('gives the mobile records header the same transparent floating look as explore', () => {
    const mediaAt = css.indexOf('@media (max-width: 980px) {\n  body:has(.traveler-shell) .brand')
    expect(mediaAt).toBeGreaterThan(-1)
    expect(css).toContain('body:has(.traveler-shell) .site-header { background: transparent; border-bottom: 0; padding: calc(var(--sp-4) + env(safe-area-inset-top)) var(--sp-8) var(--sp-4); }')
  })
})


describe('PC sidebar containment and collapsed rail', () => {
  it('keeps api-load-state inside the side panel without the page-center card margins', () => {
    expect(css).toContain('body.explore-fullbleed .explore-side-panel .api-load-state {')
    expect(css).toContain('width: 100%; max-width: 100%; margin: var(--sp-8) 0 0;')
    expect(css).not.toContain('body.explore-fullbleed .explore-side-panel .api-load-state { width: min(100% - 40px, 620px);')
  })

  it('keeps brand mark, toggle and nav icons on the collapsed ~56px rail', () => {
    expect(css).toContain('--pc-sidebar-rail-w: 56px;')
    expect(css).toContain('body.explore-fullbleed.explore-sidebar-collapsed .brand-mark { width: 32px; height: 32px; border-radius: 12px; }')
    expect(css).toContain('body.explore-fullbleed.explore-sidebar-collapsed .desktop-nav .icon { width: 18px; height: 18px; flex: none; }')
    expect(css).toContain('left: calc(var(--pc-sidebar-open-w) - 48px)')
    expect(css).not.toContain('left: 6px; top: 44px; width: 44px; height: 44px;')
    expect(css).not.toMatch(/explore-sidebar-collapsed \.sidebar-toggle[^}]*left: 6px/)
  })
})


describe('PC sidebar stacking', () => {
  it('keeps the sidebar rail ::before under the header chrome so logo/nav stay visible', () => {
    expect(css).toContain('body.explore-fullbleed::before {')
    expect(css).toContain('z-index: 20;')
    expect(css).toContain('body.explore-fullbleed .site-header {')
    expect(css).toContain('left: var(--pc-sidebar-offset); z-index: 32;')
  })
})

describe('records body and mobile return clearance', () => {
  it('spaces the records card from the sidebar and viewport edges (D-84)', () => {
    const recordsRule = css.slice(css.indexOf('body:has(.traveler-shell) .owner-records {')).split('}')[0]
    expect(recordsRule).not.toContain('border-left:')
    expect(recordsRule).toContain('margin: calc(var(--account-slot-top) + var(--account-slot-size) + var(--sp-24)) var(--sp-24) var(--sp-24) calc(var(--pc-sidebar-w) + var(--sp-24));')
    expect(recordsRule).toContain('width: calc(100% - var(--pc-sidebar-w) - 48px);')
    expect(recordsRule).toContain('max-width: 1080px;')
    expect(css).toContain('padding-bottom: calc(var(--mobile-tabbar-h, 70px) + 120px);')
  })
})

describe('traveler navigation selection (D-85)', () => {
  it('uses transparent navigation with ink and weight on mobile and PC', () => {
    const theme = readCss('src/theme.css')
    expect(theme).toContain('--ui-accent: #ffe66b;')
    expect(theme).toContain('--ui-line: #1d1d1b;')
    expect(theme).toContain('--ui-border-width: 2px;')
    const mobile = css.match(/\.mobile-nav \[aria-current="page"\] \{([^}]+)\}/)?.[1]
    const desktop = css.match(/body\.explore-fullbleed \.desktop-nav \.nav-active \{([^}]+)\}/)?.[1]
    for (const rule of [mobile, desktop]) {
      expect(rule).toContain('background: transparent;')
      expect(rule).toContain('color: var(--ui-ink);')
      expect(rule).toContain('font-weight: var(--ui-weight-strong);')
      expect(rule).toContain('border: var(--ui-border-width) solid transparent;')
      expect(rule).toContain('box-shadow: none;')
    }
    expect(css).toContain('gap: var(--sp-4); width: var(--pc-sidebar-w);')
    expect(css).toContain('height: 40px; padding: var(--sp-8) var(--sp-8); border-radius: 12px;')
    expect(css).not.toMatch(/box-shadow: var\(--ui-(?:control-|hover-)?shadow/)
    expect(css).not.toContain('box-shadow: -3px 3px')
  })
})

it('keeps yellow out of selected traveler chips, filters, rows and hint numbers', () => {
  for (const selector of [
    '.filter-chip[aria-pressed="true"]', '.filter-prefecture[aria-pressed="true"]',
    '.filter-toggle[aria-expanded="true"]', '.map-area-chip',
    '.explore-quest-list .traveler-list-row.is-selected', '.traveler-list-row.is-selected',
    '.api-quest-picker li button[aria-pressed="true"]', '.hint-step.is-current',
  ]) {
    const start = css.indexOf(`${selector} {`)
    expect(start, selector).toBeGreaterThan(-1)
    const rule = css.slice(start, css.indexOf('}', start))
    expect(rule, selector).not.toMatch(/var\(--ui-(accent|soft)/)
  }
})

// 地図未読込・失敗時も、同じフィルター位置と再試行の操作領域を維持する。
describe('mobile overlay clearance', () => {
  it('places fallback filters in flow before the state and reserves tab bar clearance', () => {
    // PCの細いパネル表示では絞り込みはパネル側に出るため、地図の流れには置かない。
    expect(mapPreview).toContain(`status !== 'ready' && !panelMode && topOverlay && <div className="map-filter-flow">{topOverlay}</div>`)
    expect(css).toContain('body.explore-fullbleed .map-preview-shell:has(> .map-filter-flow) { display: flex; flex-direction: column; }')
    expect(css).toContain('order: -1; flex: none; margin: 0; padding: calc(env(safe-area-inset-top, 0px) + 68px) var(--sp-12) var(--sp-12);')
    expect(css).toContain('body.explore-fullbleed .map-preview-shell:has(> .map-filter-flow) { padding-bottom: var(--mobile-tabbar-h); }')
    expect(css).toContain('.map-state button { min-height: 44px;')
  })

  it('keeps area errors below the measured filter and gives sheet actions scroll clearance', () => {
    expect(mapPreview).toContain("shell.style.setProperty('--map-filter-bottom'")
    expect(mapPreview).toContain('observer?.observe(overlay)')
    expect(css).toContain('body.explore-fullbleed .map-area-error { margin-top: calc(var(--map-filter-bottom, 112px) + var(--sp-12)); }')
    expect(css).toContain('.explore-sheet-body { padding-bottom: var(--sp-16); scroll-padding-bottom: var(--sp-16); }')
  })
})
