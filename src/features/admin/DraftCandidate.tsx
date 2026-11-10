import { useState } from 'react'
import { ApiError } from '../../shared/api'
import type { ApiClient, DraftSuggestion, ManagedQuest, ManagedQuestDraft } from '../../shared/api'
import { useRequestAction } from '../../shared/useRequestAction'

type Candidate = ManagedQuestDraft['content']
type State = { status: 'idle' | 'loading' | 'applied' } | { status: 'ready'; content: Candidate; source: DraftSuggestion['source'] }
  | { status: 'error'; message: string; changed?: true }

type FieldKey = 'title' | 'question' | 'hints' | 'verifiedFeatures' | 'draftingNotes'
const fieldLabels: ReadonlyArray<readonly [FieldKey, string]> = [
  ['title', 'タイトル'], ['question', '問題文'], ['hints', 'ヒント'], ['verifiedFeatures', '見た目の特徴'], ['draftingNotes', '作成メモ'],
]

function candidateFailure(cause: unknown): State {
  const code = cause instanceof ApiError ? cause.code : undefined
  if (code === 'DRAFT_CONFLICT') return { status: 'error', changed: true, message: '保存済みの版が変わりました。謎一覧から最新版を確認してください。' }
  if (code === 'SYSTEM_ERROR') return { status: 'error', message: '案を取得できませんでした。サーバー設定と試験の利用上限を確認してください。' }
  if (code === 'INVALID_INPUT') return { status: 'error', message: '保存済みの対象名・写真の利用権と合成参考写真を確認してください。' }
  return { status: 'error', message: '下書き案を取得できませんでした。通信状況を確認してください。' }
}

export function DraftCandidate({ api, saved, current, omitNotes = false, onApply }: {
  api: Pick<ApiClient, 'generateManagedQuestDraft'>; saved: ManagedQuest; current: Candidate
  omitNotes?: boolean; onApply: (content: Candidate) => void
}) {
  const [state, setState] = useState<State>({ status: 'idle' })
  const [selected, setSelected] = useState<FieldKey[]>(fieldLabels.map(([key]) => key))
  const begin = useRequestAction(35_000)
  const visibleFields = fieldLabels.filter(([key]) => key !== 'draftingNotes' || !omitNotes)

  async function load() {
    const operation = begin(() => setState({ status: 'error', message: '案の取得に時間がかかっています。再試行してください。' }))
    if (!operation) return
    setState({ status: 'loading' })
    try {
      const result = await api.generateManagedQuestDraft(saved.orgId, saved.questId, saved.draftRevision, { signal: operation.signal })
      if (!operation.isCurrent()) return
      setState({ status: 'ready', content: result.content, source: result.source })
    } catch (cause) {
      if (operation.isCurrent()) setState(candidateFailure(cause))
    } finally { operation.finish() }
  }

  function apply() {
    if (state.status !== 'ready' || selected.length === 0) return
    const merged: Candidate = { ...current }
    for (const key of selected) {
      if (key === 'hints') merged.hints = state.content.hints
      else merged[key] = state.content[key]
    }
    onApply(merged)
    setState({ status: 'applied' })
  }

  return <section className="form-section" aria-label="下書き案">
    <details>
      <summary>下書き案を取り込む</summary>
      <h2>下書き案</h2>
      <button type="button" disabled={state.status === 'loading' || (state.status === 'error' && state.changed)}
        onClick={load}>{state.status === 'loading' ? '案を取得しています…' : '下書き案を取得'}</button>
      {state.status === 'error' && <p role="alert">{state.message}</p>}
      {state.status === 'ready' && <>
        <p>{state.source === 'real' ? 'Vertex AI案' : '合成素材案'}</p>
        <h3>{state.content.title}</h3>
        <p>{state.content.question}</p>
        <ol>{state.content.hints.map((hint, index) => <li key={index}>{hint}</li>)}</ol>
        <dl><dt>見た目の特徴</dt><dd>{state.content.verifiedFeatures}</dd>{!omitNotes && <><dt>作成メモ</dt><dd>{state.content.draftingNotes}</dd></>}</dl>
        <fieldset><legend>取り入れる項目</legend>
          {visibleFields.map(([key, label]) => <label key={key} className="check-option">
            <input type="checkbox" checked={selected.includes(key)} onChange={(event) => {
              setSelected(event.target.checked ? [...selected, key] : selected.filter((item) => item !== key))
            }} />{label}を反映
          </label>)}
        </fieldset>
        <button type="button" disabled={selected.length === 0} onClick={apply}>この案を編集欄に入れる</button>
      </>}
      {state.status === 'applied' && <p role="status">反映済み・未保存</p>}
    </details>
  </section>
}
