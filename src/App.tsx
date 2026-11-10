import { GoogleContinue } from './components/GoogleContinue'
import { questHandoffUrl } from './features/quests/questHandoffUrl'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import type { MouseEvent } from 'react'
import { demoAreaLabel, demoQuest, demoQuestHints } from './features/quests/demoQuest'
import { QuestDetails } from './features/quests/QuestDetails'
import { QuestReport } from './features/quests/QuestReport'
import type { ChallengeSelection } from './features/quests/QuestDetails'
import { MapPreview } from './features/explore/MapPreview'
import { scrollBelowHeader } from './features/explore/scrollBelowHeader'
import { Icon } from './components/Icon'
import type { AuthClient, AuthSnapshot } from './features/auth/authTypes'
import type { PublicArea, PublicQuest } from './shared/api/types'
import type { QuestHint } from './shared/api/types'
import { createApiClient } from './shared/api'
import type { ApiClient, LocalApiDataMode } from './shared/api'
import { CameraPreview } from './features/capture/CameraPreview'
import { ChallengeCapture } from './features/capture/ChallengeCapture'
import { OwnerDiscoveries } from './features/discoveries/OwnerDiscoveries'
import { readDataSource, useAdminMembership, useQuestConnection, useServerIdentity } from './features/explore/useQuestConnection'
import { PrerenderViewport, useWideViewport } from './features/quests/useWideViewport'
import { AuthError, createFirebaseAuthClient } from './features/auth/firebaseAuth'
import './App.css'

type AppProps = {
  authClient?: AuthClient
  onStartChallenge?: (selection: ChallengeSelection) => void | Promise<unknown>
  quest?: PublicQuest
  filterRegion?: string | readonly string[]
  filterPrefecture?: string | readonly string[]
  mapAreas?: PublicArea[]
  mapQuests?: PublicQuest[]
  /** 問題一覧の読み込み中。一覧に「0件／空です」を一瞬出さないために MapPreview へ渡す。 */
  mapQuestsLoading?: boolean
  onOpenQuest?: (questId: string) => void
  /** 一覧の行の再タップによる選択解除（D-55）。MapPreview へそのまま渡す。 */
  onDeselectQuest?: () => void
  selectedAreaId?: string
  onSelectArea?(areaId: string): void
  areaLabel?: string
  openQuestRequest?: { questId: string; sequence: number }
  questPicker?: ReactNode
  catalogFallback?: ReactNode
  /** 地図がシート表示（使える状態）かどうかを MapPreview から受け取る。問題の選択手段の
      出し分け（地図が使える間はピッカーを出さない、D-43）を呼び出し側が判断するために使う。 */
  onMapSheetModeChange?: (sheetMode: boolean) => void
  mapOverlay?: ReactNode
  apiMode?: boolean
  apiDataMode?: LocalApiDataMode
  teamAnswerTrial?: boolean
  apiClient?: ApiClient
  onReloadQuest?: (event?: MouseEvent<HTMLButtonElement>) => void
  getHint?: ApiClient['getHint']
  questStale?: boolean
  onHintVersionStale?(): void
}

async function getPreviewHint(input: { questId: string; expectedVersion: number; index: number }, call?: { signal?: AbortSignal }): Promise<QuestHint> {
  call?.signal?.throwIfAborted()
  if (input.questId !== demoQuest.questId || input.expectedVersion !== demoQuest.version || !Number.isInteger(input.index) || input.index < 1 || input.index > demoQuestHints.length) {
    throw new Error('Preview hint is unavailable')
  }
  return { questId: input.questId, version: input.expectedVersion, index: input.index, text: demoQuestHints[input.index - 1] }
}

const emptyClearedByQuest: ReadonlyMap<string, string> = new Map()

function waitForSignedIn(authClient: AuthClient, signal: AbortSignal): Promise<boolean> {
  if (authClient.getSnapshot().status === 'signed-in') return Promise.resolve(true)
  return new Promise((resolve) => {
    let settled = false
    let unsubscribe: (() => void) | null = null
    const finish = (signedIn: boolean) => {
      if (settled) return
      settled = true
      unsubscribe?.()
      window.clearTimeout(timeout)
      signal.removeEventListener('abort', abort)
      resolve(signedIn)
    }
    const check = () => {
      const status = authClient.getSnapshot().status
      if (status === 'signed-in') finish(true)
      else if (status === 'unavailable' || status === 'unconfigured') finish(false)
    }
    const abort = () => finish(false)
    const timeout = window.setTimeout(() => finish(false), 5000)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    if (settled) return
    unsubscribe = authClient.subscribe(check)
    if (settled) unsubscribe?.()
    check()
  })
}


function readRecordsViewFromUrl() {
  try { return new URLSearchParams(window.location.search).get('view') === 'records' } catch { return false }
}

