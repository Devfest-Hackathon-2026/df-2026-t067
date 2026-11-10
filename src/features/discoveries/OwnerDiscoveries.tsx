import { Icon } from '../../components/Icon'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { ApiClient, ApiErrorCode, Discovery } from '../../shared/api'
import { useRemote } from '../../shared/useRemote'
import type { State as DeletionState } from './DiscoveryDeletion'
import { DiscoveryDeletion } from './DiscoveryDeletion'

const localDate = new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: 'numeric', day: 'numeric', timeZone: 'Asia/Tokyo' })

function RecordDate({ date }: { date: string }) {
  return <time dateTime={date}>{localDate.format(new Date(date))}</time>
}

function ReadFailure({ code, retry }: { code?: ApiErrorCode; retry: () => void }) {
  const message = code === 'NOT_FOUND' ? '記録なし'
    : code === 'SYSTEM_ERROR' ? '記録読込失敗'
      : code === 'UNAUTHENTICATED' ? 'ログイン確認失敗'
        : '記録読込失敗'
  return <>
    <p role="alert">{message}</p>
    <button type="button" className="retry-button" onClick={retry}>記録を再読込</button>
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
  return <img ref={image} className="record-photo" alt="本人の記録写真" />
}

function RecordThumbnail({ api, id, active }: { api: ApiClient; id: string; active: boolean }) {
  const placeholder = useRef<HTMLSpanElement>(null)
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (!active) return
    const controller = new AbortController()
    let objectUrl: string | null = null
    let observer: IntersectionObserver | undefined
    const load = () => {
      void api.getDiscoveryPhoto(id, { signal: controller.signal }).then((blob) => {
        if (controller.signal.aborted) return
        objectUrl = URL.createObjectURL(blob)
        setPhotoUrl(objectUrl)
      }).catch(() => {
        if (!controller.signal.aborted) setFailed(true)
      })
    }
    const target = placeholder.current
    if (target && typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver((entries) => {
        if (!entries.some((entry) => entry.isIntersecting || entry.intersectionRatio > 0)) return
        observer?.disconnect()
        load()
      }, { rootMargin: '160px' })
      observer.observe(target)
    } else {
      // Older browsers still get thumbnails; they simply load immediately.
      load()
    }
    return () => {
      observer?.disconnect()
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [active, api, id])
  if (photoUrl) return <img className="record-thumbnail" src={photoUrl} alt="" />
  return <span ref={placeholder} className="record-thumbnail-placeholder" aria-hidden="true">{failed ? '写真なし' : '写真を読み込み中'}</span>
}

function RecordGuidance({ record }: { record: Discovery }) {
  const { afterClear, descriptionSnapshot } = record
  const spot = afterClear?.spot
  const fields = ([
    ['アクセス', afterClear?.access.trim()],
    ['利用時間', afterClear?.hours.trim()],
    ['紹介', afterClear?.promoComment.trim()],
    ['解説', afterClear?.explanation.trim() || descriptionSnapshot.trim()],
  ] as const).filter(([, value]) => value)

  // 地図リンクは固定の Google Maps 検索URLから組み立てる（D-71）。スポットに
  // 由来する URL を保存・再表示せず、位置と任意の Place ID だけから作る。
  const mapsUrl = spot && 'https://www.google.com/maps/search/?api=1&query='
    + spot.position.latitude + ',' + spot.position.longitude
    + (spot.googlePlaceId ? '&query_place_id=' + encodeURIComponent(spot.googlePlaceId) : '')
  return <>
    {fields.length > 0 && <dl className="record-guidance">
      {fields.map(([label, value]) => <div key={label}>
        <dt>{label}</dt>
        <dd>{value}</dd>
      </div>)}
    </dl>}
    {mapsUrl && <p className="record-spot-link"><a href={mapsUrl} target="_blank" rel="noreferrer">Google マップ</a></p>}
  </>
}

function RecordMetadata({ api, record }: { api: ApiClient; record: Discovery }) {
  const readTitle = useCallback(async (signal: AbortSignal) => {
    const quest = await api.getQuest(record.questId, { signal })
    return quest.version === record.questVersion ? quest.title : null
  }, [api, record.questId, record.questVersion])
  const { result } = useRemote(true, readTitle)
  const spot = record.afterClear?.spot
  const title = result.status === 'loading' ? '読込中'
    : (result.status === 'ready' && result.value) || '問題名取得失敗'
  const spotName = (spot?.name ?? record.placeName).trim()
  return <dl className="record-guidance">
    {spotName && <div><dt>スポット名</dt><dd>{spotName}</dd></div>}
    <div><dt>日付</dt><dd><RecordDate date={record.firstClearedAt} /></dd></div>
    {title.trim() !== spotName && <div><dt>問題名</dt><dd>{title}</dd></div>}
    {spot?.address.trim() && <div><dt>住所</dt><dd>{spot.address}</dd></div>}
  </dl>
}

