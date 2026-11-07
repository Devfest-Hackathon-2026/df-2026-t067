import { useEffect, useRef, useState } from 'react'
import type { CaptureZone } from '../../shared/api'
import type { GoogleMapsApi, MapInstance } from '../explore/googleMapsLoader'
import { loadGoogleMaps, subscribeMapsAuthFailure } from '../explore/googleMapsLoader'

const API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? ''

/** Only mounted by the authorized private shooting-area editor; never part of public map data. */
export function ShootingAreasMap({ zones, selectedIndex, disabled, onSelect }: {
  zones: Array<CaptureZone | null>; selectedIndex: number | null; disabled: boolean
  onSelect: (latitude: number, longitude: number) => void
}) {
  const target = useRef<HTMLDivElement>(null)
  const latest = useRef({ disabled, onSelect, zones, selectedIndex })
  useEffect(() => { latest.current = { disabled, onSelect, zones, selectedIndex } }, [disabled, onSelect, zones, selectedIndex])
  const [loaded, setLoaded] = useState<{ google: GoogleMapsApi; map: MapInstance } | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing' | 'error'>(API_KEY ? 'loading' : 'missing')
  useEffect(() => {
    if (!API_KEY || !target.current) return
    let active = true
    let authFailed = false
    let dispose = () => {}
    const unsubscribe = subscribeMapsAuthFailure(() => { authFailed = true; dispose(); if (active) { setLoaded(null); setStatus('error') } })
    setLoaded(null)
    setStatus('loading')
    void loadGoogleMaps(API_KEY).then((google) => {
      if (!active || authFailed || !target.current) return
      if (!google.Circle) throw new Error('unavailable')
      const current = latest.current
      const first = (current.selectedIndex === null ? null : current.zones[current.selectedIndex]) ?? current.zones.find((zone) => zone !== null)
      const map = new google.Map(target.current, {
        center: first ? { lat: first.latitude, lng: first.longitude } : { lat: 36, lng: 138 },
        zoom: first ? 17 : 5, mapTypeControl: false, streetViewControl: false, fullscreenControl: false, clickableIcons: false,
      })
      const listener = google.event.addListener(map, 'click', (event) => {
        if (latest.current.disabled || !event?.latLng) return
        const latitude = event.latLng.lat(), longitude = event.latLng.lng()
        if (Number.isFinite(latitude) && Number.isFinite(longitude)) latest.current.onSelect(latitude, longitude)
      })
      dispose = () => { listener.remove() }
      if (authFailed) { dispose(); return }
      setLoaded({ google, map })
      setStatus('ready')
    }).catch(() => { if (active) setStatus('error') })
    return () => { active = false; unsubscribe(); dispose() }
  }, [attempt])
  useEffect(() => {
    if (!loaded?.google.Circle) return
    const Circle = loaded.google.Circle
    const circles = zones.flatMap((zone, index) => zone ? [new Circle({
      map: loaded.map, center: { lat: zone.latitude, lng: zone.longitude }, radius: zone.radiusMeters,
      clickable: false, strokeColor: index === selectedIndex ? '#176b46' : '#52677c',
      fillColor: '#176b46', fillOpacity: index === selectedIndex ? 0.25 : 0.1,
    })] : [])
    return () => { circles.forEach((circle) => circle.setMap(null)) }
  }, [loaded, zones, selectedIndex])
  return <div className="capture-map" aria-label="非公開の撮影範囲の地図">
    {API_KEY && <div ref={target} className="google-map-canvas" aria-label="撮影の立ち位置を選ぶGoogleマップ" />}
    {status === 'missing' && <p>地図の設定がないため、下の数値入力で設定できます。</p>}
    {status === 'loading' && <p role="status">地図を読み込んでいます…</p>}
    {status === 'error' && <div role="alert"><p>地図を読み込めませんでした。入力は保持されています。数値入力で設定できます。</p><button type="button" onClick={() => setAttempt((value) => value + 1)}>地図を再試行</button></div>}
  </div>
}
