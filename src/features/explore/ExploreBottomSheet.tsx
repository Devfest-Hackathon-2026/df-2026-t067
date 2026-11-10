import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import {
  clampWithRubberBand,
  pickSnapFromRelease,
  releaseTransitionMs,
  velocityFromSamples,
} from './sheetGesturePhysics'

export type SheetSnap = 'closed' | 'peek' | 'half' | 'full'

// 2行化後もpeekは168pxを維持し、先頭行と次の行の一部を見せる。
// halfも行数に連動させず、地図の表示面積を保つ。
export const SHEET_PEEK_HEIGHT = 168
const SHEET_CLOSED_HEIGHT = 64
const SHEET_TOP_GAP = 84
const FALLBACK_STAGE_HEIGHT = 640
const DRAG_TAP_THRESHOLD = 6
const CARD_CLICK_GRACE_MS = 100
const DEFAULT_TRANSITION_MS = 300

function snapHeights(stageHeight: number): Record<SheetSnap, number> {
  const half = Math.max(SHEET_PEEK_HEIGHT, Math.round(stageHeight * 0.55))
  const full = Math.max(half, stageHeight - SHEET_TOP_GAP)
  return { closed: SHEET_CLOSED_HEIGHT, peek: SHEET_PEEK_HEIGHT, half, full }
}

