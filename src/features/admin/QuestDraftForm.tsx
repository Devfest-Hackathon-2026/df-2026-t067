import { normalizePrice } from '../../shared/api/admin'
import { PHOTO_UPLOAD_MAX_BYTES, PHOTO_UPLOAD_MIME_TYPES, PHOTO_UPLOAD_ACCEPT, DEMO_DRAFT_PHOTO_MAX_BYTES } from '../../shared/mediaLimits'
import { useEffect, useRef, useState } from 'react'
import type { SetStateAction } from 'react'
import { SpotEditor } from './SpotEditor'
import { MapSpotEditor } from './MapSpotEditor'
import { initialSpotInput, spotForDraft } from './mapsSpotLink'
import './admin.css'
import { PhotoRightsInput } from './PhotoRightsInput'
import { HoursInput } from './HoursInput'
import { PriceInput } from './PriceInput'
import DraftEditor, { type DraftFields } from './DraftEditor'
import { DraftCandidate } from './DraftCandidate'
import TravelerPreview, { type PreviewMode } from './TravelerPreview'
import { useLocalDraftSave } from './useLocalDraftSave'
import type { LocalDraftConnection } from './useLocalDraftSave'

const maxPhotoBytes = DEMO_DRAFT_PHOTO_MAX_BYTES
const allowedTypes = PHOTO_UPLOAD_MIME_TYPES

type Photo = { file: File; url: string }
type HoursMode = 'unset' | 'all-day' | 'specified' | 'supplement'

function initialHoursMode(hours: string): HoursMode {
  if (!hours) return 'unset'
  if (hours === '終日') return 'all-day'
  const parsed = parseHours(hours)
  if (parsed.start && parsed.end && (parsed.nextDay || parsed.end > parsed.start)) return 'specified'
  return 'supplement'
}

function specifiedHoursError(start: string, end: string, nextDay: boolean) {
  if (!start || !end) return '開始・終了時刻を選択'
  if (end <= start && !nextDay) return '終了時刻を確認・翌日終了を選択'
  return ''
}

function parseHours(hours: string) {
  const match = /^((?:[01]\d|2[0-3]):00)〜(翌日 )?((?:[01]\d|2[0-3]|24):00)$/.exec(hours)
  return { start: match?.[1] ?? '', nextDay: Boolean(match?.[2]), end: match?.[3] ?? '' }
}

