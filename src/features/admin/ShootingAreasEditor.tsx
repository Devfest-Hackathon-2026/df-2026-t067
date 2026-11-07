import { useCallback, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { ApiError, parseUpdateShootingAreas } from '../../shared/api'
import type { ApiClient, CaptureZone, ManagedShootingAreas } from '../../shared/api'
import { useRemote } from '../../shared/useRemote'
import { useRequestAction } from '../../shared/useRequestAction'
import { ShootingAreasMap } from './ShootingAreasMap'

type ZoneInput = Record<keyof CaptureZone, string>
type State = 'idle' | 'saving' | 'saved' | 'error' | 'conflict'
const fields = [['latitude', '緯度'], ['longitude', '経度'], ['radiusMeters', '半径（m）']] as const

function toInputs(zones: CaptureZone[]): ZoneInput[] {
  return zones.map(({ latitude, longitude, radiusMeters }) => ({
    latitude: String(latitude), longitude: String(longitude), radiusMeters: String(radiusMeters),
  }))
}

function areaInput(rows: ZoneInput[], revision: number) {
  if (rows.some((row) => fields.some(([field]) => !row[field].trim()))) return null
  try {
    return parseUpdateShootingAreas({ expectedDraftRevision: revision, zones: rows.map(({ latitude, longitude, radiusMeters }) => ({
      latitude: Number(latitude), longitude: Number(longitude), radiusMeters: Number(radiusMeters),
    })) })
  } catch { return null }
}

function ShootingAreasForm({ api, initial, onReload, enableMap }: { api: ApiClient; initial: ManagedShootingAreas; onReload: () => void; enableMap: boolean }) {
  const [revision, setRevision] = useState(initial.draftRevision)
  const [rows, setRows] = useState(() => toInputs(initial.zones))
  const [selectedIndex, setSelectedIndex] = useState<number | null>(initial.zones.length ? 0 : null)
  const [state, setState] = useState<State>('idle')
  const begin = useRequestAction()
  const input = areaInput(rows, revision)
  const saving = state === 'saving'
  const mapZones = useMemo(() => rows.map((row) => {
    const parsed = areaInput([row], revision)
    return parsed?.zones[0] ?? null
  }), [rows, revision])

  function edit(next: ZoneInput[]) {
    setRows(next)
    setState((current) => current === 'conflict' ? current : 'idle')
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!input || state === 'conflict') return
    const operation = begin(() => setState('error'))
    if (!operation) return
    setState('saving')
    try {
      const updated = await api.updateShootingAreas(initial.orgId, initial.questId, input, { signal: operation.signal })
      if (!operation.isCurrent()) return
      setRows(toInputs(updated.zones))
      setRevision(updated.draftRevision)
      setState('saved')
    } catch (cause) {
      if (operation.isCurrent()) setState(cause instanceof ApiError && cause.code === 'DRAFT_CONFLICT' ? 'conflict' : 'error')
    } finally { operation.finish() }
  }

  return <form onSubmit={save}>
    <p>下書き版 {revision}。範囲をすべて外して保存すると設定を解除します。</p>
    {enableMap && <><p>対象の所在地ではなく、撮影する人の立ち位置を選びます。地点選択だけでは写真の権利、安全、通行許可の確認は完了しません。</p>
    <label>地図で編集する範囲<select disabled={saving} value={selectedIndex ?? 'new'} onChange={(event) => setSelectedIndex(event.target.value === 'new' ? null : Number(event.target.value))}>
      {rows.map((_, index) => <option key={index} value={index}>撮影範囲 {index + 1}</option>)}
      <option value="new" disabled={rows.length >= 10}>新しい範囲</option>
    </select></label>
    <p>地図を押すと選択中の範囲の中心を移動します。新しい範囲の半径は50mで、下で調整できます。</p>
    <ShootingAreasMap zones={mapZones} selectedIndex={selectedIndex} disabled={saving || (selectedIndex === null && rows.length >= 10)} onSelect={(latitude, longitude) => {
      if (selectedIndex === null) {
        if (rows.length >= 10) return
        setSelectedIndex(rows.length)
        edit([...rows, { latitude: String(latitude), longitude: String(longitude), radiusMeters: '50' }])
      } else edit(rows.map((row, index) => index === selectedIndex ? { ...row, latitude: String(latitude), longitude: String(longitude) } : row))
    }} />
    </>}
    {rows.length === 0 && <p>設定する範囲はありません。</p>}
    {rows.map((row, index) => <fieldset key={index} disabled={saving}>
      <legend>撮影範囲 {index + 1}</legend>
      {fields.map(([field, label]) => <label key={field}>{label}
        <input type="number" step="any" value={row[field]} onChange={(event) => {
          const value = event.target.value
          edit(rows.map((current, item) => item === index ? { ...current, [field]: value } : current))
        }} />
      </label>)}
      <button type="button" onClick={() => { edit(rows.filter((_, item) => item !== index)); setSelectedIndex(null) }}>この範囲を外す</button>
    </fieldset>)}
    {!input && <p>緯度は±90、経度は±180、半径は0より大きい数値を入力してください。</p>}
    {state === 'saved' && <p role="status">非公開の撮影範囲を保存しました。</p>}
    {state === 'error' && <p role="alert">保存結果を確認できませんでした。通信状況を確認して再試行してください。</p>}
    {state === 'conflict' && <p role="alert">下書きの版が変わりました。入力を控えてから最新版を確認してください。</p>}
    <div className="admin-list-actions">
      <button type="button" disabled={saving || rows.length >= 10} onClick={() => { setSelectedIndex(rows.length); edit([...rows, { latitude: '', longitude: '', radiusMeters: enableMap ? '50' : '' }]) }}>範囲を追加</button>
      <button type="submit" disabled={saving || !input || state === 'conflict'}>{saving ? '保存しています…' : '撮影範囲を保存'}</button>
      {state === 'conflict' && <button type="button" onClick={onReload}>入力を破棄して最新版を確認</button>}
    </div>
  </form>
}

export function ShootingAreasEditor({ api, orgId, questId, onBack, backLabel = '問題一覧へ戻る', enableMap = false }: { api: ApiClient; orgId: string; questId: string; onBack: () => void; backLabel?: string; enableMap?: boolean }) {
  const read = useCallback((signal: AbortSignal) => api.getShootingAreas(orgId, questId, { signal }), [api, orgId, questId])
  const { result, retry } = useRemote(true, read)
  return <section className="form-section" aria-labelledby="shooting-editor-title">
    <h2 id="shooting-editor-title">非公開の撮影範囲</h2>
    <p>撮影の立ち位置と半径を最大10件設定できます。旅行者向けの地図や通常のヒントには表示しません。</p>
    <button type="button" onClick={onBack}>{backLabel}</button>
    {result.status === 'loading' && <p role="status">撮影範囲を読み込んでいます…</p>}
    {result.status === 'error' && <><p role="alert">撮影範囲を取得できませんでした。</p><button type="button" onClick={retry}>読み直す</button></>}
    {result.status === 'ready' && <ShootingAreasForm api={api} initial={result.value} onReload={retry} enableMap={enableMap} />}
  </section>
}
