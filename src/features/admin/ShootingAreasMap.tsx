import { useEffect, useRef, useState } from 'react'
import { placeHoursCandidate } from './placeHoursCandidate'
import { Icon } from '../../components/Icon'
import type { CaptureZone } from '../../shared/api'
import type { Position } from '../../shared/api/types'
import type { GoogleMapsApi, MapInstance } from '../explore/googleMapsLoader'
import { loadGoogleMaps, subscribeMapsAuthFailure } from '../explore/googleMapsLoader'
import { useRequestAction } from '../../shared/useRequestAction'
import { MAP_PIN_COLOR, MAP_PIN_SELECTED_COLOR, MAP_STYLES } from '../explore/mapStyles'

const API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? ''
const overview = { lat: 36, lng: 138 }
const minZoom = 5
const maxZoom = 20

export type MapPlaceDetails = { name?: string; address?: string; hours?: string }

type PlacePick = { id: string; loadDetails?: () => Promise<MapPlaceDetails> }

/** Only mounted by the authorized private shooting-area editor; never part of public map data. */
export function ShootingAreasMap({ zones, selectedIndex, disabled, onSelect, spot, pickPlace = false, onAvailabilityChange }: {
  zones: Array<CaptureZone | null>; selectedIndex: number | null; disabled: boolean
  onSelect: (latitude: number, longitude: number, place?: PlacePick) => void
  onAvailabilityChange?: (unavailable: boolean) => void
  pickPlace?: boolean
  spot?: Position | null
}) {
  const spotMode = spot !== undefined
  const target = useRef<HTMLDivElement>(null)
  const latest = useRef({ disabled, onSelect, zones, selectedIndex, spot })
  useEffect(() => { latest.current = { disabled, onSelect, zones, selectedIndex, spot } }, [disabled, onSelect, zones, selectedIndex, spot])
  const [loaded, setLoaded] = useState<{ google: GoogleMapsApi; map: MapInstance; initialView: { center: { lat: number; lng: number }; zoom: number } } | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [currentLocation, setCurrentLocation] = useState<Position | null>(null)
  const [zoom, setZoom] = useState(minZoom)
  const [locating, setLocating] = useState(false)
  const [locationStatus, setLocationStatus] = useState('')
  const beginLocation = useRequestAction()
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing' | 'error'>(API_KEY ? 'loading' : 'missing')
  useEffect(() => { onAvailabilityChange?.(status === 'missing' || status === 'error') }, [status, onAvailabilityChange])
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
      if (spotMode ? !google.Marker : !google.Circle) throw new Error('unavailable')
      const current = latest.current
      const first = current.spot ?? (current.selectedIndex === null ? null : current.zones[current.selectedIndex]) ?? current.zones.find((zone) => zone !== null)
      const initialView = {
        center: first ? { lat: first.latitude, lng: first.longitude } : overview,
        zoom: first ? (spotMode ? 17 : 14) : minZoom,
      }
      const map = new google.Map(target.current, {
        ...initialView,
        ...(pickPlace ? { minZoom, maxZoom, zoomControl: false } : {}), mapTypeControl: false, streetViewControl: false, fullscreenControl: false, clickableIcons: pickPlace,
        styles: pickPlace ? undefined : MAP_STYLES,
      })
      const listener = google.event.addListener(map, 'click', (event) => {
        if (latest.current.disabled || !event?.latLng) return
        const latitude = event.latLng.lat(), longitude = event.latLng.lng()
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return
        const id = pickPlace && event.placeId && /^[A-Za-z0-9_-]{1,512}$/.test(event.placeId) ? event.placeId : undefined
        if (!id) { latest.current.onSelect(latitude, longitude); return }
        event.stop?.()
        latest.current.onSelect(latitude, longitude, {
          id, loadDetails: import.meta.env.VITE_GOOGLE_MAPS_PLACES_PICKER === 'true' && google.importLibrary
            ? async () => {
              const { Place } = await google.importLibrary!('places')
              const place = new Place({ id })
              const hoursEnabled = import.meta.env.VITE_GOOGLE_MAPS_PLACES_HOURS === 'true'
              await place.fetchFields({ fields: ['displayName', 'formattedAddress', ...(hoursEnabled ? ['regularOpeningHours'] : [])] })
              return { name: place.displayName ?? undefined, address: place.formattedAddress ?? undefined,
                hours: hoursEnabled ? placeHoursCandidate((place as unknown as { regularOpeningHours?: unknown }).regularOpeningHours) : undefined }
            } : undefined,
        })
      })
      dispose = () => { listener.remove() }
      if (authFailed) { dispose(); return }
      setLoaded({ google, map, initialView })
      setStatus('ready')
    }).catch(() => { if (active) setStatus('error') })
    return () => { active = false; unsubscribe(); dispose() }
  }, [attempt, spotMode, pickPlace])
  const spotLatitude = spot?.latitude, spotLongitude = spot?.longitude
  useEffect(() => {
    if (!loaded?.google.Marker || spotLatitude === undefined || spotLongitude === undefined) return
    const position = { lat: spotLatitude, lng: spotLongitude }
    const marker = new loaded.google.Marker({ map: loaded.map, position, title: '対象スポット' }) as { setMap(map: null): void }
    loaded.map.setCenter(position)
    loaded.map.setZoom(17)
    return () => marker.setMap(null)
  }, [loaded, spotLatitude, spotLongitude])
  useEffect(() => {
    if (!loaded?.google.Circle) return
    const Circle = loaded.google.Circle
    const circles = zones.flatMap((zone, index) => zone ? [new Circle({
      map: loaded.map, center: { lat: zone.latitude, lng: zone.longitude }, radius: zone.radiusMeters,
      clickable: false, strokeColor: index === selectedIndex ? MAP_PIN_SELECTED_COLOR : MAP_PIN_COLOR,
      fillColor: MAP_PIN_COLOR, fillOpacity: index === selectedIndex ? 0.25 : 0.1,
    })] : [])
    return () => { circles.forEach((circle) => circle.setMap(null)) }
  }, [loaded, zones, selectedIndex])
  useEffect(() => {
    if (!loaded || !currentLocation) return
    loaded.map.setCenter({ lat: currentLocation.latitude, lng: currentLocation.longitude })
    loaded.map.setZoom(17)
  }, [loaded, currentLocation])

  useEffect(() => {
    if (!pickPlace || !loaded) return
    const updateZoom = () => setZoom(loaded.map.getZoom?.() ?? minZoom)
    updateZoom()
    const listener = loaded.google.event.addListener(loaded.map, 'zoom_changed', updateZoom)
    return () => listener.remove()
  }, [loaded, pickPlace])

  function changeZoom(delta: number) {
    if (!loaded) return
    const nextZoom = Math.max(minZoom, Math.min(maxZoom, Math.round(loaded.map.getZoom?.() ?? zoom) + delta))
    loaded.map.setZoom(nextZoom)
  }

  function resetView() {
    if (!loaded) return
    loaded.map.setCenter(spot ? { lat: spot.latitude, lng: spot.longitude } : loaded.initialView.center)
    loaded.map.setZoom(spot ? 17 : loaded.initialView.zoom)
  }

  function locate() {
    const geolocation = navigator.geolocation
    if (!geolocation?.getCurrentPosition) {
      setLocationStatus('現在地未対応・地図で選択')
      return
    }
    const retryMessage = '現在地取得失敗・再試行'
    const operation = beginLocation(() => { setLocating(false); setLocationStatus(retryMessage) })
    if (!operation) return
    setLocating(true)
    setLocationStatus('現在地を取得しています…')
    function finish(message: string) {
      if (!operation?.isCurrent()) return
      operation.finish()
      setLocating(false)
      setLocationStatus(message)
    }
    try {
      geolocation.getCurrentPosition(({ coords: { latitude, longitude } }) => {
        if (!operation.isCurrent()) return
        if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) || Math.abs(longitude) > 180) {
          finish(retryMessage)
          return
        }
        setCurrentLocation({ latitude, longitude })
        finish('現在地周辺・場所を選択')
      }, (error) => finish(error.code === 1 ? '位置情報未許可・サイト設定で許可' : retryMessage),
      { enableHighAccuracy: false, maximumAge: 0, timeout: 10_000 })
    } catch {
      finish(retryMessage)
    }
  }

  return <div className="capture-map" aria-label={spotMode ? '対象スポットの確認地図' : '非公開の撮影範囲の地図'}>
    {API_KEY && <div className="spot-map-viewport">
      <div ref={target} className="google-map-canvas" aria-label={spotMode ? '対象スポットを選ぶGoogleマップ' : '撮影の立ち位置を選ぶGoogleマップ'} />
      {pickPlace && status === 'ready' && <div className="spot-map-controls" role="group" aria-label="地図の表示操作">
        <div className="spot-map-zoom">
          <button type="button" aria-label="地図を拡大" title="地図を拡大" disabled={disabled || zoom >= maxZoom} onClick={() => changeZoom(1)}><Icon name="plus" /></button>
          <button type="button" aria-label="地図を縮小" title="地図を縮小" disabled={disabled || zoom <= minZoom} onClick={() => changeZoom(-1)}><Icon name="minus" /></button>
          <button type="button" aria-label="地図の表示を戻す" title="地図の表示を戻す" disabled={disabled} onClick={resetView}><Icon name="reset" /></button>
        </div>
        <button type="button" className="spot-map-locate" aria-label="現在地へ戻る" title="現在地へ戻る" disabled={disabled || locating} onClick={locate}><Icon name="locate" /></button>
      </div>}
    </div>}
    {pickPlace && locationStatus && <p role="status">{locationStatus}</p>}
    {status === 'missing' && <p>地図未設定・座標を入力</p>}
    {status === 'loading' && <p role="status">地図を読込中</p>}
    {status === 'error' && <div role="alert"><p>地図読込失敗・座標を入力</p><button type="button" onClick={() => setAttempt((value) => value + 1)}>地図を再試行</button></div>}
  </div>
}