const hourlyChoices = Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, '0')}:00`)
const endHourlyChoices = [...hourlyChoices, '24:00']


/** Builds a starter sentence for the access text from means + minutes; the textarea stays the source of truth. */
function AccessInput({ value, onChange, builder }: { value: string; onChange: (value: string) => void; builder: boolean }) {
  const [means, setMeans] = useState('')
  const [minutes, setMinutes] = useState('')
  function compose() {
    if (!means || !minutes) return
    const sentence = `${means}約${minutes}分`
    const rest = value.replace(/^(徒歩|バス|車|自転車|電車)約\d+分。?/, '').trim()
    onChange(rest ? `${sentence}。${rest}` : sentence)
  }
  return <>
    <label>行き方<textarea value={value} onChange={event => onChange(event.target.value)} rows={2} placeholder="例：駅から徒歩約10分" /></label>
    {builder && <>
      <div className="access-builder">
        <label>交通手段<select value={means} onChange={event => setMeans(event.target.value)}>
          <option value="">選ぶ</option><option>徒歩</option><option>バス</option><option>車</option><option>自転車</option><option>電車</option></select></label>
        <label>所要分数<input type="number" min="0" step="1" inputMode="numeric" value={minutes} onChange={event => setMinutes(event.target.value)} /></label>
        <button type="button" disabled={!means || !minutes} onClick={compose}>行き方の文を作る</button>
      </div>

    </>}
  </>
}

export default function QuestDraftForm({ connection, teamPreview = false }: { connection?: LocalDraftConnection; teamPreview?: boolean } = {}) {
  const part = connection?.workflowPart
  const onePage = part === 'all'
  const focused = connection?.taskFocused === true || part !== undefined
  const initial = connection?.initial?.draft
  const [name, setName] = useState(initial?.materials.name ?? '')
  // 対象理由の入力欄は廃止済み。保存済みの値は互換のため編集せずそのまま引き継ぐ。
  const evidence = initial?.materials.evidence ?? ''
  const [requiresBoat, setRequiresBoat] = useState(initial?.materials.requiresBoat ?? false)
  const [requiresPaidFacility, setRequiresPaidFacility] = useState(initial?.materials.requiresPaidFacility ?? false)
  const [photo, setPhoto] = useState<Photo | null>(null)
  const [referenceAssetId, setReferenceAssetId] = useState(initial?.referenceAssetId ?? null)
  const [photoError, setPhotoError] = useState('')
  const [photoLoadFailed, setPhotoLoadFailed] = useState(false)
  const [access, setAccess] = useState(initial?.afterClear.access ?? '')
  const [hours, setHours] = useState(initial?.afterClear.hours ?? '')
  const [hoursMode, setHoursMode] = useState<HoursMode>(() => initialHoursMode(initial?.afterClear.hours ?? ''))
  const parsedHours = parseHours(initial?.afterClear.hours ?? '')
  const [startTime, setStartTime] = useState(parsedHours.start)
  const [endTime, setEndTime] = useState(parsedHours.end)
  const [hoursNextDay, setHoursNextDay] = useState(parsedHours.nextDay)
  const [hoursSupplement, setHoursSupplement] = useState(() => initialHoursMode(initial?.afterClear.hours ?? '') === 'supplement' ? initial?.afterClear.hours ?? '' : '')
  const [hoursError, setHoursError] = useState('')
  const [promoComment, setPromoComment] = useState(initial?.afterClear.promoComment ?? '')
  const [explanation, setExplanation] = useState(initial?.afterClear.explanation ?? '')
  const [spotInput, setSpotInput] = useState(() => initialSpotInput(initial?.afterClear.spot))
  const [price, setPrice] = useState(normalizePrice(initial?.materials.price ?? ''))
  const [inputError, setInputError] = useState('')
  const [rightsReuseNeeded, setRightsReuseNeeded] = useState(false)
  const [rightsError, setRightsError] = useState(false)
  const rightsRef = useRef<HTMLTextAreaElement>(null)
  const rightsPhotoRef = useRef<File | null>(null)
  const hadReference = useRef(Boolean(initial?.referenceAssetId))
  const [photoRights, setPhotoRights] = useState(initial?.materials.photoRights ?? '')
  const [showSummary, setShowSummary] = useState(false)
  const [step, setStep] = useState<'A03' | 'A04' | 'A05'>(part === 3 ? 'A04' : 'A03')
  const [previewMode, setPreviewMode] = useState<PreviewMode>('challenge')
  const [draft, setDraft] = useState<DraftFields>(initial?.content ?? { title: '', question: '', hints: ['', '', ''], verifiedFeatures: '', draftingNotes: '' })
  const [appliedDraft, setAppliedDraft] = useState<DraftFields | null>(null)
  const [draftEdit, setDraftEdit] = useState(0)
  const [draftEntryError, setDraftEntryError] = useState('')
  const [sampleConfirm, setSampleConfirm] = useState(false)
  const [visitedDraft, setVisitedDraft] = useState(false)
  const [materialChanged, setMaterialChanged] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const a03HeadingRef = useRef<HTMLHeadingElement>(null)
  const a04HeadingRef = useRef<HTMLHeadingElement>(null)
  const a05HeadingRef = useRef<HTMLHeadingElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const [afterClearOpen, setAfterClearOpen] = useState(false)
  const hoursErrorRef = useRef<HTMLParagraphElement>(null)
  const [hoursImport, setHoursImport] = useState(0)
  const [hoursCandidate, setHoursCandidate] = useState<string | undefined>()
  const { record, state: saveState, save, reset } = useLocalDraftSave(connection)
  const [timeError, setTimeError] = useState('')
  const [priceError, setPriceError] = useState('')
  const statusRef = useRef<HTMLParagraphElement>(null)
  useEffect(() => { if (saveState.status === 'saved') statusRef.current?.focus() }, [saveState.status])
  const saving = saveState.status === 'saving'
  const exploration = record && connection && record.areaId !== connection.member.areaId
    ? { source: 'unavailable' as const } : connection?.member.exploration
  const areaLabel = connection ? (exploration?.source === 'unavailable' ? '探索エリア未設定'
    : exploration?.name ?? connection.member.label) : undefined
  const areaStatus = connection ? (record?.shootingAreaStatus === 'configured' ? '設定済み'
    : record?.shootingAreaStatus === 'needs-review' ? '要確認' : '未設定') : '未設定・接続待ち'

  useEffect(() => () => {
    if (photo) URL.revokeObjectURL(photo.url)
  }, [photo])

  useEffect(() => {
    if (step === 'A03') a03HeadingRef.current?.focus()
    else if (step === 'A04') a04HeadingRef.current?.focus()
    else a05HeadingRef.current?.focus()
  }, [step])

  useEffect(() => {
    if (step === 'A05') a05HeadingRef.current?.focus()
  }, [previewMode, step])

  useEffect(() => {
    if (step === 'A03' && draftEntryError) {
      nameRef.current?.focus()
      nameRef.current?.scrollIntoView?.({ block: 'center' })
    }
  }, [draftEntryError, step])

  useEffect(() => {
    if (step === 'A03' && rightsError) {
      rightsRef.current?.focus()
      rightsRef.current?.scrollIntoView?.({ block: 'center' })
    }
  }, [step, rightsError])

  const [unsaved, setUnsaved] = useState(false)

  function markMaterialChange() {
    setUnsaved(true)
    connection?.onDirty?.(true)
    if (visitedDraft) setMaterialChanged(true)
  }

  function validateHours() {
    const error = !focused && hoursMode === 'specified' ? specifiedHoursError(startTime, endTime, hoursNextDay) : ''
    setHoursError(error)
    if (!error) return true
    setAfterClearOpen(true)
    setStep('A03')
    requestAnimationFrame(() => { hoursErrorRef.current?.focus(); hoursErrorRef.current?.scrollIntoView?.({ block: 'center' }) })
    return false
  }

  function enterDraft() {
    if (timeError || priceError || !validateHours()) return
    if (!focused && !validateMaterials()) return
    setDraftEntryError('')
    setVisitedDraft(true)
    setStep('A04')
  }

  function validateMaterials() {
    const missingName = !name.trim()
    if (missingName) {
      setShowSummary(false)
      setDraftEntryError('撮るものを入力')
      setStep('A03')
      nameRef.current?.focus()
      nameRef.current?.scrollIntoView?.({ block: 'center' })
      return false
    }
    setDraftEntryError('')
    return true
  }

  function clearPhoto() {
    if (photo) markMaterialChange()
    setPhoto(null)
    setPhotoLoadFailed(false)
    setPhotoError('')
    if (inputRef.current) inputRef.current.value = ''
  }

  function choosePhoto(file?: File) {
    if (!file) return false
    setPhotoError('')
    if (file.size === 0) { setPhotoError('空の画像・選び直す'); return false }
    if (!allowedTypes.includes(file.type)) { setPhotoError('JPEG・PNG・WebPを選択'); return false }
    const limit = connection ? PHOTO_UPLOAD_MAX_BYTES : maxPhotoBytes
    if (file.size > limit) { setPhotoError(connection ? '4MB以下の画像を選択'
      : '5MB以下の画像を選択'); return false }
    try {
      const url = URL.createObjectURL(file)
      setPhotoLoadFailed(false)
      if (!part && focused && photoRights.trim() && (rightsPhotoRef.current || hadReference.current || referenceAssetId)) setRightsReuseNeeded(true)
      rightsPhotoRef.current = file
      setPhoto({ file, url })
      return true
    } catch {
      setPhotoError('画像読込失敗・選び直す')
      return false
    }
  }

  function enterPreview() {
    if (!validateHours()) return
    setPreviewMode('challenge')
    setStep('A05')
  }

  function editDraft(next: SetStateAction<DraftFields>) {
    setUnsaved(true)
    connection?.onDirty?.(true)
    setDraft(next)
    setDraftEdit((value) => value + 1)
  }

  function changeHoursMode(mode: HoursMode) {
    setHoursMode(mode)
    setHoursError('')
    setShowSummary(false)
    if (mode === 'unset') setHours('')
    else if (mode === 'all-day') setHours('終日')
    else if (mode === 'supplement') setHours(hoursSupplement)
    else setHours(startTime && endTime ? `${startTime}〜${hoursNextDay ? '翌日 ' : ''}${endTime}` : '')
    markMaterialChange()
  }

  function updateSpecifiedTime(start: string, end: string, nextDay = hoursNextDay) {
    setStartTime(start)
    setEndTime(end)
    setHoursNextDay(nextDay)
    setShowSummary(false)
    if (start && end) {
      setHours(`${start}〜${nextDay ? '翌日 ' : ''}${end}`)
      setHoursError(specifiedHoursError(start, end, nextDay))
    } else {
      setHours('')
      setHoursError(start || end ? specifiedHoursError(start, end, nextDay) : '')
    }
    markMaterialChange()
  }

  const [showRequired, setShowRequired] = useState(false)
  const spot = spotForDraft(spotInput)
  const targetMissing = !name.trim()
  const referenceMissing = !photo && !referenceAssetId
  const features = draft.verifiedFeatures.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const featuresMissing = !features.length || features.length > 20 || features.some((line) => line.length > 300)
  const requiredTarget = showRequired && (part === 1 || onePage)
  const requiredContent = showRequired && (part === 3 || onePage)

  function saveDraft(destination?: 'areas' | 'publication' | 1 | 2 | 3 | 'next') {
    reset()
    setInputError('')
    if (timeError || priceError || photoError || !validateHours()) return
    if (!record && exploration?.source === 'unavailable') {
      setInputError('探索エリア取得失敗・運営に確認')
      setStep('A03')
      return
    }
    if (destination === 'next' && !onePage) {
      const missingHint = draft.hints.findIndex((hint) => !hint.trim())
      const targetFields = [
        targetMissing && 'workflow-target-name', referenceMissing && 'workflow-reference',
        (!spot || spot === 'incomplete') && 'workflow-spot',
      ]
      const contentFields = [
        !draft.title.trim() && 'workflow-title', !draft.question.trim() && 'workflow-question',
        missingHint !== -1 && 'workflow-hint-' + missingHint, featuresMissing && 'workflow-features',
      ]
      // 下書き案の取得には、先に対象・写真・場所を保存する必要がある。
      const required = onePage ? [...targetFields, ...(record?.draft.afterClear.spot ? contentFields : [])]
        : part === 1 ? targetFields
        : part === 2 ? [(!spot || spot === 'incomplete') && 'workflow-spot-needed']
        : part === 3 ? contentFields : []
      const firstMissing = required.find(Boolean)
      if (firstMissing) {
        setShowRequired(true)
        document.getElementById(firstMissing)?.focus()
        return
      }
    }
    if (spot === 'incomplete') {
      setInputError('名称・住所・座標を入力')
      setStep('A03')
      return
    }
    if (focused && (hours.length > 2000 || price.length > 2000)) {
      setInputError('時間・料金は各2000文字以内')
      setStep('A03'); setAfterClearOpen(true)
      return
    }
    setInputError('')
    if (!part && photo && rightsReuseNeeded) {
      setInputError('差し替え写真の利用権を確認')
      setStep('A03'); return
    }
    if (!part && photo && !photoRights.trim()) {
      setRightsError(true)
      setStep('A03')
      rightsRef.current?.focus()
      rightsRef.current?.scrollIntoView?.({ block: 'center' })
      return
    }
    if (!record && !name.trim() && !draft.title.trim()) { setDraftEntryError('撮るものを入力'); setInputError('撮るもの・タイトルを入力'); return }
    const savedDraft = onePage ? connection?.initial?.draft ?? record?.draft : record?.draft
    const legacyHintAssetId = savedDraft?.hintAssetId ?? null
    const hintAssetIds = savedDraft?.hintAssetIds ?? (legacyHintAssetId ? [legacyHintAssetId, null, null] : undefined)
    void save({
      materials: { name, evidence, requiresBoat, requiresPaidFacility, price: normalizePrice(price), photoNote: '', photoRights: part && photo ? '' : photoRights },
      content: draft, afterClear: { access, hours, promoComment, explanation, ...(spot ? { spot } : {}) }, referenceAssetId,
      hintAssetId: savedDraft?.hintAssetIds ? legacyHintAssetId : null,
      ...(hintAssetIds ? { hintAssetIds } : {}),
    }, photo ? { file: photo.file, purpose: 'reference', photoRights } : undefined, (saved) => {
      setAppliedDraft(null)
      setShowRequired(false)
      setDraftEntryError('')
      setRightsError(false)
      setReferenceAssetId(saved.draft.referenceAssetId)
      clearPhoto()
      setUnsaved(false)
      connection?.onWorkflowSave?.(saved, destination === 'next')
      if (destination !== undefined && destination !== 'next') connection?.onContinue?.(saved, destination)
    })
  }

  useEffect(() => {
    const listener = () => { if (!connection?.saveBlocked) saveDraft() }
    document.addEventListener('admin-save-draft', listener)
    return () => document.removeEventListener('admin-save-draft', listener)
  })

  const materialMissing = [!name.trim() && '対象名'].filter(Boolean) as string[]
  const contentMissing = [!draft.title.trim() && 'タイトル', !draft.question.trim() && '問題文',
    ...draft.hints.map((hint, index) => !hint.trim() && `ヒント ${index + 1}`)].filter(Boolean) as string[]

  const Root = connection ? 'section' : 'main'
  return <Root className={connection ? 'admin-editor' : 'admin-demo'}>
    {!part && connection && <button className="admin-back-link" type="button" aria-label="謎一覧へ戻る" disabled={saving} onClick={connection.onBack}>← 謎一覧</button>}
    {!part && <header className="admin-header"><div><h1>{step === 'A03' ? '素材登録' : step === 'A04' ? '問題の編集' : '表示確認'}</h1></div><span className="demo-badge">{connection ? '保存先：検証用' : '未ログイン'}</span></header>}
    <div inert={saving}>
    {!part && <><nav className="steps" aria-label="登録手順">
      <button type="button" aria-current={step === 'A03' ? 'step' : undefined} onClick={() => setStep('A03')}><b>1/3</b><span>素材・場所</span></button><button type="button" aria-current={step === 'A04' ? 'step' : undefined} onClick={enterDraft}><b>2/3</b><span>下書き編集</span></button><button type="button" aria-current={step === 'A05' ? 'step' : undefined} onClick={enterPreview}><b>3/3</b><span>プレビュー</span></button>
    </nav>
    <p className="demo-notice" role="note">{connection
      ? teamPreview ? '検証環境'
        : '検証環境'
      : '未保存・再読込で消去・AI未接続'}</p></>}

    {(onePage || step === 'A03') && <form onSubmit={event => {
      event.preventDefault()
      if (focused) { enterDraft(); return }
      if (validateHours() && validateMaterials()) setShowSummary(true)
    }}>
      {part !== 2 && <><section className="form-section" aria-labelledby="target-heading"><h2 id="target-heading" ref={a03HeadingRef} tabIndex={-1} className={part && !onePage ? "sr-only" : undefined}>非公開</h2>

        <label>撮るもの<input aria-label="撮るもの" id="workflow-target-name" ref={nameRef} aria-required={Boolean(part) || !focused} aria-invalid={Boolean((requiredTarget || draftEntryError) && targetMissing)} aria-describedby={(draftEntryError || requiredTarget) && targetMissing ? "name-error" : undefined} value={name} onChange={event => { setName(event.target.value); markMaterialChange() }} placeholder="例：広場の時計" /></label>
        {(draftEntryError || requiredTarget) && targetMissing && <p id="name-error" className="field-error">撮るものを入力</p>}
        <label className="photo-picker">正解の写真<span className="photo-picker-button" aria-hidden="true">写真を選ぶ</span><input aria-label="正解の写真" id="workflow-reference" className="reference-photo-input" ref={inputRef} type="file" accept={PHOTO_UPLOAD_ACCEPT} aria-required={Boolean(part)} aria-invalid={Boolean(photoError) || (requiredTarget && referenceMissing)} aria-describedby="photo-error" onChange={event => { if (choosePhoto(event.target.files?.[0])) markMaterialChange(); event.currentTarget.value = '' }} /></label>

        {!photo && referenceAssetId && <p>保存済みの参考写真 <button type="button" onClick={() => {
          setReferenceAssetId(null); markMaterialChange()
        }}>参照を外す</button></p>}
        {(photoError || (requiredTarget && referenceMissing)) && <p id="photo-error" role="alert" className="field-error">{photoError || "参考写真を選択。"}</p>}
        {photoLoadFailed && <p role="alert" className="field-error">画像読込失敗・選び直す</p>}
        {photo && <div className="photo-preview" role="region" aria-label="選択中の参考写真"><img src={photo.url} alt={`選択した参考写真：${photo.file.name}`} onError={() => setPhotoLoadFailed(true)} /><div><span>選択中：{photo.file.name}</span><button type="button" onClick={clearPhoto}>削除</button></div></div>}
      </section>
      {!part && <section className="form-section" ><h2 id="rights-heading">写真の権利</h2>
        {connection ? <PhotoRightsInput key={photo?.url ?? "saved"} purpose="reference" label="写真の権利" textareaRef={rightsRef} invalid={rightsError && !photoRights.trim()} describedBy={rightsError && !photoRights.trim() ? "rights-error" : undefined} value={photoRights} onChange={value => { setPhotoRights(value); setRightsError(false); setRightsReuseNeeded(false); markMaterialChange() }} /> : <label>写真の権利<textarea ref={rightsRef} aria-invalid={rightsError && !photoRights.trim()} aria-describedby={rightsError && !photoRights.trim() ? "rights-error" : undefined} value={photoRights} onChange={event => { setPhotoRights(event.target.value); setRightsError(false); markMaterialChange() }} rows={2} placeholder="出典・撮影者・利用許諾など" /></label>}
        {focused && photo && rightsReuseNeeded && <label><input type="checkbox" checked={false} onChange={() => { setRightsReuseNeeded(false); setInputError('') }} />差し替え写真の利用権を確認</label>}
        {rightsError && !photoRights.trim() && <p id="rights-error" role="alert" className="field-error">写真の権利を入力</p>}
      </section>}
      <section className="form-section" aria-labelledby="area-heading"><h2 id="area-heading">探索エリア</h2>
        {exploration?.source === 'N03' ? <>
          <p>公開エリア：{exploration.name}</p>
        </> : exploration?.source === 'unavailable' ? <>
          <p>所属自治体：{connection?.member.label}</p>
          <p role="alert">行政区域未確認・運営に確認</p>
        </> : exploration?.source === 'fixture' ? <p>公開エリア：{exploration.name}</p>
          : areaLabel ? <p>公開エリア：{areaLabel}</p> : <>
          <p><strong>自治体：青葉みらい市</strong></p>
          <p>探索エリア：青葉みらい市の行政区域</p>
        </>}
        {!part && <div className="private-setting"><strong>撮影範囲</strong><span>{areaStatus}</span></div>}
      </section>
      {connection && <section className="form-section" aria-label="対象スポット登録" id="workflow-spot" tabIndex={-1} aria-invalid={requiredTarget && (!spot || spot === 'incomplete')}>
        {part ? <MapSpotEditor input={spotInput} invalid={requiredTarget || Boolean(inputError)} orgId={connection.member.orgId}
          locationError={saveState.status === 'error' && saveState.message === 'エリアの外です' ? saveState.message : undefined}
          onHoursCandidate={setHoursCandidate}
          lookup={connection.api.canLookupSpotAddress ? connection.api.lookupSpotAddress : undefined}
          onChange={(input) => { setSpotInput(input); setInputError(''); if (saveState.status === 'error' && saveState.message === 'エリアの外です') reset(); markMaterialChange() }} /> : <SpotEditor input={spotInput} deriveShootingArea={Boolean(part)} durable={connection.taskFocused || teamPreview} orgId={connection.member.orgId}
          canLookupSpotAddress={connection.api.canLookupSpotAddress} lookupSpotAddress={connection.api.lookupSpotAddress}
          onChange={(input) => { setSpotInput(input); setInputError(''); markMaterialChange() }} />}
        {hoursCandidate && <div className="spot-address-candidate"><p>利用時間候補：{hoursCandidate}</p><button type="button" onClick={() => { setHours(hoursCandidate); setHoursImport(value => value + 1); setHoursCandidate(undefined); markMaterialChange() }}>使う</button></div>}
      </section>}</>}
      {part === 2 && <div id="workflow-spot-needed" tabIndex={-1} aria-invalid={showRequired && (!spot || spot === 'incomplete')}>
        {showRequired && (!spot || spot === 'incomplete') && <p role="alert" className="field-error">STEP 1で場所を保存</p>}
      </div>}
      {part !== 1 && <><section className="form-section" aria-labelledby="conditions-heading"><h2 id="conditions-heading">挑戦条件</h2>
        <fieldset><legend>撮影条件</legend><div className="check-grid"><label className="check-option"><input type="checkbox" checked={requiresBoat} onChange={event => { setRequiresBoat(event.target.checked); markMaterialChange() }} />船上・海上</label><label className="check-option"><input type="checkbox" checked={requiresPaidFacility} onChange={event => { setRequiresPaidFacility(event.target.checked); markMaterialChange() }} />有料施設内</label></div></fieldset>
        {connection ? <PriceInput onError={setPriceError} value={price} onChange={value => { setPrice(value); markMaterialChange() }} /> : <label>料金<input value={price} onChange={event => { setPrice(event.target.value); markMaterialChange() }} placeholder="例：大人500円／無料／要確認" /></label>}
      </section>
      <details className="form-section" open={afterClearOpen} onToggle={event => setAfterClearOpen(event.currentTarget.open)}><summary>クリア後</summary>

        <AccessInput value={access} onChange={value => { setAccess(value); markMaterialChange() }} builder={Boolean(connection)} />
        {focused ? <HoursInput key={hoursImport} onError={setTimeError} value={hours} onChange={value => { setHours(value); markMaterialChange() }} /> : <fieldset><legend>利用時間</legend>
          <div role="radiogroup" aria-label="利用時間の設定">
            {([['unset', '未設定'], ['all-day', '終日'], ['specified', '時刻指定'], ['supplement', '補足']] as const).map(([value, label]) =>
              <label key={value}><input type="radio" name="hours-mode" value={value} checked={hoursMode === value} onChange={() => changeHoursMode(value)} />{label}</label>)}
          </div>
          {hoursMode === 'specified' && <div>
            <label>開始時刻<select value={startTime} aria-describedby="hours-error" onChange={event => updateSpecifiedTime(event.target.value, endTime)}><option value="">選択</option>{hourlyChoices.map(time => <option key={time} value={time}>{time}</option>)}</select></label>
            <label>終了時刻<select value={endTime} aria-describedby="hours-error" onChange={event => updateSpecifiedTime(startTime, event.target.value)}><option value="">選択</option>{endHourlyChoices.map(time => <option key={time} value={time}>{time}</option>)}</select></label>
            <label><input type="checkbox" checked={hoursNextDay} onChange={event => updateSpecifiedTime(startTime, endTime, event.target.checked)} />翌日終了</label>

          </div>}
          {hoursMode === 'supplement' && <label>時間補足<input value={hoursSupplement} onChange={event => { setHoursSupplement(event.target.value); setHours(event.target.value); setShowSummary(false); markMaterialChange() }} placeholder="例：季節により異なります" /></label>}
          {hoursError && <p ref={hoursErrorRef} id="hours-error" role="alert" tabIndex={-1} className="field-error">{hoursError}</p>}
        </fieldset>}
        <label>紹介<textarea value={promoComment} onChange={event => { setPromoComment(event.target.value); markMaterialChange() }} rows={2} placeholder="例：地域で大切に受け継いできた風景です。" /></label>
        <label>解説<textarea value={explanation} onChange={event => { setExplanation(event.target.value); markMaterialChange() }} rows={3} placeholder="例：この建物が建てられた背景や、地域との関わり" /></label>
      </details></>}
      {!part && <>{draftEntryError && !name.trim() && <p tabIndex={-1} role="alert" className="field-error">{draftEntryError}</p>}
      <button className="submit-button" type="button" onClick={enterDraft}>下書き・編集へ</button>
      {!focused && <button type="submit">入力内容を確認</button>}
      {showSummary && <section aria-labelledby="summary-heading" className="form-section summary"><h2 id="summary-heading">入力内容の確認</h2>{!connection && <p>画面内の確認表示です。送信・保存はしていません。</p>}<dl><dt>自治体・探索エリア</dt><dd>{areaLabel ?? '青葉みらい市・青葉みらい市の行政区域'}</dd><dt>対象名</dt><dd>{name || '未入力'}</dd><dt>船上・海上での撮影</dt><dd>{requiresBoat ? '必要' : '未選択'}</dd><dt>有料施設内での撮影</dt><dd>{requiresPaidFacility ? '必要' : '未選択'}</dd><dt>挑戦前の料金</dt><dd>{price || '未入力'}</dd><dt>クリア後の行き方</dt><dd>{access || '未入力'}</dd><dt>クリア後に利用時間</dt><dd>{hours || '未入力'}</dd><dt>紹介</dt><dd>{promoComment || '未入力'}</dd><dt>解説</dt><dd>{explanation || '未入力'}</dd><dt>写真の権利</dt><dd>{photoRights || '未入力'}</dd><dt>参考写真</dt><dd>{photo?.file.name ?? (referenceAssetId ? '保存済み' : '未選択')}</dd><dt>撮影範囲</dt><dd>{areaStatus}</dd></dl></section>}
      </>}
    </form>}
    {(onePage || step === 'A04') && <>
      <DraftEditor draft={draft} setDraft={editDraft} materialChanged={materialChanged} sampleConfirm={sampleConfirm}
        setSampleConfirm={setSampleConfirm} onBack={() => setStep('A03')} workflow={part === 3 || onePage} requiredErrors={requiredContent} featuresInvalid={featuresMissing} onPreview={enterPreview} headingRef={a04HeadingRef} omitMemo={focused} allowSample={!connection} />
      {appliedDraft && <div role="status" className="admin-operation-notice">反映済み・未保存<button type="button" onClick={() => { editDraft(appliedDraft); setAppliedDraft(null); document.getElementById('workflow-title')?.focus() }}>元に戻す</button></div>}
      {connection && record && <DraftCandidate key={record.draftRevision + ':' + draftEdit} api={connection.api} saved={record} current={draft} omitNotes={focused} onApply={next => {
        const merged = focused ? { ...next, draftingNotes: draft.draftingNotes } : next
        const first = (['title', 'question', 'hints', 'verifiedFeatures', 'draftingNotes'] as const).find(key => JSON.stringify(draft[key]) !== JSON.stringify(merged[key]))
        setAppliedDraft(draft)
        editDraft(merged)
        const id = first === 'hints' ? 'workflow-hint-' + draft.hints.findIndex((hint, index) => hint !== merged.hints[index]) : first === 'verifiedFeatures' ? 'workflow-features' : first === 'draftingNotes' ? 'workflow-notes' : 'workflow-' + first
        document.getElementById(id)?.focus()
      }} />}
    </>}
    {!onePage && step === 'A05' && <>
      {!part && <section className="form-section" aria-label="不足項目">
        <p><strong>不足項目</strong></p>
        {materialMissing.length === 0 && contentMissing.length === 0
          ? <p role="status">入力済み</p>
          : <>
            {materialMissing.length > 0 && <p>非公開の確認材料：{materialMissing.join('・')}が未入力です。</p>}
            {contentMissing.length > 0 && <p role="status">旅行者に公開文章：{contentMissing.join('・')}が未入力です。</p>}
          </>}
        {!part && <button type="button" onClick={() => setStep('A03')}>素材と場所を編集</button>}
      </section>}
      <TravelerPreview challengeContent={{ title: draft.title, question: draft.question, hints: draft.hints, requiresBoat, requiresPaidFacility, price }} afterClearContent={{ access, hours, promoComment, explanation }} mode={previewMode} onModeChange={setPreviewMode} headingRef={a05HeadingRef} onEdit={() => { setVisitedDraft(true); setStep('A04') }} areaLabel={areaLabel} /></>}
    </div>
    {(part === 1 || onePage) && exploration?.source === 'N03' && <footer className="helper">出典：国土交通省 国土数値情報「行政区域」{exploration.year}年版を加工</footer>}
    {connection && <section className="form-section" aria-label="下書きの保存">
      {saveState.status === 'saved' && <p role="status" tabIndex={-1} ref={statusRef}><span className="save-success">保存済み</span></p>}
      {saveState.status === 'error' && <p role="alert">{saveState.message}</p>}
      {inputError && <p role="alert">{inputError}</p>}
      <div className="admin-list-actions admin-save-bar">
        <button type="button" className={onePage ? "workflow-primary" : undefined} disabled={saving || connection.saveBlocked || (onePage && (!record ? !name.trim() && !draft.title.trim() : !unsaved)) || (saveState.status === 'error' && saveState.reload)} onClick={() => {
          saveDraft()
        }}>{saving ? '保存中' : onePage ? '保存' : '下書きを保存'}</button>
        {part && !onePage && <button type="button" className="workflow-primary" disabled={saving || (saveState.status === 'error' && saveState.reload)} onClick={() => saveDraft('next')}>保存して次へ</button>}
        {!part && connection.onContinue && <details className="save-continue">
          <summary>保存先</summary>
          <div className="admin-list-actions">
            <button type="button" disabled={saving || (saveState.status === 'error' && saveState.reload)} onClick={() => saveDraft('areas')}>保存して撮影範囲へ</button>
            {draft.hints.map((hint, index) => hint.trim() && <button key={index} type="button" disabled={saving || (saveState.status === 'error' && saveState.reload)} onClick={() => saveDraft((index + 1) as 1 | 2 | 3)}>保存してヒント {index + 1}の画像へ</button>)}
            <button type="button" disabled={saving || (saveState.status === 'error' && saveState.reload)} onClick={() => saveDraft('publication')}>保存して試験・公開確認へ</button>
          </div>
        </details>}
      </div>
    </section>}
  </Root>
}
