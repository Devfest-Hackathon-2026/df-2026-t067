import { ShootingAreasMap } from './ShootingAreasMap'
import { initialSpotInput, parseMapsSpotLink, spotPosition, type SpotInput } from './mapsSpotLink'
import { useState } from 'react'

export function SpotEditor({ input, onChange }: { input: SpotInput; onChange(input: SpotInput): void }) {
  const [message, setMessage] = useState('')
  const [showMap, setShowMap] = useState(false)
  const point = spotPosition(input.latitude, input.longitude)

  function readLink() {
    const result = parseMapsSpotLink(input.url)
    setMessage(result.message)
    if (!result.position && !result.googlePlaceId) return
    onChange({ ...input, googlePlaceId: result.googlePlaceId, confirmed: false,
      ...(result.position ? { latitude: String(result.position.latitude), longitude: String(result.position.longitude) } : {}) })
  }

  return <fieldset>
    <legend>対象スポットの位置・住所</legend>
    <p>クリア後の案内に使います。撮影者の立ち位置は「撮影範囲」で別に設定します。</p>
    <label>Google Maps共有URL<input type="url" value={input.url} maxLength={4096}
      onChange={(event) => { onChange({ ...input, url: event.target.value }); setMessage('') }} /></label>
    <button type="button" onClick={readLink}>リンクから位置候補を読み取る</button>
    {message && <p role="status">{message}</p>}
    {input.googlePlaceId && <p>Google Mapsの場所IDを取得済み</p>}
    <label>スポット名・施設名<input value={input.name} maxLength={200}
      onChange={(event) => onChange({ ...input, name: event.target.value, confirmed: false })} /></label>
    <label>確認済み住所<input value={input.address} maxLength={1000}
      onChange={(event) => onChange({ ...input, address: event.target.value, confirmed: false })} /></label>
    <div className="field-pair">
      <label>スポットの緯度<input inputMode="decimal" value={input.latitude} maxLength={32}
        onChange={(event) => onChange({ ...input, latitude: event.target.value, googlePlaceId: undefined, confirmed: false })} /></label>
      <label>スポットの経度<input inputMode="decimal" value={input.longitude} maxLength={32}
        onChange={(event) => onChange({ ...input, longitude: event.target.value, googlePlaceId: undefined, confirmed: false })} /></label>
    </div>
    <button type="button" aria-expanded={showMap} onClick={() => setShowMap(!showMap)}>{showMap ? '確認地図を閉じる' : '確認地図を開く'}</button>
    {showMap && <ShootingAreasMap zones={[]} selectedIndex={null} disabled={false} spot={point}
      onSelect={(latitude, longitude) => onChange({ ...input, latitude: String(latitude), longitude: String(longitude),
        googlePlaceId: undefined, confirmed: false })} />}
    <label><input type="checkbox" checked={input.confirmed} disabled={!point || !input.name.trim() || !input.address.trim()}
      onChange={(event) => onChange({ ...input, confirmed: event.target.checked })} />位置・スポット名・住所を確認した</label>
    {(input.name || input.address || input.latitude || input.longitude || input.googlePlaceId) &&
      <button type="button" onClick={() => { onChange(initialSpotInput()); setMessage('') }}>スポットの入力を消す</button>}
  </fieldset>
}
