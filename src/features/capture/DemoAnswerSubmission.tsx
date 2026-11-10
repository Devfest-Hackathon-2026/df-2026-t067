import { saveReceipt } from './captureContinuity'
import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react'
import { ApiError } from '../../shared/api'
import { ClearCelebration } from './ClearCelebration'
import { ClearScreen } from './ClearScreen'
import type { ApiClient, AttemptOutcome, AttemptResult, CaptureMetadata, LocalApiDataMode } from '../../shared/api'

export interface DemoAnswerContext {
  api: Pick<ApiClient, 'submitAnswer' | 'getAttempt'>
  storageKey?: string
  placeName?: string
  questId?: string
  challengeId: string
  onReloadQuest: () => void
  onOpenDiscovery?: (id: string, alreadyCleared?: boolean) => void
  // クリア画面の「地図に戻る」用。撮影を終えて探索画面へ戻す操作を呼び出し側が渡す。
  // クリア済みの記録ID（あれば）を一緒に渡し、呼び出し側が詳細側のクリア済み
  // 表示へ即時反映できるようにする（D-64）。
  onReturnToMap?: (discoveryId?: string) => void
  // クリア画面に出す問題タイトル。
  questTitle?: string
  dataMode?: LocalApiDataMode
}

type ReceiptView = { attemptId: string; message: string; canCheck: boolean; reload?: boolean; discoveryId?: string; cleared?: boolean; outcome?: AttemptOutcome }
type Failure = { message: string; reload?: true; retake?: true; retryAfterSeconds?: number }
type Operation = { controller: AbortController; deadline?: ReturnType<typeof setTimeout> }

const automaticDelays = [1000, 2000, 4000, 8000, 8000, 8000]

const durableMessages: Record<AttemptOutcome, string> = {
  CORRECT: 'テストクリア',
  ALREADY_CLEARED: 'クリア済み',
  OUTSIDE_AREA: 'テスト範囲外',
  LOCATION_UNCERTAIN: 'テスト位置未確認',
  WRONG_TARGET: '合成画像の対象不一致',
  IMAGE_UNCERTAIN: '合成画像の判定不能',
  QUEST_UNAVAILABLE: '受付終了',
  QUEST_CHANGED: '問題更新',
  SYSTEM_ERROR: '回答処理失敗',
}

const trialMessages: Record<AttemptOutcome, string> = {
  CORRECT: 'クリア',
  ALREADY_CLEARED: 'クリア済み',
  OUTSIDE_AREA: '撮影範囲外',
  LOCATION_UNCERTAIN: '位置未確認',
  WRONG_TARGET: '対象不一致',
  IMAGE_UNCERTAIN: '写真判定不能',
  QUEST_UNAVAILABLE: '受付終了',
  QUEST_CHANGED: '問題更新',
  SYSTEM_ERROR: '回答処理失敗',
}

function receiptView(result: AttemptResult, dataMode: LocalApiDataMode | undefined, expectedId?: string): ReceiptView {
  const real = dataMode === 'durable-local' || dataMode === 'team-preview'
  if (result.source !== (real ? 'real' : 'mock') || (expectedId !== undefined && result.attemptId !== expectedId)) {
    throw new ApiError('INVALID_RESPONSE')
  }
  const attemptId = result.attemptId
  if (real) {
    if (result.state !== 'COMPLETED') {
      return { attemptId, canCheck: true, message: '回答受付済み' }
    }
    const messages = dataMode === 'durable-local' ? durableMessages : trialMessages
    return { attemptId, outcome: result.outcome, canCheck: false, message: messages[result.outcome],
      discoveryId: result.outcome === 'CORRECT' || result.outcome === 'ALREADY_CLEARED' ? result.optionalDiscoveryId : undefined,
      // 演出は初回クリアの確定時だけ（D-42）。クリア済み・その他の結果では出さない。
      cleared: result.outcome === 'CORRECT',
      reload: result.outcome === 'QUEST_CHANGED' || result.outcome === 'QUEST_UNAVAILABLE' }
  }
  if (result.state === 'RECEIVED') {
    return { attemptId, canCheck: true, message: '送信済み' }
  }
  if (result.outcome === 'OUTSIDE_AREA') {
    return { attemptId, canCheck: false, outcome: 'OUTSIDE_AREA', message: '撮影範囲外' }
  }
  if (result.outcome === 'LOCATION_UNCERTAIN') {
    return { attemptId, canCheck: false, outcome: 'LOCATION_UNCERTAIN', message: '位置未確認' }
  }
  throw new ApiError('INVALID_RESPONSE')
}

