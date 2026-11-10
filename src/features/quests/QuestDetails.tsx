import { openedHints } from '../capture/captureContinuity'
import type { PublicQuest } from '../../shared/api/types'
import { Icon } from '../../components/Icon'
import { QuestHandoff } from '../../components/QuestHandoff'
import { questHandoffUrl } from './questHandoffUrl'
import { useWideViewport } from './useWideViewport'
import { ShootingConditionIndicators } from '../../components/ShootingConditionIndicators'
import type { createApiClient } from '../../shared/api/client'
import { ApiError } from '../../shared/api/client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useId } from 'react'
import type { ReactNode } from 'react'
import type { MouseEvent } from 'react'
import type { QuestHint } from '../../shared/api/types'

export type ChallengeSelection = Parameters<ReturnType<typeof createApiClient>['createChallenge']>[0]
type GetHint = (input: { questId: string; expectedVersion: number; index: number }, call?: { signal?: AbortSignal }) => Promise<QuestHint>
const getHintIdentities = new WeakMap<GetHint, number>()
let nextGetHintIdentity = 1
function getHintIdentity(getHint?: GetHint) {
  if (!getHint) return 0
  let identity = getHintIdentities.get(getHint)
  if (!identity) { identity = nextGetHintIdentity++; getHintIdentities.set(getHint, identity) }
  return identity
}

type HintLoadState = { status: 'idle' | 'loading' | 'ready' | 'error' | 'changed'; text?: string; message?: string }

