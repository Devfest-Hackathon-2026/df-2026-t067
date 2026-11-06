import { useCallback, useEffect, useRef, useState } from 'react'
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
    case 'QUEST_CHANGED': return { status, reload: true, message: '問題が更新されました。読み直してから挑戦してください。' }
    case 'NOT_FOUND':
    case 'QUEST_UNAVAILABLE': return { status, reload: true, message: 'この問題では挑戦を始められません。問題を読み直してください。' }
    case 'UNAUTHENTICATED': return { status, message: 'ログインを確認できませんでした。再試行するか、一度ログアウトしてログインし直してください。' }
    case 'AUTH_UNAVAILABLE': return { status, message: '現在ログイン確認を利用できません。時間をおいて再試行してください。' }
    case 'RATE_LIMITED': return { status, message: '開始の操作が多いため、少しお待ちください。', retryAt: Date.now() + (error.retryAfterSeconds ?? 60) * 1000 }
    case 'NETWORK_ERROR': return { status, message: '通信状況を確認して、もう一度お試しください。' }
    default: return { status, message: '挑戦の開始を確認できませんでした。時間をおいて再試行してください。' }
  }
}

// The parent keys this component by verified user, selected quest/version and
// navigation revision. Leaving any of them disposes the operation and camera.
export function ChallengeCapture({ api, quest, onReloadQuest, dataMode = 'demo' }: {
  api: ApiClient; quest: PublicQuest; onReloadQuest: () => void; dataMode?: LocalApiDataMode
}) {
  const [state, setState] = useState<StartState>({ status: 'idle' })
  const [cameraOpen, setCameraOpen] = useState(false)
  const [clock, setClock] = useState(0)
  const active = useRef<Operation | null>(null)
  const closeCamera = useCallback(() => setCameraOpen(false), [])

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
    if (active.current || cameraOpen || (state.status === 'error' && (state.reload || (state.retryAt ?? 0) > Date.now()))) return
    const operation: Operation = { controller: new AbortController() }
    active.current = operation
    setState({ status: 'starting' })
    operation.deadline = setTimeout(() => {
      if (active.current !== operation) return
      abort()
      setState({ status: 'error', message: '開始の確認に時間がかかっています。通信状況を確認して再試行してください。' })
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

  return <>
    <button type="button" className="primary-button" onClick={start} aria-describedby="challenge-note"
      disabled={state.status === 'starting' || cameraOpen || seconds > 0 || (state.status === 'error' && state.reload)}>
      {state.status === 'starting' ? '挑戦を開始しています…' : cameraOpen ? '撮影中' : state.status === 'ready' ? '撮影を再開' : '挑戦を始める'}
    </button>
    <p id="challenge-note" className="unavailable-note" role="status">
      {state.status === 'ready' ? (dataMode === 'durable-local' ? '挑戦を開始しました。写真と位置を確認してからテスト送信できます。'
        : '挑戦を開始しました。写真と位置を確認してからデモ送信できます。')
        : state.status === 'starting' ? 'サーバーで挑戦の開始を確認しています…'
          : dataMode === 'durable-local' ? 'ログインを確認しました。合成素材で回答と判定を試せます。' : 'ログインを確認しました。デモの回答受付を試せます。'}
    </p>
    {state.status === 'starting' && <button type="button" className="retry-button" onClick={() => { abort(); setState({ status: 'idle' }) }}>開始をキャンセル</button>}
    {state.status === 'error' && <div className="auth-feedback">
      <p role="alert">{state.message}{seconds > 0 && ` ${seconds}秒後に再試行できます。`}</p>
      {state.reload && <button type="button" className="retry-button" onClick={onReloadQuest}>問題を読み直す</button>}
    </div>}
    {state.status === 'ready' && cameraOpen && <CameraPreview onClose={closeCamera}
      answer={{ api, challengeId: state.challenge.challengeId, onReloadQuest, dataMode }} />}
  </>
}
