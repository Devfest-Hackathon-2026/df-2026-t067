import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { demoAreaLabel } from './features/quests/demoQuest'
import { QuestDetails } from './features/quests/QuestDetails'
import { QuestReport } from './features/quests/QuestReport'
import type { ChallengeSelection } from './features/quests/QuestDetails'
import { MapPreview } from './features/explore/MapPreview'
import { Icon } from './components/Icon'
import type { AuthClient, AuthSnapshot } from './features/auth/authTypes'
import type { PublicQuest } from './shared/api/types'
import { createApiClient } from './shared/api'
import type { ApiClient, LocalApiDataMode } from './shared/api'
import { CameraPreview } from './features/capture/CameraPreview'
import { ChallengeCapture } from './features/capture/ChallengeCapture'
import { OwnerDiscoveries } from './features/discoveries/OwnerDiscoveries'
import { readDataSource, useQuestConnection, useServerIdentity } from './features/explore/useQuestConnection'
import { AuthError, createFirebaseAuthClient } from './features/auth/firebaseAuth'
import './App.css'

function connectionNotice(auth: AuthSnapshot): { title: string; description: string } {
  switch (auth.status) {
    case 'unconfigured':
      return { title: 'ログイン準備中', description: '問題はログインなしで閲覧できます。ログイン機能は準備中です。' }
    case 'unavailable':
      return { title: 'Googleログインを利用できません', description: auth.message }
    case 'checking':
      return { title: 'ログイン状態を確認中', description: '問題はそのまま閲覧できます。しばらくお待ちください。' }
    case 'signed-out':
      return { title: 'ゲストで閲覧中', description: '問題はログインなしで閲覧できます。写真判定・記録保存は準備中です。' }
    case 'signed-in':
      return { title: 'Googleログイン済み', description: (auth.user.displayName ?? 'Googleアカウント') + 'でログインしています。写真判定・記録保存は準備中です。' }
  }
}

type AppProps = {
  authClient?: AuthClient
  onStartChallenge?: (selection: ChallengeSelection) => void | Promise<unknown>
  quest?: PublicQuest
  areaLabel?: string
  questPicker?: ReactNode
  catalogFallback?: ReactNode
  apiMode?: boolean
  apiDataMode?: LocalApiDataMode
  apiClient?: ApiClient
  onReloadQuest?: () => void
  getHint?: ApiClient['getHint']
  questStale?: boolean
  onHintVersionStale?(): void
}

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

