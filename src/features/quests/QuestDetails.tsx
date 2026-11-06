import type { PublicQuest } from '../../shared/api/types'
import { Icon } from '../../components/Icon'
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

function HintItem({ questId, version, index, getHint, onVersionChanged, onReloadNeeded }: {
  questId: string; version: number; index: number; getHint: GetHint; onVersionChanged(): void; onReloadNeeded(index: number, needed: boolean): void
}) {
  const toggleRef = useRef<HTMLButtonElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [state, setState] = useState<{ status: 'idle' | 'loading' | 'ready' | 'error' | 'changed'; text?: string; message?: string; reloadNeeded?: boolean }>({ status: 'idle' })
  const controllerRef = useRef<AbortController | null>(null)
  const timeoutRef = useRef<number | null>(null)
  const generation = useRef(0)
  useEffect(() => () => { generation.current++; controllerRef.current?.abort(); if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current) }, [])

  async function load() {
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
      setState({ status: 'error', message: '取得がタイムアウトしました。再試行できます。' })
    }, 10_000)
    timeoutRef.current = timeout
    setExpanded(true)
    onReloadNeeded(index, false)
    setState({ status: 'loading' })
    try {
      const hint = await getHint({ questId, expectedVersion: version, index }, { signal: controller.signal })
      if (controller.signal.aborted || generation.current !== currentGeneration) return
      setState({ status: 'ready', text: hint.text })
    } catch (error) {
      if (generation.current !== currentGeneration) return
      if (error instanceof ApiError && error.code === 'QUEST_CHANGED') {
        setState({ status: 'changed' })
        onVersionChanged()
      } else if (controller.signal.aborted && !timedOut) return
      else {
        const reloadNeeded = error instanceof ApiError && (error.code === 'NOT_FOUND' || error.code === 'INVALID_INPUT')
        onReloadNeeded(index, reloadNeeded)
        setState({ status: 'error', message: timedOut ? '取得がタイムアウトしました。再試行できます。'
        : error instanceof ApiError && error.code === 'NOT_FOUND' ? 'このヒントは見つかりません（404）。問題を読み直してください。'
          : error instanceof ApiError && error.code === 'INVALID_INPUT' ? 'ヒント番号が無効です。問題を読み直してください。'
            : error instanceof ApiError && error.code === 'INVALID_RESPONSE' ? 'ヒントの応答を確認できませんでした。'
              : 'ヒントを取得できませんでした。通信を確認して再試行してください。' })
      }
    } finally { window.clearTimeout(timeout); if (timeoutRef.current === timeout) timeoutRef.current = null }
  }

  return <div className="hint-item">
    <button ref={toggleRef} type="button" aria-expanded={expanded} onClick={() => {
      if (expanded) {
        if (state.status === 'loading') {
          generation.current++; controllerRef.current?.abort()
          if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current)
          timeoutRef.current = null
        }
        setExpanded(false); setState({ status: 'idle' })
        onReloadNeeded(index, false)
      }
      else void load()
    }}>{state.status === 'loading' ? `ヒント${index}を取得中（閉じる）` : expanded ? `ヒント${index}を閉じる` : `ヒント${index}を見る`}</button>
    {expanded && state.status === 'loading' && <p role="status">ヒントを取得しています。</p>}
    {expanded && state.status === 'ready' && <p>{state.text}</p>}
    {expanded && state.status === 'error' && <div role="alert"><p>{state.message}</p>
      <button type="button" className="hint-retry" onClick={() => {
        toggleRef.current?.focus()
        void load()
      }}>ヒント{index}を再試行</button>
    </div>}
    {expanded && state.status === 'changed' && <div role="alert"><p>問題の版が変わりました。古いヒントと挑戦を無効にしました。</p><button type="button" onClick={onVersionChanged}>最新版の問題を読み直す</button></div>}
  </div>
}

