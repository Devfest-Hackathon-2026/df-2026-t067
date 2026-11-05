import { useEffect, useState } from 'react'
import { ApiError } from './api/client'
import type { ApiErrorCode } from './api/client'

export type Remote<T> = { status: 'loading' } | { status: 'error'; code?: ApiErrorCode } | { status: 'ready'; value: T }

// A request belongs to one callback and retry generation. Cleanup and the
// deadline abort it so an old response cannot replace the current view.
export function useRemote<T>(enabled: boolean, read: (signal: AbortSignal) => Promise<T>) {
  const [revision, setRevision] = useState(0)
  const [settled, setSettled] = useState<{ read: typeof read; revision: number; result: Remote<T> } | null>(null)
  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    const fail = (cause?: unknown) => setSettled({ read, revision, result: {
      status: 'error', code: cause instanceof ApiError ? cause.code : undefined,
    } })
    const deadline = setTimeout(() => { fail(); controller.abort() }, 10_000)
    void read(controller.signal).then((value) => {
      if (!controller.signal.aborted) setSettled({ read, revision, result: { status: 'ready', value } })
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) { fail(cause); controller.abort() }
    }).finally(() => clearTimeout(deadline))
    return () => { clearTimeout(deadline); controller.abort() }
  }, [enabled, read, revision])
  const result: Remote<T> = settled?.read === read && settled.revision === revision ? settled.result : { status: 'loading' }
  return { result, retry: () => setRevision((value) => value + 1) }
}
