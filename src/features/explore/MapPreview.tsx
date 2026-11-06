import { useEffect, useRef, useState } from 'react'
import { Icon } from '../../components/Icon'
import type { PublicArea } from '../../shared/api/types'
import { loadGoogleMaps, subscribeMapsAuthFailure, type DataLayer, type MapInstance } from './googleMapsLoader'

const JAPAN = { lat: 36.2048, lng: 138.2529 }
const API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? ''

export function MapPreview({ areas = [], selectedAreaId = '', onSelectArea, showPublicAreas = true }: {
  areas?: PublicArea[]; selectedAreaId?: string; onSelectArea?: (areaId: string) => void; showPublicAreas?: boolean
}) {
  const target = useRef<HTMLDivElement>(null)
  const map = useRef<MapInstance | null>(null)
  const dataLayer = useRef<DataLayer | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing' | 'error' | 'auth-error'>(API_KEY ? 'loading' : 'missing')
  const [zoom, setZoom] = useState(5)
  const [attempt, setAttempt] = useState(0)
  const [areaAttempt, setAreaAttempt] = useState(0)
  const [areaFailed, setAreaFailed] = useState(false)
  const lastViewportSelection = useRef<{ map: MapInstance; areaId: string } | null>(null)
  const areaFailureTimer = useRef<number | undefined>(undefined)
  const failArea = () => {
    window.clearTimeout(areaFailureTimer.current)
    areaFailureTimer.current = window.setTimeout(() => { areaFailureTimer.current = undefined; setAreaFailed(true) }, 0)
  }

  useEffect(() => {
    if (!API_KEY || !target.current) return
    let active = true
    let authFailed = false
    let zoomListener: { remove(): void } | undefined
    const unsubscribeAuth = subscribeMapsAuthFailure(() => {
      authFailed = true
      if (active) { map.current = null; setStatus('auth-error') }
    })
    void loadGoogleMaps(API_KEY).then((google) => {
      if (!active || authFailed || !target.current) return
      let instance: MapInstance
      try {
        instance = new google.Map(target.current, {
          center: JAPAN, zoom: 5, minZoom: 3, maxZoom: 12,
          disableDefaultUI: true, mapTypeControl: false, streetViewControl: false,
          fullscreenControl: false, clickableIcons: false, gestureHandling: 'greedy',
        }) as MapInstance
        if (authFailed) return
        map.current = instance
        try {
          const layer = new google.Data()
          layer.setMap(instance)
          dataLayer.current = layer
        } catch { failArea() }
        zoomListener = instance.addListener('zoom_changed', () => {
          if (active) setZoom(instance.getZoom() ?? 5)
        })
        setStatus('ready')
      } catch {
        if (active) setStatus('error')
        return
      }
    }).catch((error: unknown) => { if (active) setStatus(error instanceof Error && error.message === 'auth' ? 'auth-error' : 'error') })
    return () => {
      active = false
      window.clearTimeout(areaFailureTimer.current)
      unsubscribeAuth()
      try { zoomListener?.remove() } catch { /* SDK teardown is best effort. */ }
      try { dataLayer.current?.setMap(null) } catch { /* SDK teardown is best effort. */ }
      dataLayer.current = null
      map.current = null
    }
  }, [attempt])

  useEffect(() => {
    let layer = dataLayer.current
    if (!layer && status === 'ready' && showPublicAreas && API_KEY && map.current && window.google?.maps) {
      try { layer = new window.google.maps.Data(); layer.setMap(map.current); dataLayer.current = layer }
      catch { failArea(); return }
    }
    if (!layer) return
    let active = true
    let listener: { remove(): void } | undefined
    try {
      window.clearTimeout(areaFailureTimer.current)
      areaFailureTimer.current = undefined
      layer.setMap(null)
      layer.forEach((feature) => layer.remove(feature))
      if (!showPublicAreas || status !== 'ready') return () => { active = false }
      const features = areas.flatMap((area) => {
        const geometry = area.publicGeometry
        const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
        const valid = polygons.filter((polygon) => polygon.length > 0 && polygon.every((ring) => {
          if (ring.length < 4) return false
          const validPoints = ring.every(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat) && Math.abs(lng) <= 180 && Math.abs(lat) <= 90)
          const [firstLng, firstLat] = ring[0]
          const [lastLng, lastLat] = ring[ring.length - 1]
          return validPoints && firstLng === lastLng && firstLat === lastLat
        }))
        if (!valid.length) return []
        return [{ type: 'Feature' as const, id: area.areaId, properties: { areaId: area.areaId },
          geometry: { type: geometry.type, coordinates: geometry.type === 'Polygon' ? valid[0] : valid } }]
      })
      if (!features.length) return () => { active = false }
      layer.setMap(map.current)
      layer.addGeoJson({ type: 'FeatureCollection', features })
      layer.setStyle((feature) => ({
        fillColor: feature.getProperty('areaId') === selectedAreaId ? '#f6d84a' : '#4eb8d0',
        fillOpacity: feature.getProperty('areaId') === selectedAreaId ? 0.55 : 0.25,
        strokeColor: '#17212b', strokeOpacity: 0.9, strokeWeight: feature.getProperty('areaId') === selectedAreaId ? 3 : 1.5,
        clickable: true,
      }))
      listener = layer.addListener('click', (event) => {
        const areaId = event.feature.getProperty('areaId')
        if (active && typeof areaId === 'string' && areas.some((area) => area.areaId === areaId)) onSelectArea?.(areaId)
      })
    } catch {
      active = false
      try { listener?.remove(); layer.setMap(null); layer.forEach((feature) => layer.remove(feature)) } catch { /* Keep the base map usable. */ }
      failArea()
    }
    return () => { active = false; window.clearTimeout(areaFailureTimer.current); areaFailureTimer.current = undefined; try { listener?.remove(); layer.setMap(null) } catch { /* SDK teardown is best effort. */ } }
  }, [areas, selectedAreaId, onSelectArea, showPublicAreas, status, areaAttempt])

  useEffect(() => {
    const instance = map.current
    const google = window.google?.maps
    if (!API_KEY || !instance || !google || !showPublicAreas || status !== 'ready') return
    if (lastViewportSelection.current?.map === instance && lastViewportSelection.current.areaId === selectedAreaId) return
    if (!selectedAreaId) { instance.setCenter(JAPAN); instance.setZoom(5); lastViewportSelection.current = { map: instance, areaId: '' }; return }
    try {
      const area = areas.find((candidate) => candidate.areaId === selectedAreaId)
      if (!area) return
      const geometry = area.publicGeometry
      const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
      const validPolygons = polygons.filter((polygon) => polygon.length > 0 && polygon.every((ring) => {
        if (ring.length < 4) return false
        const validPoints = ring.every(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat) && Math.abs(lng) <= 180 && Math.abs(lat) <= 90)
        const [firstLng, firstLat] = ring[0]
        const [lastLng, lastLat] = ring[ring.length - 1]
        return validPoints && firstLng === lastLng && firstLat === lastLat
      }))
      if (!validPolygons.length) return
      const bounds = new google.LatLngBounds()
      validPolygons.forEach((polygon) => polygon.forEach((ring) => ring.forEach(([lng, lat]) => bounds.extend({ lat, lng }))))
      instance.fitBounds(bounds)
      lastViewportSelection.current = { map: instance, areaId: selectedAreaId }
    } catch { failArea() }
  }, [selectedAreaId, areas, showPublicAreas, status, areaAttempt])

  const changeZoom = (delta: number) => map.current?.setZoom(Math.max(3, Math.min(12, (map.current.getZoom() ?? zoom) + delta)))
  const reset = () => { map.current?.setCenter(JAPAN); map.current?.setZoom(5) }

  return (
    <section className="map-preview" aria-label="全国の謎">
      <div className="map-topline"><span className="map-scope"><Icon name="map" />全国の謎</span></div>
      {API_KEY && <div ref={target} className="google-map-canvas" aria-label="日本地図" />}
      {status !== 'ready' && <div className="map-state" role={status === 'error' || status === 'auth-error' ? 'alert' : 'status'}>
        {status === 'missing' ? <><strong>Google Mapsの設定が必要です</strong><span>地図を表示するには設定をご確認ください。問題の閲覧は続けられます。</span></> :
          status === 'loading' ? <span>地図を読み込んでいます…</span> :
            <><strong>地図を読み込めませんでした</strong><span>問題の閲覧は続けられます。</span>{status === 'auth-error'
              ? <><span>地図の設定を確認して、このページを再読み込みしてください。</span><button type="button" onClick={() => window.location.reload()}>ページを再読み込み</button></>
              : <button type="button" onClick={() => { setStatus('loading'); setAttempt((value) => value + 1) }}>地図を再試行</button>}</>}
      </div>}
      {status === 'ready' && areaFailed && <div className="map-state map-area-error" role="alert"><strong>地域エリアを表示できませんでした</strong><button type="button" onClick={() => { window.clearTimeout(areaFailureTimer.current); areaFailureTimer.current = undefined; setAreaFailed(false); setAreaAttempt((value) => value + 1) }}>地域エリアを再試行</button></div>}
      {status === 'ready' && <div className="map-zoom" aria-label="地図の表示操作">
        <button type="button" aria-label="地図を拡大" disabled={zoom >= 12} onClick={() => changeZoom(1)}><Icon name="plus" /></button>
        <button type="button" aria-label="地図を縮小" disabled={zoom <= 3} onClick={() => changeZoom(-1)}><Icon name="minus" /></button>
        <button type="button" aria-label="地図の表示を戻す" onClick={reset}><Icon name="reset" /></button>
      </div>}
      {status === 'ready' && <output className="sr-only" aria-label="地図の表示倍率">{zoom}</output>}
    </section>
  )
}