function writeRecordsViewToUrl(open: boolean, mode: 'push' | 'replace') {
  try {
    const url = new URL(window.location.href)
    if (open) url.searchParams.set('view', 'records')
    else url.searchParams.delete('view')
    const next = `${url.pathname}${url.search}${url.hash}`
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`
    if (next === current) return
    window.history[mode === 'push' ? 'pushState' : 'replaceState'](window.history.state, '', next)
  } catch { /* URL 反映は補助。画面状態は React 側が正。 */ }
}

export default function App({ authClient: providedClient, apiClient: providedApi, onStartChallenge, onReloadQuest, getHint: providedGetHint, questStale: providedQuestStale = false, onHintVersionStale, quest: externalQuest, filterRegion = '', filterPrefecture = '', mapAreas = [], mapQuests = [], mapQuestsLoading = false, onOpenQuest, onDeselectQuest, selectedAreaId = '', onSelectArea, areaLabel: externalAreaLabel, openQuestRequest, questPicker, catalogFallback, mapOverlay, onMapSheetModeChange, apiMode = false, apiDataMode = 'demo', teamAnswerTrial: teamAnswerTrialProp = false }: AppProps = {}) {
  const [openState, setOpenState] = useState<{ quest?: PublicQuest; open: boolean }>({ open: false })
  const [openedRequest, setOpenedRequest] = useState<typeof openQuestRequest>()
  if (openQuestRequest && openQuestRequest !== openedRequest && externalQuest?.questId === openQuestRequest.questId) {
    setOpenedRequest(openQuestRequest)
    setOpenState({ quest: externalQuest, open: true })
  }

  const [recordDestination, setRecordDestination] = useState<{ auth: AuthSnapshot; id: string; alreadyCleared?: boolean } | null>(null)
  // 記録タブは ?view=records で復元する（パスは Cloud Run の静的配信が / と /admin 以外
  // を HTML に落とさないため使わない。Firebase Hosting は SPA rewrite あり）。
  const [recordsOpen, setRecordsOpen] = useState(() => readRecordsViewFromUrl())
  // 記録画面は一度開いたらアンマウントせず、隠して常駐させる。探索側（地図・パネル・
  // 選択状態）も同様に隠すだけで壊さないため、タブ往復でフィルタ・一覧・地図・選択が
  // 食い違わない（往復の前後で状態は visibility だけが変わる）。
  const [recordsVisited, setRecordsVisited] = useState(() => readRecordsViewFromUrl())
  // 記録画面へ入るたびに数え、一覧の取り直しの合図にする。画面は常駐させる
  // （D-53）ため、合図が無いと初回の取得結果がセッション中ずっと残ってしまう。
  const [recordsVisit, setRecordsVisit] = useState(0)
  const questCard = useRef<HTMLDivElement>(null)
  const authClient = useMemo(() => providedClient ?? createFirebaseAuthClient(), [providedClient])
  const auth = useSyncExternalStore(authClient.subscribe, authClient.getSnapshot, authClient.getSnapshot)
  const source = readDataSource(import.meta.env.VITE_QUEST_DATA_SOURCE, import.meta.env.DEV)
  const teamPreview = apiMode && apiDataMode === 'team-preview'
  const teamAnswerTrial = teamPreview && teamAnswerTrialProp
  const railFallback = teamPreview || (apiMode && apiDataMode === 'durable-local') ? catalogFallback : undefined
  const getHint = providedGetHint ?? (source === 'preview' && !apiMode && !externalQuest && !catalogFallback ? getPreviewHint : undefined)
  const localApiMode = apiMode || source === 'local-api'
  const durableLocal = apiMode && apiDataMode === 'durable-local'
  const wideViewport = useWideViewport()
  // PC幅では、地図の下に通常フローで出ていたレール（問題の選択・詳細・注意書き）を左サイドバーの
  // パネル内へ寄せ、探索画面を「サイドバー＋地図」だけで完結させる（D-34 の集約の仕上げ）。
  // demo でも PC 幅は Cursor 風サイドバーへ載せる（ローカルデモ／審査確認用。team-preview と同じ殻）。
  const panelArrangement = wideViewport && (teamPreview || durableLocal || apiMode)
  const showRecords = localApiMode && recordsOpen

  const api = useMemo(() => providedApi ?? createApiClient({ getIdToken: () => authClient.getIdToken(),
    expectedDataMode: localApiMode ? apiDataMode : undefined }), [providedApi, authClient, localApiMode, apiDataMode])
  const connection = useQuestConnection(apiMode || externalQuest || catalogFallback ? 'preview' : source, api)
  const content = connection.result.status === 'ready' ? connection.result.value : null
  const quest = externalQuest ?? (!apiMode && !catalogFallback && content ? (({ areaLabel: _area, ...dto }) => dto)(content) : null)
  const areaLabel = externalAreaLabel ?? content?.areaLabel ?? demoAreaLabel
  // 詳細は、地図が使える表示（共有検証・永続）では一覧の選択中の行の直下へアコーディオンとして
  // 差し込む（D-46）。対象の問題が一覧に無い使い方（固定問題の埋め込み等）と、それ以外
  // （スタンドアロンのデモ表示等）では従来どおりレールに置く。
  // team-preview / durable は幅を問わず一覧内詳細。demo の PC サイドバー時だけ同様にする。
  const detailInList = (teamPreview || durableLocal || panelArrangement) && Boolean(quest) && mapQuests.some((item) => item.questId === quest?.questId)
  // 一覧の中の詳細は、選択されている間は常に開いているものとして扱う（D-65）。閉じる
  // 受け口は一覧の行の再タップによる選択解除（D-55）だけであり、詳細側に開閉状態は
  // 持たせない（開閉ボタンも出さない）。レールに置く使い方では従来どおり開閉状態が決める。
  const isQuestOpen = detailInList ? Boolean(quest) : openState.quest === externalQuest && openState.open
  useEffect(() => {
    if (isQuestOpen && openedRequest && document.querySelector('.is-browsing-below-map')) {
      scrollBelowHeader(questCard.current?.querySelector<HTMLElement>('.quest-card-heading h3') ?? questCard.current)
    }
  }, [isQuestOpen, openedRequest])
  // PC（広い画面）では挑戦の主導線をスマホへ受け渡す。その問題の詳細を直接開くURLをQRにする。
  const handoffUrl = useMemo(() => {
    if (!quest) return undefined
    try {
      return questHandoffUrl(quest)
    } catch { return undefined }
  }, [quest])
  // ディープリンク（?quest=）で開かれた場合は、その問題の詳細を最初から開く。
  const [initialQuestParam] = useState(() => { try { return new URLSearchParams(window.location.search).get('quest') ?? '' } catch { return '' } })
  const [deepLinkOpenedFor, setDeepLinkOpenedFor] = useState('')
  if (!externalQuest && initialQuestParam && quest && quest.questId === initialQuestParam && deepLinkOpenedFor !== initialQuestParam) {
    setDeepLinkOpenedFor(initialQuestParam)
    setOpenState({ quest: externalQuest, open: true })
  }
  const questKey = quest ? `${quest.questId}:${quest.version}` : ''
  const [localStaleQuestKey, setLocalStaleQuestKey] = useState('')
  const questStale = providedQuestStale || (questKey !== '' && localStaleQuestKey === questKey)
  const serverIdentity = useServerIdentity((!teamPreview || teamAnswerTrial) && (apiMode || source === 'local-api'), api, auth)
  // 自治体画面への入口は、所属を持つアカウントでログインした時だけ出す（表示の制御であり、保護はサーバー側）。
  const hasAdminMembership = useAdminMembership(teamPreview, api, auth)
  const identityErrorMessage = teamAnswerTrial && serverIdentity.result?.status === 'error' && serverIdentity.result.code === 'FORBIDDEN'
    ? 'この回答試験は招待された人だけが使えます。このアカウントは招待されていません。'
    : 'ログイン確認失敗'
  const uid = auth.status === 'signed-in' ? auth.user.uid : null
  const canUseCamera = uid !== null && (!(apiMode || source === 'local-api') || serverIdentity.result?.status === 'ready')
  const [cameraOwner, setCameraOwner] = useState<{ auth: AuthSnapshot; confirmation: typeof serverIdentity.result; questId: string; version: number } | null>(null)
  const [captureRevision, setCaptureRevision] = useState(0)
  const closeCamera = useCallback(() => { setCameraOwner(null); setCaptureRevision((value) => value + 1) }, [])
  const cameraVisible = !questStale && canUseCamera && cameraOwner !== null && cameraOwner.auth === auth && cameraOwner.confirmation === serverIdentity.result && cameraOwner.questId === quest?.questId && cameraOwner.version === quest.version
  // アカウントメニューを開いた時点の uid を持ち、ログイン状態が変われば開いていないものとして扱う（派生）。
  const [accountMenuAnchor, setAccountMenuAnchor] = useState<string | null>(null)
  const accountMenuOpen = accountMenuAnchor !== null && auth.status === 'signed-in' && accountMenuAnchor === auth.user.uid
  const accountMenuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!accountMenuOpen) return
    const closeOnOutside = (event: PointerEvent) => {
      if (accountMenuRef.current && !accountMenuRef.current.contains(event.target as Node)) setAccountMenuAnchor(null)
    }
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setAccountMenuAnchor(null) }
    document.addEventListener('pointerdown', closeOnOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [accountMenuOpen])
  const [pending, setPending] = useState<{ client: AuthClient; kind: 'sign-in' | 'sign-out' } | null>(null)
  const pendingRef = useRef(false)
  const lifecycle = useRef(0)
  const selectionGeneration = useRef(0)
  const mobileNavGesture = useRef<{ pointerId: number; x: number; y: number; moved: boolean } | null>(null)
  const waitController = useRef<AbortController | null>(null)
  const [feedback, setFeedback] = useState<{ error: boolean; text: string } | null>(null)
  const [startIntent, setStartIntent] = useState<{ auth: AuthSnapshot; selection: ChallengeSelection; generation: number; expires: number } | null>(null)
  const selectedQuest = useRef(quest)
  const openRef = useRef(isQuestOpen)
  const visiblePending = pending?.client === authClient ? pending.kind : null
  // 本人のクリア済み問題（questId → 記録ID）。クリアは1人1問につき1回だけで、
  // クリア済みの問題は再挑戦できない（D-64）。詳細の開始導線の置き換えと一覧の
  // バッジに使う表示専用の情報であり、再挑戦の最終的な防止はサーバー側が担う。
  // 記録画面と同じ条件（ログイン済み・本人確認が取れている時）で本人の記録を読み、
  // 失敗した時は「未クリア扱い」で従来表示に倒す。
  const [clearedState, setClearedState] = useState<{ uid: string; byQuest: ReadonlyMap<string, string> } | null>(null)
  const [clearedRefresh, setClearedRefresh] = useState(0)
  // 戻る／進むで ?view=records を読み直し、記録⇄探索を同期する。
  useEffect(() => {
    if (!localApiMode) return
    const onPopState = () => {
      if (document.querySelector('.record-dialog[open]')) return
      const open = readRecordsViewFromUrl()
      if (open) { setRecordsVisited(true); setRecordsVisit((value) => value + 1) }
      else { setRecordDestination(null); setClearedRefresh((value) => value + 1) }
      setRecordsOpen(open)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [localApiMode])
  const clearedByQuest = clearedState && uid !== null && clearedState.uid === uid ? clearedState.byQuest : emptyClearedByQuest
  const clearedQuestIds = useMemo(() => new Set(clearedByQuest.keys()), [clearedByQuest])
  useEffect(() => {
    // 対象は実モード（共有検証・永続）だけ。デモ表示は後退のため新機能の対象に
    // しない（AGENTS.md の方針）。取得回数の契約（認証まわりの呼び出し回数など）を
    // 乱さないよう、デモでは一切取得しない。
    if (!(durableLocal || teamPreview) || !localApiMode || uid === null || visiblePending !== null || serverIdentity.result?.status !== 'ready') return
    const controller = new AbortController()
    void (async () => {
      try {
        const byQuest = new Map<string, string>()
        let cursor: string | undefined
        // 本人のクリア数は多くならないが、ページングは上限を決めて最後まで読む。
        for (let page = 0; page < 10; page++) {
          const result = await api.listDiscoveries({ limit: 100, cursor }, { signal: controller.signal })
          for (const item of result.items) if (!byQuest.has(item.questId)) byQuest.set(item.questId, item.discoveryId)
          cursor = result.nextCursor ?? undefined
          if (!cursor) break
        }
        if (!controller.signal.aborted) setClearedState({ uid, byQuest })
      } catch { /* 表示だけの情報のため、失敗時は未取得として従来表示にする。 */ }
    })()
    return () => controller.abort()
  }, [api, durableLocal, teamPreview, localApiMode, uid, visiblePending, serverIdentity.result, clearedRefresh])
  // クリア確定後の退出点（記録を開く／クリア画面から地図へ戻る）で、セッション内
  // でもクリア済みへ即時反映する（D-64）。一覧を取り直さずに詳細・バッジへ出す。
  const noteCleared = useCallback((questId: string, discoveryId: string) => {
    setClearedState((current) => {
      if (uid === null) return current
      const base = current && current.uid === uid ? current.byQuest : emptyClearedByQuest
      if (base.get(questId) === discoveryId) return current
      const next = new Map(base)
      next.set(questId, discoveryId)
      return { uid, byQuest: next }
    })
  }, [uid])

  useLayoutEffect(() => {
    if (selectedQuest.current?.questId !== quest?.questId || selectedQuest.current?.version !== quest?.version) {
      selectionGeneration.current += 1
    }
    selectedQuest.current = quest
    openRef.current = isQuestOpen
  }, [quest, isQuestOpen])

  useEffect(() => {
    pendingRef.current = false
    return () => {
      lifecycle.current += 1
      waitController.current?.abort()
    }
  }, [authClient])

  async function login(selection?: ChallengeSelection) {
    if ((selection && questStale) || visiblePending || pendingRef.current) return
    const requestedAt = Date.now()
    const operation = lifecycle.current
    const generation = selectionGeneration.current
    setFeedback(null)
    if (auth.status === 'signed-in') {
      if (!onStartChallenge || !selection) return
      pendingRef.current = true
      setPending({ client: authClient, kind: 'sign-in' })
      try { await onStartChallenge(selection) }
      catch { if (lifecycle.current === operation) setFeedback({ error: true, text: '挑戦を開始できませんでした。問題の閲覧を続けられます。' }) }
      finally { if (lifecycle.current === operation) { pendingRef.current = false; setPending(null) } }
      return
    }
    if (auth.status !== 'signed-out') return
    pendingRef.current = true
    setPending({ client: authClient, kind: 'sign-in' })
    const controller = new AbortController()
    waitController.current = controller
    let firstUid: string | null = null
    let accountChanged = false
    const stopObserving = authClient.subscribe(() => {
      const next = authClient.getSnapshot()
      if (next.status === 'signed-in') {
        if (firstUid !== null && firstUid !== next.user.uid) accountChanged = true
        firstUid ??= next.user.uid
      } else if (firstUid !== null) accountChanged = true
    })
    try {
      await authClient.signInWithGoogle()
      if (lifecycle.current !== operation) return
      const signedIn = await waitForSignedIn(authClient, controller.signal)
      if (!signedIn) {
        if (lifecycle.current === operation) setFeedback({ error: true, text: 'ログイン状態を確認できませんでした。問題の閲覧を続けられます。' })
        return
      }
      if (lifecycle.current !== operation || selectionGeneration.current !== generation) return
      if ((durableLocal || teamAnswerTrial) && !accountChanged && !onStartChallenge && selection && openRef.current &&
        selectedQuest.current?.questId === selection.questId && selectedQuest.current.version === selection.expectedVersion && Date.now() - requestedAt < 30_000) {
        setStartIntent({ auth: authClient.getSnapshot(), selection, generation, expires: requestedAt + 30_000 })
      }
      if (selection && openRef.current && selectedQuest.current?.questId === selection.questId &&
        selectedQuest.current?.version === selection.expectedVersion && onStartChallenge) await onStartChallenge(selection)
    }
    catch (error) {
      const safe = error instanceof AuthError ? error : new AuthError('unknown')
      if (lifecycle.current === operation) setFeedback({ error: safe.code !== 'cancelled', text: safe.message })
    } finally {
      stopObserving()
      if (waitController.current === controller) waitController.current = null
      if (lifecycle.current === operation) { pendingRef.current = false; setPending(null) }
    }
  }

  useEffect(() => {
    if (!startIntent) return
    const timer = setTimeout(() => setStartIntent(null), Math.max(0, startIntent.expires - Date.now()))
    const cancel = () => setStartIntent(null)
    window.addEventListener('pagehide', cancel)
    return () => { clearTimeout(timer); window.removeEventListener('pagehide', cancel) }
  }, [startIntent])

  async function logout() {
    if (visiblePending) return
    closeCamera()
    setFeedback(null)
    setPending({ client: authClient, kind: 'sign-out' })
    try { await authClient.signOut() }
    catch (error) {
      const safe = error instanceof AuthError ? error : new AuthError('unknown')
      setFeedback({ error: true, text: safe.message })
    } finally { setPending(null) }
  }

  function navigateToRecords(open: boolean) {
    // 記録画面から戻る時はクリア済み一覧を取り直す。記録の削除でクリアが
    // 解かれている場合に、詳細側の表示も追いつかせるため（D-64）。
    if (!open) { setRecordDestination(null); setClearedRefresh((value) => value + 1) }
    else { setRecordsVisited(true); setRecordsVisit((value) => value + 1) }
    closeCamera()
    selectionGeneration.current++
    setFeedback(null)
    setRecordsOpen(open)
    // 再読み込み・戻る／進むで同じ画面に戻せるよう URL に載せる（t165u）。
    if (localApiMode) writeRecordsViewToUrl(open, 'push')
  }

  // 探索へ戻る導線はタブに一本化する（記録画面の本文に重複した戻りボタンは置かない）。
  // 通常フロー表示では、従来の #explore-title アンカーと同じく見出しの位置へ戻す。
  function navigateToExplore() {
    // 選択中の「謎を探す」を押しただけでスクロールを起こさない。
    // スワイプ中にクリックが合成される端末でも、現在の探索画面が動かないようにする。
    const returningFromRecords = showRecords
    navigateToRecords(false)
    if (returningFromRecords) requestAnimationFrame(() => {
      try { document.getElementById('explore-title')?.scrollIntoView({ block: 'start' }) } catch { /* スクロールは補助であり、画面遷移は完了している。 */ }
    })
  }

  const exploreFeedback = !isQuestOpen && feedback
    ? <p className="auth-feedback" role={feedback.error ? 'alert' : 'status'}>{feedback.text}</p> : null
  const clearedDiscoveryId = quest && uid !== null ? clearedByQuest.get(quest.questId) : undefined
  const questDetailBlock = (
              !railFallback && <PrerenderViewport value={wideViewport}><div ref={questCard}>
                {quest ? <QuestDetails quest={quest} areaLabel={areaLabel} sourceLabel="" detailsLabel={durableLocal || teamPreview ? '問題の詳細' : undefined} open={isQuestOpen} hideToggle={detailInList} handoffUrl={handoffUrl}
                  getHint={getHint ?? api.getHint} getHintPhoto={teamPreview ? api.getPublishedHintPhoto : undefined} stale={questStale}
                  onHintVersionChanged={() => { closeCamera(); selectionGeneration.current++; waitController.current?.abort(); setLocalStaleQuestKey(questKey); onHintVersionStale?.() }}
                  onReloadQuest={(event) => { if (externalQuest) onReloadQuest?.(event); else connection.retry() }}
                  hideStartAction={(teamPreview && !teamAnswerTrial) || (!wideViewport && !onStartChallenge && (apiMode || source === 'local-api') && canUseCamera && visiblePending === null)}
                  disabled={questStale || visiblePending !== null || (auth.status !== 'signed-out' && auth.status !== 'signed-in') || (auth.status === 'signed-in' && (onStartChallenge ? false : !canUseCamera || cameraVisible))}
                  buttonLabel={visiblePending === 'sign-in' ? '処理中…' : auth.status === 'signed-in' ? (onStartChallenge ? '挑戦する' : cameraVisible ? '撮影中' : serverIdentity.result?.status === 'loading' ? 'ログイン確認中' : serverIdentity.result?.status === 'error' ? 'ログイン確認待ち' : '撮影する') : 'Googleでログイン'}
                  note={questStale ? '問題の再読込が必要' : undefined}
                  clearedDiscoveryId={clearedDiscoveryId} onOpenDiscovery={(id) => { setRecordDestination({ auth, id }); navigateToRecords(true) }}
                  feedback={feedback} onToggle={() => { const next = !openRef.current; selectionGeneration.current += 1; openRef.current = next; if (!next) closeCamera(); /* 開閉ボタンはレールに置く使い方（選択の受け口が無い場合）だけに出る（D-65）。一覧の中の詳細ではボタン自体を出さず、閉じる操作は行の再タップによる選択解除（D-55）に一本化したため、ここで選択解除まで連動させる配線は不要になった（旧 D-60 の配線は廃止）。 */ setOpenState({ quest: externalQuest, open: next }) }} onStart={(selection) => { if (onStartChallenge) return login(selection); if (auth.status === 'signed-in' && canUseCamera && quest) setCameraOwner({ auth, confirmation: serverIdentity.result, questId: selection.questId, version: selection.expectedVersion }); else return login(selection) }}>
                    {!wideViewport && !questStale && !clearedDiscoveryId && !onStartChallenge && (apiMode || source === 'local-api') && canUseCamera && uid !== null && visiblePending === null && <ChallengeCapture
                      key={JSON.stringify([uid, quest.questId, quest.version, captureRevision])} api={api} quest={quest} dataMode={apiDataMode} ownerKey={uid} placeName={areaLabel}
                      autoStart={(durableLocal || teamAnswerTrial) && startIntent !== null && startIntent.auth === auth && startIntent.selection.questId === quest.questId && startIntent.selection.expectedVersion === quest.version}
                      canAutoStart={() => startIntent !== null && startIntent.generation === selectionGeneration.current && startIntent.expires > Date.now() && openRef.current && authClient.getSnapshot() === startIntent.auth}
                      onAutoStartConsumed={() => setStartIntent(null)}
                      onOpenDiscovery={durableLocal || teamAnswerTrial ? (id, alreadyCleared) => { noteCleared(quest.questId, id); setRecordDestination({ auth, id, alreadyCleared }); navigateToRecords(true) } : undefined}
                      onReturnToMap={(discoveryId) => { if (discoveryId) noteCleared(quest.questId, discoveryId) }}
                      onReloadQuest={() => { closeCamera(); if (externalQuest) onReloadQuest?.(); else connection.retry() }} />}
                    {auth.status === 'signed-in' && serverIdentity.result?.status === 'error' && <div className="auth-feedback"><p role="alert">{identityErrorMessage}</p><button type="button" className="retry-button" onClick={serverIdentity.retry}>ログインを再確認</button></div>}
                    {!wideViewport && cameraVisible && uid !== null && <CameraPreview key={uid} onClose={closeCamera} handoffUrl={handoffUrl} />}
                    {localApiMode && !teamPreview && <QuestReport key={questKey} api={api} questId={quest.questId} dataMode={apiDataMode}
                      ownerUid={canUseCamera && visiblePending === null ? uid : null} canSignIn={auth.status === 'signed-out'}
                      signInPending={visiblePending !== null} onSignIn={() => void login()} />}
                  </QuestDetails>
                  : apiMode ? null : connection.result.status === 'loading' ? <p role="status" aria-label="問題の読み込み">問題読込中</p> : <div role="alert">{source === 'invalid' ? '表示設定エラー' : '問題読込失敗'}<button type="button" className="retry-button" onClick={connection.retry}>問題を再読込</button></div>}
              </div></PrerenderViewport>
  )
  const railContent = (
    <>
              {railFallback ?? questPicker}
              {!detailInList && questDetailBlock}
              {/* 開発・モード注記のバナーは出さない（ユーザー向け画面から補足ラベルを撤去）。 */}
    </>
  )
  // サイドバー内では、レールの中身と認証フィードバックをパネルに寄せる。
  const panelContent = (
    <div className="side-panel-rail">
      {railContent}
      {exploreFeedback}
    </div>
  )

  return (
    <div className="traveler-shell">
      <a className="skip-link" href="#main">本文へ移動</a>
      <header className="site-header">
        <div className="brand">
          <span className="brand-mark"><img src="/favicon.svg" alt="" aria-hidden="true" /></span>
          <span className="brand-copy">NAZOP</span>
        </div>
        <nav className="desktop-nav" aria-label="主要ナビゲーション">
          {/* 画面遷移のタブは2つともボタンで揃える（片方だけリンクだと URL のハッシュが
              残ったり消えたりして、URL と表示の対応が分かりにくくなるため）。 */}
          <button type="button" className={showRecords ? undefined : 'nav-active'} aria-current={showRecords ? undefined : 'page'}
            aria-label="謎を探す" onClick={navigateToExplore}><Icon name="pin" /><span className="nav-label">謎を探す</span></button>
          {/* F5でブート殻と並べるため常に出す。使えないときは無効＋薄い見た目だけ（補足文字は出さない）。 */}
          <button type="button" className={showRecords ? 'nav-active' : undefined} aria-current={showRecords ? 'page' : undefined}
            aria-label="自分の記録"
            disabled={!localApiMode || (teamPreview && !teamAnswerTrial) || visiblePending !== null} onClick={() => navigateToRecords(true)}>
            <Icon name="book" /><span className="nav-label">自分の記録</span>
          </button>
        </nav>
        <div id="sidebar-toggle-slot" />
        <div className="account-area">
          {/* 右上の固定スロットはアイコン型にする（#36 の固定スロットと、#42 の「状態表示を置かない」を維持）。
              ログイン中はタップで小さなメニューを開き、アカウント名とログアウトはその中だけに出す。 */}
          {auth.status === 'signed-in' ? (
            <div className="account-menu-wrap" ref={accountMenuRef}>
              <button type="button" className="account-icon-button" aria-label="アカウントメニュー" aria-haspopup="menu"
                aria-expanded={accountMenuOpen} disabled={visiblePending !== null}
                onClick={() => setAccountMenuAnchor((anchor) => (anchor === auth.user.uid ? null : auth.user.uid))}>
                {auth.user.photoURL
                  ? <img src={auth.user.photoURL} alt="" />
                  : auth.user.displayName
                    ? <span className="account-initial" aria-hidden="true">{auth.user.displayName.slice(0, 1)}</span>
                    : <Icon name="user" />}
              </button>
              {accountMenuOpen && (
                <div className="account-menu" role="menu">
                  <p className="account-menu-name">{auth.user.displayName ?? 'ログイン中のアカウント'}</p>
                  {/* 自治体画面への入口はアカウントメニューの中だけに置き、ナビ／タブは全ユーザー共通にする（D-47）。 */}
                  {teamPreview && hasAdminMembership && <a role="menuitem" href="/admin">自治体画面</a>}
                  <button type="button" role="menuitem" onClick={() => { setAccountMenuAnchor(null); void logout() }}>ログアウト</button>
                </div>
              )}
            </div>
          ) : (
            <button type="button" className="account-icon-button" aria-label="ログイン"
              disabled={visiblePending !== null || auth.status === 'checking'}
              aria-disabled={auth.status !== 'signed-out' || visiblePending !== null}
              onClick={() => { if (auth.status === 'signed-out' && visiblePending === null) void login() }}>
              <Icon name="user" />
            </button>
          )}
        </div>
      </header>

      <main id="main" className="page" tabIndex={-1}>
        {/* 記録画面と探索画面はどちらもアンマウントせず、hidden で切り替える。地図や
            パネルを再マウントするとカメラ・フィット記録・選択状態が初期化され、タブ
            往復の前後で表示が食い違うため（状態の保持は D-53）。 */}
        {recordsVisited && <section className={"owner-records view-enter" + (auth.status === 'signed-out' ? ' is-login' : '')} aria-labelledby="records-title" hidden={!showRecords}>
          <h1 id="records-title">自分の記録</h1>
          {auth.status === 'signed-out' && <>
            <button type="button" className="google-continue" disabled={visiblePending !== null}
              onClick={() => void login()}><GoogleContinue /></button>
            <p className="login-terms">続行すると<a href="/terms">利用規約</a>に同意したものとみなします</p>
          </>}
          {auth.status === 'checking' && <p role="status">ログイン確認中</p>}
          {(auth.status === 'unconfigured' || auth.status === 'unavailable') && <p role="status">ログイン</p>}
          {uid !== null && visiblePending === null && (serverIdentity.result?.status === 'ready'
            ? <OwnerDiscoveries alreadyCleared={recordDestination?.auth === auth && recordDestination.alreadyCleared} key={uid} api={api} onExplore={navigateToExplore} visit={recordsVisit} active={showRecords} initialId={recordDestination?.auth === auth ? recordDestination.id : undefined} />
            : serverIdentity.result?.status === 'error'
              ? <><p role="alert">ログイン確認失敗</p><button type="button" className="retry-button" onClick={serverIdentity.retry}>ログインを再確認</button></>
              : <p role="status">ログイン確認中</p>)}
          {feedback && <p className="auth-feedback" role={feedback.error ? 'alert' : 'status'}>{feedback.text}</p>}
        </section>}
        <div className="explore-view" hidden={showRecords}>
        {(!teamPreview && !durableLocal ? catalogFallback : undefined) ?? <>
        <section className="explore view-enter" aria-labelledby="explore-title">
          <div className="explore-heading">
            <div>
              <h1 id="explore-title">全国から謎を探す</h1>
            </div>
          </div>

          <div className="explore-workspace">
            <MapPreview filterRegion={filterRegion} filterPrefecture={filterPrefecture} areas={mapAreas} selectedAreaId={selectedAreaId} onSelectArea={onSelectArea} showPublicAreas={durableLocal || teamPreview || apiMode} quests={mapQuests} questsLoading={mapQuestsLoading} onOpenQuest={onOpenQuest} onDeselectQuest={onDeselectQuest} selectedQuestId={quest?.questId ?? ''} clearedQuestIds={clearedQuestIds} topOverlay={mapOverlay} showBoundaryCredit={teamPreview} fillSelectedAreaOnly={teamPreview} panelExtra={panelArrangement ? panelContent : undefined} onSheetModeChange={onMapSheetModeChange} questScrollTarget={questCard} questDetail={detailInList ? questDetailBlock : undefined} viewActive={!showRecords} />

{!panelArrangement && <aside className="quest-rail" aria-label="選べる謎">{railContent}</aside>}
          </div>
        </section>
        {!panelArrangement && exploreFeedback}
        </>}
        </div>
      </main>
      <nav className="mobile-nav" aria-label="スマホ用ナビゲーション"
        onPointerDownCapture={(event) => {
          mobileNavGesture.current = event.pointerType === 'touch'
            ? { pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false }
            : null
        }}
        onPointerMoveCapture={(event) => {
          const gesture = mobileNavGesture.current
          if (gesture?.pointerId === event.pointerId && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 8) gesture.moved = true
        }}
        onPointerCancelCapture={() => { mobileNavGesture.current = null }}
        onClickCapture={(event) => {
          const gesture = mobileNavGesture.current
          mobileNavGesture.current = null
          // PointerEvent由来のスワイプ後クリックだけを捨て、Enter/Space の click(detail=0) は通す。
          if (gesture?.moved && event.detail !== 0) {
            event.preventDefault()
            event.stopPropagation()
          }
        }}>
        <button type="button" aria-current={showRecords ? undefined : 'page'} aria-label="謎を探す" onClick={navigateToExplore}><Icon name="pin" /><span>謎を探す</span></button>
        <button type="button" aria-current={showRecords ? 'page' : undefined} aria-label="自分の記録" disabled={!localApiMode || (teamPreview && !teamAnswerTrial) || visiblePending !== null}
          onClick={() => navigateToRecords(true)}><Icon name="book" /><span>自分の記録</span></button>
      </nav>
    </div>
  )
}