function QuestHints({ quest, getHint, getHintPhoto, stale, onVersionChanged, onReloadNeeded }: { quest: PublicQuest; getHint?: GetHint; getHintPhoto?: HintPhoto; stale: boolean; onVersionChanged(): void; onReloadNeeded(index: number, needed: boolean): void }) {
  const { questId, version, hintCount } = quest
  const [changed, setChanged] = useState(false)
  const [opened, setOpened] = useState(false)
  const [currentIndex, setCurrentIndex] = useState(1)
  const [unlockedThrough, setUnlockedThrough] = useState(1)
  const [cache, setCache] = useState<Record<number, string>>({})
  const [state, setState] = useState<HintLoadState>({ status: 'idle' })
  const controllerRef = useRef<AbortController | null>(null)
  const timeoutRef = useRef<number | null>(null)
  const generation = useRef(0)
  const stepRefs = useRef<Record<number, HTMLButtonElement | null>>({})
  const openRef = useRef<HTMLButtonElement>(null)

  useEffect(() => () => {
    generation.current++
    controllerRef.current?.abort()
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current)
  }, [])

  useEffect(() => {
    if (state.status === 'ready') stepRefs.current[currentIndex]?.focus()
  }, [state.status, currentIndex])

  async function load(index: number) {
    if (cache[index]) {
      setCurrentIndex(index)
      setState({ status: 'ready', text: cache[index] })
      onReloadNeeded(index, false)
      return
    }
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    const currentGeneration = ++generation.current
    let timedOut = false
    const timeout = window.setTimeout(() => {
      timedOut = true
      if (generation.current !== currentGeneration) return
      generation.current++
      controller.abort()
      setState({ status: 'error', message: '時間切れ' })
    }, 10_000)
    timeoutRef.current = timeout
    setOpened(true)
    setCurrentIndex(index)
    onReloadNeeded(index, false)
    setState({ status: 'loading' })
    try {
      const hint = await getHint!({ questId, expectedVersion: version, index }, { signal: controller.signal })
      if (controller.signal.aborted || generation.current !== currentGeneration) return
      setCache((current) => ({ ...current, [index]: hint.text }))
      const key = `${questId}:${version}`
      openedHints.set(key, { ...openedHints.get(key), [index]: hint.text })
      setState({ status: 'ready', text: hint.text })
      setUnlockedThrough((current) => Math.max(current, index + 1))
    } catch (error) {
      if (generation.current !== currentGeneration) return
      if (error instanceof ApiError && error.code === 'QUEST_CHANGED') {
        setState({ status: 'changed' })
        setChanged(true)
        onVersionChanged()
      } else if (controller.signal.aborted && !timedOut) return
      else {
        const reloadNeeded = error instanceof ApiError && (error.code === 'NOT_FOUND' || error.code === 'INVALID_INPUT')
        onReloadNeeded(index, reloadNeeded)
        setState({ status: 'error', message: timedOut ? '時間切れ'
          : error instanceof ApiError && error.code === 'NOT_FOUND' ? 'ヒントなし。問題を再読込'
            : error instanceof ApiError && error.code === 'INVALID_INPUT' ? 'ヒント番号エラー'
              : error instanceof ApiError && error.code === 'INVALID_RESPONSE' ? 'ヒント確認失敗'
                : 'ヒント取得失敗' })
      }
    } finally {
      window.clearTimeout(timeout)
      if (timeoutRef.current === timeout) timeoutRef.current = null
    }
  }

  function cancelLoad() {
    generation.current++
    controllerRef.current?.abort()
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current)
    timeoutRef.current = null
    onReloadNeeded(currentIndex, false)
    if (cache[currentIndex]) setState({ status: 'ready', text: cache[currentIndex] })
    else {
      setOpened(false)
      setState({ status: 'idle' })
      queueMicrotask(() => openRef.current?.focus())
    }
  }

  if (stale || changed) return <div role="alert" className="hint-version-changed"><p>問題更新。再読込</p></div>
  if (!getHint) return null
  if (!hintCount) return null


  return <div className="quest-hints" aria-label="ヒント">
    <p>ヒントは順番に開けます</p>
    {!opened && <button ref={openRef} type="button" className="hint-open" onClick={() => void load(1)}>ヒントを見る</button>}
    {opened && <div className="hint-card" aria-live="polite">
      <div className="hint-card-toolbar">
        <div className="hint-card-steps" aria-label={`ヒント ${currentIndex} / ${hintCount}`}>
          {Array.from({ length: hintCount }, (_, offset) => offset + 1).map((index) => {
            const reachable = index <= unlockedThrough
            return <button key={index} ref={(element) => { stepRefs.current[index] = element }} type="button" className={'hint-step' + (index === currentIndex ? ' is-current' : '')}
              aria-current={index === currentIndex ? 'step' : undefined}
              aria-disabled={!reachable || state.status === 'loading'}
              title={!reachable ? 'まだ開けません' : undefined}
              disabled={!reachable || state.status === 'loading'}
              onClick={() => { if (index !== currentIndex) void load(index) }}><span>{index}</span>{!reachable && <span aria-hidden="true" className="hint-step-lock">🔒</span>}</button>
          })}
          <span className="hint-step-total">/ {hintCount}</span>
        </div>
      </div>
      {state.status === 'loading' && <>
        <p role="status">ヒント取得中</p>
        <button type="button" className="hint-cancel" onClick={cancelLoad}>キャンセル</button>
      </>}
      {state.status === 'ready' && <>
        <p className="hint-card-text">{state.text}</p>
        {quest.hintImages?.[currentIndex - 1] && <OptionalHintImage url={quest.hintImages[currentIndex - 1]!} quest={quest}
          index={currentIndex} inline getPhoto={getHintPhoto} onRetryFocus={() => { (document.querySelector('.hint-step.is-current') as HTMLButtonElement | null)?.focus() }}
          onVersionChanged={() => { setChanged(true); onVersionChanged() }}
          onReloadNeeded={(needed) => onReloadNeeded(currentIndex, needed)} />}
      </>}
      {state.status === 'error' && <div role="alert"><p>{state.message}</p>
        <button type="button" className="hint-retry" onClick={() => void load(currentIndex)}>再試行</button>
      </div>}
      {state.status === 'changed' && <div role="alert"><p>問題更新。再読込</p><button type="button" onClick={onVersionChanged}>問題を再読込</button></div>}

    </div>}
  </div>
}

