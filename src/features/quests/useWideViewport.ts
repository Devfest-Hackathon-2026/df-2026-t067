import { createContext, useContext, useSyncExternalStore } from 'react'

// 起動HTMLの指定幅と、詳細ツリー内で親と同じ幅を使うための上書き。
export const PrerenderViewport = createContext<boolean | null>(null)

// App.css のワークスペースが2カラムになる境界（max-width: 980px の反対側）を
// 「広い画面＝PC」の境目として使う。UA判定はしない。
export const WIDE_VIEWPORT_QUERY = '(min-width: 981px)'

function subscribe(onChange: () => void) {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {}
  const query = window.matchMedia(WIDE_VIEWPORT_QUERY)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

function getSnapshot() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia(WIDE_VIEWPORT_QUERY).matches
}

export function useWideViewport(): boolean {
  const prerender = useContext(PrerenderViewport)
  // 親から幅が渡されている場合、子の再描画タイミングによる判定の混在を防ぐ。
  const wide = useSyncExternalStore(subscribe, getSnapshot, () => prerender ?? false)
  return prerender ?? wide
}
