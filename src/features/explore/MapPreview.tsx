import { useEffect, useRef, useState } from 'react'
import { Icon } from '../../components/Icon'
import { loadGoogleMaps, subscribeMapsAuthFailure } from './googleMapsLoader'

const JAPAN = { lat: 36.2048, lng: 138.2529 }
const API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? ''

interface MapInstance {
  setZoom(value: number): void
  getZoom(): number | undefined
  setCenter(value: { lat: number; lng: number }): void
  addListener(name: string, callback: () => void): { remove(): void }
}

export function MapPreview() {
  const target = useRef<HTMLDivElement>(null)
  const map = useRef<MapInstance | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing' | 'error'>(API_KEY ? 'loading' : 'missing')
  const [zoom, setZoom] = useState(5)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!API_KEY || !target.current) return
    let active = true
    let zoomListener: { remove(): void } | undefined
    const unsubscribeAuth = subscribeMapsAuthFailure(() => {
      if (active) { map.current = null; setStatus('error') }
    })
    setStatus('loading')
    void loadGoogleMaps(API_KEY).then((google) => {
      if (!active || !target.current) return
      const instance = new google.Map(target.current, {
        center: JAPAN, zoom: 5, minZoom: 3, maxZoom: 12,
        disableDefaultUI: true, mapTypeControl: false, streetViewControl: false,
        fullscreenControl: false, clickableIcons: false, gestureHandling: 'greedy',
      }) as MapInstance
      map.current = instance
      zoomListener = instance.addListener('zoom_changed', () => {
        if (active) setZoom(instance.getZoom() ?? 5)
      })
      setStatus('ready')
    }).catch(() => { if (active) setStatus('error') })
    return () => { active = false; unsubscribeAuth(); zoomListener?.remove(); map.current = null }
  }, [attempt])

  const changeZoom = (delta: number) => map.current?.setZoom(Math.max(3, Math.min(12, (map.current.getZoom() ?? zoom) + delta)))
  const reset = () => { map.current?.setCenter(JAPAN); map.current?.setZoom(5) }

  return (
    <section className="map-preview" aria-label="全国の謎">
      <div className="map-topline"><span className="map-scope"><Icon name="map" />全国の謎</span></div>
      {API_KEY && <div ref={target} className="google-map-canvas" aria-label="日本地図" />}
      {status !== 'ready' && <div className="map-state" role={status === 'error' ? 'alert' : 'status'}>
        {status === 'missing' ? <><strong>Google Mapsの設定が必要です</strong><span>地図を表示するには設定をご確認ください。問題の閲覧は続けられます。</span></> :
          status === 'loading' ? <span>地図を読み込んでいます…</span> :
            <><strong>地図を読み込めませんでした</strong><span>問題の閲覧は続けられます。</span><button type="button" onClick={() => setAttempt((value) => value + 1)}>地図を再試行</button></>}
      </div>}
      {status === 'ready' && <div className="map-zoom" aria-label="地図の表示操作">
        <button type="button" aria-label="地図を拡大" disabled={zoom >= 12} onClick={() => changeZoom(1)}><Icon name="plus" /></button>
        <button type="button" aria-label="地図を縮小" disabled={zoom <= 3} onClick={() => changeZoom(-1)}><Icon name="minus" /></button>
        <button type="button" aria-label="地図の表示を戻す" onClick={reset}><Icon name="reset" /></button>
      </div>}
      {status === 'ready' && <output className="sr-only" aria-label="地図の表示倍率">{zoom}</output>}
    </section>
  )
}
