import { createPortal as reactCreatePortal } from 'react-dom'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode, RefObject } from 'react'
import { Icon } from '../../components/Icon'
import type { PublicArea, PublicQuest } from '../../shared/api/types'
import { useWideViewport, WIDE_VIEWPORT_QUERY } from '../quests/useWideViewport'
import { ExploreBottomSheet, SHEET_PEEK_HEIGHT } from './ExploreBottomSheet'
import { mobileHeaderClearance } from './scrollBelowHeader'
import { initialPinShift, projectedAnchorY } from './initialPinShift'
import { visibleAreaFitPadding } from './fitPadding'
import { ExploreQuestList } from './ExploreQuestList'
import { loadGoogleMaps, subscribeMapsAuthFailure, type DataLayer, type MapInstance, type MarkerInstance } from './googleMapsLoader'
import { arrangePins } from './pinClustering'
import { MAP_PIN_ACTIVE_COLOR as PIN_ACTIVE_COLOR, MAP_PIN_CLEARED_COLOR as PIN_CLEARED_COLOR, MAP_PIN_COLOR as PIN_COLOR, MAP_PIN_SELECTED_COLOR as PIN_SELECTED_COLOR, MAP_PIN_STROKE as PIN_STROKE, MAP_STYLES } from './mapStyles'
import { boundsForFilter } from '../quests/prefectureBounds'
import { getRegionAreas } from '../quests/areaHierarchy'
import { areaPinPosition } from './viewportQuests'
import { mapControlsPlacement } from './mapOverlayLayout'
import { isMapControlFullyCovered, isMapControlWithin } from './mapControlVisibility'

// SSR has no portal target; the fixed toggle has the same screen coordinates inline.
const createPortal = (node: ReactNode, target: HTMLElement | null) => target ? reactCreatePortal(node, target) : node

const JAPAN = { lat: 36.2048, lng: 138.2529 }
// 日本国内専用の見た目（D-27／D-41）は、初期表示の日本全体フィットと最小ズームで維持する。
// 地図の restriction は使わない：表示範囲が restriction の幅より広いズームでは、ライブラリが
// setCenter を restriction のメルカトル中心（北緯35.605…・東経134.5）へ固定してしまい、
// fitBounds がセットした中心が差し替わって「ピンと違う場所へ飛ぶ」不具合になったため撤去した
// （2026-11-08 の実測で確定。詳細は decisions.md の D-41 追記）。
// 国外を薄く落とすベールも、相方だった restriction の撤去で飾りだけが残り、見た目も
// しっくり来なかったため撤去した（D-41 追記）。移動範囲は制限しない。
// これ以上引くと日本が小さくなりすぎるため、最小ズームも引き上げる（D-41）。
// 当初は初期表示の日本全体フィットの下限に合わせて 4.5（小数）だったが、Mac のトラックパッドで
// 最小ズームからさらに縮小ピンチをすると画面がちらつく報告があり、整数の 5 に変更した（D-67）。
// 実効の下限は5。スマホの初期フィットで余白が不足する場合はidle後に位置を補正する。
const MIN_ZOOM = 5
const INITIAL_ZOOM = 5
const MAX_ZOOM = 20
// フィットで寄せる倍率の上限（D-60 追記）。対象が実質1点だと fitBounds が最大倍率まで
// 寄ってしまい、ピン1つと空白の地図になる。地域の境界や周辺の道路が見える程度に留める。
// 利用者が自分で寄せる操作（最大20）と現在地への寄せ（14）は対象外。
const FIT_MAX_ZOOM = 12
const LOCATION_ZOOM = 14
const LOCATION_DEADLINE_MS = 10_000
const API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? ''

