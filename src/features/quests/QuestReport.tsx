import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { ApiError, REPORT_CATEGORIES } from '../../shared/api'
import type { ApiClient, ReportInput } from '../../shared/api'
import { reportCategoryLabels } from '../../shared/reportLabels'
import { useRequestAction } from '../../shared/useRequestAction'

type Submission = { status: 'idle' | 'sending' | 'received' } | { status: 'error'; message: string }

function reportError(cause: unknown): string {
  if (cause instanceof ApiError) {
    switch (cause.code) {
      case 'SYSTEM_ERROR': return '開発用の報告受付を利用できません。'
      case 'NOT_FOUND': return 'この問題への報告を受け付けていません。'
      case 'RATE_LIMITED': return '開発用の報告上限に達しました。'
      case 'UNAUTHENTICATED': return 'ログインを確認できませんでした。'
    }
  }
  return '報告の受付を確認できませんでした。通信状況を確認して再試行してください。'
}

function ReportForm({ api, questId }: { api: ApiClient; questId: string }) {
  const [category, setCategory] = useState<ReportInput['category']>('PHOTO_UNAVAILABLE')
  const [text, setText] = useState('')
  const [state, setState] = useState<Submission>({ status: 'idle' })
  const key = useRef<string | null>(null)
  const begin = useRequestAction()

  function edited() {
    key.current = null
    setState({ status: 'idle' })
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!text.trim() || state.status === 'received') return
    const operation = begin(() => setState({ status: 'error', message: '受付の確認に時間がかかっています。同じ内容で再試行できます。' }))
    if (!operation) return
    setState({ status: 'sending' })
    try {
      const result = await api.submitReport({ questId, category, text, idempotencyKey: key.current ??= crypto.randomUUID() }, { signal: operation.signal })
      if (!operation.isCurrent()) return
      if (result.source !== 'mock') throw new ApiError('INVALID_RESPONSE')
      setState({ status: 'received' })
    } catch (cause) {
      if (operation.isCurrent()) setState({ status: 'error', message: reportError(cause) })
    } finally { operation.finish() }
  }

  if (state.status === 'received') return <p role="status">開発用の報告を受け付けました。</p>
  return <form className="quest-report-form" onSubmit={submit}>
    <p>架空の報告内容でお試しください。写真や個人情報は送らないでください。</p>
    <label>分類<select value={category} disabled={state.status === 'sending'} onChange={(event) => {
      setCategory(event.target.value as ReportInput['category']); edited()
    }}>{REPORT_CATEGORIES.map((value) => <option key={value} value={value}>{reportCategoryLabels[value]}</option>)}</select></label>
    <label>報告内容<textarea required maxLength={1000} rows={3} value={text} disabled={state.status === 'sending'}
      onChange={(event) => { setText(event.target.value); edited() }} /></label>
    {state.status === 'error' && <p role="alert">{state.message}</p>}
    <button type="submit" className="secondary-button" disabled={state.status === 'sending' || !text.trim()}>
      {state.status === 'sending' ? '受付を確認しています…' : 'デモ報告を送信'}
    </button>
  </form>
}

export function QuestReport({ api, questId, ownerUid, canSignIn, signInPending, onSignIn }: {
  api: ApiClient; questId: string; ownerUid: string | null; canSignIn: boolean; signInPending: boolean; onSignIn: () => void
}) {
  const [open, setOpen] = useState(false)
  return <section aria-label="開発用の問題報告">
    <button type="button" className="secondary-button" aria-expanded={open} onClick={() => setOpen((previous) => !previous)}>
      {open ? '報告を閉じる' : '問題を報告'}
    </button>
    {open && (ownerUid !== null ? <ReportForm key={ownerUid} api={api} questId={questId} />
      : canSignIn ? <button type="button" className="secondary-button" disabled={signInPending} onClick={onSignIn}>Googleログインして報告する</button>
        : <p role="status">ログイン確認後に報告できます。</p>)}
  </section>
}