type HintPhoto = ReturnType<typeof createApiClient>['getPublishedHintPhoto']
const hintImageReloadIndex = 0
const getPhotoIdentities = new WeakMap<HintPhoto, number>()
let nextGetPhotoIdentity = 1
function getPhotoIdentity(getPhoto?: HintPhoto) {
  if (!getPhoto) return 0
  let identity = getPhotoIdentities.get(getPhoto)
  if (!identity) { identity = nextGetPhotoIdentity++; getPhotoIdentities.set(getPhoto, identity) }
  return identity
}

function ProtectedHintImage({ getPhoto, questId, version, index, alt, hidden, active, onLoad, onError }: {
  getPhoto: HintPhoto; questId: string; version: number; index?: number; alt: string; hidden: boolean
  /** 開いている間だけ取得する。閉じ始めたら進行中の取得を破棄し、閉じた後の
      遅延解決でオブジェクトURLを作らない（従来はアンマウントが担っていた）。 */
  active: boolean
  onLoad(): void; onError(error?: unknown): void
}) {
  const [source, setSource] = useState<string>()
  const onErrorRef = useRef(onError)
  useEffect(() => { onErrorRef.current = onError }, [onError])
  useEffect(() => {
    if (!active) return
    const controller = new AbortController()
    let url: string | undefined
    void (index === undefined ? getPhoto(questId, version, { signal: controller.signal }) : getPhoto(questId, version, index, { signal: controller.signal })).then((photo) => {
      if (controller.signal.aborted) return
      url = URL.createObjectURL(photo)
      setSource(url)
    }).catch((error: unknown) => { if (!controller.signal.aborted) onErrorRef.current(error) })
    return () => {
      controller.abort()
      if (url) URL.revokeObjectURL(url)
    }
  }, [active, getPhoto, index, questId, version])
  return source && <img src={source} alt={alt} className="optional-hint-image"
    style={{ display: hidden ? 'none' : undefined }} onLoad={onLoad} onError={onError} />
}