function QuestHints({ quest, getHint, stale, onVersionChanged, onReloadNeeded }: { quest: PublicQuest; getHint?: GetHint; stale: boolean; onVersionChanged(): void; onReloadNeeded(index: number, needed: boolean): void }) {
  const [changed, setChanged] = useState(false)
  if (!getHint) return null
  if (!quest.hintCount) return <p className="hints-note">この問題には通常ヒントがありません。</p>
  if (stale || changed) return <div role="alert" className="hint-version-changed"><p>問題の版が変わりました。すべてのヒントと挑戦を無効にしました。</p></div>
  return <div className="quest-hints" aria-label="段階ヒント">
    <h4>段階ヒント</h4>
    {Array.from({ length: quest.hintCount }, (_, offset) => offset + 1).map(index =>
      <HintItem key={`${quest.questId}:${quest.version}:${index}`} questId={quest.questId} version={quest.version} index={index} getHint={getHint} onVersionChanged={() => { setChanged(true); onVersionChanged() }} onReloadNeeded={onReloadNeeded} />)}
    <p className="hints-note">各ヒントは選んだ番号だけ取得します。最終案内は含みません。</p>
  </div>
}

type HintPhoto = ReturnType<typeof createApiClient>['getPublishedHintPhoto']

function ProtectedHintImage({ getPhoto, questId, version, alt, hidden, onLoad, onError }: {
  getPhoto: HintPhoto; questId: string; version: number; alt: string; hidden: boolean
  onLoad(): void; onError(): void
}) {
  const [source, setSource] = useState<string>()
  useEffect(() => {
    const controller = new AbortController()
    let url: string | undefined
    void getPhoto(questId, version, { signal: controller.signal }).then((photo) => {
      if (controller.signal.aborted) return
      url = URL.createObjectURL(photo)
      setSource(url)
    }).catch(() => { if (!controller.signal.aborted) onError() })
    return () => {
      controller.abort()
      if (url) URL.revokeObjectURL(url)
    }
  }, [getPhoto, questId, version, onError])
  return source && <img src={source} alt={alt} className="optional-hint-image"
    style={{ display: hidden ? 'none' : undefined }} onLoad={onLoad} onError={onError} />
}

function OptionalHintImage({ url, quest, getPhoto }: { url: string; quest: PublicQuest; getPhoto?: HintPhoto }) {
  const toggleRef = useRef<HTMLButtonElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading')
  const [attempt, setAttempt] = useState(0)
  const onLoad = useCallback(() => setStatus('loaded'), [])
  const onError = useCallback(() => setStatus('error'), [])
  const alt = `${quest.title}のヒント画像`
  return <div className="optional-hint">
    <button ref={toggleRef} type="button" className="optional-hint-toggle" aria-expanded={expanded}
      onClick={() => { setExpanded(value => !value); setStatus('loading') }}>
      {expanded ? 'ヒント画像を閉じる' : 'ヒント画像を見る'}
    </button>
    {expanded && <div className="optional-hint-content" aria-live="polite">
      {status === 'loading' && <p role="status">ヒント画像を読み込み中…</p>}
      {status === 'error' && <div role="alert"><p>ヒント画像を読み込めませんでした。</p>
        <button type="button" onClick={() => {
          toggleRef.current?.focus()
          setStatus('loading')
          setAttempt(value => value + 1)
        }}>再試行</button>
      </div>}
      {getPhoto ? <ProtectedHintImage key={attempt} getPhoto={getPhoto} questId={quest.questId} version={quest.version}
        alt={alt} hidden={status !== 'loaded'} onLoad={onLoad} onError={onError} />
        : <img key={attempt} src={url} alt={alt} className="optional-hint-image"
          style={{ display: status === 'loaded' ? undefined : 'none' }} onLoad={onLoad} onError={onError} />}
    </div>}
  </div>
}

interface QuestDetailsProps {
  quest: PublicQuest
  areaLabel: string
  open: boolean
  disabled: boolean
  buttonLabel: string
  note: string
  sourceLabel?: string
  feedback?: { error: boolean; text: string } | null
  onToggle(): void
  onStart(selection: ChallengeSelection): void | Promise<unknown>
  getHint?: GetHint
  getHintPhoto?: HintPhoto
  onHintVersionChanged?(): void
  onReloadQuest?(event?: MouseEvent<HTMLButtonElement>): void
  children?: ReactNode
  hideStartAction?: boolean
  stale?: boolean
}