function DiscoveryDetail({ api, id, onBack, onDeleted, deletion, onDeletion, onReceipt, alreadyCleared }: { alreadyCleared?: boolean; deletion?: { state: DeletionState; receipt?: string }; onDeletion: (state: DeletionState) => void; onReceipt: (receipt: string) => void; api: ApiClient; id: string; onBack: (refresh: boolean) => void; onDeleted: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const headingId = useId()
  const [deletionState, setDeletionState] = useState<DeletionState>(deletion?.state === 'working' ? (deletion.receipt ? 'pending' : 'send-error') : deletion?.state ?? 'idle')
  const deletionInFlight = deletionState === 'working'
  function close() {
    if (!deletionInFlight) onBack(deletionState !== 'idle')
  }
  useEffect(() => {
    const element = dialog.current
    if (!element) return
    element.showModal()
    return () => element.close()
  }, [])
  const read = useCallback(async (signal: AbortSignal) => {
    const [record, photo] = await Promise.all([
      api.getDiscovery(id, { signal }),
      api.getDiscoveryPhoto(id, { signal }),
    ])
    return { record, photo }
  }, [api, id])
  const { result, retry } = useRemote(true, read)
  return <dialog ref={dialog} aria-labelledby={headingId} className="record-dialog"
    onCancel={(event) => { event.preventDefault(); close() }}>
    <div className="record-detail">
      <header className="record-dialog-heading">
        <h2 id={headingId}>記録詳細</h2>
        <button type="button" className="secondary-button" disabled={deletionInFlight} onClick={close}>閉じる</button>
      </header>
      {alreadyCleared && <p role="status">クリア済み</p>}
      {result.status === 'loading' && <p role="status">記録読込中</p>}
      {result.status === 'error' && <ReadFailure code={result.code} retry={retry} />}
      {result.status === 'ready' && <>
        <RecordPhoto blob={result.value.photo} />
        <RecordMetadata api={api} record={result.value.record} />
        <RecordGuidance record={result.value.record} />
      </>}
      {(result.status === 'ready' || deletion?.receipt) && <DiscoveryDeletion api={api} id={id} onDeleted={onDeleted}
        initialState={deletion?.state} initialReceipt={deletion?.receipt} onReceipt={onReceipt}
        onStateChange={(state) => { setDeletionState(state); onDeletion(state) }} />}
    </div>
  </dialog>
}

export function OwnerDiscoveries({ api, initialId, visit = 0, active = true, onExplore, alreadyCleared = false }: { alreadyCleared?: boolean; api: ApiClient; onExplore: () => void; initialId?: string; visit?: number; active?: boolean }) {
  const [selected, setSelected] = useState<string | null>(initialId ?? null)
  const [deletions, setDeletions] = useState<Record<string, { state: DeletionState; receipt?: string; record?: Discovery }>>({})
  const [noticeExpired, setNoticeExpired] = useState(false)
  useEffect(() => {
    if (!alreadyCleared) return
    const timer = setTimeout(() => setNoticeExpired(true), 5000)
    return () => clearTimeout(timer)
  }, [alreadyCleared, visit])
  const detailHistory = useRef(false)
  const detailBaseUrl = useRef('')
  useEffect(() => {
    if (!active || !selected || detailHistory.current) return
    detailBaseUrl.current = window.location.href
    window.history.pushState({ ...window.history.state, recordDetail: selected }, '')
    detailHistory.current = true
  }, [active, selected])
  useEffect(() => {
    const back = (event: PopStateEvent) => {
      if (!active || !detailHistory.current) return
      if (window.location.href === detailBaseUrl.current) event.stopImmediatePropagation()
      detailHistory.current = false
      setSelected(null)
    }
    window.addEventListener('popstate', back, true)
    return () => window.removeEventListener('popstate', back, true)
  }, [active])
  function closeDetail() {
    setSelected(null)
    if (detailHistory.current) window.history.back()
  }
  const [cursor, setCursor] = useState<string | undefined>(undefined)
  const [deleted, setDeleted] = useState(false)
  const [destination, setDestination] = useState({ initialId, visit })
  // 常駐中の明示遷移を反映する。同じIDでも再訪時は詳細を開き直す。
  if (destination.initialId !== initialId || destination.visit !== visit) {
    setDestination({ initialId, visit })
    setSelected(initialId ?? null)
    if (initialId) setDeleted(false)
    setNoticeExpired(false)
  }

  const read = useCallback((signal: AbortSignal) => api.listDiscoveries({ limit: 20, cursor }, { signal }), [api, cursor])
  const { result, retry } = useRemote(true, read)
  // 記録画面は一度開くとアンマウントせず隠して常駐させる（D-53）ため、この部品も
  // 残り続け、初回の取得結果だけが表示され続けてしまう。画面へ入り直すたびに
  // （visit の増加で）一覧を取り直し、初回に空・失敗だった表示が居座ることと、
  // 挑戦で増えた記録が再読み込みなしでは出てこないことを防ぐ。
  const mountedVisit = useRef(visit)
  useEffect(() => {
    if (visit === mountedVisit.current) return
    mountedVisit.current = visit
    retry()
  }, [visit, retry])
  const detail = active && selected !== null && <DiscoveryDetail alreadyCleared={alreadyCleared && !noticeExpired} key={selected} api={api} id={selected} deletion={deletions[selected]}
    onDeletion={(state) => setDeletions(current => ({ ...current, [selected]: { ...current[selected], state } }))}
    onReceipt={(receipt) => setDeletions(current => ({ ...current, [selected]: { ...current[selected], state: current[selected]?.state ?? 'working', receipt, record: current[selected]?.record ?? (result.status === 'ready' ? result.value.items.find(item => item.discoveryId === selected) : undefined) } }))} onBack={(refresh) => {
    closeDetail()
    if (refresh) retry()
  }}
    onDeleted={() => { setDeletions(current => { const next = { ...current }; delete next[selected]; return next }); setDeleted(true); closeDetail(); setCursor(undefined); retry() }} />
  const confirmation = <>{alreadyCleared && !noticeExpired && !selected && <p role="status">クリア済み</p>}{deleted && <p role="status">削除完了</p>}</>
  if (result.status === 'loading') return <>{detail}{confirmation}<p role="status">記録読込中</p></>
  const firstPage = cursor !== undefined && <button type="button" className="secondary-button" onClick={() => setCursor(undefined)}>先頭へ</button>
  if (result.status === 'error') return <>{detail}{confirmation}<ReadFailure code={result.code} retry={retry} />{firstPage}</>
  const { nextCursor } = result.value
  const items = [...result.value.items]
  for (const deletion of Object.values(deletions)) {
    if (deletion.receipt && deletion.record && !items.some(item => item.discoveryId === deletion.record!.discoveryId)) items.push(deletion.record)
  }
  return <>
    {detail}
    {confirmation}
    {items.length === 0 ? <div className="record-empty">
      <span className="record-empty-icon" aria-hidden="true"><Icon name="check" /></span>
      <h2>記録はまだない</h2>
      <button type="button" className="primary-button" onClick={onExplore}>謎を探す</button>
    </div> : <ul className="record-list" aria-label="自分の記録一覧">
      {items.map((record) => <li key={record.discoveryId}>
        <button type="button" className="traveler-list-row traveler-list-row-photo record-open"
          aria-label={record.afterClear?.spot?.name ?? record.placeName} aria-haspopup="dialog"
          onClick={() => { setDeleted(false); setSelected(record.discoveryId) }}>
          <RecordThumbnail key={`${record.discoveryId}:${active}`} api={api} id={record.discoveryId} active={active} />
          <span className="record-summary">
            <span className="traveler-row-title">{record.afterClear?.spot?.name ?? record.placeName}</span>
            <span className="traveler-row-meta"><RecordDate date={record.firstClearedAt} /></span>
            {deletions[record.discoveryId]?.receipt && <span role="status">{deletions[record.discoveryId].state === 'failed' ? '削除未完了' : '削除中'}</span>}
            {deletions[record.discoveryId]?.state === 'send-error' && <span role="status">削除結果未確認</span>}
          </span>
        </button>
      </li>)}
    </ul>}
    {(firstPage || nextCursor) && <div className="camera-actions">
      {firstPage}
      {nextCursor && <button type="button" className="secondary-button" onClick={() => setCursor(nextCursor)}>次の記録</button>}
    </div>}
  </>
}