function OptionalHintImage({ url, quest, index, inline = false, getPhoto, onRetryFocus, onVersionChanged, onReloadNeeded }: {
  url: string; quest: PublicQuest; index?: number; inline?: boolean; getPhoto?: HintPhoto; onRetryFocus?(): void; onVersionChanged(): void; onReloadNeeded(needed: boolean): void
}) {
  const toggleRef = useRef<HTMLButtonElement>(null)
  const [expanded, setExpanded] = useState(inline)
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error' | 'timeout' | 'reload' | 'auth'>('loading')
  const [authCode, setAuthCode] = useState<'UNAUTHENTICATED' | 'FORBIDDEN'>('UNAUTHENTICATED')
  const [attempt, setAttempt] = useState(0)
  const alt = `${quest.title}のヒント画像`
  const attemptRef = useRef(0)
  const finishedAttemptRef = useRef(-1)
  const timeoutRef = useRef<number | null>(null)
  // 閉じる間は最後の内容を保持し、畳むアニメーション（280ms）の後に外す
  // （D-59 追記、行アコーディオンと同じ考え方）。
  const [closing, setClosing] = useState(false)
  const closeTimerRef = useRef<number | null>(null)
  useEffect(() => () => {
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current)
  }, [])

  useEffect(() => {
    if (!expanded || status !== 'loading') return
    const currentAttempt = attemptRef.current
    timeoutRef.current = window.setTimeout(() => {
      timeoutRef.current = null
      if (attemptRef.current === currentAttempt && finishedAttemptRef.current !== currentAttempt) {
        finishedAttemptRef.current = currentAttempt
        setStatus('timeout')
      }
    }, 10_000)
    return () => {
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }, [expanded, attempt, status])

  const finishAttempt = useCallback((nextStatus: 'loaded' | 'error' | 'reload' | 'auth', imageAttempt: number) => {
    if (!expanded || imageAttempt !== attemptRef.current || finishedAttemptRef.current === imageAttempt) return
    finishedAttemptRef.current = imageAttempt
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current)
    timeoutRef.current = null
    setStatus(nextStatus)
  }, [expanded])
  const onLoad = useCallback(() => finishAttempt('loaded', attempt), [attempt, finishAttempt])
  const onError = useCallback((error?: unknown) => {
    if (!expanded || attempt !== attemptRef.current || finishedAttemptRef.current === attempt) return
    if (error instanceof ApiError && error.code === 'QUEST_CHANGED') {
      finishAttempt('reload', attempt)
      onVersionChanged()
      return
    }
    if (error instanceof ApiError && (error.code === 'NOT_FOUND' || error.code === 'INVALID_INPUT')) {
      finishAttempt('reload', attempt)
      onReloadNeeded(true)
      return
    }
    if (error instanceof ApiError && (error.code === 'UNAUTHENTICATED' || error.code === 'FORBIDDEN')) {
      setAuthCode(error.code)
      finishAttempt('auth', attempt)
      return
    }
    finishAttempt('error', attempt)
  }, [attempt, expanded, finishAttempt, onReloadNeeded, onVersionChanged])
  return <div className="optional-hint">
    {!inline && <button ref={toggleRef} type="button" className="optional-hint-toggle" aria-expanded={expanded}
      onClick={() => {
        if (expanded) {
          attemptRef.current++
          if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current)
          timeoutRef.current = null
          setExpanded(false)
          // 状態の初期化は畳み終わってから。中身は closing の間保持する。
          setClosing(true)
          if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current)
          closeTimerRef.current = window.setTimeout(() => {
            closeTimerRef.current = null
            setClosing(false)
            setStatus('loading')
          }, 300)
        } else {
          if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current)
          closeTimerRef.current = null
          setClosing(false)
          onReloadNeeded(false)
          attemptRef.current++
          finishedAttemptRef.current = -1
          setAttempt(attemptRef.current)
          setStatus('loading')
          setExpanded(true)
        }
      }}>
      ヒント画像
    </button>}
    {/* 開閉の枠は行アコーディオン（D-59）と同じく常時マウントし、開状態のクラスだけで
        grid-template-rows を切り替える（D-59 追記）。中身は開いている間と、閉じ終わる
        までの間だけが持つ。 */}
    <div className={'optional-hint-content-wrap' + (expanded ? ' is-open' : '')}
      aria-hidden={!expanded || undefined}>
      <div className="optional-hint-content-clip">
      {(expanded || closing) && <div className="optional-hint-content" aria-live="polite">
      {status === 'loading' && <p role="status">画像読込中</p>}
      {(status === 'error' || status === 'timeout') && <div role="alert"><p>{status === 'timeout' ? '時間切れ' : '画像読込失敗'}</p>
        <button type="button" className="optional-hint-retry" onClick={() => {
          if (onRetryFocus) onRetryFocus()
          else toggleRef.current?.focus()
          attemptRef.current++
          finishedAttemptRef.current = -1
          setAttempt(attemptRef.current)
          setStatus('loading')
        }}>再試行</button>
      </div>}
      {status === 'reload' && <div role="alert"><p>問題の再読込が必要</p></div>}
      {status === 'auth' && <div role="alert"><p>{authCode === 'UNAUTHENTICATED'
        ? '画像表示失敗。再読込'
        : '画像アクセス拒否'}</p>
        <button type="button" className="optional-hint-retry" onClick={() => {
          if (onRetryFocus) onRetryFocus()
          else toggleRef.current?.focus()
          attemptRef.current++
          finishedAttemptRef.current = -1
          setAttempt(attemptRef.current)
          setStatus('loading')
        }}>再試行</button>
      </div>}
      {(status === 'loading' || status === 'loaded') && (getPhoto
        ? <ProtectedHintImage key={attempt} getPhoto={getPhoto} questId={quest.questId} version={quest.version} index={index}
          alt={alt} hidden={status !== 'loaded'} active={expanded}
          onLoad={onLoad} onError={onError} />
        : <img key={attempt} src={url} alt={alt} className="optional-hint-image"
        style={{ display: status === 'loaded' ? undefined : 'none' }}
        onLoad={onLoad} onError={onError} />)}
      </div>}
      </div>
    </div>
  </div>
}

