import { useEffect, useRef, useState } from 'react'
import { loadGoogleMaps, subscribeMapsAuthFailure } from '../explore/googleMapsLoader'
import { MAP_STYLES } from '../explore/mapStyles'

const API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? ''

export function CaptureLocationMap({ latitude, longitude }: { latitude: number; longitude: number }) {
  const target = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing' | 'error' | 'auth-error'>(API_KEY ? 'loading' : 'missing')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!API_KEY || !target.current) return
    let active = true
    let authFailed = false
    const unsubscribe = subscribeMapsAuthFailure(() => {
      authFailed = true
      if (active) setStatus('auth-error')
    })
    setStatus('loading')
    void loadGoogleMaps(API_KEY).then((google) => {
      if (!active || authFailed || !target.current) return
      const center = { lat: latitude, lng: longitude }
      const map = new google.Map(target.current, {
        center, zoom: 17, disableDefaultUI: false, mapTypeControl: false,
        streetViewControl: false, fullscreenControl: false, clickableIcons: false,
        styles: MAP_STYLES,
      })
      if (authFailed) return
      if (!google.Marker) throw new Error('unavailable')
      new google.Marker({ map, position: center, title: '撮影地' })
      setStatus('ready')
    }).catch((error: unknown) => {
      if (active) setStatus(error instanceof Error && error.message === 'auth' ? 'auth-error' : 'error')
    })
    return () => { active = false; unsubscribe() }
  }, [attempt, latitude, longitude])

  return (
    <div className="capture-map" aria-label="撮影地の地図">
      {API_KEY && <div ref={target} className="google-map-canvas" aria-label="撮影地のGoogleマップ" />}
      {status !== 'ready' && <div className="map-state" role={status === 'error' || status === 'auth-error' ? 'alert' : 'status'}>
        {status === 'missing' ? <><strong>地図未設定</strong><span>地図設定を確認</span></> :
          status === 'loading' ? <span>地図読込中</span> :
            <><strong>地図読込失敗</strong>{status === 'auth-error'
              ? <span>地図設定を確認</span>
              : <button type="button" onClick={() => setAttempt((value) => value + 1)}>地図を再試行</button>}</>}
      </div>}
    </div>
  )
}
