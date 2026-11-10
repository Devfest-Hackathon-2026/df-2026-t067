import { DemoAnswerSubmission } from './DemoAnswerSubmission'
import { openedHints, readReceipt, receiptKey } from './captureContinuity'
import { QuestHandoff } from '../../components/QuestHandoff'
import { questHandoffUrl } from '../quests/questHandoffUrl'
import { useWideViewport } from '../quests/useWideViewport'
import type { ComponentProps } from 'react'
import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react'
import { ApiError } from '../../shared/api'
import type { ApiClient, Challenge, LocalApiDataMode, PublicQuest } from '../../shared/api'
import { CameraPreview } from './CameraPreview'

type StartState = { status: 'idle' | 'starting' }
  | { status: 'ready'; challenge: Challenge }
  | { status: 'error'; message: string; reload?: boolean; retryAt?: number }
type Operation = { controller: AbortController; deadline?: ReturnType<typeof setTimeout> }

function failure(cause: unknown): Extract<StartState, { status: 'error' }> {
  const error = cause instanceof ApiError ? cause : new ApiError('SYSTEM_ERROR')
  const status = 'error'
  switch (error.code) {
    case 'QUEST_CHANGED': return { status, reload: true, message: '問題更新' }
    case 'NOT_FOUND':
    case 'QUEST_UNAVAILABLE': return { status, reload: true, message: '挑戦受付終了' }
    case 'UNAUTHENTICATED': return { status, message: 'ログイン確認失敗' }
    case 'AUTH_UNAVAILABLE': return { status, message: 'ログイン確認停止' }
    case 'RATE_LIMITED': return { status, message: '開始回数上限', retryAt: Date.now() + (error.retryAfterSeconds ?? 60) * 1000 }
    case 'NETWORK_ERROR': return { status, message: '通信失敗' }
    default: return { status, message: '開始確認失敗' }
  }
}

// The parent keys this component by verified user, selected quest/version and
// navigation revision. Leaving any of them disposes the operation and camera.
export function ChallengeCapture(props: ComponentProps<typeof MobileChallengeCapture>) {
  const wide = useWideViewport()
  if (wide) return <QuestHandoff value={questHandoffUrl(props.quest)} title={props.quest.title} />
  return <MobileChallengeCapture {...props} />
}

