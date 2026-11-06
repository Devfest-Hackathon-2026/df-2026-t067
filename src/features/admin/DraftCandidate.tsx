import { useState } from 'react'
import { ApiError } from '../../shared/api'
import type { ApiClient, DraftSuggestion, ManagedQuest, ManagedQuestDraft } from '../../shared/api'
import { useRequestAction } from '../../shared/useRequestAction'

type Candidate = ManagedQuestDraft['content']
type State = { status: 'idle' | 'loading' | 'applied' } | { status: 'ready'; content: Candidate; source: DraftSuggestion['source'] }
  | { status: 'error'; message: string; changed?: true }

function candidateFailure(cause: unknown): State {
  const code = cause instanceof ApiError ? cause.code : undefined
  if (code === 'DRAFT_CONFLICT') return { status: 'error', changed: true, message: '保存済みの版が変わりました。問題一覧から最新版を確認してください。' }
  if (code === 'SYSTEM_ERROR') return { status: 'error', message: '候補を取得できませんでした。サーバー設定と試験の利用上限を確認してください。' }
  if (code === 'INVALID_INPUT') return { status: 'error', message: '保存済みの対象名・根拠・写真の利用権と合成参考写真を確認してください。' }
  return { status: 'error', message: '下書き候補を取得できませんでした。通信状況を確認してください。' }
}

export function DraftCandidate({ api, saved, onApply }: {
  api: Pick<ApiClient, 'generateManagedQuestDraft'>; saved: ManagedQuest; onApply: (content: Candidate) => void
}) {
  const [state, setState] = useState<State>({ status: 'idle' })
  const begin = useRequestAction(35_000)

  async function load() {
    const operation = begin(() => setState({ status: 'error', message: '候補取得に時間がかかっています。再試行してください。' }))
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

  return <section className="form-section" aria-label="開発用の下書き候補">
    <h2>開発用の下書き候補</h2>
    <p>保存済みの下書き版 {saved.draftRevision} の合成素材を使います。</p>
    <button type="button" disabled={state.status === 'loading' || (state.status === 'error' && state.changed)}
      onClick={load}>{state.status === 'loading' ? '候補を取得しています…' : '保存済み版の候補を取得'}</button>
    {state.status === 'error' && <p role="alert">{state.message}</p>}
    {state.status === 'ready' && <>
      <p>{state.source === 'real' ? 'Vertex AIの候補です。根拠を確認してから採用してください。' : '合成素材の固定候補です。'}</p>
      <h3>{state.content.title}</h3>
      <p>{state.content.question}</p>
      <ol>{state.content.hints.map((hint, index) => <li key={index}>{hint}</li>)}</ol>
      <dl><dt>特徴</dt><dd>{state.content.verifiedFeatures}</dd><dt>作成メモ</dt><dd>{state.content.draftingNotes}</dd></dl>
      <button type="button" onClick={() => { onApply(state.content); setState({ status: 'applied' }) }}>候補で編集欄を置き換える</button>
    </>}
    {state.status === 'applied' && <p role="status">編集欄に反映しました。内容を確認して下書きを保存してください。</p>}
  </section>
}
