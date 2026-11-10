import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

const css = readFileSync('src/App.css', 'utf8')
const explore = readFileSync('src/features/explore/ExploreQuestList.tsx', 'utf8')
const records = readFileSync('src/features/discoveries/OwnerDiscoveries.tsx', 'utf8')

it('探索と記録が共通行を使い、写真行だけ高さを広げる', () => {
  expect(explore).toContain('traveler-list-row')
  expect(records).toContain('traveler-list-row traveler-list-row-photo')
  expect(css).toMatch(/\.traveler-list-row \{[^}]*min-height: 44px;[^}]*padding: var\(--sp-8\) var\(--sp-12\);[^}]*border: 2px solid var\(--ui-line\);[^}]*border-radius: 12px;/)
  expect(css).toMatch(/\.traveler-list-row-photo \{[^}]*min-height: 64px;/)
  expect(css).not.toMatch(/explore-side-panel \.explore-quest-card \{/)
})

it('一覧の間隔、2行省略、メタデータ、キーボードフォーカスを保つ', () => {
  expect(css).toMatch(/\.explore-quest-list \{[^}]*gap: var\(--sp-4\);/)
  expect(css).toMatch(/\.record-list \{[^}]*gap: var\(--sp-8\);/)
  expect(css).toMatch(/\.traveler-row-title \{[^}]*-webkit-line-clamp: 2;/)
  expect(css).toMatch(/\.traveler-row-meta \{[^}]*text-align: right;[^}]*white-space: nowrap;/)
  expect(css).toMatch(/\.traveler-list-row:focus-within \{[^}]*background: var\(--role-hover\);/)
  expect(css).toMatch(/\.traveler-list-row:focus-within \{[^}]*outline: 2px solid var\(--ui-line\);/)
  // 選択中は水色、既存の太字も保つ。
  expect(css).toMatch(/\.traveler-list-row\.is-selected \{[^}]*background: var\(--role-selected\);/)
  expect(css).toMatch(/\.traveler-list-row\.is-selected \.traveler-row-title \{[^}]*font-weight: var\(--ui-weight-strong\);/)
})

it('探索だけ題名とメタの2行にし、詳細の上余白を16pxにまとめる', () => {
  expect(css).toMatch(/\.explore-row-copy \{[^}]*flex-direction: column;/)
  expect(css).toMatch(/\.explore-quest-list \.traveler-row-title \{[^}]*-webkit-line-clamp: 1;/)
  expect(css).toMatch(/\.explore-quest-list \.traveler-row-meta \{[^}]*text-align: left;/)
  expect(css).toContain('.explore-quest-detail { margin-top: var(--sp-16); }')
  expect(css).toContain('.quest-card.is-in-list .quest-details { margin-top: 0; padding-top: 0; }')
  expect(css).toContain('.traveler-shell .quest-card.is-in-list .quest-card-heading { padding: 0 var(--sp-16); }')
  expect(css).toContain('.traveler-shell .quest-card.is-in-list .quest-card-content { padding: 0 var(--sp-16) var(--sp-16); }')
})


it('一覧内のチップは小さい余白で1段を保ち、丸アイコンは28pxの固定幅にする', () => {
  expect(css).toMatch(/\.explore-clear-filters \{[^}]*flex-wrap: nowrap;/)
  expect(css).toMatch(/\.explore-clear-filters button \{[^}]*padding: 4px 8px;[^}]*white-space: nowrap;/)
  expect(css).toMatch(/\.explore-clear-filters button\[aria-pressed="true"\] \{[^}]*background: var\(--role-selected\);/)
  expect(css).toMatch(/\.explore-row-icon \{[^}]*flex: 0 0 28px;[^}]*width: 28px; height: 28px;[^}]*border: 2px solid var\(--ui-control-line\);[^}]*background: #4eb8d0;/)
  expect(css).toMatch(/\.explore-row-icon\.is-cleared \{[^}]*background: var\(--role-done\);/)
})
