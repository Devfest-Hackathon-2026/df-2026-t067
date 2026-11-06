import { useCallback, useEffect, useRef, useState } from 'react'
import type { ApiClient, ApiErrorCode, Discovery } from '../../shared/api'
import { useRemote } from '../../shared/useRemote'
import { DiscoveryDeletion } from './DiscoveryDeletion'

const localDate = new Intl.DateTimeFormat('ja-JP', { dateStyle: 'long', timeZone: 'Asia/Tokyo' })

function RecordDate({ date }: { date: string }) {
  return <time dateTime={date}>{localDate.format(new Date(date))}</time>
}

function ReadFailure({ code, retry }: { code?: ApiErrorCode; retry: () => void }) {
  const message = code === 'NOT_FOUND' ? 'この記録を利用できません。'
    : code === 'SYSTEM_ERROR' ? '記録の保存先に接続できません。'
      : code === 'UNAUTHENTICATED' ? 'ログインを確認できませんでした。'
        : '記録を読み込めませんでした。通信状況を確認してください。'
  return <>
    <p role="alert">{message}</p>
    <button type="button" className="retry-button" onClick={retry}>記録を読み直す</button>
  </>
}

function RecordPhoto({ blob }: { blob: Blob }) {
  const image = useRef<HTMLImageElement>(null)
  useEffect(() => {
    const target = image.current
    if (!target) return
    const url = URL.createObjectURL(blob)
    target.src = url
    return () => { target.removeAttribute('src'); URL.revokeObjectURL(url) }
  }, [blob])
  return <img ref={image} className="photo-preview" alt="本人の記録写真" />
}

function RecordGuidance({ record }: { record: Discovery }) {
  const { afterClear, descriptionSnapshot } = record
  const fields = ([
    ['アクセス', afterClear?.access.trim()],
    ['利用時間', afterClear?.hours.trim()],
    ['自治体からの紹介', afterClear?.promoComment.trim()],
    ['解説', afterClear?.explanation.trim() || descriptionSnapshot.trim()],
  ] as const).filter(([, value]) => value)

  if (fields.length === 0) return null
  return <dl className="record-guidance">
    {fields.map(([label, value]) => <div key={label}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>)}
  </dl>
}

function DiscoveryDetail({ api, id, onBack, onDeleted }: { api: ApiClient; id: string; onBack: () => void; onDeleted: () => void }) {
  const read = useCallback(async (signal: AbortSignal) => {
    const [record, photo] = await Promise.all([
      api.getDiscovery(id, { signal }),
      api.getDiscoveryPhoto(id, { signal }),
    ])
    return { record, photo }
  }, [api, id])
  const { result, retry } = useRemote(true, read)
  return <section aria-label="記録詳細" className="record-detail">
    <button type="button" className="secondary-button" onClick={onBack}>記録一覧へ戻る</button>
    {result.status === 'loading' && <p role="status">記録を読み込んでいます…</p>}
    {result.status === 'error' && <ReadFailure code={result.code} retry={retry} />}
    {result.status === 'ready' && <>
      <RecordPhoto blob={result.value.photo} />
      <h2>{result.value.record.placeName}</h2>
      <p>初回の記録 <RecordDate date={result.value.record.firstClearedAt} /></p>
      <RecordGuidance record={result.value.record} />
      <DiscoveryDeletion api={api} id={id} onDeleted={onDeleted} />
    </>}
  </section>
}

export function OwnerDiscoveries({ api }: { api: ApiClient }) {
  const [selected, setSelected] = useState<string | null>(null)
  const [cursor, setCursor] = useState<string | undefined>(undefined)
  const [deleted, setDeleted] = useState(false)
  const read = useCallback((signal: AbortSignal) => api.listDiscoveries({ limit: 20, cursor }, { signal }), [api, cursor])
  const { result, retry } = useRemote(selected === null, read)
  if (selected !== null) return <DiscoveryDetail api={api} id={selected} onBack={() => { setSelected(null); retry() }}
    onDeleted={() => { setDeleted(true); setSelected(null); setCursor(undefined); retry() }} />
  const confirmation = deleted && <p role="status">記録と写真の削除が完了しました。</p>
  if (result.status === 'loading') return <>{confirmation}<p role="status">記録を読み込んでいます…</p></>
  const firstPage = cursor !== undefined && <button type="button" className="secondary-button" onClick={() => setCursor(undefined)}>最初のページへ</button>
  if (result.status === 'error') return <>{confirmation}<ReadFailure code={result.code} retry={retry} />{firstPage}</>
  const { items, nextCursor } = result.value
  return <>
    {confirmation}
    {items.length === 0 ? <p>自分の記録はまだありません。</p> : <ul className="record-list">
      {items.map((record) => <li key={record.discoveryId}>
        <button type="button" className="secondary-button" onClick={() => { setDeleted(false); setSelected(record.discoveryId) }}>{record.placeName}</button>
        <RecordDate date={record.firstClearedAt} />
      </li>)}
    </ul>}
    <div className="camera-actions">
      {firstPage}
      {nextCursor && <button type="button" className="secondary-button" onClick={() => setCursor(nextCursor)}>次の記録</button>}
    </div>
  </>
}