interface QuestDetailsProps {
  quest: PublicQuest
  areaLabel: string
  open: boolean
  disabled: boolean
  buttonLabel: string
  note?: string
  sourceLabel?: string
  detailsLabel?: string
  feedback?: { error: boolean; text: string } | null
  onToggle(): void
  onStart(selection: ChallengeSelection): void | Promise<unknown>
  getHint?: GetHint
  getHintPhoto?: HintPhoto
  onHintVersionChanged?(): void
  onReloadQuest?(event?: MouseEvent<HTMLButtonElement>): void
  children?: ReactNode
  hideStartAction?: boolean
  /** 一覧の中の詳細（D-46 のアコーディオン）では開閉ボタンを出さない（D-65）。
      閉じる操作は一覧の行の再タップによる選択解除（D-55）に一本化し、詳細の中に
      別の閉じ方を持たせない。レールに置く使い方（固定問題の埋め込み・デモ表示等、
      選択の受け口が無い場合）では従来どおりこのボタンが開閉を担う。 */
  hideToggle?: boolean
  stale?: boolean
  handoffUrl?: string
  /** ログイン中の本人がこの問題をクリア済みの時の記録ID（D-64）。渡されたら
      挑戦開始の導線は出さず、「クリア済み」表示と記録への導線に置き換える。
      クリアは1人1問につき1回だけで、再挑戦はできない。 */
  clearedDiscoveryId?: string
  /** 「記録を見る」の受け口。クリア済み表示から本人の記録詳細へ進む。 */
  onOpenDiscovery?: (discoveryId: string) => void
}