function pinIcon(color: string, count: number, emphasized = false, dimmed = false, cleared = false): { url: string } {
  const center = count >= 2
    ? `<circle cx="18" cy="17" r="9.5" fill="#ffffff"/><text x="18" y="21.5" text-anchor="middle" font-family="sans-serif" font-size="${count >= 10 ? 10 : 12}" font-weight="700" fill="${PIN_STROKE}">${count}</text>`
    : '<circle cx="18" cy="17" r="7" fill="#ffffff"/>'
  // クリア済みの緑は強調中も保ち、通常ピンの強調は従来の赤にする。
  const fill = emphasized && !cleared ? PIN_ACTIVE_COLOR : color
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${emphasized ? 42 : 36}" height="${emphasized ? 51 : 44}" viewBox="-2 -2 40 48" opacity="${dimmed && !emphasized ? 0.3 : 1}"><path d="M18 1C9.2 1 2 8.2 2 17c0 10.5 16 26 16 26s16-15.5 16-26C34 8.2 26.8 1 18 1Z" fill="${fill}" stroke="${PIN_STROKE}" stroke-width="${emphasized ? 3 : 2}"/>${center}</svg>`
  return { url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}` }
}

// クラスタマーカー（D-52）：重なったピンの合計問題数を出す丸いバッジ。ピンの色（青）に揃え、
// 形でピンと区別する（尾のない円＋二重リング）。
function clusterIcon(totalQuests: number, dimmed = false): { url: string } {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40" opacity="${dimmed ? 0.3 : 1}"><circle cx="20" cy="20" r="17" fill="${PIN_COLOR}" stroke="${PIN_STROKE}" stroke-width="2"/><circle cx="20" cy="20" r="12" fill="#ffffff"/><text x="20" y="25" text-anchor="middle" font-family="sans-serif" font-size="${totalQuests >= 10 ? 11 : 13}" font-weight="700" fill="${PIN_STROKE}">${totalQuests}</text></svg>`
  return { url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}` }
}

const LOCATION_SUCCESS_MESSAGE = '現在地を表示'

// 地域の公開ジオメトリから、フィットに使える全頂点を {lat, lng} で返す。閉じていない・
// 範囲外の座標を含むリングは丸ごと除く（従来のフィットと同じ検証）。使える輪郭が無ければ null。
function areaFitPoints(area: PublicArea): Array<{ lat: number; lng: number }> | null {
  const geometry = area.publicGeometry
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
  const validPolygons = polygons.filter((polygon) => polygon.length > 0 && polygon.every((ring) => {
    if (ring.length < 4) return false
    const validPoints = ring.every(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat) && Math.abs(lng) <= 180 && Math.abs(lat) <= 90)
    const [firstLng, firstLat] = ring[0]
    const [lastLng, lastLat] = ring[ring.length - 1]
    return validPoints && firstLng === lastLng && firstLat === lastLat
  }))
  if (!validPolygons.length) return null
  const points: Array<{ lat: number; lng: number }> = []
  validPolygons.forEach((polygon) => polygon.forEach((ring) => ring.forEach(([lng, lat]) => points.push({ lat, lng }))))
  return points
}

// フィットの結果が上限より寄っていたら上限まで引く。実際に引いたら true を返す
// （引いた場合は次の idle でカメラが確定する）。
function clampFitZoom(instance: MapInstance): boolean {
  try {
    const zoom = instance.getZoom()
    if (zoom !== undefined && zoom > FIT_MAX_ZOOM) { instance.setZoom(FIT_MAX_ZOOM); return true }
  } catch { /* カメラが読めなければ上限なしで続ける。 */ }
  return false
}

// 記録を伴わないフィット向け：完了（idle）後に一度だけ上限を適用する。
function clampFitZoomOnIdle(instance: MapInstance): void {
  try {
    const listener = instance.addListener('idle', () => {
      try { listener.remove() } catch { /* SDK teardown is best effort. */ }
      clampFitZoom(instance)
    })
  } catch { /* リスナーを付けられない環境では上限なしで続ける。 */ }
}

// 地域が未指定の時の既定値。引数の既定値にリテラルを書くとレンダーのたびに新しい
// 配列になり、地域に依存する effect やコールバックの同一性が毎回変わってしまうため、
// 共有の定数にして同一性を安定させる（Issue #129）。
const EMPTY_AREAS: PublicArea[] = []

export function MapPreview({ areas = EMPTY_AREAS, filterRegion = '', filterPrefecture = '', selectedAreaId = '', onSelectArea, showPublicAreas = true, quests = [], questsLoading = false, onOpenQuest, onDeselectQuest, selectedQuestId = '', clearedQuestIds, topOverlay, showBoundaryCredit = false, fillSelectedAreaOnly = false, panelExtra, onSheetModeChange, questScrollTarget, questDetail, viewActive = true }: {
  filterRegion?: string | readonly string[]; filterPrefecture?: string | readonly string[]
  areas?: PublicArea[]; selectedAreaId?: string; onSelectArea?: (areaId: string) => void; showPublicAreas?: boolean
  quests?: PublicQuest[]; questsLoading?: boolean; onOpenQuest?: (questId: string) => void; onDeselectQuest?: () => void; selectedQuestId?: string; clearedQuestIds?: ReadonlySet<string>
  /** 探索画面が前面にあるか。記録画面の表示中は探索側を隠したまま常駐させるため、
      その間は全画面化のシェル（body クラス）を外し、シート表示の通知も止める。
      地図インスタンスやフィット記録は保持し、戻った時にそのまま続きから使える。 */
  viewActive?: boolean
  /** 選択中の問題の詳細。一覧の選択中の行の直下にアコーディオンとして差し込む（D-46）。
      別枠で下に置くとタイトルが二重に出て煩雑になるため、置き場所は一覧の中に寄せる。 */
  questDetail?: ReactNode
  /** シート表示（地図が使えてカード一覧が出ている状態）かどうかを呼び出し側へ知らせる。
      問題の選択手段の出し分け（地図が使える間はカード一覧に一本化し、全件ピッカーは
      地図が使えないフォールバック専用にする、D-43）に使う。 */
  onSheetModeChange?: (sheetMode: boolean) => void
  /** PC幅で地図の下に出ていた内容（問題の選択・詳細・注意書き）をサイドバーのパネル内へ寄せるための追加コンテンツ。
      パネル表示ではサイドバー内、地図が使えない時は通常フローのリスト末尾に出す。シート表示（スマホ幅）では出さない。 */
  panelExtra?: ReactNode
  questScrollTarget?: RefObject<HTMLDivElement | null>
  /** 境界データの出典（国土数値情報 N03）をシート内に小さく出す。共有検証サイトの探索地図でのみ有効にする。 */
  showBoundaryCredit?: boolean
  /** 地域の塗りを「選択中の地域だけ」にする（D-29）。共有検証サイトの探索地図でのみ有効にする。 */
  fillSelectedAreaOnly?: boolean
  /** 地図の上部に浮かせて出す操作（地方・都道府県フィルタ等）。地図が使えない時は地図下の通常フローに出す。 */
  topOverlay?: ReactNode
}) {
  const [clearFilter, setClearFilter] = useState<'all' | 'pending' | 'done'>('all')
  const hasClears = Boolean(clearedQuestIds?.size)
  const activeClearFilter = hasClears ? clearFilter : 'all'
  const visibleQuests = useMemo(() => quests.filter((quest) => activeClearFilter === 'all'
    || (clearedQuestIds?.has(quest.questId) ?? false) === (activeClearFilter === 'done')), [quests, activeClearFilter, clearedQuestIds])
  useEffect(() => {
    if (activeClearFilter !== 'all' && selectedQuestId && !visibleQuests.some((quest) => quest.questId === selectedQuestId)) onDeselectQuest?.()
  }, [activeClearFilter, selectedQuestId, visibleQuests, onDeselectQuest])
  const clearFilterChips = hasClears ? <div className="explore-clear-filters" role="group" aria-label="クリア状況">
    {([['all', 'すべて'], ['pending', '未クリア'], ['done', 'クリア済み']] as const).map(([value, label]) =>
      <button key={value} type="button" aria-pressed={activeClearFilter === value} onClick={() => setClearFilter(value)}>{label}</button>)}
  </div> : undefined
  const target = useRef<HTMLDivElement>(null)
  const map = useRef<MapInstance | null>(null)
  const markersRef = useRef(new Map<string, { marker: MarkerInstance; listeners: Array<{ remove(): void }> }>())
  const markerMapRef = useRef<MapInstance | null>(null)
  const locationMarkerRef = useRef<MarkerInstance | null>(null)
  const dataLayer = useRef<DataLayer | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing' | 'error' | 'auth-error'>(API_KEY ? 'loading' : 'missing')
  const mapShell = useRef<HTMLDivElement>(null)
  const [browseBelowMap, setBrowseBelowMap] = useState(false)
  const [detailLocation, setDetailLocation] = useState<'sheet' | 'belowMap'>('sheet')
  const openQuestFromSheet = useCallback((questId: string) => {
    setBrowseBelowMap(false)
    setDetailLocation('sheet')
    onOpenQuest?.(questId)
  }, [onOpenQuest])
  const openQuestFromBelowMap = useCallback((questId: string) => {
    setDetailLocation('belowMap')
    onOpenQuest?.(questId)
  }, [onOpenQuest])
  const selectMapArea = useCallback((areaId: string) => {
    setBrowseBelowMap(false)
    setDetailLocation('sheet')
    onSelectArea?.(areaId)
  }, [onSelectArea])
  const onUserSheetClosedChange = useCallback((closed: boolean) => {
    setBrowseBelowMap(closed)
    if (!closed) setDetailLocation('sheet')
  }, [])
  // PC幅（981px以上）ではボトムシートを使わず、左サイドバーのパネルに一覧を出す（D-34）。
  const wideViewport = useWideViewport()
  const [zoom, setZoom] = useState(INITIAL_ZOOM)
  const [inactiveMapControls, setInactiveMapControls] = useState<ReadonlySet<string>>(() => new Set())
  const [locationStatus, setLocationStatus] = useState('')
  const [currentLocation, setCurrentLocation] = useState<{ lat: number; lng: number } | null>(null)

  // 結果メッセージは常駐させない。成功は5秒、案内を含む失敗は読む時間を取って
  // 10秒で消す（D-58）。閉じるボタンでも即座に消せる。取得中は確定まで消さない。
  useEffect(() => {
    if (!locationStatus || locationStatus === '現在地取得中') return
    const timeout = window.setTimeout(() => setLocationStatus(''),
      locationStatus.startsWith(LOCATION_SUCCESS_MESSAGE) ? 5000 : 10_000)
    return () => window.clearTimeout(timeout)
  }, [locationStatus])
  // 位置情報の送信案内は常駐させず、そのセッションで初めて現在地を使う時に結果メッセージへ一度だけ添える（D-28）。
  const locationNoticeShown = useRef(false)
  const withLocationNotice = (message: string) => {
    if (locationNoticeShown.current) return message
    locationNoticeShown.current = true
    return `${message} 位置情報をGoogle Mapsに送信`
  }
  const [locating, setLocating] = useState(false)
  const locationRequest = useRef(0)
  const locationTimer = useRef<number | undefined>(undefined)
  const [attempt, setAttempt] = useState(0)
  const [fitRequest, setFitRequest] = useState(0)
  // カメラを寄せる対象の地域。地域が選択されていればその地域、そうでなければ選択中の
  // 問題の所属地域（D-65）。問題を選んでも地域の選択状態は変わらないが、地図の寄せ
  // （D-44）と選択直前カメラの復元は従来どおり問題の所属地域に対しても発生させる。
  // 地域の塗り（D-29）・ピンの選択表示・ピンの再タップ判定は地域選択だけに連動する。
  const selectedQuestAreaId = selectedQuestId ? quests.find((quest) => quest.questId === selectedQuestId)?.areaId ?? '' : ''
  const fitAreaId = selectedAreaId || selectedQuestAreaId
  // フィット対象の同一性。「問題経由で寄せた地域」と「地域として選んだ地域」は同じ
  // 地域でも対象としては区別する：問題選択の後に同じ地域のピンを押したら、選択の
  // 成立に合わせて寄せ直しが起きるようにするため（D-44 の「押したのに移行しない」
  // への対応の考え方を、問題→地域の移行にも保つ）。
  const fitKey = fitAreaId ? `${selectedAreaId ? 'area' : 'quest'}:${fitAreaId}` : ''

  useEffect(() => {
    const instance = map.current
    const Marker = window.google?.maps?.Marker
    if (!instance || !Marker || status !== 'ready' || !currentLocation) return
    try {
      if (locationMarkerRef.current?.setPosition) {
        locationMarkerRef.current.setPosition(currentLocation)
        return
      }
      locationMarkerRef.current?.setMap(null)
      locationMarkerRef.current = new Marker({
        map: instance,
        position: currentLocation,
        title: '現在地',
        clickable: false,
        zIndex: 3,
        icon: {
          path: 'M9 -9 3 9 -1 1 -9 -3 9 -9Z',
          fillColor: '#111827',
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeOpacity: 1,
          strokeWeight: 2,
          scale: 1.4,
        },
      })
    } catch { /* 現在地マークが表示できなくても地図は利用できる。 */ }
  }, [currentLocation, status, attempt])
  useEffect(() => () => {
    try { locationMarkerRef.current?.setMap(null) } catch { /* SDK teardown is best effort. */ }
    locationMarkerRef.current = null
  }, [status, attempt])
  const [areaAttempt, setAreaAttempt] = useState(0)
  const [areaFailed, setAreaFailed] = useState(false)
  const [pinAreaId, setPinAreaId] = useState<string | null>(null)
  const [sheetHeight, setSheetHeight] = useState(SHEET_PEEK_HEIGHT)
  // PC幅サイドバーの開閉（D-36）。その場の操作感を優先し、状態はメモリのみで保持する。
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  // フィット時のパディングは「フィットする時点」の開閉状態で決める。開閉のたびに
  // 再フィットすると地図の中心が動いてしまうため（D-38）、フィット側の effect の
  // 依存には開閉状態を入れず、ref 経由で現在の値だけを読む。
  const sidebarCollapsedRef = useRef(false)
  // フィット済みの対象の記録。対象は「地域の選択」だけではなく「問題の選択」も含む
  // ため、地域IDではなく対象キー（下記の fitKey）で持つ。
  const lastViewportSelection = useRef<{ map: MapInstance; key: string } | null>(null)
  const preSelectionCamera = useRef<{ map: MapInstance; center: { lat: number; lng: number }; zoom: number } | null>(null)
  const initialFitDone = useRef<MapInstance | null>(null)
  // 初期フィットを実行した時点のレイアウトシグネチャ。レイアウト確定側の effect が、
  // 確定後のシグネチャと食い違う時だけ初期フィットを合わせ直すために使う（D-72）。
  const initialFitSignature = useRef<string | null>(null)
  // レイアウト（シート方式／パネル方式）の確定シグネチャ。確定側の effect が記録する。
  const settledLayout = useRef('')
  const lastAreaSelection = useRef<{ map: MapInstance; areaId: string } | null>(null)
  const areaFailureTimer = useRef<number | undefined>(undefined)
  const cancelLocationRequest = (updateState = true) => {
    locationRequest.current += 1
    window.clearTimeout(locationTimer.current)
    locationTimer.current = undefined
    if (updateState) { setLocating(false); setLocationStatus('') }
  }
  const failArea = () => {
    window.clearTimeout(areaFailureTimer.current)
    areaFailureTimer.current = window.setTimeout(() => { areaFailureTimer.current = undefined; setAreaFailed(true) }, 0)
  }
  const cancelInitialAdjustment = useRef<() => void>(() => {})
  // 地図が使える時は全画面マップ＋ボトムシート（sheetMode）、PC幅ではシートの代わりに
  // 左サイドバーのパネルへ同じ一覧を出す（panelMode、D-34）。全画面化の扱いはシートと同じ。
  // フィット系のコールバック（fitInitialAreas）がレイアウトシグネチャの算出に使うため、
  // この位置で定義する。
  // 公開地図シェルが必要な画面では、SDK の成否に関係なく fullbleed 殻を先に出す。
  // ready 待ちだとブート（サイドバー／シート）からヘッダー付き通常シェルへ一瞬戻って崩れる（t165u）。
  // showPublicAreas が無い（地図なし閲覧）は従来どおり通常シェル。
  const mapReady = status === 'ready'
  const sheetMode = showPublicAreas
  // matchMedia の初回が狭い側でも、実幅が PC ならパネルを出す（F5の1コマ目で仮カードが欠けるのを防ぐ）
  const wideByWidth = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia(WIDE_VIEWPORT_QUERY).matches
  const panelMode = sheetMode && (wideViewport || wideByWidth)
  useLayoutEffect(() => {
    const shell = mapShell.current
    const overlay = shell?.querySelector<HTMLElement>('.map-filter-overlay')
    if (!shell || !overlay || panelMode) return
    const update = () => shell.style.setProperty('--map-filter-bottom', `${Math.max(0, overlay.getBoundingClientRect().bottom - shell.getBoundingClientRect().top)}px`)
    update()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    observer?.observe(overlay)
    window.addEventListener('resize', update)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', update)
      shell.style.removeProperty('--map-filter-bottom')
    }
  }, [panelMode, status])
  // Keep controls at peek; sample sheet movement only to disable covered buttons.
  useLayoutEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const media = window.matchMedia('(max-width: 980px)')
    if (!sheetMode || panelMode || !media.matches) return
    const shell = mapShell.current
    const sheet = shell?.querySelector<HTMLElement>('.explore-sheet')
    const controls = shell?.querySelector<HTMLElement>('.map-controls')
    const handle = shell?.querySelector<HTMLButtonElement>('.explore-sheet-handle')
    const buttons = controls ? [...controls.querySelectorAll<HTMLButtonElement>('button')] : []
    if (!sheet || !controls || !buttons.length) return

    const update = () => {
      if (!media.matches) { setInactiveMapControls(new Set()); return }
      const sheetRect = sheet.getBoundingClientRect()
      const shellRect = shell!.getBoundingClientRect()
      const viewportLeft = window.visualViewport?.offsetLeft ?? 0
      const viewportTop = window.visualViewport?.offsetTop ?? 0
      const viewportWidth = window.visualViewport?.width ?? window.innerWidth
      const viewportHeight = window.visualViewport?.height ?? window.innerHeight
      const visibleBounds = {
        left: Math.max(viewportLeft, shellRect.left), top: Math.max(viewportTop, shellRect.top),
        right: Math.min(viewportLeft + viewportWidth, shellRect.right), bottom: Math.min(viewportTop + viewportHeight, shellRect.bottom),
        width: Math.max(0, Math.min(viewportLeft + viewportWidth, shellRect.right) - Math.max(viewportLeft, shellRect.left)),
        height: Math.max(0, Math.min(viewportTop + viewportHeight, shellRect.bottom) - Math.max(viewportTop, shellRect.top)),
      }
      const headerBottom = document.querySelector('.site-header')?.getBoundingClientRect().bottom ?? 0
      const filterBottom = shell?.querySelector('.filter-toggle')?.getBoundingClientRect().bottom ?? 0
      const placement = mapControlsPlacement(shellRect.bottom, sheetRect.top, controls.getBoundingClientRect().height,
        Math.max(visibleBounds.top, headerBottom, filterBottom) + 12,
        SHEET_PEEK_HEIGHT + (Number.parseFloat(getComputedStyle(shell!).getPropertyValue('--mobile-tabbar-h')) || 64))
      controls.style.bottom = `${placement.bottom}px`
      controls.style.visibility = placement.hidden ? 'hidden' : ''
      const inactiveLabels = new Set<string>()
      for (const button of buttons) {
        const rect = button.getBoundingClientRect()
        const label = button.getAttribute('aria-label') ?? ''
        const available = isMapControlWithin(rect, visibleBounds)
        const covered = available && isMapControlFullyCovered(rect, sheetRect)
        if (placement.hidden || !available || covered) {
          if (document.activeElement === button) handle?.focus({ preventScroll: true })
          inactiveLabels.add(label)
        }
      }
      setInactiveMapControls((current) => current.size === inactiveLabels.size && [...current].every((label) => inactiveLabels.has(label)) ? current : inactiveLabels)
    }
    update()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    observer?.observe(sheet)
    observer?.observe(controls)
    let animationFrame = 0
    const sampleTransition = () => {
      update()
      if (animationFrame) animationFrame = window.requestAnimationFrame(sampleTransition)
    }
    const onTransitionRun = (event: TransitionEvent) => {
      if (event.propertyName !== 'height' || animationFrame) return
      animationFrame = window.requestAnimationFrame(sampleTransition)
    }
    const stopTransitionSampling = (event: TransitionEvent) => {
      if (event.propertyName !== 'height') return
      if (animationFrame) window.cancelAnimationFrame(animationFrame)
      animationFrame = 0
      update()
    }
    sheet.addEventListener('transitionrun', onTransitionRun)
    sheet.addEventListener('transitionend', stopTransitionSampling)
    sheet.addEventListener('transitioncancel', stopTransitionSampling)
    const onViewportChange = () => update()
    window.addEventListener('resize', onViewportChange)
    window.addEventListener('scroll', onViewportChange, true)
    window.visualViewport?.addEventListener('resize', onViewportChange)
    window.visualViewport?.addEventListener('scroll', onViewportChange)
    media.addEventListener('change', onViewportChange)
    return () => {
      observer?.disconnect()
      controls.style.removeProperty('bottom')
      controls.style.removeProperty('visibility')
      if (animationFrame) window.cancelAnimationFrame(animationFrame)
      sheet.removeEventListener('transitionrun', onTransitionRun)
      sheet.removeEventListener('transitionend', stopTransitionSampling)
      sheet.removeEventListener('transitioncancel', stopTransitionSampling)
      window.removeEventListener('resize', onViewportChange)
      window.removeEventListener('scroll', onViewportChange, true)
      window.visualViewport?.removeEventListener('resize', onViewportChange)
      window.visualViewport?.removeEventListener('scroll', onViewportChange)
      media.removeEventListener('change', onViewportChange)
      setInactiveMapControls(new Set())
    }
  }, [sheetMode, panelMode, status, sheetHeight, zoom, locating])
  // 地域の範囲へ地図をフィットさせる共通処理。選択時フィットと、再タップ時の再フィットで使う。
  // 地図の上に重なる帯・チップ・シート等の分をパディングとして差し引き、選んだ地域が
  // 実際に見えている領域の中央に来るようにする。
  const fitToArea = useCallback((instance: MapInstance, area: PublicArea): boolean => {
    cancelInitialAdjustment.current()
    const google = window.google?.maps
    if (!google?.LatLngBounds) return false
    const points = areaFitPoints(area)
    if (!points) return false
    const bounds = new google.LatLngBounds()
    points.forEach((point) => bounds.extend(point))
    if (showPublicAreas) {
      // スマホ幅の選択フィットでは、選択でシートが half まで開く前提で下パディングを
      // 見積もる（D-70）。peek 前提のままだと、開いたシートの裏にピンが隠れる。
      // ステージの高さは地図キャンバスの実高から取り、half の定義（ExploreBottomSheet の
      // snapHeights）と揃える。読めない時は peek 前提に倒す。
      const stageHeight = target.current?.clientHeight ?? 0
      const sheetFitHeight = Math.max(SHEET_PEEK_HEIGHT, Math.round(stageHeight * 0.55))
      instance.fitBounds(bounds, visibleAreaFitPadding(wideViewport, sidebarCollapsedRef.current, wideViewport ? undefined : sheetFitHeight, Math.max(0, mobileHeaderClearance() - (mapShell.current?.getBoundingClientRect().top ?? 0))))
    } else instance.fitBounds(bounds)
    clampFitZoomOnIdle(instance)
    return true
  }, [showPublicAreas, wideViewport])
  // 初期表示のフィット（ピンが立つ地域全体を「実際に見えている領域」へ収める）。
  // マーカー生成時の初回と、レイアウト確定後に実サイズへ合わせ直す時（D-72）の
  // 両方から使う。フィットした時点のレイアウトシグネチャを記録しておき、確定側は
  // 「確定前のシグネチャでフィット済み」の時だけ合わせ直す（同じ確定では二度直さない）。
  const fitInitialAreas = useCallback((instance: MapInstance): boolean => {
    const google = window.google?.maps
    if (!google?.LatLngBounds) return false
    const bounds = new google.LatLngBounds()
    let fitted = false
    const filterBounds = boundsForFilter(filterRegion, filterPrefecture)
    if (filterBounds) {
      for (const lat of [filterBounds.south, filterBounds.north]) {
        for (const lng of [filterBounds.west, filterBounds.east]) bounds.extend({ lat, lng })
      }
      fitted = true
    }
    for (const area of filterBounds ? [] : areas) {
      if (area.publishedCount < 1) continue
      const position = areaPinPosition(area)
      if (!position) continue
      bounds.extend(position)
      fitted = true
    }
    if (!fitted) return false
    cancelInitialAdjustment.current()
    if (!wideViewport && !panelMode) {
      const shell = mapShell.current
      let active = true
      const listeners: Array<{ remove(): void }> = []
      const cancel = () => {
        active = false
        listeners.forEach((listener) => listener.remove())
        shell?.removeEventListener('pointerdown', cancel, true)
        shell?.removeEventListener('wheel', cancel, true)
        shell?.removeEventListener('keydown', cancel, true)
      }
      cancelInitialAdjustment.current = cancel
      listeners.push(instance.addListener('dragstart', cancel))
      // wheel / pinch / controls も含め、利用者の操作以降は遅延補正しない。
      shell?.addEventListener('pointerdown', cancel, { once: true, capture: true })
      shell?.addEventListener('wheel', cancel, { once: true, capture: true })
      shell?.addEventListener('keydown', cancel, { once: true, capture: true })
      listeners.push(instance.addListener('idle', () => {
        if (!active) return
        cancelInitialAdjustment.current()
        if (instance.getZoom() !== MIN_ZOOM || !shell || !instance.panBy) return
        const projection = instance.getProjection?.()
        const mapBounds = instance.getBounds?.()
        if (!projection || !mapBounds) return
        const north = projection.fromLatLngToPoint(mapBounds.getNorthEast())
        const west = projection.fromLatLngToPoint(mapBounds.getSouthWest())
        if (!north || !west) return
        const anchors = areas.filter((area) => area.publishedCount > 0).flatMap((area) => {
          const position = areaPinPosition(area)
          const point = position && projection.fromLatLngToPoint(position)
          return point ? [{
            x: (point.x - west.x) * 2 ** MIN_ZOOM,
            y: projectedAnchorY(point.y, north.y, MIN_ZOOM),
          }] : []
        })
        const rect = shell.getBoundingClientRect()
        const obstacles = Array.from(document.querySelectorAll(
          '.site-header .brand, .account-area, .filter-toggle',
        )).flatMap((element) => {
          const obstacle = element.getBoundingClientRect()
          const style = getComputedStyle(element)
          if (!obstacle.width || !obstacle.height || style.visibility === 'hidden' || style.display === 'none') return []
          return [{ left: obstacle.left - rect.left, right: obstacle.right - rect.left, bottom: obstacle.bottom - rect.top }]
        })
        // peek の実寸168pxと下部ナビ64px。fitBounds の追加余白20pxはここでは不要。
        const tabbar = Number.parseFloat(getComputedStyle(document.querySelector('.mobile-nav') ?? shell).height)
        const bottom = rect.height - SHEET_PEEK_HEIGHT - (document.querySelector('.mobile-nav') && Number.isFinite(tabbar) ? tabbar : 64)
        const shift = initialPinShift(anchors, obstacles, bottom)
        if (Math.abs(shift) > 0.5) instance.panBy(0, -shift)
      }))
    }
    instance.fitBounds(bounds, visibleAreaFitPadding(wideViewport, sidebarCollapsedRef.current, undefined, Math.max(0, mobileHeaderClearance() - (mapShell.current?.getBoundingClientRect().top ?? 0))))
    clampFitZoomOnIdle(instance)
    initialFitDone.current = instance
    initialFitSignature.current = `${sheetMode}:${panelMode}`
    return true
  }, [areas, filterRegion, filterPrefecture, wideViewport, sheetMode, panelMode])
  useEffect(() => {
    if (!API_KEY || !target.current) return
    let active = true
    let authFailed = false
    let zoomListener: { remove(): void } | undefined
    const unsubscribeAuth = subscribeMapsAuthFailure(() => {
      authFailed = true
      if (active) { cancelLocationRequest(); map.current = null; setStatus('auth-error') }
    })
    void loadGoogleMaps(API_KEY).then((google) => {
      if (!active || authFailed || !target.current) return
      let instance: MapInstance
      try {
        instance = new google.Map(target.current, {
          center: JAPAN, zoom: INITIAL_ZOOM, minZoom: MIN_ZOOM, maxZoom: MAX_ZOOM,
          disableDefaultUI: true, mapTypeControl: false, streetViewControl: false,
          fullscreenControl: false, clickableIcons: false, gestureHandling: 'greedy',
          // Maps の初期灰色キャンバスを挟まないよう、ブート／殻と同じ水色で塗る。
          backgroundColor: '#c5e8f5',
          styles: MAP_STYLES,
        }) as MapInstance
        if (authFailed) return
        map.current = instance
        try {
          const layer = new google.Data()
          layer.setMap(instance)
          dataLayer.current = layer
        } catch { failArea() }
        zoomListener = instance.addListener('zoom_changed', () => {
          if (active) setZoom(instance.getZoom() ?? 5)
        })
        setStatus('ready')
      } catch {
        if (active) setStatus('error')
        return
      }
    }).catch((error: unknown) => { if (active) setStatus(error instanceof Error && error.message === 'auth' ? 'auth-error' : 'error') })
    return () => {
      active = false
      cancelInitialAdjustment.current()
      cancelLocationRequest(false)
      window.clearTimeout(areaFailureTimer.current)
      unsubscribeAuth()
      try { zoomListener?.remove() } catch { /* SDK teardown is best effort. */ }
      try { dataLayer.current?.setMap(null) } catch { /* SDK teardown is best effort. */ }
      dataLayer.current = null
      map.current = null
    }
  }, [attempt])

  useEffect(() => {
    let layer = dataLayer.current
    if (!layer && status === 'ready' && showPublicAreas && API_KEY && map.current && window.google?.maps) {
      try { layer = new window.google.maps.Data(); layer.setMap(map.current); dataLayer.current = layer }
      catch { failArea(); return }
    }
    if (!layer) return
    let active = true
    let listener: { remove(): void } | undefined
    try {
      window.clearTimeout(areaFailureTimer.current)
      areaFailureTimer.current = undefined
      layer.setMap(null)
      layer.forEach((feature) => layer.remove(feature))
      if (!showPublicAreas || status !== 'ready') return () => { active = false }
      const features = areas.flatMap((area) => {
        const geometry = area.publicGeometry
        const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
        const valid = polygons.filter((polygon) => polygon.length > 0 && polygon.every((ring) => {
          if (ring.length < 4) return false
          const validPoints = ring.every(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat) && Math.abs(lng) <= 180 && Math.abs(lat) <= 90)
          const [firstLng, firstLat] = ring[0]
          const [lastLng, lastLat] = ring[ring.length - 1]
          return validPoints && firstLng === lastLng && firstLat === lastLat
        }))
        if (!valid.length) return []
        return [{ type: 'Feature' as const, id: area.areaId, properties: { areaId: area.areaId },
          geometry: { type: geometry.type, coordinates: geometry.type === 'Polygon' ? valid[0] : valid } }]
      })
      if (!features.length) return () => { active = false }
      layer.setMap(map.current)
      layer.addGeoJson({ type: 'FeatureCollection', features })
      layer.setStyle((feature) => {
        const selected = feature.getProperty('areaId') === selectedAreaId
        // D-29: 選択中の地域だけ塗るモードでは、未選択の地域は塗りも枠線も出さずピンだけにする。
        if (fillSelectedAreaOnly && !selected) {
          return { fillColor: PIN_COLOR, fillOpacity: 0, strokeColor: PIN_STROKE, strokeOpacity: 0, strokeWeight: 0, clickable: false }
        }
        return {
          fillColor: selected ? PIN_SELECTED_COLOR : PIN_COLOR,
          fillOpacity: selected ? 0.55 : 0.25,
          strokeColor: PIN_STROKE, strokeOpacity: 0.9, strokeWeight: selected ? 3 : 1.5,
          clickable: true,
        }
      })
      listener = layer.addListener('click', (event) => {
        const areaId = event.feature.getProperty('areaId')
        if (!active || typeof areaId !== 'string') return
        const area = areas.find((candidate) => candidate.areaId === areaId)
        if (!area) return
        setPinAreaId(null); selectMapArea(areaId)
      })
    } catch {
      active = false
      try { listener?.remove(); layer.setMap(null); layer.forEach((feature) => layer.remove(feature)) } catch { /* Keep the base map usable. */ }
      failArea()
    }
    return () => { active = false; window.clearTimeout(areaFailureTimer.current); areaFailureTimer.current = undefined; try { listener?.remove(); layer.setMap(null) } catch { /* SDK teardown is best effort. */ } }
  }, [areas, selectedAreaId, selectMapArea, showPublicAreas, status, areaAttempt, fillSelectedAreaOnly])

  const clearMarkers = useCallback(() => {
    for (const entry of markersRef.current.values()) {
      for (const listener of entry.listeners) { try { listener.remove() } catch { /* SDK teardown is best effort. */ } }
      try { entry.marker.setMap(null) } catch { /* SDK teardown is best effort. */ }
    }
    markersRef.current.clear()
    markerMapRef.current = null
  }, [])
  // 同期effectの再実行では撤去しない。地図の終了・非表示時だけ全撤去する。
  useEffect(() => clearMarkers, [clearMarkers, status, showPublicAreas, attempt])

  useEffect(() => {
    const instance = map.current
    const google = window.google?.maps
    if (!API_KEY || !instance || !google?.Marker || !showPublicAreas || status !== 'ready') return
    if (markerMapRef.current !== instance) {
      clearMarkers()
      markerMapRef.current = instance
    }
    const desiredKeys = new Set<string>()
    const syncMarker = (key: string, options: Record<string, unknown>) => {
      desiredKeys.add(key)
      const previous = markersRef.current.get(key)
      let marker = previous?.marker
      for (const listener of previous?.listeners ?? []) listener.remove()
      if (marker?.setOptions) marker.setOptions(options)
      else if (marker?.setIcon && marker.setPosition && marker.setTitle && marker.setZIndex) {
        marker.setIcon(options.icon as { url: string })
        marker.setPosition(options.position as { lat: number; lng: number })
        marker.setTitle(options.title as string)
        marker.setZIndex(options.zIndex as number)
      } else {
        marker?.setMap(null)
        marker = new google.Marker!(options)
      }
      const listeners: Array<{ remove(): void }> = []
      markersRef.current.set(key, { marker, listeners })
      return { marker, listeners }
    }
    try {
      // 現在のズームで画面上重なるピンはクラスタにまとめる（D-52）。フィット対象の
      // 地域（選択中の地域／選択中の問題の所属地域）のピンはクラスタに隠さず常に
      // 対象外とする。まとめ直しはズームが変わるたびにこの効果が担う。
      const emphasizedIds = new Set(getRegionAreas(areas, filterRegion, filterPrefecture).map((area) => area.areaId))
      const pinPoints = []
      const areaById = new Map<string, PublicArea>()
      for (const area of areas) {
        if (area.publishedCount < 1) continue
        if (activeClearFilter !== 'all' && !visibleQuests.some((quest) => quest.areaId === area.areaId)) continue
        const position = areaPinPosition(area)
        if (!position) continue
        pinPoints.push({ areaId: area.areaId, lat: position.lat, lng: position.lng, questCount: activeClearFilter === 'all' ? area.publishedCount : visibleQuests.filter((quest) => quest.areaId === area.areaId).length })
        areaById.set(area.areaId, area)
      }
      for (const arrangement of arrangePins(pinPoints, instance.getZoom() ?? zoom, fitAreaId)) {
        if (arrangement.kind === 'cluster') {
          const dimmed = arrangement.points.every((point) => !emphasizedIds.has(point.areaId))
          const key = `cluster:${arrangement.points.map((point) => point.areaId).sort().join(',')}`
          const { marker, listeners } = syncMarker(key, {
            position: { lat: arrangement.lat, lng: arrangement.lng }, map: instance,
            title: `重なっている${arrangement.points.length}地域 ${arrangement.totalQuests}問`,
            icon: clusterIcon(arrangement.totalQuests, dimmed),
            cursor: 'pointer',
            zIndex: dimmed ? 0 : 1,
          })
          listeners.push(marker.addListener('click', () => {
            if (markersRef.current.get(key)?.marker !== marker || !google.LatLngBounds) return
            // クラスタを押したら、中の地域がバラけて見える位置・ズームへ寄せる（対象地域群へのフィット）。
            const bounds = new google.LatLngBounds()
            let fitted = false
            for (const point of arrangement.points) {
              const member = areaById.get(point.areaId)
              const fitPoints = member ? areaFitPoints(member) : null
              if (fitPoints) for (const fitPoint of fitPoints) { bounds.extend(fitPoint); fitted = true }
              else { bounds.extend({ lat: point.lat, lng: point.lng }); fitted = true }
            }
            if (fitted) { instance.fitBounds(bounds, visibleAreaFitPadding(wideViewport, sidebarCollapsedRef.current, undefined, Math.max(0, mobileHeaderClearance() - (mapShell.current?.getBoundingClientRect().top ?? 0)))); clampFitZoomOnIdle(instance) }
          }))
          continue
        }
        const area = areaById.get(arrangement.point.areaId)
        if (!area) continue
        const position = { lat: arrangement.point.lat, lng: arrangement.point.lng }
        const selected = area.areaId === selectedAreaId
        const dimmed = !selected && !emphasizedIds.has(area.areaId)
        // 地域内がすべてクリア済みなら緑、それ以外の選択・強調は従来どおり。
        const areaQuests = visibleQuests.filter((quest) => quest.areaId === area.areaId)
        const cleared = areaQuests.length > 0 && (activeClearFilter !== 'all' || areaQuests.length >= area.publishedCount) && areaQuests.every((quest) => clearedQuestIds?.has(quest.questId))
        const pinColor = cleared ? PIN_CLEARED_COLOR : selected ? PIN_ACTIVE_COLOR : PIN_COLOR
        const pinCount = arrangement.point.questCount
        const key = `pin:${area.areaId}`
        const { marker, listeners } = syncMarker(key, {
          position, map: instance,
          title: `${area.label} ${pinCount}問`,
          icon: pinIcon(pinColor, pinCount, selected && cleared, dimmed, cleared),
          cursor: 'pointer',
          zIndex: selected ? 3 : dimmed ? 0 : 2,
        })
        listeners.push(marker.addListener('click', () => {
          if (markersRef.current.get(key)?.marker !== marker) return
          setPinAreaId((current) => (current === area.areaId ? null : area.areaId))
          // 絞り込み外の薄いピンも、通常のピンと同じ onSelectArea で選択できる。
          selectMapArea(area.areaId)
        }))
        // Google Maps のポインタイベントに任せ、PC・タッチ端末で共通の強調表示を行う。
        if (marker.setIcon) {
          listeners.push(marker.addListener('mouseover', () => {
            if (markersRef.current.get(key)?.marker === marker) marker.setIcon?.(pinIcon(pinColor, pinCount, true, false, cleared))
          }))
          listeners.push(marker.addListener('mouseout', () => {
            if (markersRef.current.get(key)?.marker === marker) marker.setIcon?.(pinIcon(pinColor, pinCount, false, dimmed))
          }))
        }
      }
      for (const [key, entry] of markersRef.current) {
        if (desiredKeys.has(key)) continue
        for (const listener of entry.listeners) listener.remove()
        entry.marker.setMap(null)
        markersRef.current.delete(key)
      }
      // 初期表示は、ピンが立つ地域全体が「実際に見えている領域」に収まるよう一度だけフィットする。
      if (initialFitDone.current !== instance && !fitAreaId) fitInitialAreas(instance)
    } catch { /* ピンは補助表示のため、失敗しても地図本体は使える状態を保つ。 */ }

  }, [visibleQuests, activeClearFilter, clearedQuestIds, areas, filterRegion, filterPrefecture, selectedAreaId, fitAreaId, selectMapArea, showPublicAreas, status, areaAttempt, attempt, wideViewport, zoom, fitInitialAreas, clearMarkers])

  useEffect(() => {
    const instance = map.current
    const google = window.google?.maps
    if (!API_KEY || !instance || !google || !showPublicAreas || status !== 'ready') return
    if (lastAreaSelection.current?.map === instance && lastAreaSelection.current.areaId !== selectedAreaId) cancelLocationRequest()
    lastAreaSelection.current = { map: instance, areaId: selectedAreaId }
    if (lastViewportSelection.current?.map === instance && lastViewportSelection.current.key === fitKey) return
    if (!fitAreaId) {
      // 選択解除では初期表示へ戻さず、選択直前のカメラを復元する。選択後に手動で動かしていても、
      // 解除時は選択前の状態へ戻す（「選ぶ前の地図に戻る」を単純な仕様として採る）。
      const saved = preSelectionCamera.current
      if (saved && saved.map === instance) {
        cancelInitialAdjustment.current()
        instance.setCenter(saved.center)
        instance.setZoom(saved.zoom)
        preSelectionCamera.current = null
      } else if (lastViewportSelection.current?.map === instance && lastViewportSelection.current.key !== '') {
        // この地図で選択が実際に処理された後の解除で、直前カメラが読めなかった時だけ
        // 初期表示（日本中心）へ戻す。
        cancelInitialAdjustment.current()
        instance.setCenter(JAPAN); instance.setZoom(INITIAL_ZOOM)
      }
      // 初期マウント時（この地図でまだ選択が処理されていない時）はカメラに触らない。
      // 初期カメラはマーカー側の初期フィットが決めるもので、ここで日本中心＋初期ズームを
      // 書くと、同じコミットで走る初期フィットと競合して初期表示が崩れた（D-72）。
      lastViewportSelection.current = { map: instance, key: '' }
      return
    }
    // フィット対象が無い状態から移る時だけ、フィット直前のカメラを覚える。対象の
    // 切替（地域A→B、問題→別の問題、問題→その所属地域の選択）では上書きせず、
    // 解除時に「最初に選ぶ前」の状態へ戻れるようにする。
    const previousSelection = lastViewportSelection.current
    if (!previousSelection || previousSelection.map !== instance || previousSelection.key === '') {
      try {
        const center = instance.getCenter?.()
        if (center) preSelectionCamera.current = { map: instance, center: { lat: center.lat(), lng: center.lng() }, zoom: instance.getZoom() ?? INITIAL_ZOOM }
      } catch { /* カメラが読めない時は復元を諦め、解除時は従来どおり初期表示へ戻す。 */ }
    }
    try {
      const area = areas.find((candidate) => candidate.areaId === fitAreaId)
      if (!area) return
      if (!fitToArea(instance, area)) return
      initialFitDone.current = instance
      lastViewportSelection.current = { map: instance, key: fitKey }
    } catch { failArea() }
  }, [selectedAreaId, fitAreaId, fitKey, areas, showPublicAreas, status, areaAttempt, wideViewport, fitRequest, fitToArea])

  // D-60: ピン数によらず静的な都道府県／地方全体へフィットする。
  // 選択中の地域・問題へのフィットを優先し、解除時は全ピンへ戻す。
  const lastAreasKey = useRef<{ map: MapInstance; key: string } | null>(null)
  useEffect(() => {
    const instance = map.current
    if (!API_KEY || !instance || status !== 'ready' || areas.length === 0) return
    const regionKey = Array.isArray(filterRegion) ? filterRegion.join(',') : filterRegion
    const prefectureKey = Array.isArray(filterPrefecture) ? filterPrefecture.join(',') : filterPrefecture
    const key = `${regionKey}:${prefectureKey}:${areas.map((area) => area.areaId).sort().join(',')}`
    const previous = lastAreasKey.current
    lastAreasKey.current = { map: instance, key }
    if (!previous || previous.map !== instance || previous.key === key || fitAreaId) return
    fitInitialAreas(instance)
  }, [areas, filterRegion, filterPrefecture, fitAreaId, status, fitInitialAreas])

  const changeZoom = (delta: number) => map.current?.setZoom(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, (map.current.getZoom() ?? zoom) + delta)))
  const reset = () => { cancelLocationRequest(); setLocationStatus(''); map.current?.setCenter(JAPAN); map.current?.setZoom(INITIAL_ZOOM) }
  const locate = () => {
    if (locating) return
    const geolocation = navigator.geolocation
    if (!geolocation?.getCurrentPosition) { setLocationStatus('現在地非対応'); return }
    const request = ++locationRequest.current
    const requestedMap = map.current
    setLocationStatus('現在地取得中')
    setLocating(true)
    const settle = (message: string) => {
      if (request !== locationRequest.current) return
      locationRequest.current += 1
      window.clearTimeout(locationTimer.current)
      locationTimer.current = undefined
      setLocating(false)
      setLocationStatus(withLocationNotice(message))
    }
    locationTimer.current = window.setTimeout(() => settle('現在地取得失敗'), LOCATION_DEADLINE_MS)
    try {
      geolocation.getCurrentPosition((position) => {
        if (request !== locationRequest.current) return
        const { latitude, longitude } = position.coords
        if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
          settle('現在地取得失敗')
          return
        }
        if (!requestedMap || map.current !== requestedMap) { settle('現在地取得失敗'); return }
        requestedMap.setCenter({ lat: latitude, lng: longitude })
        requestedMap.setZoom(LOCATION_ZOOM)
        setCurrentLocation({ lat: latitude, lng: longitude })
        settle(LOCATION_SUCCESS_MESSAGE)
      }, (error) => {
        const message = error.code === 1 ? '位置情報未許可。サイト設定で許可'
          : error.code === 3 ? '現在地取得失敗'
            : '現在地取得失敗'
        settle(message)
      }, { enableHighAccuracy: false, maximumAge: 0, timeout: LOCATION_DEADLINE_MS })
    } catch { settle('現在地取得失敗') }
  }

  // ピン以外（地域セレクト等）で別の地域が選ばれたら、ピンのハイライトは外れたものとして扱う。
  const previousSelectedArea = useRef(selectedAreaId)
  useEffect(() => {
    if (previousSelectedArea.current && !selectedAreaId) setPinAreaId(null)
    previousSelectedArea.current = selectedAreaId
  }, [selectedAreaId])
  const effectivePinAreaId = pinAreaId && (!selectedAreaId || selectedAreaId === pinAreaId) ? pinAreaId : null
  const sheetOpenSignal = effectivePinAreaId
    ? `${effectivePinAreaId}:${selectedQuestId}`
    : selectedQuestId ? `quest:${selectedQuestId}` : null
  const highlightArea = effectivePinAreaId ? areas.find((area) => area.areaId === effectivePinAreaId) : undefined
  // 一覧は選択（地域・地方の絞り込み）だけに連動し、地図の表示範囲では変わらない（D-45）。
  // 絞り込みは呼び出し側が済ませた quests をそのまま並べる。
  // 地図が使える時は全画面マップ＋ボトムシート、使えない時は従来どおり地図下の全件リスト。
  // シート表示は問題の件数に依存させない。絞り込みで0件になってもシートと全画面を維持し、空表示を出す。
  // （sheetMode／panelMode の定義は、フィット系のコールバックが使うため前方の
  // フィット共通処理の前に置く。）
  const belowMap = sheetMode && !panelMode && browseBelowMap
  const mapControlGesture = useRef<{ pointerId: number; x: number; y: number; moved: boolean } | null>(null)
  const mapControlGestureProps = {
    onPointerDownCapture: (event: ReactPointerEvent<HTMLElement>) => {
      mapControlGesture.current = event.pointerType === 'touch'
        ? { pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false }
        : null
    },
    onPointerMoveCapture: (event: ReactPointerEvent<HTMLElement>) => {
      const gesture = mapControlGesture.current
      if (gesture?.pointerId === event.pointerId && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 8) gesture.moved = true
    },
    onPointerCancelCapture: () => { mapControlGesture.current = null },
    onClickCapture: (event: ReactMouseEvent<HTMLElement>) => {
      const gesture = mapControlGesture.current
      mapControlGesture.current = null
      // タッチスワイプ後に合成される誤クリックだけを抑え、タップとキーボード操作は残す。
      if (gesture?.moved && event.detail !== 0) {
        event.preventDefault()
        event.stopPropagation()
      }
    },
  }
  const [pastMap, setPastMap] = useState(false)
  const updateMapScrollPosition = useCallback(() => {
    const bottom = mapShell.current?.getBoundingClientRect().bottom
    setPastMap(bottom !== undefined && bottom <= mobileHeaderClearance() + 1)
  }, [])
  useEffect(() => {
    const update = updateMapScrollPosition
    update()
    window.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [sheetMode, panelMode, belowMap, updateMapScrollPosition])
  const returnToMap = () => {
    setBrowseBelowMap(false)
    setDetailLocation('sheet')
    mapShell.current?.focus({ preventScroll: true })
    mapShell.current?.scrollIntoView?.({ block: 'start' })
  }
  // 詳細（questDetail）は一覧の選択中の行の直下にだけ差し込む。同時に2か所へは出さない
  // （状態を持つ詳細が二重にマウントされるのを避けるため）。地図下一覧が表示中なら
  // そちらへ寄せ、シートと地図下で詳細を二重にマウントしない。
  // 読み込み中の一覧（仮の行）は、最終的な置き場所であるシート／パネルの中でのみ出す。
  // 地図の読み込み中に通常フロー側へ先に出すと、地図の準備完了で置き場所が移り、
  // 一覧が作り直されて見た目が跳ねるため。
  const renderQuestList = (scrollToHighlight = true, withDetail = false, inSheetOrPanel = false, discardClosingDetail = false, openQuest = onOpenQuest) => showPublicAreas && (sheetMode || quests.length > 0 || (inSheetOrPanel && questsLoading)) ? <ExploreQuestList areas={areas} quests={visibleQuests} filters={clearFilterChips} loading={questsLoading}
    highlightArea={highlightArea} selectedQuestId={selectedQuestId} clearedQuestIds={clearedQuestIds}
    scrollToHighlight={scrollToHighlight}
    detailContent={withDetail ? questDetail : undefined} detailRef={questScrollTarget} discardClosingDetail={discardClosingDetail}
    detailOwner={detailLocation} onOpenQuest={openQuest} onDeselectQuest={onDeselectQuest} /> : null
  // 境界データの出典表記（N03 の利用条件）。短い文言で、パネル／シートの一番下に小さく出す（D-46）。
  // 登録年度が公開応答に載っている地域があれば、その年度を出典に含める（D-71）。
  const boundaryYears = [...new Set(areas.flatMap((area) => area.boundary?.source === 'N03' ? [area.boundary.year] : []))].sort((a, b) => a - b)
  const boundaryCreditText = boundaryYears.length === 1
    ? `境界データ：国土数値情報N03-${boundaryYears[0]} 国土交通省`
    : boundaryYears.length > 1
      ? `境界データ：国土数値情報N03 ${boundaryYears.join('・')}年 国土交通省`
      : '境界データ：国土数値情報N03 国土交通省'
  const boundaryCredit = showBoundaryCredit && showPublicAreas
    ? <p className="map-boundary-credit">{boundaryCreditText}</p>
    : null
  const mapControls = status === 'ready' ? <div className="map-controls" {...mapControlGestureProps}>
    <div className="map-zoom" aria-label="地図の表示操作">
      <div className="map-zoom-group">
        <button type="button" aria-label="地図を拡大" disabled={zoom >= MAX_ZOOM || inactiveMapControls.has('地図を拡大')} inert={inactiveMapControls.has('地図を拡大')} aria-hidden={inactiveMapControls.has('地図を拡大')} onClick={() => changeZoom(1)}><Icon name="plus" /></button>
        <button type="button" aria-label="地図を縮小" disabled={zoom <= MIN_ZOOM || inactiveMapControls.has('地図を縮小')} inert={inactiveMapControls.has('地図を縮小')} aria-hidden={inactiveMapControls.has('地図を縮小')} onClick={() => changeZoom(-1)}><Icon name="minus" /></button>
        <button type="button" aria-label="地図の表示を戻す" disabled={inactiveMapControls.has('地図の表示を戻す')} inert={inactiveMapControls.has('地図の表示を戻す')} aria-hidden={inactiveMapControls.has('地図の表示を戻す')} onClick={reset}><Icon name="reset" /></button>
      </div>
    </div>
    <button type="button" className="map-locate-fab" aria-label="現在地へ戻る" title="現在地へ戻る" disabled={locating || inactiveMapControls.has('現在地へ戻る')} inert={inactiveMapControls.has('現在地へ戻る')} aria-hidden={inactiveMapControls.has('現在地へ戻る')} onClick={locate}><Icon name="locate" /></button>
  </div> : null

  // 公開地図シェルの間は縁なし fullbleed にする（地図の ready 前から。ブートと形を揃える）。
  // シェル側（ヘッダー・下部ナビ等）の浮動配置は App.css がこのクラスとメディアクエリで切り替える。
  // 記録画面の表示中（viewActive でない間）は探索が前面にないため付けない。
  // useLayoutEffect：最初の描画前にクラスを付け、ブート→React でトップヘッダー型が一瞬出るのを防ぐ。
  useLayoutEffect(() => {
    if (!sheetMode || !viewActive) return
    document.body.classList.add('explore-fullbleed')
    return () => { document.body.classList.remove('explore-fullbleed') }
  }, [sheetMode, viewActive])

  // シート表示かどうかを呼び出し側へ知らせる（D-43）。コールバックの同一性に依存しないよう
  // ref 経由で最新のものを呼び、アンマウント時は「地図は使えない」側へ戻す。地図が無い画面
  // （記録画面や、フォールバックが本文になる永続側）でピッカーが消えたままにならないため。
  const sheetModeChangeRef = useRef(onSheetModeChange)
  useEffect(() => { sheetModeChangeRef.current = onSheetModeChange }, [onSheetModeChange])
  // 一覧の置き場を殻側へ渡す合図。loading／ready のあいだは true にして、呼び出し側の
  // 大きな読み込みカードや全件ピッカーを抑え、パネル／シートのスケルトンを一本化する。
  // missing／error／auth-error では false に戻し、地図が使えない画面ではピッカーを出す（D-43）。
  // 殻の fullbleed 自体は sheetMode（showPublicAreas）で先に出す。
  const listShellActive = sheetMode && viewActive && (status === 'loading' || status === 'ready')
  useLayoutEffect(() => { sheetModeChangeRef.current?.(listShellActive) }, [listShellActive])
  useEffect(() => () => { sheetModeChangeRef.current?.(false) }, [])

  // 隠れていた探索が前面に戻ったら、地図コンテナの大きさが戻る。Google Maps は
  // 中心・ズームを保持するため、サイズの再認識だけを促せば表示が復帰する。
  const wasViewActive = useRef(viewActive)
  useEffect(() => {
    const becameActive = viewActive && !wasViewActive.current
    wasViewActive.current = viewActive
    if (!becameActive || !sheetMode) return
    const instance = map.current
    if (!instance) return
    try { window.google?.maps?.event.trigger?.(instance, 'resize') } catch { /* サイズ再認識は補助であり、失敗しても地図は使える。 */ }
  }, [viewActive, sheetMode])

  // レイアウトが確定する遷移（全画面化・サイドバー方式への切替）では地図コンテナの
  // 大きさが変わる。コンテナ確定前に走ったフィットは実サイズに合わず、選択中なのに
  // 初期表示のまま残ることがある（2026-11-08 の実機報告）。確定後にサイズの再認識を
  // 促し、未フィットの選択があればフィットをやり直す。
  // サイドバーの開閉はフローティング化（D-38）でコンテナの大きさが変わらなくなったため、
  // ここでの対象に含めない（開閉では resize も再フィットもしない）。
  useEffect(() => {
    if (!sheetMode || !mapReady) return
    const instance = map.current
    if (!instance) return
    const signature = `${sheetMode}:${panelMode}`
    const signatureChanged = settledLayout.current !== signature
    if (signatureChanged) {
      settledLayout.current = signature
      try { window.google?.maps?.event.trigger?.(instance, 'resize') } catch { /* サイズ再認識は補助であり、失敗しても地図は使える。 */ }
    }
    const alreadyFitted = lastViewportSelection.current?.map === instance && lastViewportSelection.current.key === fitKey
    // フィット対象の地域データが areas に無い場合は、合わせ直しようがないため要求を
    // 出さない。出し続けるとフィット側が完了を記録できず（対象が見つからない）、
    // 依存が変わるたびに再実行されて要求が止まらなくなる（Issue #129）。
    const fitTargetKnown = fitAreaId !== '' && areas.some((area) => area.areaId === fitAreaId)
    if (fitAreaId && fitTargetKnown && !alreadyFitted) {
      lastViewportSelection.current = null
      setFitRequest((value) => value + 1)
    } else if (!fitAreaId && signatureChanged && initialFitDone.current === instance && initialFitSignature.current !== signature) {
      // 未選択の初期フィットがレイアウト確定前の大きさで走っていたら、確定後の実サイズで
      // 合わせ直す（D-72）。マーカーは作り直さず、フィットだけを掛け直す。確定と同じ
      // シグネチャでフィット済みなら何もしない（利用者の操作を邪魔しない）。
      fitInitialAreas(instance)
    }
  }, [sheetMode, mapReady, panelMode, fitKey, fitAreaId, fitInitialAreas, areas])

  // サイドバーの開閉はシェル側（浮動カードの表示／非表示）にも効かせるため、
  // body のクラスで CSS と協調する。フィット用に現在の開閉状態も ref へ写す。
  // 記録画面でも同じ開閉状態と操作を使う。トグルは hidden な探索画面の外へ出す。
  useLayoutEffect(() => {
    if (!panelMode) return
    sidebarCollapsedRef.current = sidebarCollapsed
    document.body.classList.toggle('explore-sidebar-collapsed', sidebarCollapsed)
    return () => { document.body.classList.remove('explore-sidebar-collapsed') }
  }, [panelMode, sidebarCollapsed])

  return (<>
    <div ref={mapShell} tabIndex={-1} className={'map-preview-shell' + (sheetMode ? ' has-sheet' : '') + (belowMap ? ' is-browsing-below-map' : '')}
      style={sheetMode ? { '--sheet-h': `${panelMode ? 0 : sheetHeight}px` } as CSSProperties : undefined}>
    <section className="map-preview" aria-label="全国の謎">
      {API_KEY && <div ref={target} className="google-map-canvas" aria-label="日本地図" />}
      {status !== 'ready' && <div className={'map-state' + (sheetMode && status === 'loading' ? ' is-boot-quiet' : '')} role={status === 'error' || status === 'auth-error' ? 'alert' : 'status'} {...mapControlGestureProps}>
        {status === 'missing' ? <><strong>地図未設定</strong></> :
          status === 'loading' ? <span className={sheetMode ? 'sr-only' : undefined}>地図読込中</span> :
            <><strong>地図読込失敗</strong>{status === 'auth-error'
              ? <><span>地図設定を確認</span><button type="button" onClick={() => window.location.reload()}>再読込</button></>
              : <button type="button" onClick={() => { setStatus('loading'); setAttempt((value) => value + 1) }}>地図を再試行</button>}</>}
      </div>}
      {status === 'ready' && areaFailed && <div className="map-state map-area-error" role="alert" {...mapControlGestureProps}><strong>地域表示失敗</strong><button type="button" onClick={() => { window.clearTimeout(areaFailureTimer.current); areaFailureTimer.current = undefined; setAreaFailed(false); setAreaAttempt((value) => value + 1) }}>地域エリアを再試行</button></div>}
      {!sheetMode && mapControls}
      {status === 'ready' && <output className="sr-only" aria-label="地図の表示倍率">{zoom}</output>}
    </section>
      {/* 地図の独立レイヤーより上で操作できるよう、シート時はシェル直下に置く。 */}
      {status === 'ready' && !panelMode && topOverlay && <div className="map-filter-overlay">{topOverlay}</div>}
      {sheetMode && mapControls}
      {/* 地図が使えない時は浮かせず、地図の下に通常フローで出して絞り込み自体は失わせない。 */}
      {status !== 'ready' && !panelMode && topOverlay && <div className="map-filter-flow">{topOverlay}</div>}
      {status === 'ready' && locationStatus && <div className={'map-location-status' + (sheetMode ? ' is-floating' : '')} role="status"><span>{locationStatus}</span><button type="button" className="map-location-status-close" aria-label="位置情報の表示を閉じる" onClick={() => setLocationStatus('')}>×</button></div>}
      {sheetMode
        ? panelMode
          ? <>
            <div className="explore-side-panel">{topOverlay && <div className="side-panel-filters">{topOverlay}</div>}{renderQuestList(true, true, true)}{panelExtra}{boundaryCredit}</div>
            {createPortal(<button type="button" className="sidebar-toggle" aria-expanded={!sidebarCollapsed}
              aria-label={sidebarCollapsed ? 'サイドバーを開く' : 'サイドバーを閉じる'}
              onClick={() => setSidebarCollapsed((value) => !value)}>
              <Icon name="panel" />
            </button>, typeof document === 'undefined' ? null : document.getElementById('sidebar-toggle-slot') ?? document.body)}
          </>
          : <ExploreBottomSheet questCount={visibleQuests.length} onDismissDetail={onDeselectQuest} detailOpen={Boolean(selectedQuestId && questDetail)} openSignal={sheetOpenSignal} onHeightChange={setSheetHeight}
            onUserClosedChange={onUserSheetClosedChange}>{renderQuestList(true, detailLocation === 'sheet', true, detailLocation !== 'sheet', openQuestFromSheet)}{boundaryCredit}</ExploreBottomSheet>
        : <>{renderQuestList(true, true)}{boundaryCredit}{panelExtra}</>}
    </div>
    {sheetMode && !panelMode && pastMap && <button type="button" {...mapControlGestureProps}
      className="explore-sheet-reopen map-browse-shortcut is-return-to-map"
      onClick={returnToMap}>地図に戻る</button>}
    {belowMap && <section className="below-map-quests" aria-label="地図の下の問題一覧">
      {renderQuestList(false, detailLocation === 'belowMap', false, detailLocation !== 'belowMap', openQuestFromBelowMap)}
      {boundaryCredit}
    </section>}
  </>)
}