// 地図の上に重なる引き上げ式シート。スナップは closed / peek / half / full の4段で、
// ハンドルのドラッグとタップ（ボタン）の両方で開閉できる。シート本体が地図とは
// 別の要素なので、シート上のスクロールやドラッグが地図へ伝わることはない。
export function ExploreBottomSheet({ children, openSignal, onHeightChange, onUserClosedChange, questCount = 0, detailOpen = false, onDismissDetail }: {
  children: ReactNode
  questCount?: number
  onDismissDetail?: () => void
  detailOpen?: boolean
  /** 地域IDが新しく渡されたら、ハイライトされたカードが見える位置まで開く。 */
  openSignal?: string | null
  onHeightChange?: (height: number) => void
  /** Reports user handle gestures only; automatic opens from map/list selection are not reported. */
  onUserClosedChange?: (closed: boolean) => void
}) {
  const sheetRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<HTMLButtonElement>(null)
  const focusAfterSnap = useRef<'body' | 'handle' | null>(null)
  const [stageHeight, setStageHeight] = useState(FALLBACK_STAGE_HEIGHT)
  const [snap, setSnap] = useState<SheetSnap>('peek')
  // ピンの通知は詳細の取得より先に届くため、halfへ開く前の高さを保存する。
  const preDetailSnap = useRef<SheetSnap | null>(null)
  useEffect(() => {
    if ((detailOpen || openSignal) && preDetailSnap.current === null) {
      preDetailSnap.current = snap
    } else if (!detailOpen && !openSignal && preDetailSnap.current !== null) {
      setSnap(preDetailSnap.current)
      preDetailSnap.current = null
    }
  }, [detailOpen, openSignal, snap])
  const [dragHeight, setDragHeight] = useState<number | null>(null)
  const [releaseMs, setReleaseMs] = useState<number | null>(null)
  const drag = useRef<{ pointerId: number; startY: number; startHeight: number; distance: number; samples: Array<{ y: number; t: number }> } | null>(null)
  const suppressClick = useRef(false)
  const reducedMotion = useRef(false)
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    const sync = () => { reducedMotion.current = Boolean(mq?.matches) }
    sync()
    mq?.addEventListener?.('change', sync)
    return () => mq?.removeEventListener?.('change', sync)
  }, [])
  const lastOpenSignal = useRef<string | null>(null)
  const bodyId = useId()

  const measure = useCallback(() => {
    const sheet = sheetRef.current
    const parentHeight = sheet?.parentElement?.clientHeight ?? 0
    // 縁なしスマホでは sheet の bottom がタブバー高（--mobile-tabbar-h）になる。
    // 親いっぱいをステージにすると full がタブバー領域まで食い込み、中間高さでは
    // 「シート下端とタブバー／画面下のあいだ」に地図が覗く隙間になる。
    const bottomRaw = sheet ? Number.parseFloat(getComputedStyle(sheet).bottom) : 0
    const bottomOffset = Number.isFinite(bottomRaw) ? Math.max(0, bottomRaw) : 0
    const usable = Math.max(0, parentHeight - bottomOffset)
    setStageHeight(usable >= 320 ? usable : FALLBACK_STAGE_HEIGHT)
  }, [])

  useEffect(() => {
    measure()
    window.addEventListener('resize', measure)
    // モバイルのアドレスバー伸縮は resize だけでは足りないことがある。
    const viewport = window.visualViewport
    viewport?.addEventListener('resize', measure)
    viewport?.addEventListener('scroll', measure)
    return () => {
      window.removeEventListener('resize', measure)
      viewport?.removeEventListener('resize', measure)
      viewport?.removeEventListener('scroll', measure)
    }
  }, [measure])

  useEffect(() => {
    if (openSignal && openSignal !== lastOpenSignal.current) {
      setSnap((current) => (current === 'closed' || current === 'peek' ? 'half' : current))
    }
    lastOpenSignal.current = openSignal ?? null
  }, [openSignal])

  const heights = snapHeights(stageHeight)
  const height = dragHeight ?? heights[snap]
  useEffect(() => { onHeightChange?.(height) }, [height, onHeightChange])

  const cardClicksBlockedUntil = useRef(0)
  // つまみのタップ・ドラッグで利用者がシートを動かした時だけ、動いている間の一覧カードの
  // クリックを捨てる（つまみの素早い2回タップが、下から来たカードに当たって詳細が開く対策）。
  // 選択に伴う自動の開閉（openSignal）では止めない。
  const guardCardClicks = (durationMs: number) => {
    cardClicksBlockedUntil.current = performance.now() + durationMs + CARD_CLICK_GRACE_MS
  }

  useEffect(() => {
    const target = focusAfterSnap.current
    if (!target) return
    focusAfterSnap.current = null
    const element = target === 'body' ? bodyRef.current : handleRef.current
    if (target === 'body' && element) element.scrollTop = 0
    element?.focus({ preventScroll: true })
  }, [snap])

  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    const now = performance.now()
    drag.current = {
      pointerId: event.pointerId, startY: event.clientY, startHeight: height, distance: 0,
      samples: [{ y: event.clientY, t: now }],
    }
    suppressClick.current = false
    setReleaseMs(null)
    setDragHeight(height)
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* 捕捉できなくてもドラッグは続けられる。 */ }
  }
  const onPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const active = drag.current
    if (!active || event.pointerId !== active.pointerId) return
    const delta = active.startY - event.clientY
    active.distance = Math.max(active.distance, Math.abs(delta))
    const now = performance.now()
    active.samples.push({ y: event.clientY, t: now })
    if (active.samples.length > 6) active.samples.shift()
    // Track phase: 指に 1:1。端だけラバーバンド（gestures スキル）。
    setDragHeight(clampWithRubberBand(active.startHeight + delta, heights.closed, heights.full))
  }
  const endDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const active = drag.current
    if (!active || event.pointerId !== active.pointerId) return
    const samples = active.samples.concat([{ y: event.clientY, t: performance.now() }])
    drag.current = null
    if (active.distance >= DRAG_TAP_THRESHOLD) {
      suppressClick.current = true
      const target = dragHeight ?? heights[snap]
      const velocityY = velocityFromSamples(samples)
      const next = pickSnapFromRelease({
        height: Math.min(heights.full, Math.max(heights.closed, target)),
        velocityY,
        heights,
        reducedMotion: reducedMotion.current,
      })
      const releaseDuration = releaseTransitionMs(velocityY, reducedMotion.current)
      setReleaseMs(releaseDuration)
      guardCardClicks(releaseDuration)
      onUserClosedChange?.(next === 'closed')
      if (next === 'closed') {
        preDetailSnap.current = null
        if (detailOpen) onDismissDetail?.()
        focusAfterSnap.current = 'handle'
      }
      setSnap(next)
    }
    setDragHeight(null)
  }
  const onClick = () => {
    if (suppressClick.current) { suppressClick.current = false; return }
    guardCardClicks(reducedMotion.current ? 120 : DEFAULT_TRANSITION_MS)
    if (detailOpen && onDismissDetail) {
      setSnap(preDetailSnap.current ?? 'peek')
      preDetailSnap.current = null
      onDismissDetail()
      return
    }
    const next = snap === 'full' ? 'half' : snap === 'half' ? 'full' : 'half'
    onUserClosedChange?.(false)
    if (snap === 'half' || snap === 'full') focusAfterSnap.current = 'handle'
    setSnap(next)
  }
  return <>
    <div ref={sheetRef} className={'explore-sheet' + (dragHeight !== null ? ' is-dragging' : '')} data-snap={snap}
      style={{ height, ...(releaseMs != null && dragHeight === null ? { '--sheet-release-ms': `${releaseMs}ms` } as CSSProperties : {}) }}>
      <button ref={handleRef} type="button" className="explore-sheet-handle" aria-expanded={snap === 'half' || snap === 'full'} aria-controls={bodyId}
        aria-label={detailOpen && onDismissDetail ? '謎リストに戻る' : snap === 'full' ? '謎リストをたたむ' : '謎リストを広げる'}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag} onClick={onClick}>
        <span className="explore-sheet-grip" aria-hidden="true" />
        {snap === 'closed' && <span className="explore-sheet-count">{questCount}件の謎</span>}
      </button>
      <div ref={bodyRef} className="explore-sheet-body" id={bodyId} tabIndex={-1}
        onClickCapture={(event) => {
          if ((drag.current || performance.now() < cardClicksBlockedUntil.current)
            && event.target instanceof Element && event.target.closest('.explore-quest-card')) {
            event.preventDefault()
            event.stopPropagation()
          }
        }}>{children}</div>
    </div>
  </>
}
