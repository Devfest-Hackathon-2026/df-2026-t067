import { ShootingAreasMap } from './ShootingAreasMap'
import { initialSpotInput, parseDurableMapsLink, parseMapsSpotLink, spotPosition, type DurableMapsLink, type SpotInput } from './mapsSpotLink'
import { useEffect, useRef, useState } from 'react'
import type { SpotAddressInput, SpotAddressLookup } from '../../shared/api/admin-spot-address'

type Lookup = (orgId: string, input: SpotAddressInput, call?: { signal?: AbortSignal }) => Promise<SpotAddressLookup>

export function SpotEditor({ input, onChange, durable = false, orgId, canLookupSpotAddress = false, lookupSpotAddress, deriveShootingArea: _deriveShootingArea = false }: {
  input: SpotInput; onChange(input: SpotInput): void; durable?: boolean; orgId?: string
  canLookupSpotAddress?: boolean; lookupSpotAddress?: Lookup; deriveShootingArea?: boolean
}) {
  const [message, setMessage] = useState('')
  const [showMap, setShowMap] = useState(false)
  const [reference, setLinkReference] = useState<DurableMapsLink | null>(null)
  const [addressLookup, setAddressLookup] = useState<SpotAddressLookup | null>(null)
  const [lookingUp, setLookingUp] = useState(false)
  const lookupRequest = useRef<AbortController | null>(null)
  useEffect(() => () => {
    lookupRequest.current?.abort()
    lookupRequest.current = null
  }, [])
  const point = spotPosition(input.latitude, input.longitude)
  const referencePosition = reference?.kind === 'place' ? reference.position : null

  function clearAddressLookup() {
    lookupRequest.current?.abort()
    lookupRequest.current = null
    setAddressLookup(null)
    setLookingUp(false)
  }

  function setReference(link: DurableMapsLink | null) {
    clearAddressLookup()
    setLinkReference(link)
  }

  async function readLink() {
    if (lookupRequest.current) return
    if (durable) {
      const link = parseDurableMapsLink(input.url)
      setReference(link)
      if (link.kind === 'invalid' || link.kind === 'unsupported') {
        setMessage(link.kind === 'invalid' ? 'Google MapsのHTTPS共有リンクを入力してください。' : 'このリンクから対象の場所を特定できません。地図または数値で位置を指定してください。')
        return
      }
      const position = link.kind === 'place' && !link.googlePlaceId ? link.position : null
      onChange({ ...initialSpotInput(), url: input.url, hasImportedLink: true,
        ...(position ? { latitude: String(position.latitude), longitude: String(position.longitude) } : {}) })
      if (link.kind === 'short') setMessage('短縮リンクを開き、表示されたURLを貼り直してください。手入力でも登録できます。')
      else if (position) setMessage('座標候補を入力しました。スポット名・住所・位置を確認してください。')
      else setMessage('施設名・住所・位置は、地図や自治体の資料で確認して入力してください。')
      const lookupInput: SpotAddressInput | null = link.kind !== 'place' ? null : link.position
        ? { position: link.position, ...(link.googlePlaceId ? { googlePlaceId: link.googlePlaceId } : {}) }
        : link.googlePlaceId ? { googlePlaceId: link.googlePlaceId } : null
      if (lookupInput && canLookupSpotAddress && orgId && lookupSpotAddress) {
        const controller = new AbortController()
        lookupRequest.current = controller
        setLookingUp(true)
        try {
          const result = await lookupSpotAddress(orgId, lookupInput, { signal: controller.signal })
          if (!controller.signal.aborted) {
            setAddressLookup(result.orgId === orgId ? result : { orgId, status: 'unavailable' })
          }
        } catch {
          if (!controller.signal.aborted) setAddressLookup({ orgId, status: 'unavailable' })
        } finally {
          if (lookupRequest.current === controller) { setLookingUp(false); lookupRequest.current = null }
        }
      }
      return
    }
    const result = parseMapsSpotLink(input.url)
    setMessage(result.message)
    if (!result.position) return
    edit({ latitude: String(result.position.latitude), longitude: String(result.position.longitude) })
  }

  function edit(changes: Partial<SpotInput>) {
    if ('latitude' in changes || 'longitude' in changes) clearAddressLookup()
    onChange({ ...input, googlePlaceId: undefined, ...changes })
  }

  return <fieldset>
    <legend>場所</legend>
    <label>Google Maps共有URL<input type="url" value={input.url} maxLength={4096}
      onChange={(event) => {
        const url = event.target.value
        if (durable) { edit({ url }); setReference(null) }
        else onChange({ ...input, url })
        setMessage('')
      }} /></label>
    <button type="button" disabled={lookingUp} onClick={readLink}>{durable ? '場所を取得' : '位置を取得'}</button>
    {lookingUp && <p role="status">住所候補を確認しています…</p>}
    {addressLookup && <div aria-live="polite" className="spot-address-candidate">
      {addressLookup.status === 'candidate' ? <>
        <p>{addressLookup.source === 'place' ? 'Place IDの住所候補' : '座標周辺の住所候補'}：{addressLookup.address}</p>
        <span translate="no">Google Maps</span>
      </> : <p role="status">{addressLookup.status === 'no-result' ? '住所候補は見つかりませんでした。住所を手入力してください。'
        : addressLookup.status === 'conflict' ? '場所の住所候補を一意に確認できませんでした。住所を手入力してください。'
        : '住所候補を取得できませんでした。住所を手入力してください。'}</p>}
    </div>}
    {message && <p role="status">{message}</p>}
    {reference?.kind === 'short' && <a href={reference.href} target="_blank" rel="noreferrer">Google Mapsを開く</a>}
    {reference?.kind === 'place' && reference.label && <p>リンク内の名称候補：{reference.label}</p>}
    {reference?.kind === 'place' && reference.googlePlaceId && <>
      <p>Place ID候補：<code>{reference.googlePlaceId}</code>。場所との対応は未確認です。</p>
      {referencePosition && <button type="button" onClick={() => {
        const { latitude, longitude } = referencePosition
        onChange({ ...input, latitude: String(latitude), longitude: String(longitude), googlePlaceId: undefined })
      }}>座標を使う</button>}
    </>}
    {input.googlePlaceId && <p>Google Mapsの場所IDを登録済み</p>}
    <label>場所の名前<input value={input.name} maxLength={200}
      onChange={(event) => edit({ name: event.target.value })} /></label>
    <label>住所<input value={input.address} maxLength={1000} placeholder="住所を手入力"
      onChange={(event) => edit({ address: event.target.value })} /></label>
    <div className="field-pair">
      <label>緯度<input inputMode="decimal" value={input.latitude} maxLength={32}
        onChange={(event) => edit({ latitude: event.target.value })} /></label>
      <label>経度<input inputMode="decimal" value={input.longitude} maxLength={32}
        onChange={(event) => edit({ longitude: event.target.value })} /></label>
    </div>
    <button type="button" aria-expanded={showMap} onClick={() => setShowMap(!showMap)}>地図</button>
    {showMap && <ShootingAreasMap zones={[]} selectedIndex={null} disabled={false} spot={point}
      onSelect={(latitude, longitude) => edit({ latitude: String(latitude), longitude: String(longitude) })} />}
    {(input.name || input.address || input.latitude || input.longitude || input.googlePlaceId || (durable && input.url)) &&
      <button type="button" className="spot-clear-button" onClick={() => { onChange(initialSpotInput()); setReference(null); setMessage('') }}>場所を消す</button>}
  </fieldset>
}