export function QuestDetails({ quest, areaLabel, open, disabled, buttonLabel, note, sourceLabel = '架空のサンプル問題', feedback, onToggle, onStart, children, hideStartAction = false, stale = false, getHint, getHintPhoto, onHintVersionChanged = () => {}, onReloadQuest = () => {} }: QuestDetailsProps) {
  const detailsId = `quest-details-${useId().replaceAll(':', '')}`
  const hintUrl = quest.optionalHintImage
  const hintIdentity = `${quest.questId}\u0000${quest.version}\u0000${hintUrl ?? ''}\u0000${getHintIdentity(getHint)}`
  const [staleHintIdentity, setStaleHintIdentity] = useState('')
  const [reloadNeededState, setReloadNeededState] = useState<{ identity: string; open: boolean; indexes: Set<number> }>(() => ({ identity: hintIdentity, open, indexes: new Set() }))
  if (reloadNeededState.identity !== hintIdentity || reloadNeededState.open !== open) {
    setReloadNeededState({ identity: hintIdentity, open, indexes: new Set() })
  }
  const reloadNeededHints = reloadNeededState.identity === hintIdentity && reloadNeededState.open === open ? reloadNeededState.indexes : new Set<number>()
  const questStale = stale || staleHintIdentity === hintIdentity
  return (
    <article className={'quest-card' + (open ? ' is-open' : '')} aria-labelledby={`${detailsId}-title`}>
      <header className="quest-card-heading">
        <div className="quest-meta"><span className="area-label"><Icon name="pin" />{areaLabel}</span><span className="sample-label">{sourceLabel}</span></div>
        <div className="quest-title-row">
          <h3 id={`${detailsId}-title`}>{quest.title}</h3>
          <ShootingConditionIndicators conditions={quest.shootingConditions} />
        </div>
        {open && (reloadNeededHints.size > 0 || questStale) && <button type="button" className="quest-reload-subtle" onClick={onReloadQuest}>問題を読みなおす</button>}
      </header>
      <div className="quest-card-content">
        <button type="button" className={'quest-toggle' + (open ? ' is-open' : '')}
          aria-expanded={open} aria-controls={detailsId} onClick={() => {
            setReloadNeededState({ identity: hintIdentity, open: !open, indexes: new Set() })
            onToggle()
          }}>
          <span>{open ? '問題を閉じる' : '問題を見てみる'}</span><Icon name="arrow" />
        </button>
        {open && (
          <section id={detailsId} className="quest-details" aria-label="サンプル問題の詳細">
            <h4>この場所はどこ？</h4>
            <p className="clue-text">{quest.clue}</p>
            <p className="sample-note">{quest.visitConditions}</p>
            <QuestHints key={hintIdentity} quest={quest} getHint={getHint} stale={questStale} onVersionChanged={() => { setStaleHintIdentity(hintIdentity); onHintVersionChanged() }} onReloadNeeded={(index, needed) => setReloadNeededState(current => {
              const indexes = current.identity === hintIdentity && current.open === open ? new Set(current.indexes) : new Set<number>()
              if (needed) indexes.add(index); else indexes.delete(index)
              return { identity: hintIdentity, open, indexes }
            })} />
            {hintUrl && !questStale && <OptionalHintImage key={hintIdentity} url={hintUrl} quest={quest} getPhoto={getHintPhoto} />}
            {!hideStartAction && <><button type="button" className="primary-button" disabled={disabled || questStale} onClick={() => { if (!questStale) void onStart({ questId: quest.questId, expectedVersion: quest.version }) }} aria-describedby={`${detailsId}-note`}>
              {buttonLabel}
            </button>
            <p id={`${detailsId}-note`} className="unavailable-note">{note}</p></>}
            {children}
            {feedback && <p className="auth-feedback" role={feedback.error ? 'alert' : 'status'}>{feedback.text}</p>}
          </section>
        )}
      </div>
    </article>
  )
}