function answerFailure(cause: unknown): Failure {
  const error = cause instanceof ApiError ? cause : new ApiError('SYSTEM_ERROR')
  switch (error.code) {
    case 'QUEST_CHANGED': return { message: '問題更新', reload: true }
    case 'QUEST_UNAVAILABLE':
    case 'NOT_FOUND': return { message: '受付終了', reload: true }
    case 'NETWORK_ERROR': return { message: '通信失敗。送信未確認' }
    case 'UNAUTHENTICATED': return { message: 'ログイン確認失敗' }
    case 'RATE_LIMITED': return { message: '操作回数上限', retryAfterSeconds: error.retryAfterSeconds ?? 60 }
    case 'MEDIA_TOO_LARGE': return { message: '写真容量超過', retake: true }
    case 'INVALID_INPUT':
    case 'IDEMPOTENCY_CONFLICT': return { message: '写真と位置の確認失敗', retake: true }
    default: return { message: '送信・判定未確認' }
  }
}

export function DemoAnswerSubmission({ context, photo, metadata, disabled, initialSubmitLabel, onSubmissionStarted, onSubmissionResolved, onWaitingChange, initialAttemptId }: {
  context: DemoAnswerContext
  initialAttemptId?: string
  photo?: Blob
  metadata?: CaptureMetadata
  initialSubmitLabel?: string
  disabled: boolean
  onSubmissionStarted: () => void
  onSubmissionResolved?: () => void
  // 判定待ち中だけ親の撮影操作（撮り直し等）を畳むために通知する（t158u）。
  onWaitingChange?: (waiting: boolean) => void
}) {
  const onOpenDiscovery = context.onOpenDiscovery
  const dataMode = context.dataMode
  const real = dataMode === 'durable-local' || dataMode === 'team-preview'
  const [receipt, setReceipt] = useState<ReceiptView | null>(() => initialAttemptId ? { attemptId: initialAttemptId, message: '判定中', canCheck: true } : null)
  const [failure, setFailure] = useState<Failure | null>(null)
  const [pending, setPending] = useState(false)
  const active = useRef<Operation | null>(null)
  const automaticReads = useRef(0)
  const automaticStopped = useRef(false)
  const [pollLimit, setPollLimit] = useState(false)
  const idempotencyKey = useRef<string | null>(null)
  const abort = useCallback(() => {
    const operation = active.current
    active.current = null
    if (operation) { clearTimeout(operation.deadline); operation.controller.abort() }
  }, [])
  useEffect(() => abort, [abort])
  const openedDiscovery = useRef<string | null>(null)
  useEffect(() => {
    if (!receipt?.discoveryId || !onOpenDiscovery || openedDiscovery.current === receipt.discoveryId) return
    // 初回クリアはクリア画面（D-63）を挟むため自動では開かず、「記録を見る」
    // ボタンからの遷移だけにする。クリア済み（ALREADY_CLEARED）は従来どおり自動で開く。
    if (receipt.cleared) return
    openedDiscovery.current = receipt.discoveryId
    onOpenDiscovery(receipt.discoveryId, true)
  }, [receipt, onOpenDiscovery])
  const [clearScreenClosed, setClearScreenClosed] = useState(false)
  const showClearScreen = Boolean(receipt?.cleared && !clearScreenClosed)
  function viewRecord() {
    if (!receipt?.discoveryId || !onOpenDiscovery) { setClearScreenClosed(true); return }
    openedDiscovery.current = receipt.discoveryId
    onOpenDiscovery(receipt.discoveryId)
  }
  function returnToMap() {
    setClearScreenClosed(true)
    context.onReturnToMap?.(receipt?.discoveryId)
  }

  useEffect(() => {
    if (!failure?.retryAfterSeconds) return
    const timer = setTimeout(() => {
      setFailure((current) => current === failure ? (real && receipt?.canCheck ? null : { message: failure.message }) : current)
    }, failure.retryAfterSeconds * 1000)
    return () => clearTimeout(timer)
  }, [failure, real, receipt])

  const cancel = useCallback((message: string) => {
    automaticStopped.current = true
    abort()
    setPending(false)
    setFailure({ message })
  }, [abort])

  const poll = useEffectEvent(() => { void exchange(true) })
  useEffect(() => {
    if (!real || !receipt?.canCheck || pending || failure || automaticStopped.current) return
    if (automaticReads.current >= automaticDelays.length) { setPollLimit(true); return }
    const timer = setTimeout(() => {
      automaticReads.current += 1
      poll()
    }, automaticDelays[automaticReads.current])
    return () => clearTimeout(timer)
  }, [real, receipt, pending, failure])

  useEffect(() => {
    const leave = () => cancel(receipt ? '確認中止' : '送信中止。受付未確認')
    window.addEventListener('pagehide', leave)
    return () => window.removeEventListener('pagehide', leave)
  }, [cancel, receipt])

  async function exchange(automatic = false, retryPhoto = false) {
    if (retryPhoto && receipt?.outcome !== 'SYSTEM_ERROR') return
    const acceptedReceipt = retryPhoto ? null : receipt
    if (active.current || failure?.reload || failure?.retake || failure?.retryAfterSeconds || (acceptedReceipt && !acceptedReceipt.canCheck)) return
    if (retryPhoto) { idempotencyKey.current = null; setReceipt(null) }
    if (!automatic) { automaticReads.current = 0; automaticStopped.current = false; setPollLimit(false) }
    const operation: Operation = { controller: new AbortController() }
    active.current = operation
    if (!acceptedReceipt) onSubmissionStarted()
    setPending(true)
    setFailure(null)
    operation.deadline = setTimeout(() => {
      if (active.current === operation) cancel('送信・判定の時間切れ')
    }, 10_000)
    try {
      const call = { signal: operation.controller.signal }
      if (!acceptedReceipt && (!photo || !metadata)) return
      const response = acceptedReceipt ? await context.api.getAttempt(acceptedReceipt.attemptId, call)
        : await context.api.submitAnswer({ challengeId: context.challengeId, photo: photo!, metadata: metadata!,
          idempotencyKey: idempotencyKey.current ??= crypto.randomUUID() }, call)
      if (active.current !== operation) return
      const nextReceipt = receiptView(response, dataMode, acceptedReceipt?.attemptId)
      setReceipt(nextReceipt)
      saveReceipt(context.storageKey, nextReceipt.canCheck ? nextReceipt.attemptId : null)
      if (!nextReceipt.canCheck) onSubmissionResolved?.()
    } catch (cause) {
      if (active.current !== operation) return
      const next = answerFailure(cause)
      if (next.reload) setReceipt(null)
      setFailure(next)
      // 受付結果が不明な通信失敗・取消では写真と冪等キーを保持する。
      if (!acceptedReceipt && next.retake) onSubmissionResolved?.()
    } finally {
      clearTimeout(operation.deadline)
      if (active.current === operation) { active.current = null; setPending(false) }
    }
  }

  // 判定待ちは「送信〜完了/失敗/上限」まで一つの状態。ポーリングの pending 往復で
  // 「判定を確認」ボタンと待ちカードを出し分けない（チラつきの本態、t157u）。
  const waiting = pending || (real && !!receipt?.canCheck && !failure && !pollLimit)
  // 親の撮り直し等の表示は paint 前に同期する。useEffect だと判定終了直後に
  // failure は見えても judging が残り「撮り直す」が一時的に無い競合が起きた（#149後）。
  useLayoutEffect(() => {
    onWaitingChange?.(waiting)
    return () => { onWaitingChange?.(false) }
  }, [waiting, onWaitingChange])

  if (showClearScreen && photo) {
    return <ClearScreen questTitle={context.questTitle} photo={photo}
      onViewRecord={viewRecord} onReturnToMap={returnToMap} />
  }

  // 判定中は待ちカードだけを出し続ける（マウントは1回）。段階はアプリが
  // 実際に知る区切りだけ（送信中 → 写真確認中）。時間や%の偽進捗は出さない。
  if (waiting) {
    // receipt の有無だけが本当の区切り。ポーリングの pending 往復では段階を動かさない。
    const stage = receipt ? '写真確認中' : '送信中'
    return <div className="camera-actions is-waiting" aria-label="回答受付">
      <div className="answer-waiting" role="status" aria-label="写真の判定待ち">
        <p className="answer-waiting-stage">{stage}</p>
        <div className="answer-waiting-progress" role="progressbar" aria-label="判定の進行状況" aria-valuetext={stage}>
          <span className="answer-waiting-progress-bar" />
        </div>
        <button type="button" className="answer-waiting-cancel" onClick={() => cancel(receipt
          ? '確認中止' : '送信中止。受付未確認')}>キャンセル</button>
      </div>
    </div>
  }

  return <div className="camera-actions" aria-label="回答受付">
    {receipt?.cleared && <ClearCelebration />}
    {receipt?.discoveryId && !photo && <button type="button" className="primary-button" onClick={viewRecord}>記録を見る</button>}
    {receipt && !failure && <p className="answer-result" data-outcome={receipt.outcome} role="status">{receipt.message}</p>}
    {(receipt?.outcome === 'OUTSIDE_AREA' || receipt?.outcome === 'LOCATION_UNCERTAIN') && <p role="status">{context.placeName ?? context.questTitle ?? 'この問題の場所'}：範囲内で撮り直す</p>}
    {receipt?.outcome === 'SYSTEM_ERROR' && photo && metadata && <button type="button" className="secondary-button" onClick={() => void exchange(false, true)}>同じ写真で再送</button>}
    {failure && <p className="answer-result" role="alert">{failure.message}{!failure.retake && !failure.reload && " 判定待ち"}</p>}
    {pollLimit && <p role="status">判定中</p>}
    {(failure?.reload || receipt?.reload) && <button type="button" className="retry-button" onClick={context.onReloadQuest}>問題を再読込</button>}
    {!failure?.reload && !failure?.retake && (!receipt || receipt.canCheck) &&
      <button type="button" className="primary-button" disabled={disabled || !!failure?.retryAfterSeconds} onClick={() => void exchange()}>
        {receipt ? '判定を確認'
          : failure ? '再送する' : initialSubmitLabel ?? (dataMode === 'durable-local' ? 'テスト送信'
            : dataMode === 'team-preview' ? '送信する' : '送信する')}
      </button>}
  </div>
}
