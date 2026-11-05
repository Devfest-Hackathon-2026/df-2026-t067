import { useEffect, useMemo, useRef, useState } from 'react'
import App from '../../App'
import { ApiError, createApiClient } from '../../shared/api/client'
import type { Page, PublicArea, PublicQuest } from '../../shared/api/types'

type Api = Pick<ReturnType<typeof createApiClient>, 'listQuests' | 'getQuest' | 'listAreas'>
type Result = {
  api: Api; selection: string; areaSelection: string; retry: number
  state: 'loading' | 'ready' | 'empty' | 'error'
  choices: PublicQuest[]; areas: PublicArea[]; quest?: PublicQuest; area?: PublicArea; missing?: boolean
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

export function ApiQuestApp({ api: providedApi }: { api?: Api }) {
  const api = useMemo(() => providedApi ?? createApiClient(), [providedApi])
  const [selectedId, setSelectedId] = useState('')
  const [selectedAreaId, setSelectedAreaId] = useState('')
  const [retry, setRetry] = useState(0)
  const [result, setResult] = useState<Result | null>(null)
  const catalog = useRef<{ api: Api; choices: Map<string, PublicQuest[]>; areas?: PublicArea[] } | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    const { signal } = controller
    // Discard obsolete responses even when a transport ignores cancellation.
    void (async () => {
      let choices: PublicQuest[] = []
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
          setResult({ api, selection: selectedId, areaSelection: selectedAreaId, retry, state: 'empty', choices, areas })
          return
        }
        setResult({ api, selection: selectedId, areaSelection: selectedAreaId, retry, state: 'loading', choices, areas })
        const id = choices.some((item) => item.questId === selectedId) ? selectedId : choices[0].questId
        const quest = await api.getQuest(id, { signal })
        signal.throwIfAborted()
        if (quest.questId !== id) throw new ApiError('INVALID_RESPONSE')
        if (selectedAreaId && quest.areaId !== selectedAreaId) throw new ApiError('INVALID_RESPONSE')
        setResult({ api, selection: selectedId, areaSelection: selectedAreaId, retry, state: 'ready', choices, areas, quest,
          area: areas.find((item) => item.areaId === quest.areaId) })
      } catch (error) {
        if (!signal.aborted) setResult({ api, selection: selectedId, areaSelection: selectedAreaId, retry, state: 'error', choices, areas: catalog.current?.api === api ? catalog.current.areas ?? [] : [],
          missing: error instanceof ApiError && (error.code === 'NOT_FOUND' || error.code === 'QUEST_UNAVAILABLE') })
      }
    })()
    return () => controller.abort()
  }, [api, selectedId, selectedAreaId, retry])

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
      onChange={(event) => { setSelectedAreaId(event.target.value); setSelectedId('') }}>
      <option value="">全国</option>
      {selectedAreaId && !availableAreas.some((item) => item.areaId === selectedAreaId)
        && <option value={selectedAreaId}>選択中の地域（一覧にありません）</option>}
      {availableAreas.map((item) => <option key={item.areaId} value={item.areaId}>{item.label}（{item.publishedCount}問）</option>)}
    </select>
    <label htmlFor="api-quest-select">公開APIの問題を選択</label>
    <select id="api-quest-select" aria-label="公開APIの問題を選択" value={selectedQuestId}
      disabled={!choices.length}
      onChange={(event) => setSelectedId(event.target.value)}>
      {!choices.length && <option value="">{state === 'loading' ? '問題を読み込み中' : '選べる問題がありません'}</option>}
      {choices.map((item) => <option key={item.questId} value={item.questId}>{item.title}</option>)}
    </select>
    <p>問題と地域名は公開APIから取得しています。地図は静的なプレビューで、問題の位置を示しません。</p>
  </div>

  return state === 'ready' && current?.quest
    ? <App quest={current.quest} areaLabel={current.area?.label ?? '探索地域名は未掲載です'} questPicker={picker} apiMode />
    : <main className="api-load-state" aria-live="polite">
      <p className="eyebrow">公開APIデモ</p>
      <h1>{state === 'loading' ? '公開問題を読み込み中' : state === 'empty' ? '公開問題はありません' : '公開問題を取得できませんでした'}</h1>
      {state === 'loading' && <p role="status">サーバーから問題を取得しています。</p>}
      {state === 'empty' && <p>{selectedAreaId ? 'この地域に公開問題はありません。地域を変えるか全国からお選びください。' : '現在選べる公開問題はありません。'}</p>}
      {state === 'error' && <p role="alert">{current?.missing
        ? 'この問題は公開されていないか、見つかりません。別の問題を選べます。'
        : 'サーバーとの通信を確認して、もう一度お試しください。'}</p>}
      {state !== 'loading' && <button type="button" onClick={() => { catalog.current = null; setRetry((value) => value + 1) }}>再試行</button>}
      {(availableAreas.length > 0 || choices.length > 0 || state === 'empty' || state === 'error') && picker}
    </main>
}
