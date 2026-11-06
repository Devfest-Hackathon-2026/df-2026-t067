import { useState } from 'react'
import type { FormEvent } from 'react'
import { ApiError } from '../../shared/api'
import type { ApiClient } from '../../shared/api'
import { useRequestAction } from '../../shared/useRequestAction'

type Failure = { message: string; reload?: true }

function pauseFailure(cause: unknown): Failure {
  if (cause instanceof ApiError) {
    if (cause.code === 'QUEST_CHANGED') return { message: '公開版が変わりました。最新の一覧を確認してください。', reload: true }
    if (cause.code === 'QUEST_UNAVAILABLE') return { message: 'この公開版は利用できません。最新の一覧を確認してください。', reload: true }
    if (cause.code === 'FORBIDDEN') return { message: '公開担当者の権限を確認できません。', reload: true }
  }
  return { message: '休止を確認できませんでした。同じ理由で再試行できます。' }
}

export function PausePublication({ api, orgId, questId, version, onPaused, onReload }: {
  api: ApiClient; orgId: string; questId: string; version: number; onPaused: () => void; onReload: () => void
}) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<Failure | null>(null)
  const begin = useRequestAction()

  async function pause(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!reason.trim() || failure?.reload) return
    const operation = begin(() => {
      setFailure({ message: '休止の確認に時間がかかっています。同じ理由で再試行できます。' })
      setPending(false)
    })
    if (!operation) return
    setPending(true)
    setFailure(null)
    try {
      await api.pauseManagedQuest(orgId, questId, { expectedPublishedVersion: version, reason }, { signal: operation.signal })
      if (operation.isCurrent()) onPaused()
    } catch (cause) {
      if (operation.isCurrent()) setFailure(pauseFailure(cause))
    } finally {
      if (operation.isCurrent()) setPending(false)
      operation.finish()
    }
  }

  if (!open) return <button type="button" onClick={() => {
    setReason(''); setFailure((current) => current?.reload ? current : null); setOpen(true)
  }}>公開を休止</button>
  return <form aria-label="開発用の公開休止" onSubmit={pause}>
    <p>公開版 {version} を休止します。旅行者は新しく挑戦や回答を送れなくなります。</p>
    <label>休止理由<textarea required maxLength={1000} rows={2} value={reason} disabled={pending}
      onChange={(event) => setReason(event.target.value)} /></label>
    {failure && <p role="alert">{failure.message}</p>}
    <div className="admin-list-actions">
      <button type="button" disabled={pending} onClick={() => setOpen(false)}>キャンセル</button>
      {failure?.reload ? <button type="button" onClick={onReload}>最新の問題一覧を確認</button>
        : <button type="submit" disabled={pending || !reason.trim()}>{pending ? '休止を確認しています…' : 'この公開版を休止する'}</button>}
    </div>
  </form>
}