function MobileChallengeCapture({ api, quest, onReloadQuest, onOpenDiscovery, onReturnToMap, autoStart = false, canAutoStart, onAutoStartConsumed, dataMode = 'demo', ownerKey = 'session', placeName }: {
  placeName?: string; ownerKey?: string; api: ApiClient; quest: PublicQuest; onReloadQuest: () => void; autoStart?: boolean; canAutoStart?: () => boolean; onAutoStartConsumed?: () => void; dataMode?: LocalApiDataMode; onOpenDiscovery?: (id: string, alreadyCleared?: boolean) => void
  // クリア画面の「地図に戻る」が押された通知。カメラを閉じた後に呼び出し側へ返す。
  onReturnToMap?: (discoveryId?: string) => void
}) {
  const [state, setState] = useState<StartState>({ status: 'idle' })
  const storageKey = dataMode === 'durable-local' || dataMode === 'team-preview' ? receiptKey(ownerKey, quest.questId) : undefined
  const [savedReceipt, setSavedReceipt] = useState(() => readReceipt(storageKey))
  const [receiptResolved, setReceiptResolved] = useState(false)
  const [resume, setResume] = useState(false)
  const [cameraOpen, setCameraOpen] = useState(false)
  const [clock, setClock] = useState(0)
  const active = useRef<Operation | null>(null)
  const closeCamera = useCallback(() => { setCameraOpen(false); setSavedReceipt(readReceipt(storageKey)) }, [storageKey])

  function abort() {
    const operation = active.current
    active.current = null
    if (operation) { clearTimeout(operation.deadline); operation.controller.abort() }
  }

  useEffect(() => {
    const leave = () => { abort(); setCameraOpen(false); setState({ status: 'idle' }) }
    window.addEventListener('pagehide', leave)
    return () => { abort(); window.removeEventListener('pagehide', leave) }
  }, [])

  const retryAt = state.status === 'error' ? state.retryAt : undefined
  const seconds = retryAt === undefined ? 0 : Math.max(0, Math.ceil((retryAt - clock) / 1000))
  useEffect(() => {
    if (retryAt === undefined || retryAt <= clock) return
    const timer = setTimeout(() => setClock(Date.now()), Math.min(1000, retryAt - clock))
    return () => clearTimeout(timer)
  }, [clock, retryAt])

  async function start() {
    if ((savedReceipt && !receiptResolved) || active.current || cameraOpen || (state.status === 'error' && (state.reload || (state.retryAt ?? 0) > Date.now()))) return
    const operation: Operation = { controller: new AbortController() }
    active.current = operation
    setState({ status: 'starting' })
    operation.deadline = setTimeout(() => {
      if (active.current !== operation) return
      abort()
      setState({ status: 'error', message: '開始確認の時間切れ' })
    }, 10_000)
    try {
      const challenge = await api.createChallenge({ questId: quest.questId, expectedVersion: quest.version }, { signal: operation.controller.signal })
      if (operation.controller.signal.aborted || active.current !== operation) return
      if (challenge.questId !== quest.questId || challenge.version !== quest.version) throw new ApiError('INVALID_RESPONSE')
      setState({ status: 'ready', challenge })
      setCameraOpen(true)
    } catch (cause) {
      if (operation.controller.signal.aborted || active.current !== operation) return
      setClock(Date.now())
      setState(failure(cause))
    } finally {
      clearTimeout(operation.deadline)
      if (active.current === operation) active.current = null
    }
  }

  const continueIntent = useEffectEvent(() => {
    if (!autoStart || !canAutoStart?.()) return
    void start()
    onAutoStartConsumed?.()
  })
  useEffect(() => {
    if (!autoStart) return
    const timer = setTimeout(() => continueIntent(), 0)
    return () => clearTimeout(timer)
  }, [autoStart])

  return <>
    {savedReceipt && !cameraOpen && !resume && <div><p role="status">判定中</p><button type="button" className="primary-button" onClick={() => setResume(true)}>判定を確認</button></div>}
    {savedReceipt && !cameraOpen && resume && <DemoAnswerSubmission context={{ api, challengeId: '', questId: quest.questId, questTitle: quest.title, placeName, storageKey, dataMode, onReloadQuest, onOpenDiscovery, onReturnToMap }} initialAttemptId={savedReceipt} onSubmissionResolved={() => setReceiptResolved(true)} disabled={false} onSubmissionStarted={() => {}} />}
    {(!savedReceipt || receiptResolved) && <button type="button" className={savedReceipt && !receiptResolved ? "secondary-button" : "primary-button"} onClick={start}
      disabled={Boolean(savedReceipt && !receiptResolved) || state.status === 'starting' || cameraOpen || seconds > 0 || (state.status === 'error' && state.reload)}>
      {state.status === 'starting' ? '開始中' : cameraOpen ? '撮影中' : state.status === 'ready' ? '撮影を再開' : '挑戦する'}
    </button>}
    {state.status === 'starting' && <button type="button" className="retry-button" onClick={() => { abort(); setState({ status: 'idle' }) }}>キャンセル</button>}
    {state.status === 'error' && <div className="auth-feedback">
      <p role="alert">{state.message}{seconds > 0 && ` ${seconds}秒後に再試行`}</p>
      {state.reload && <button type="button" className="retry-button" onClick={onReloadQuest}>問題を再読込</button>}
    </div>}
    {state.status === 'ready' && cameraOpen && <CameraPreview onClose={closeCamera} handoffUrl={questHandoffUrl(quest)}
      clue={quest.clue} hints={Object.values(openedHints.get(`${quest.questId}:${quest.version}`) ?? {})} answer={{ placeName, storageKey, questId: quest.questId, api, challengeId: state.challenge.challengeId, onReloadQuest, dataMode, onOpenDiscovery, questTitle: quest.title, onReturnToMap: (discoveryId) => { closeCamera(); onReturnToMap?.(discoveryId) } }} />}
  </>
}
