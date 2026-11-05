import { useRef, useState } from 'react'
import type { ApiClient } from '../../shared/api'
import { useRequestAction } from '../../shared/useRequestAction'

type State = 'idle' | 'confirm' | 'working' | 'pending' | 'send-error' | 'check-error' | 'failed'

export function DiscoveryDeletion({ api, id, onDeleted }: { api: ApiClient; id: string; onDeleted: () => void }) {
  const [state, setState] = useState<State>('idle')
  const receipt = useRef<string | null>(null)
  const begin = useRequestAction()

  async function check() {
    const operation = begin(() => setState(receipt.current ? 'check-error' : 'send-error'))
    if (!operation) return
    setState('working')
    try {
      const call = { signal: operation.signal }
      if (receipt.current === null) {
        const result = await api.deleteDiscovery(id, call)
        if (!operation.isCurrent()) return
        receipt.current = result.deletionId
      }
      const result = await api.getDeletion(receipt.current, call)
      if (!operation.isCurrent()) return
      if (result.state === 'completed') onDeleted()
      else if (result.state === 'pending') setState('pending')
      else setState(result.retryable ? 'check-error' : 'failed')
    } catch {
      if (operation.isCurrent()) setState(receipt.current ? 'check-error' : 'send-error')
    } finally { operation.finish() }
  }

  if (state === 'idle') return <button type="button" className="secondary-button" onClick={() => setState('confirm')}>記録を削除</button>
  return <div role="group" aria-label="本人記録の削除">
    {state === 'confirm' && <>
      <p>この記録と写真を削除しますか？</p>
      <div className="camera-actions">
        <button type="button" className="secondary-button" onClick={() => setState('idle')}>キャンセル</button>
        <button type="button" className="primary-button" onClick={check}>記録と写真を削除する</button>
      </div>
    </>}
    {state === 'working' && <p role="status">削除状態を確認しています…</p>}
    {state === 'pending' && <>
      <p role="status">削除を受け付けました。</p>
      <button type="button" className="secondary-button" onClick={check}>削除状態を確認</button>
    </>}
    {(state === 'send-error' || state === 'check-error') && <>
      <p role="alert">削除結果を確認できませんでした。</p>
      <button type="button" className="retry-button" onClick={check}>{state === 'check-error' ? '削除状態を再確認' : '削除を再試行'}</button>
    </>}
    {state === 'failed' && <p role="alert">記録を削除できませんでした。</p>}
  </div>
}