export function QuestDetails({ quest, open, disabled, buttonLabel, note, sourceLabel = '', detailsLabel = 'サンプル問題の詳細', feedback, onToggle, onStart, children, hideStartAction = false, hideToggle = false, stale = false, getHint, getHintPhoto, onHintVersionChanged = () => {}, onReloadQuest = () => {}, handoffUrl, clearedDiscoveryId, onOpenDiscovery }: QuestDetailsProps) {
  const wideViewport = useWideViewport()
  const handoffActive = wideViewport
  // Legacy publication appended the entire (possibly multiline) photo note after this marker.
  const visitConditions = quest.visitConditions.replace(/(?:^|\n)[ \t]*注意[：:][\s\S]*$/, '').trim()
  const detailsId = `quest-details-${useId().replaceAll(':', '')}`
  const hintUrl = quest.optionalHintImage
  const hintIdentity = `${quest.questId}\u0000${quest.version}\u0000${hintUrl ?? ''}\u0000${JSON.stringify(quest.hintImages ?? [])}\u0000${getHintIdentity(getHint)}\u0000${getPhotoIdentity(getHintPhoto)}`
  const [staleHintIdentity, setStaleHintIdentity] = useState('')
  const [reloadNeededState, setReloadNeededState] = useState<{ identity: string; open: boolean; indexes: Set<number> }>(() => ({ identity: hintIdentity, open, indexes: new Set() }))
  if (reloadNeededState.identity !== hintIdentity || reloadNeededState.open !== open) {
    setReloadNeededState({ identity: hintIdentity, open, indexes: new Set() })
  }
  const reloadNeededHints = reloadNeededState.identity === hintIdentity && reloadNeededState.open === open ? reloadNeededState.indexes : new Set<number>()
  const questStale = stale || staleHintIdentity === hintIdentity
  const markImageVersionChanged = useCallback(() => {
    setStaleHintIdentity(hintIdentity)
    onHintVersionChanged()
  }, [hintIdentity, onHintVersionChanged])
  const markImageReloadNeeded = useCallback((needed: boolean) => {
    setReloadNeededState(current => {
      const indexes = current.identity === hintIdentity && current.open === open ? new Set(current.indexes) : new Set<number>()
      if (needed) indexes.add(hintImageReloadIndex); else indexes.delete(hintImageReloadIndex)
      return { identity: hintIdentity, open, indexes }
    })
  }, [hintIdentity, open])
  return (
    <article className={'quest-card' + (open ? ' is-open' : '') + (hideToggle ? ' is-in-list' : '')} aria-labelledby={`${detailsId}-title`}>
      <header className="quest-card-heading">
        {hideToggle && sourceLabel && <span className="sample-label">{sourceLabel}</span>}
        {!hideToggle && <div className="quest-meta">{quest.questNumber && <span className="quest-number-label">No. {quest.questNumber}</span>}{sourceLabel ? <span className="sample-label">{sourceLabel}</span> : null}</div>}
        <div className="quest-title-row">
          <h3 className={hideToggle ? 'sr-only' : undefined} id={`${detailsId}-title`}>{quest.title}</h3>
          <ShootingConditionIndicators conditions={quest.shootingConditions} />
        </div>
        {open && (reloadNeededHints.size > 0 || questStale) && <button type="button" className="quest-reload-subtle" onClick={onReloadQuest}>問題を再読込</button>}
      </header>
      <div className="quest-card-content">
        {!hideToggle && <button type="button" className={'quest-toggle' + (open ? ' is-open' : '')}
          aria-expanded={open} aria-controls={detailsId} onClick={() => {
            setReloadNeededState({ identity: hintIdentity, open: !open, indexes: new Set() })
            onToggle()
          }}>
          <span>問題を見る</span><Icon name="arrow" />
        </button>}
        {open && (
          <section id={detailsId} className="quest-details" aria-label={detailsLabel}>
            <h4>謎</h4>
            <p className="clue-text">{quest.clue}</p>
            {visitConditions && <p className="sample-note">{visitConditions.replace(/^(料金[ ：]+無料)[：:][^\n]*$/gm, '$1')}</p>}
            <QuestHints key={`hints:${hintIdentity}`} quest={quest} getHint={getHint} getHintPhoto={getHintPhoto} stale={questStale} onVersionChanged={() => { setStaleHintIdentity(hintIdentity); onHintVersionChanged() }} onReloadNeeded={(index, needed) => setReloadNeededState(current => {
              const indexes = current.identity === hintIdentity && current.open === open ? new Set(current.indexes) : new Set<number>()
              if (needed) indexes.add(index); else indexes.delete(index)
              return { identity: hintIdentity, open, indexes }
            })} />
            {hintUrl && !questStale && <OptionalHintImage key={`image:${hintIdentity}`} url={hintUrl} quest={quest} getPhoto={getHintPhoto}
              onVersionChanged={markImageVersionChanged} onReloadNeeded={markImageReloadNeeded} />}
            {clearedDiscoveryId ? <div className="quest-cleared-action">
              {/* クリア済みの問題は再挑戦できない（D-64）。開始導線（QRの受け渡しを含む）は
                  丸ごと出さず、記録への導線だけを置く。hideStartAction は撮影フローが
                  使える時に開始ボタンの二重化を防ぐためのものなので、クリア済み表示は
                  その gate の対象にしない（gate の中に入れると、肝心のログイン中本人に
                  何も出なくなってしまう）。 */}
              {/* 一覧内では行のバッジに集約し、単独表示時だけここに状態を出す。 */}
              {!hideToggle && <p className="quest-cleared-label"><Icon name="check" />クリア済み</p>}
              {onOpenDiscovery && <button type="button" className="primary-button" onClick={() => onOpenDiscovery(clearedDiscoveryId)}>記録を見る</button>}
            </div> : !hideStartAction && (handoffActive ? <><QuestHandoff value={handoffUrl ?? questHandoffUrl(quest)} title={quest.title} />{note ? <p className="unavailable-note">{note}</p> : null}</> : <><button type="button" className="primary-button quest-mobile-start" disabled={disabled || questStale} onClick={() => { if (!questStale) void onStart({ questId: quest.questId, expectedVersion: quest.version }) }} aria-describedby={note ? `${detailsId}-note` : undefined}>
              {buttonLabel}
            </button>
            {note ? <p id={`${detailsId}-note`} className="unavailable-note">{note}</p> : null}</>)}
            {children}
            {feedback && <p className="auth-feedback" role={feedback.error ? 'alert' : 'status'}>{feedback.text}</p>}
          </section>
        )}
      </div>
    </article>
  )
}