export default function App({ authClient: providedClient, apiClient: providedApi, onStartChallenge, onReloadQuest, getHint: providedGetHint, questStale: providedQuestStale = false, onHintVersionStale, quest: externalQuest, areaLabel: externalAreaLabel, questPicker, catalogFallback, apiMode = false, apiDataMode = 'demo' }: AppProps = {}) {
  const [openState, setOpenState] = useState<{ quest?: PublicQuest; open: boolean }>({ open: false })
  const isQuestOpen = openState.quest === externalQuest && openState.open
  const [recordsOpen, setRecordsOpen] = useState(false)
  const questCard = useRef<HTMLDivElement>(null)
  const authClient = useMemo(() => providedClient ?? createFirebaseAuthClient(), [providedClient])
  const auth = useSyncExternalStore(authClient.subscribe, authClient.getSnapshot, authClient.getSnapshot)
  const source = readDataSource(import.meta.env.VITE_QUEST_DATA_SOURCE, import.meta.env.DEV)
  const localApiMode = apiMode || source === 'local-api'
  const durableLocal = apiMode && apiDataMode === 'durable-local'
  const showRecords = localApiMode && recordsOpen
  const api = useMemo(() => providedApi ?? createApiClient({ getIdToken: () => authClient.getIdToken(),
    expectedDataMode: localApiMode ? apiDataMode : undefined }), [providedApi, authClient, localApiMode, apiDataMode])
  const connection = useQuestConnection(externalQuest || catalogFallback ? 'preview' : source, api)
  const content = connection.result.status === 'ready' ? connection.result.value : null
  const quest = externalQuest ?? (!catalogFallback && content ? (({ areaLabel: _area, ...dto }) => dto)(content) : null)
  const areaLabel = externalAreaLabel ?? content?.areaLabel ?? demoAreaLabel
  const questKey = quest ? `${quest.questId}:${quest.version}` : ''
  const [localStaleQuestKey, setLocalStaleQuestKey] = useState('')
  const questStale = providedQuestStale || (questKey !== '' && localStaleQuestKey === questKey)
  const serverIdentity = useServerIdentity(apiMode || source === 'local-api', api, auth)
  const uid = auth.status === 'signed-in' ? auth.user.uid : null
  const canUseCamera = uid !== null && (!(apiMode || source === 'local-api') || serverIdentity.result?.status === 'ready')
  const [cameraOwner, setCameraOwner] = useState<{ auth: AuthSnapshot; confirmation: typeof serverIdentity.result; questId: string; version: number } | null>(null)
  const [captureRevision, setCaptureRevision] = useState(0)
  const closeCamera = useCallback(() => { setCameraOwner(null); setCaptureRevision((value) => value + 1) }, [])
  const cameraVisible = !questStale && canUseCamera && cameraOwner !== null && cameraOwner.auth === auth && cameraOwner.confirmation === serverIdentity.result && cameraOwner.questId === quest?.questId && cameraOwner.version === quest.version
  const [pending, setPending] = useState<{ client: AuthClient; kind: 'sign-in' | 'sign-out' } | null>(null)
  const pendingRef = useRef(false)
  const lifecycle = useRef(0)
  const selectionGeneration = useRef(0)
  const waitController = useRef<AbortController | null>(null)
  const [feedback, setFeedback] = useState<{ error: boolean; text: string } | null>(null)
  const selectedQuest = useRef(quest)
  const openRef = useRef(isQuestOpen)
  const visiblePending = pending?.client === authClient ? pending.kind : null
  const notice = connectionNotice(auth)

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
    try {
      await authClient.signInWithGoogle()
      if (lifecycle.current !== operation) return
      const signedIn = await waitForSignedIn(authClient, controller.signal)
      if (!signedIn) {
        if (lifecycle.current === operation) setFeedback({ error: true, text: 'ログイン状態を確認できませんでした。問題の閲覧を続けられます。' })
        return
      }
      if (lifecycle.current !== operation || selectionGeneration.current !== generation) return
      if (selection && openRef.current && selectedQuest.current?.questId === selection.questId &&
        selectedQuest.current?.version === selection.expectedVersion && onStartChallenge) await onStartChallenge(selection)
    }
    catch (error) {
      const safe = error instanceof AuthError ? error : new AuthError('unknown')
      if (lifecycle.current === operation) setFeedback({ error: safe.code !== 'cancelled', text: safe.message })
    } finally {
      if (waitController.current === controller) waitController.current = null
      if (lifecycle.current === operation) { pendingRef.current = false; setPending(null) }
    }
  }

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
    closeCamera()
    selectionGeneration.current++
    setFeedback(null)
    setRecordsOpen(open)
  }

  return (
    <>
      <a className="skip-link" href="#main">本文へ移動</a>
      <header className="site-header">
        <div className="brand">
          <span className="brand-mark"><Icon name="compass" /></span>
          <span className="brand-copy">全国観光謎アプリ</span>
        </div>
        <nav className="desktop-nav" aria-label="主要ナビゲーション">
          <a className={showRecords ? undefined : 'nav-active'} href="#explore-title" aria-current={showRecords ? undefined : 'page'}
            onClick={() => navigateToRecords(false)}><Icon name="map" />謎を探す</a>
          <button type="button" className={showRecords ? 'nav-active' : undefined} aria-current={showRecords ? 'page' : undefined}
            disabled={!localApiMode || visiblePending !== null} onClick={() => navigateToRecords(true)}>
            <Icon name="book" />自分の記録{!localApiMode && <span>準備中</span>}
          </button>
        </nav>
        <div className="account-area">
          <div className="account-status" role="status" aria-label="ログイン状態">
            <Icon name="user" /><span>{notice.title}</span>
            <span className="sr-only">{notice.description}</span>
          </div>
          {auth.status === 'signed-in' && (
            <button type="button" className="logout-button" disabled={visiblePending !== null} onClick={logout}>
              {visiblePending === 'sign-out' ? 'ログアウト中…' : 'ログアウト'}
            </button>
          )}
        </div>
      </header>

      <main id="main" className="page" tabIndex={-1}>
        {showRecords ? <section className="owner-records" aria-labelledby="records-title">
          <h1 id="records-title">自分の記録</h1>
          <p className="sample-note">開発用の本人記録です。</p>
          <button type="button" className="secondary-button" onClick={() => navigateToRecords(false)}>地図へ戻る</button>
          {auth.status === 'signed-out' && <button type="button" className="primary-button" disabled={visiblePending !== null}
            onClick={() => void login()}>Googleログインして記録を見る</button>}
          {auth.status === 'checking' && <p role="status">ログイン状態を確認しています…</p>}
          {(auth.status === 'unconfigured' || auth.status === 'unavailable') && <p role="status">{notice.description}</p>}
          {uid !== null && visiblePending === null && (serverIdentity.result?.status === 'ready'
            ? <OwnerDiscoveries key={uid} api={api} />
            : serverIdentity.result?.status === 'error'
              ? <><p role="alert">ログインを確認できませんでした。</p><button type="button" className="retry-button" onClick={serverIdentity.retry}>ログインを確認し直す</button></>
              : <p role="status">ログインを確認しています…</p>)}
          {feedback && <p className="auth-feedback" role={feedback.error ? 'alert' : 'status'}>{feedback.text}</p>}
        </section> : catalogFallback ?? <>
        <section className="explore" aria-labelledby="explore-title">
          <div className="explore-heading">
            <div>
              <h1 id="explore-title">全国から謎を探す</h1>
            </div>
            <span className={'preview-label' + (apiMode ? ' api-source' : '')}><span className="status-dot" />{durableLocal ? '永続API・ローカル' : apiMode ? '公開API・デモ' : '開発用プレビュー'}</span>
          </div>

          <div className="explore-workspace">
            <MapPreview />

            <aside className="quest-rail" aria-label="選べる謎">
              <div className="rail-heading"><h2>選べる謎</h2>{!apiMode && <span>1件</span>}</div>
              {questPicker}
              <div ref={questCard}>
                {quest ? <QuestDetails quest={quest} areaLabel={areaLabel} sourceLabel={apiMode ? '公開APIデモデータ' : undefined} open={isQuestOpen}
                  getHint={providedGetHint ?? api.getHint} stale={questStale}
                  onHintVersionChanged={() => { closeCamera(); selectionGeneration.current++; waitController.current?.abort(); setLocalStaleQuestKey(questKey); onHintVersionStale?.() }}
                  onReloadQuest={() => { if (externalQuest) onReloadQuest?.(); else connection.retry() }}
                  hideStartAction={!onStartChallenge && (apiMode || source === 'local-api') && canUseCamera && visiblePending === null}
                  disabled={questStale || visiblePending !== null || (auth.status !== 'signed-out' && auth.status !== 'signed-in') || (auth.status === 'signed-in' && (onStartChallenge ? false : !canUseCamera || cameraVisible))}
                  buttonLabel={visiblePending === 'sign-in' ? '処理中…' : auth.status === 'signed-in' ? (onStartChallenge ? '挑戦を開始する' : cameraVisible ? '撮影中' : serverIdentity.result?.status === 'loading' ? 'ログインの確認中…' : serverIdentity.result?.status === 'error' ? 'ログインの確認待ち' : '撮影を始める') : 'Googleログインして挑戦する'}
                  note={questStale ? '問題の版を確認できていません。最新版を読み直すまで挑戦できません。'
                    : auth.status === 'signed-in' && !onStartChallenge ? serverIdentity.result?.status === 'ready' ? 'ログインを確認しました。写真はこの画面で確認するだけです。' : serverIdentity.result?.status === 'loading' ? 'ログインを確認しています…' : '問題の閲覧は続けられます。ログイン確認後に撮影できます。'
                    : auth.status === 'signed-in' ? 'ログイン済みです。挑戦開始先へ選んだ問題を渡します。'
                      : auth.status === 'signed-out' ? 'Googleのログイン画面を開きます。キャンセルしてもこの問題に戻れます。'
                        : auth.status === 'checking' ? 'ログイン状態の確認後に操作できます。'
                          : 'ログイン機能は準備中です。問題はそのまま閲覧できます。'}
                  feedback={feedback} onToggle={() => { const next = !openRef.current; selectionGeneration.current += 1; openRef.current = next; if (!next) closeCamera(); setOpenState({ quest: externalQuest, open: next }) }} onStart={(selection) => { if (onStartChallenge) return login(selection); if (auth.status === 'signed-in' && canUseCamera && quest) setCameraOwner({ auth, confirmation: serverIdentity.result, questId: selection.questId, version: selection.expectedVersion }); else return login(selection) }}>
                    {!questStale && !onStartChallenge && (apiMode || source === 'local-api') && canUseCamera && uid !== null && visiblePending === null && <ChallengeCapture
                      key={JSON.stringify([uid, quest.questId, quest.version, captureRevision])} api={api} quest={quest} dataMode={apiDataMode}
                      onReloadQuest={() => { closeCamera(); if (externalQuest) onReloadQuest?.(); else connection.retry() }} />}
                    {auth.status === 'signed-in' && serverIdentity.result?.status === 'error' && <div className="auth-feedback"><p role="alert">ログインを確認できませんでした。時間をおいて再試行してください。</p><button type="button" className="retry-button" onClick={serverIdentity.retry}>ログインを確認し直す</button></div>}
                    {cameraVisible && uid !== null && <CameraPreview key={uid} onClose={closeCamera} />}
                    {localApiMode && !durableLocal && <QuestReport key={questKey} api={api} questId={quest.questId}
                      ownerUid={canUseCamera && visiblePending === null ? uid : null} canSignIn={auth.status === 'signed-out'}
                      signInPending={visiblePending !== null} onSignIn={() => void login()} />}
                  </QuestDetails>
                  : connection.result.status === 'loading' ? <p role="status" aria-label="問題の読み込み">問題を読み込んでいます…</p> : <div role="alert">{source === 'invalid' ? '表示設定を確認してください。' : '問題を読み込めませんでした。'}<button type="button" className="retry-button" onClick={connection.retry}>問題を再読み込み</button></div>}
              </div>
              <p className="browse-note">問題の閲覧にログインは必要ありません。</p>
              <div className="demo-note"><span className="demo-note-dot" /><p>{durableLocal ? '永続APIの確認用です。回答の送信には合成画像と架空の座標を使ってください。' : apiMode ? '公開APIが返す架空のデモデータです。実際に訪問できる場所ではありません。' : '今はデザイン確認用の架空の1問を表示しています。実際に訪問できる場所ではありません。'}</p></div>
            </aside>
          </div>
        </section>
        {!isQuestOpen && feedback && <p className="auth-feedback" role={feedback.error ? 'alert' : 'status'}>{feedback.text}</p>}
        </>}
      </main>
      <footer className="site-footer"><span>場所・問題は架空の開発用デモです。</span></footer>
      <nav className="mobile-nav" aria-label="スマホ用ナビゲーション">
        <a href="#explore-title" aria-current={showRecords ? undefined : 'page'} onClick={() => navigateToRecords(false)}><Icon name="map" /><span>謎を探す</span></a>
        <button type="button" aria-current={showRecords ? 'page' : undefined} disabled={!localApiMode || visiblePending !== null}
          onClick={() => navigateToRecords(true)}><Icon name="book" /><span>自分の記録{!localApiMode && <small>準備中</small>}</span></button>
      </nav>
    </>
  )
}
