import { useEffect, useMemo, useRef, useState } from 'react'
import App from '../../App'
import type { AuthClient } from '../auth/authTypes'
import { ApiError, createApiClient } from '../../shared/api/client'
import type { LocalApiDataMode } from '../../shared/api/client'
import type { Page, PublicArea, PublicQuest } from '../../shared/api/types'

type Api = Pick<ReturnType<typeof createApiClient>, 'listQuests' | 'getQuest' | 'listAreas' | 'getHint'>
type Result = {
  api: Api; selection: string; areaSelection: string; retry: number
  state: 'loading' | 'ready' | 'empty' | 'error'
  choices: PublicQuest[]; areas: PublicArea[]; quest?: PublicQuest; area?: PublicArea; missing?: boolean
}

function readSelectionFromUrl() {
  const params = new URLSearchParams(window.location.search)
  return { areaId: params.get('area') ?? '', questId: params.get('quest') ?? '' }
}

function writeSelectionToUrl(areaId: string, questId: string, mode: 'push' | 'replace') {
  const url = new URL(window.location.href)
  if (areaId) url.searchParams.set('area', areaId)
  else url.searchParams.delete('area')
  if (questId) url.searchParams.set('quest', questId)
  else url.searchParams.delete('quest')
  window.history[mode === 'push' ? 'pushState' : 'replaceState'](window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
}

async function readPages<T>(read: (cursor?: string) => Promise<Page<T>>, signal: AbortSignal) {
  const items: T[] = []
  const seen = new Set<string>()
  let cursor: string | undefined
  do {
    signal.throwIfAborted()
    const page = await read(cursor)
    signal.throwIfAborted()
    items.push(...page.items)
    cursor = page.nextCursor ?? undefined
    if (cursor && seen.has(cursor)) throw new Error('Repeated pagination cursor')
    if (cursor) seen.add(cursor)
  } while (cursor)
  return items
}

export function ApiQuestApp({ api: providedApi, syncUrl = true, authClient, dataMode = 'demo' }: {
  api?: Api; syncUrl?: boolean; authClient?: AuthClient; dataMode?: LocalApiDataMode
}) {
  const api = useMemo(() => providedApi ?? createApiClient({ expectedDataMode: dataMode }), [providedApi, dataMode])
  const [initialSelection] = useState(() => syncUrl ? readSelectionFromUrl() : { areaId: '', questId: '' })
  const [selectedId, setSelectedId] = useState(initialSelection.questId)
  const [selectedAreaId, setSelectedAreaId] = useState(initialSelection.areaId)
  const [retry, setRetry] = useState(0)
  const [staleQuest, setStaleQuest] = useState<{ questId: string; version: number } | null>(null)
  const [result, setResult] = useState<Result | null>(null)
  const catalog = useRef<{ api: Api; choices: Map<string, PublicQuest[]>; areas?: PublicArea[] } | null>(null)

  useEffect(() => {
    if (!syncUrl) return
    const onPopState = () => {
      const selection = readSelectionFromUrl()
      setSelectedAreaId(selection.areaId)
      setSelectedId(selection.questId)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [syncUrl])

  useEffect(() => {
    const controller = new AbortController()
    const { signal } = controller
    let choices: PublicQuest[] = []
    const fail = (error?: unknown) => setResult({ api, selection: selectedId, areaSelection: selectedAreaId, retry, state: 'error', choices,
      areas: catalog.current?.api === api ? catalog.current.areas ?? [] : [],
      missing: error instanceof ApiError && (error.code === 'NOT_FOUND' || error.code === 'QUEST_UNAVAILABLE') })
    const deadline = setTimeout(() => { fail(); controller.abort() }, 10_000)
    // Discard obsolete responses even when a transport ignores cancellation.
    void (async () => {
      try {
        let cache = catalog.current?.api === api ? catalog.current : undefined
        if (!cache) {
          cache = { api, choices: new Map() }
          catalog.current = cache
        }
        let areas = cache.areas
        if (!areas) {
          areas = await readPages((cursor) => api.listAreas({ limit: 100, cursor }, { signal }), signal)
          if (signal.aborted) return
          cache.areas = areas
        }
        choices = cache.choices.get(selectedAreaId) ?? []
        if (!cache.choices.has(selectedAreaId)) {
          choices = await readPages((cursor) => api.listQuests({ ...(selectedAreaId ? { areaId: selectedAreaId } : {}), limit: 100, cursor }, { signal }), signal)
          if (signal.aborted) return
          cache.choices.set(selectedAreaId, choices)
        }
        if (signal.aborted) return
        if (!choices.length) {
          if (selectedId) {
            if (syncUrl) writeSelectionToUrl(selectedAreaId, '', 'replace')
            setSelectedId('')
            return
          }
          setResult({ api, selection: selectedId, areaSelection: selectedAreaId, retry, state: 'empty', choices, areas })
          return
        }
        setResult({ api, selection: selectedId, areaSelection: selectedAreaId, retry, state: 'loading', choices, areas })
        const id = choices.some((item) => item.questId === selectedId) ? selectedId : choices[0].questId
        if (id !== selectedId) {
          if (syncUrl) writeSelectionToUrl(selectedAreaId, id, 'replace')
          setSelectedId(id)
          return
        }
        const quest = await api.getQuest(id, { signal })
        signal.throwIfAborted()
        if (quest.questId !== id) throw new ApiError('INVALID_RESPONSE')
        if (selectedAreaId && quest.areaId !== selectedAreaId) throw new ApiError('INVALID_RESPONSE')
        setResult({ api, selection: selectedId, areaSelection: selectedAreaId, retry, state: 'ready', choices, areas, quest,
          area: areas.find((item) => item.areaId === quest.areaId) })
      } catch (error) {
        if (!signal.aborted) fail(error)
      } finally { clearTimeout(deadline) }
    })()
    return () => { clearTimeout(deadline); controller.abort() }
  }, [api, selectedId, selectedAreaId, retry, syncUrl])

  const current = result?.api === api && result.selection === selectedId && result.areaSelection === selectedAreaId && result.retry === retry ? result : null
  const state = current?.state ?? 'loading'
  const choices = current?.choices ?? []
  const availableAreas = result?.api === api ? result.areas : []
  const selectedQuestId = choices.some((item) => item.questId === selectedId)
    ? selectedId
    : choices[0]?.questId ?? ''
  const picker = <div className="api-quest-picker">
    <label htmlFor="api-area-select">地域を選択</label>
    <select id="api-area-select" value={selectedAreaId}
      onChange={(event) => {
        const areaId = event.target.value
        if (syncUrl) writeSelectionToUrl(areaId, '', 'push')
        setSelectedAreaId(areaId); setSelectedId('')
      }}>
      <option value="">全国</option>
      {selectedAreaId && !availableAreas.some((item) => item.areaId === selectedAreaId)
        && <option value={selectedAreaId}>選択中の地域（一覧にありません）</option>}
      {availableAreas.map((item) => <option key={item.areaId} value={item.areaId}>{item.label}（{item.publishedCount}問）</option>)}
    </select>
    <label htmlFor="api-quest-select">公開APIの問題を選択</label>
    <select id="api-quest-select" aria-label="公開APIの問題を選択" value={selectedQuestId}
      disabled={!choices.length}
      onChange={(event) => {
        const questId = event.target.value
        if (syncUrl) writeSelectionToUrl(selectedAreaId, questId, 'push')
        setSelectedId(questId)
      }}>
      {!choices.length && <option value="">{state === 'loading' ? '問題を読み込み中' : '選べる問題がありません'}</option>}
      {choices.map((item) => <option key={item.questId} value={item.questId}>{item.title}</option>)}
    </select>
    <p>問題と地域名は公開APIから取得しています。架空の問題の位置は地図に表示しません。</p>
  </div>

  const quest = state === 'ready' ? current?.quest : undefined
  const reload = () => { catalog.current = null; setRetry((value) => value + 1) }
  const selectArea = (areaId: string) => {
    if (areaId === selectedAreaId || !availableAreas.some((item) => item.areaId === areaId)) return
    if (syncUrl) writeSelectionToUrl(areaId, '', 'push')
    setSelectedAreaId(areaId)
    setSelectedId('')
  }
  const fallback = !quest ? <section className="api-load-state" aria-live="polite">
      <p className="eyebrow">{dataMode === 'durable-local' ? '永続API・ローカル' : '公開APIデモ'}</p>
      <h1 id="explore-title">{state === 'loading' ? '公開問題を読み込み中' : state === 'empty' ? '公開問題はありません' : '公開問題を取得できませんでした'}</h1>
      {state === 'loading' && <p role="status">サーバーから問題を取得しています。</p>}
      {state === 'empty' && <p>{selectedAreaId ? 'この地域に公開問題はありません。地域を変えるか全国からお選びください。' : '現在選べる公開問題はありません。'}</p>}
      {state === 'error' && <p role="alert">{current?.missing
        ? 'この問題は公開されていないか、見つかりません。別の問題を選べます。'
        : 'サーバーとの通信を確認して、もう一度お試しください。'}</p>}
      {state !== 'loading' && <button type="button" onClick={reload}>再試行</button>}
      {(availableAreas.length > 0 || choices.length > 0 || state === 'empty' || state === 'error') && picker}
    </section> : undefined
  return <App authClient={authClient} quest={quest} mapAreas={availableAreas} selectedAreaId={selectedAreaId} onSelectArea={selectArea}
    areaLabel={current?.area?.label ?? '探索地域名は未掲載です'}
    questPicker={picker} catalogFallback={fallback} apiMode apiDataMode={dataMode} getHint={api.getHint}
    questStale={!!quest && staleQuest?.questId === quest.questId && staleQuest.version === quest.version}
    onHintVersionStale={() => { if (quest) setStaleQuest({ questId: quest.questId, version: quest.version }) }}
    onReloadQuest={reload} />
}
