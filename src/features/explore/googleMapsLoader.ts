export interface GoogleMapsApi {
  Map: new (element: HTMLElement, options: Record<string, unknown>) => unknown
  event: { addListener(target: unknown, name: string, callback: () => void): { remove(): void } }
}

declare global {
  interface Window { google?: { maps?: GoogleMapsApi }; gm_authFailure?: () => void }
}

let loading: Promise<GoogleMapsApi> | undefined
let generation = 0
let previousFailure: (() => void) | undefined
let authFailed = false
const failureListeners = new Set<() => void>()

function reportAuthFailure() {
  authFailed = true
  previousFailure?.()
  for (const listener of failureListeners) listener()
}

export function subscribeMapsAuthFailure(listener: () => void): () => void {
  if (failureListeners.size === 0) {
    previousFailure = window.gm_authFailure
    window.gm_authFailure = reportAuthFailure
  }
  failureListeners.add(listener)
  return () => {
    failureListeners.delete(listener)
    if (failureListeners.size === 0 && window.gm_authFailure === reportAuthFailure) {
      window.gm_authFailure = previousFailure
      previousFailure = undefined
    }
  }
}

export function loadGoogleMaps(key: string, timeoutMs = 15000): Promise<GoogleMapsApi> {
  if (!key) return Promise.reject(new Error('missing-key'))
  if (authFailed) return Promise.reject(new Error('auth'))
  if (typeof window.google?.maps?.Map === 'function') return Promise.resolve(window.google.maps)
  if (loading) return loading

  const current = ++generation
  const callbackName = `__questMapsReady_${current}`
  let cleanup = () => {}
  const request = new Promise<GoogleMapsApi>((resolve, reject) => {
    const script = document.createElement('script')
    let settled = false
    const finish = (error?: Error) => {
      if (settled || current !== generation) return
      settled = true
      window.clearTimeout(timer)
      delete (window as unknown as Record<string, unknown>)[callbackName]
      if (error) {
        script.remove()
        loading = undefined
        reject(error)
      } else if (window.google?.maps) resolve(window.google.maps)
      else {
        script.remove()
        loading = undefined
        reject(new Error('unavailable'))
      }
    }
    const stopAuth = subscribeMapsAuthFailure(() => finish(new Error('auth')))
    cleanup = stopAuth
    const timer = window.setTimeout(() => finish(new Error('timeout')), timeoutMs)
    ;(window as unknown as Record<string, unknown>)[callbackName] = () => finish()
    script.dataset.questGoogleMaps = 'true'
    script.async = true
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&callback=${callbackName}&loading=async&language=ja&region=JP&v=quarterly`
    script.onerror = () => finish(new Error('network'))
    document.head.append(script)
  })
  loading = request
  void request.then(cleanup, cleanup)
  return request
}
