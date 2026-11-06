import { useCallback, useEffect, useRef } from 'react'

type Request = { controller: AbortController; deadline?: ReturnType<typeof setTimeout> }

export function useRequestAction(timeoutMs = 10_000) {
  const active = useRef<Request | null>(null)
  const abort = useCallback(() => {
    const request = active.current
    active.current = null
    if (request) { clearTimeout(request.deadline); request.controller.abort() }
  }, [])
  useEffect(() => abort, [abort])

  return (onTimeout: () => void) => {
    if (active.current) return null
    const request: Request = { controller: new AbortController() }
    active.current = request
    const isCurrent = () => active.current === request
    request.deadline = setTimeout(() => {
      if (!isCurrent()) return
      abort()
      onTimeout()
    }, timeoutMs)
    return {
      signal: request.controller.signal,
      isCurrent,
      finish() {
        clearTimeout(request.deadline)
        if (isCurrent()) active.current = null
      },
    }
  }
}
