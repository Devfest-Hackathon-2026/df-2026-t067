import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { ApiError } from '../../shared/api'
import type { ApiClient } from '../../shared/api'
import { useRequestAction } from '../../shared/useRequestAction'

type Failure = { message: string; reload?: true }

function pauseFailure(cause: unknown): Failure {
  if (cause instanceof ApiError) {
    if (cause.code === 'QUEST_CHANGED') return { message: '公開内容に変更・一覧を再読込', reload: true }
    if (cause.code === 'QUEST_UNAVAILABLE') return { message: '未公開・一覧を再読込', reload: true }
    if (cause.code === 'FORBIDDEN') return { message: '公開権限を確認', reload: true }
  }
  return { message: '休止未確認・再試行' }
}

const pauseCategories = ['安全上の問題', '権利の問題', '内容の誤り', '自治体からの依頼', 'その他'] as const

export function PausePublication({ api, orgId, questId, version, onPaused, onReload }: {
  api: ApiClient; orgId: string; questId: string; version: number; onPaused: () => void; onReload: () => void
}) {
  const trigger = useRef<HTMLButtonElement>(null)
  const categoryInput = useRef<HTMLSelectElement>(null)
  const wasOpen = useRef(false)
  const [open, setOpen] = useState(false)
  useEffect(() => { if (open) categoryInput.current?.focus(); else if (wasOpen.current) trigger.current?.focus(); wasOpen.current = open }, [open])
  const [category, setCategory] = useState('')
  const [reason, setReason] = useState('')
  const composed = category ? (reason.trim() ? `${category}：${reason.trim()}` : category) : reason.trim()
  const valid = composed !== '' && (category !== 'その他' || reason.trim() !== '')
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<Failure | null>(null)
  const begin = useRequestAction()

  async function pause(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!valid || failure?.reload) return
    const operation = begin(() => {
      setFailure({ message: '休止確認中断・再試行' })
      setPending(false)
    })
    if (!operation) return
    setPending(true)
    setFailure(null)
    try {
      await api.pauseManagedQuest(orgId, questId, { expectedPublishedVersion: version, reason: composed }, { signal: operation.signal })
      if (operation.isCurrent()) onPaused()
    } catch (cause) {
      if (operation.isCurrent()) setFailure(pauseFailure(cause))
    } finally {
      if (operation.isCurrent()) setPending(false)
      operation.finish()
    }
  }

  if (!open) return <button type="button" className="danger-button" ref={trigger} onClick={() => {
    setCategory(''); setReason(''); setFailure((current) => current?.reload ? current : null); setOpen(true)
  }}>休止</button>
  return <form aria-label="公開休止" onSubmit={pause}>
    <p>公開停止・新規挑戦停止</p>
    <label>種類<select ref={categoryInput} value={category} disabled={pending} onChange={(event) => setCategory(event.target.value)}>
      <option value="">選択</option>
      {pauseCategories.map((item) => <option key={item} value={item}>{item}</option>)}
    </select></label>
    <label>休止理由<textarea required={category === 'その他'} maxLength={1000 - (category ? category.length + 1 : 0)} rows={2} value={reason} disabled={pending}
      onChange={(event) => setReason(event.target.value)} /></label>
    {failure && <p role="alert">{failure.message}</p>}
    <div className="admin-list-actions">
      <button type="button" disabled={pending} onClick={() => setOpen(false)}>キャンセル</button>
      {failure?.reload ? <button type="button" onClick={onReload}>最新の謎一覧を確認</button>
        : <button type="submit" className="danger-button" disabled={pending || !valid}>{pending ? '休止を確認しています…' : '休止する'}</button>}
    </div>
  </form>
}
