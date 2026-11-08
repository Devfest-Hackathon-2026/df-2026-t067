import { useEffect, useRef, useState } from 'react'
import type { SetStateAction } from 'react'
import { SpotEditor } from './SpotEditor'
import { confirmedSpot, initialSpotInput } from './mapsSpotLink'
import './admin.css'
import { PhotoRightsInput } from './PhotoRightsInput'
import { HoursInput } from './HoursInput'
import { PriceInput } from './PriceInput'
import DraftEditor, { type DraftFields } from './DraftEditor'
import { DraftCandidate } from './DraftCandidate'
import TravelerPreview, { type PreviewMode } from './TravelerPreview'
import { useLocalDraftSave } from './useLocalDraftSave'
import type { LocalDraftConnection } from './useLocalDraftSave'

const maxPhotoBytes = 5 * 1024 * 1024
const allowedTypes = ['image/jpeg', 'image/png', 'image/webp']

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
  if (!start || !end) return '開始時刻と終了時刻を選んでください。'
  if (end <= start && !nextDay) return '終了時刻が開始時刻以前の場合は、終了を翌日に設定してください。'
  return ''
}

function parseHours(hours: string) {
  const match = /^((?:[01]\d|2[0-3]):00)〜(翌日 )?((?:[01]\d|2[0-3]|24):00)$/.exec(hours)
  return { start: match?.[1] ?? '', nextDay: Boolean(match?.[2]), end: match?.[3] ?? '' }
}

const hourlyChoices = Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, '0')}:00`)
const endHourlyChoices = [...hourlyChoices, '24:00']

export default function QuestDraftForm({ connection, teamPreview = false }: { connection?: LocalDraftConnection; teamPreview?: boolean } = {}) {
  const focused = connection?.taskFocused === true
  const initial = connection?.initial?.draft
  const [name, setName] = useState(initial?.materials.name ?? '')
  const [evidence, setEvidence] = useState(initial?.materials.evidence ?? '')
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
  const [price, setPrice] = useState(initial?.materials.price ?? '')
  const [photoNote, setPhotoNote] = useState(initial?.materials.photoNote ?? '')
  const [inputError, setInputError] = useState('')
  const [rightsReuseNeeded, setRightsReuseNeeded] = useState(false)
  const [rightsError, setRightsError] = useState(false)
  const rightsRef = useRef<HTMLTextAreaElement>(null)
  const rightsPhotoRef = useRef<File | null>(null)
  const hadReference = useRef(Boolean(initial?.referenceAssetId))
  const [photoRights, setPhotoRights] = useState(initial?.materials.photoRights ?? '')
  const [showSummary, setShowSummary] = useState(false)
  const [step, setStep] = useState<'A03' | 'A04' | 'A05'>('A03')
  const [previewMode, setPreviewMode] = useState<PreviewMode>('challenge')
  const [draft, setDraft] = useState<DraftFields>(initial?.content ?? { title: '', question: '', hints: ['', '', ''], verifiedFeatures: '', draftingNotes: '' })
  const [draftEdit, setDraftEdit] = useState(0)
  const [draftEntryError, setDraftEntryError] = useState('')
  const [sampleConfirm, setSampleConfirm] = useState(false)
  const [visitedDraft, setVisitedDraft] = useState(false)
  const [materialChanged, setMaterialChanged] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const a03HeadingRef = useRef<HTMLHeadingElement>(null)
  const a04HeadingRef = useRef<HTMLHeadingElement>(null)
  const a05HeadingRef = useRef<HTMLHeadingElement>(null)
  const errorFieldRef = useRef<'name' | 'evidence'>('name')
  const nameRef = useRef<HTMLInputElement>(null)
  const evidenceRef = useRef<HTMLTextAreaElement>(null)
  const [afterClearOpen, setAfterClearOpen] = useState(false)
  const hoursErrorRef = useRef<HTMLParagraphElement>(null)
  const { record, state: saveState, save } = useLocalDraftSave(connection)
  const saving = saveState.status === 'saving'
  const exploration = record && connection && record.areaId !== connection.member.areaId
    ? { source: 'unavailable' as const } : connection?.member.exploration
  const areaLabel = connection ? (exploration?.source === 'unavailable' ? '探索エリア未設定'
    : exploration?.name ?? connection.member.label + '・' + connection.member.areaId) : undefined
  const areaStatus = connection ? (record?.shootingAreaStatus === 'configured' ? '設定済み'
    : record?.shootingAreaStatus === 'needs-review' ? '要確認（旧半径）' : '未設定') : '未設定・接続待ち'

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
      const field = errorFieldRef.current === 'name' ? nameRef.current : evidenceRef.current
      field?.focus()
      field?.scrollIntoView?.({ block: 'center' })
    }
  }, [draftEntryError, step])

  useEffect(() => {
    if (step === 'A03' && rightsError) {
      rightsRef.current?.focus()
      rightsRef.current?.scrollIntoView?.({ block: 'center' })
    }
  }, [step, rightsError])

  function markMaterialChange() {
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
    if (!validateHours()) return
    if (!focused && !validateMaterials()) return
    setDraftEntryError('')
    setVisitedDraft(true)
    setStep('A04')
  }

  function validateMaterials() {
    const missingName = !name.trim()
    const missingEvidence = !evidence.trim()
    if (missingName || missingEvidence) {
      errorFieldRef.current = missingName ? 'name' : 'evidence'
      setShowSummary(false)
      setDraftEntryError('対象名と対象とする理由を確認してください。未入力の欄にエラーを表示しています。')
      setStep('A03')
      const field = missingName ? nameRef.current : evidenceRef.current
      field?.focus()
      field?.scrollIntoView?.({ block: 'center' })
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
    if (file.size === 0) { setPhotoError('画像ファイルが空です。別の画像を選び直してください。'); return false }
    if (!allowedTypes.includes(file.type)) { setPhotoError('JPEG、PNG、WebP形式の画像を選んでください。'); return false }
    const limit = connection ? 4 * 1024 * 1024 : maxPhotoBytes
    if (file.size > limit) { setPhotoError(connection ? '送信上限の4 MiBを超えています。小さい画像を選んでください。'
      : '選択上限の5 MBを超えています。小さい画像を選んでください。'); return false }
    try {
      const url = URL.createObjectURL(file)
      setPhotoLoadFailed(false)
      if (focused && photoRights.trim() && (rightsPhotoRef.current || hadReference.current || referenceAssetId)) setRightsReuseNeeded(true)
      rightsPhotoRef.current = file
      setPhoto({ file, url })
      return true
    } catch {
      setPhotoError('画像プレビューを準備できませんでした。もう一度選んでください。')
      return false
    }
  }

  function enterPreview() {
    if (!validateHours()) return
    setPreviewMode('challenge')
    setStep('A05')
  }

  function editDraft(next: SetStateAction<DraftFields>) {
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

  function saveDraft(destination?: 'areas' | 'publication' | 1 | 2 | 3) {
    if (!validateHours()) return
    if (!record && exploration?.source === 'unavailable') {
      setInputError('所属自治体の探索エリアを取得できません。自治体コードと行政区域の登録を運営に確認してください。')
      setStep('A03')
      return
    }
    const spot = confirmedSpot(spotInput)
    if (spot === 'incomplete') {
      setInputError('対象スポットの位置・名称・住所を入力し、確認欄を選択してください。')
      setStep('A03')
      return
    }
    if (focused && (hours.length > 2000 || price.length > 2000)) {
      setInputError('時間と料金はそれぞれ2000文字以内で入力してください。')
      setStep('A03'); setAfterClearOpen(true)
      return
    }
    setInputError('')
    if (photo && rightsReuseNeeded) {
      setInputError('差し替えた写真に入力済みの権利文を適用できるか確認してください。')
      setStep('A03'); return
    }
    if (photo && !photoRights.trim()) {
      setRightsError(true)
      setStep('A03')
      rightsRef.current?.focus()
      rightsRef.current?.scrollIntoView?.({ block: 'center' })
      return
    }
    const legacyHintAssetId = record?.draft.hintAssetId ?? null
    const hintAssetIds = record?.draft.hintAssetIds ?? (legacyHintAssetId ? [legacyHintAssetId, null, null] : undefined)
    void save({
      materials: { name, evidence, requiresBoat, requiresPaidFacility, price, photoNote, photoRights },
      content: draft, afterClear: { access, hours, promoComment, explanation, ...(spot ? { spot } : {}) }, referenceAssetId,
      hintAssetId: record?.draft.hintAssetIds ? legacyHintAssetId : null,
      ...(hintAssetIds ? { hintAssetIds } : {}),
    }, photo ? { file: photo.file, purpose: 'reference', photoRights } : undefined, (saved) => {
      setReferenceAssetId(saved.draft.referenceAssetId)
      clearPhoto()
      if (destination !== undefined) connection?.onContinue?.(saved, destination)
    })
  }

  const Root = connection ? 'section' : 'main'
  return <Root className={connection ? 'admin-editor' : 'admin-demo'}>
    <header className="admin-header"><div><span className="eyebrow">自治体向け</span><h1>{step === 'A03' ? '問題の素材と場所を登録' : step === 'A04' ? '問題の下書きを編集' : '旅行者向け表示の確認'}</h1></div><span className="demo-badge">{connection ? '開発用保存' : '未認証・未接続'}</span></header>
    <div inert={saving}>
    <nav className="steps" aria-label="登録手順">
      <button type="button" aria-current={step === 'A03' ? 'step' : undefined} onClick={() => setStep('A03')}><b>1/3</b><span>素材・場所登録</span></button><button type="button" aria-current={step === 'A04' ? 'step' : undefined} onClick={enterDraft}><b>2/3</b><span>下書き・編集（AI未接続）</span></button><button type="button" aria-current={step === 'A05' ? 'step' : undefined} onClick={enterPreview}><b>3/3</b><span>表示プレビュー（未公開）</span></button>
    </nav>
    <p className="demo-notice" role="note">{connection
      ? teamPreview ? '「下書きを保存」で入力と選択した合成参考写真をチームの検証用データとして保存します。'
        : '「下書きを保存」で入力と選択した合成参考写真をローカルAPIへ送ります。保存先はAPIの起動モードに従います（demoは一時領域、durable-localはローカル永続ストア）。'
      : '未認証です。入力と写真の送信・保存はしていません。再読み込みで入力は消えます。AI・認証・認可・正解判定・公開は未接続です。'}</p>

    {step === 'A03' ? <form onSubmit={event => {
      event.preventDefault()
      if (focused) { enterDraft(); return }
      if (validateHours() && validateMaterials()) setShowSummary(true)
    }}>
      <section className="form-section" aria-labelledby="target-heading"><h2 id="target-heading" ref={a03HeadingRef} tabIndex={-1}>1/3 素材と場所</h2>
        <p className="helper">{focused ? '対象名・写真・権利・特徴・撮影範囲などの確認は公開までに必要です。途中でも文章編集・保存できます。対象理由は任意です。' : '次へ進むには対象名と理由が必須です。写真・権利・撮影範囲などの確認は公開までに必要です。下書き保存は未完成でもできます。'}</p>
        <p className="helper">対象名と理由は非公開。問題を作るための確認材料です。</p>
        <span className="helper">{focused ? '公開までに必須' : '必須（次へ進むとき）'}</span><label>対象名<input ref={nameRef} aria-required={!focused} aria-invalid={Boolean(draftEntryError && !name.trim())} aria-describedby={draftEntryError && !name.trim() ? "name-error" : undefined} value={name} onChange={event => { setName(event.target.value); markMaterialChange() }} placeholder="例：広場の時計" /></label>
        {draftEntryError && !name.trim() && <p id="name-error" className="field-error">対象名を入力してください。</p>}
        <span className="helper">{focused ? '任意・担当者への追加情報' : '必須（次へ進むとき）'}</span><label>対象とする理由（確認した内容）<textarea ref={evidenceRef} aria-required={!focused} aria-invalid={Boolean(draftEntryError && !evidence.trim())} aria-describedby={draftEntryError && !evidence.trim() ? "evidence-error" : undefined} value={evidence} onChange={event => { setEvidence(event.target.value); markMaterialChange() }} rows={3} placeholder="例：自治体が管理し、安全に撮影できることを確認済み" /></label>
        {draftEntryError && !evidence.trim() && <p id="evidence-error" className="field-error">対象とする理由を入力してください。</p>}
        <span className="helper">任意（後で登録可・非公開の照合用）</span><label className="file-label">参考写真（公開ヒントには自動流用しません）<input className="reference-photo-input" ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" aria-describedby="photo-help photo-error" onChange={event => { if (choosePhoto(event.target.files?.[0])) markMaterialChange(); event.currentTarget.value = '' }} /></label>
        <p id="photo-help" className="helper">{connection ? 'JPEG / PNG / WebP、送信上限4 MiB。合成素材を使ってください。'
          : 'JPEG / PNG / WebP、選択上限5 MB。参考写真の選択・プレビューのみです。'}</p>
        {!photo && referenceAssetId && <p>保存済みの参考写真 <button type="button" onClick={() => {
          setReferenceAssetId(null); markMaterialChange()
        }}>参照を外す</button></p>}
        {photoError && <p id="photo-error" role="alert" className="field-error">{photoError}</p>}
        {photoLoadFailed && <p role="alert" className="field-error">画像を読み込めませんでした。もう一度選ぶか、画像を削除してください。</p>}
        {photo && <div className="photo-preview" role="region" aria-label="選択中の参考写真"><img src={photo.url} alt={`選択した参考写真：${photo.file.name}`} onError={() => setPhotoLoadFailed(true)} /><div><span>選択中：{photo.file.name}</span><button type="button" onClick={() => inputRef.current?.click()}>変更</button><button type="button" onClick={clearPhoto}>削除</button>{photoLoadFailed && <button type="button" onClick={() => inputRef.current?.click()}>再試行</button>}</div></div>}
      </section>
      <section className="form-section" aria-labelledby="rights-heading"><h2 id="rights-heading">写真の権利</h2>
        <p className="helper">非公開。写真の出典・利用許諾を確認してください。写真を添えて保存するときに必須です。写真なしの下書きは空欄でも保存でき、確認依頼までに記入が必要です。</p>{focused ? <PhotoRightsInput key={photo?.url ?? "saved"} purpose="reference" label="写真の出典と利用権" textareaRef={rightsRef} invalid={rightsError && !photoRights.trim()} describedBy={rightsError && !photoRights.trim() ? "rights-error" : undefined} value={photoRights} onChange={value => { setPhotoRights(value); setRightsError(false); setRightsReuseNeeded(false); markMaterialChange() }} /> : <label>写真の出典と利用権<textarea ref={rightsRef} aria-invalid={rightsError && !photoRights.trim()} aria-describedby={rightsError && !photoRights.trim() ? "rights-error" : undefined} value={photoRights} onChange={event => { setPhotoRights(event.target.value); setRightsError(false); markMaterialChange() }} rows={2} placeholder="出典・撮影者・利用許諾など" /></label>}
        {focused && photo && rightsReuseNeeded && <label><input type="checkbox" checked={false} onChange={() => { setRightsReuseNeeded(false); setInputError('') }} />差し替えた写真を非公開照合に使う権利を確認し、入力済みの権利文を適用する</label>}
        {rightsError && !photoRights.trim() && <p id="rights-error" role="alert" className="field-error">写真の出典と利用権を入力してください。</p>}
      </section>
      <section className="form-section" aria-labelledby="area-heading"><h2 id="area-heading">公開する探索エリア</h2>
        {exploration?.source === 'N03' ? <>
          <p>所属自治体：{connection?.member.label}</p>
          <p>探索エリア：{exploration.name}（自治体コード {exploration.municipalityCode}）</p>
          <p>出典：国土交通省 国土数値情報「行政区域」{exploration.year}年版を加工</p>
        </> : exploration?.source === 'unavailable' ? <>
          <p>所属自治体：{connection?.member.label}</p>
          <p role="alert">行政区域を確認できません。自治体コードとデータ登録を運営に確認してください。</p>
        </> : exploration?.source === 'fixture' ? <p>探索エリア：{exploration.name}（架空の検証用エリア）</p>
          : areaLabel ? <p>開発用の所属と公開探索エリア：{areaLabel}</p> : <>
          <p><strong>架空自治体：青葉みらい市（実在しません）</strong></p>
          <p>公開探索エリア：青葉みらい市の行政区域（架空エリア）。自治体の行政区域から自動設定する構想の表示で、実際の地図・区域データには未接続です。</p>
        </>}
        <div className="private-setting"><strong>非公開の撮影地点・半径</strong><span>{areaStatus}</span><small>{connection ? '撮影可能範囲：中心から半径1km（固定）' : '安全上、値や入力欄を表示しません。'}</small></div>
      </section>
      {connection && <section className="form-section" aria-label="対象スポット登録">
        <SpotEditor input={spotInput} onChange={(input) => { setSpotInput(input); setInputError(''); markMaterialChange() }} />
      </section>}
      <section className="form-section" aria-labelledby="conditions-heading"><h2 id="conditions-heading">挑戦前に伝える条件</h2><p className="helper">旅行者に公開。条件の選択・補足は任意ですが、安全上の制約や必要な費用がある場合は必ず記載してください。</p>
        <fieldset><legend>撮影に必要な条件</legend><div className="check-grid"><label className="check-option"><input type="checkbox" checked={requiresBoat} onChange={event => { setRequiresBoat(event.target.checked); markMaterialChange() }} />船上・海上での撮影が必要</label><label className="check-option"><input type="checkbox" checked={requiresPaidFacility} onChange={event => { setRequiresPaidFacility(event.target.checked); markMaterialChange() }} />有料施設内での撮影が必要</label></div><p className="helper">陸から撮影できる場合、船上・海上の条件は選びません。</p></fieldset>
        {focused ? <PriceInput value={price} onChange={value => { setPrice(value); markMaterialChange() }} /> : <label>料金<input value={price} onChange={event => { setPrice(event.target.value); markMaterialChange() }} placeholder="例：大人500円／無料／要確認" /></label>}
        <label>撮影時の注意<textarea value={photoNote} onChange={event => { setPhotoNote(event.target.value); markMaterialChange() }} rows={2} placeholder="撮影できる時間や安全上の制約は、挑戦前にここへ記載" /></label>
      </section>
      <details className="form-section" open={afterClearOpen} onToggle={event => setAfterClearOpen(event.currentTarget.open)}><summary>クリア後の紹介・解説（任意）</summary><p className="helper">クリアした旅行者に公開。アクセス・時間・地域の紹介・答えの背景を後から補足できます。</p>
        {!focused && <fieldset><legend>紹介・解説の入力方法</legend>
          <div role="radiogroup" aria-label="紹介・解説の入力方法">
            <label><input type="radio" name="after-clear-entry-mode" value="manual" defaultChecked />手入力</label>
            <label><input type="radio" name="after-clear-entry-mode" value="ai" disabled aria-describedby="after-clear-ai-status" />AI自動入力（準備中）</label>
          </div>
          <p id="after-clear-ai-status" className="helper">AIによる紹介・解説の自動入力は準備中です。生成APIは未接続です。</p>
        </fieldset>}
        {focused && <p className="helper">AIによる紹介・解説の自動入力は未提供です。</p>}
        <p className="helper">入力した紹介コメントと解説は、内容を確認・編集してから「下書き・編集へ」進んでください。</p>
        <label>アクセス補足<textarea value={access} onChange={event => { setAccess(event.target.value); markMaterialChange() }} rows={2} placeholder="例：駅から徒歩約10分" /></label>
        {focused ? <HoursInput value={hours} onChange={value => { setHours(value); markMaterialChange() }} /> : <fieldset><legend>利用できる時間</legend>
          <div role="radiogroup" aria-label="利用できる時間の設定">
            {([['unset', '未設定'], ['all-day', '終日'], ['specified', '時間を指定'], ['supplement', '補足を入力']] as const).map(([value, label]) =>
              <label key={value}><input type="radio" name="hours-mode" value={value} checked={hoursMode === value} onChange={() => changeHoursMode(value)} />{label}</label>)}
          </div>
          {hoursMode === 'specified' && <div>
            <label>開始時刻<select value={startTime} aria-describedby="hours-help hours-error" onChange={event => updateSpecifiedTime(event.target.value, endTime)}><option value="">選択してください</option>{hourlyChoices.map(time => <option key={time} value={time}>{time}</option>)}</select></label>
            <label>終了時刻<select value={endTime} aria-describedby="hours-help hours-error" onChange={event => updateSpecifiedTime(startTime, event.target.value)}><option value="">選択してください</option>{endHourlyChoices.map(time => <option key={time} value={time}>{time}</option>)}</select></label>
            <label><input type="checkbox" checked={hoursNextDay} onChange={event => updateSpecifiedTime(startTime, endTime, event.target.checked)} />終了は翌日</label>
            <p id="hours-help" className="helper">開始・終了時刻は1時間ごとに選べます。日をまたぐ場合は「終了は翌日」を選んでください。</p>
          </div>}
          {hoursMode === 'supplement' && <label>時間の補足<input value={hoursSupplement} onChange={event => { setHoursSupplement(event.target.value); setHours(event.target.value); setShowSummary(false); markMaterialChange() }} placeholder="例：季節により異なります" /></label>}
          {hoursError && <p ref={hoursErrorRef} id="hours-error" role="alert" tabIndex={-1} className="field-error">{hoursError}</p>}
        </fieldset>}
        <label>自治体のアピールコメント<textarea value={promoComment} onChange={event => { setPromoComment(event.target.value); markMaterialChange() }} rows={2} placeholder="例：地域で大切に受け継いできた風景です。" /></label>
        <label>解説<textarea value={explanation} onChange={event => { setExplanation(event.target.value); markMaterialChange() }} rows={3} placeholder="例：この建物が建てられた背景や、地域との関わり" /></label>
      </details>
      {draftEntryError && (!name.trim() || !evidence.trim()) && <p tabIndex={-1} role="alert" className="field-error">{draftEntryError}</p>}
      <button className="submit-button" type="button" onClick={enterDraft}>下書き・編集へ</button>
      {!focused && <button className="submit-button" type="submit">入力内容を確認</button>}
      {showSummary && <section aria-labelledby="summary-heading" className="form-section summary"><h2 id="summary-heading">入力内容の確認</h2><p>{connection ? 'これは現在の入力の確認表示です。' : 'これは画面内の確認表示です。送信・保存はしていません。'}</p><dl><dt>架空自治体・探索エリア</dt><dd>{areaLabel ?? '青葉みらい市（架空）・青葉みらい市の行政区域（架空）'}</dd><dt>対象名</dt><dd>{name || '未入力'}</dd><dt>根拠</dt><dd>{evidence || '未入力'}</dd><dt>船上・海上での撮影</dt><dd>{requiresBoat ? '必要' : '未選択'}</dd><dt>有料施設内での撮影</dt><dd>{requiresPaidFacility ? '必要' : '未選択'}</dd><dt>挑戦前の料金</dt><dd>{price || '未入力'}</dd><dt>撮影時の注意</dt><dd>{photoNote || '未入力'}</dd><dt>クリア後のアクセス補足</dt><dd>{access || '未入力'}</dd><dt>クリア後に利用できる時間</dt><dd>{hours || '未入力'}</dd><dt>自治体のアピールコメント</dt><dd>{promoComment || '未入力'}</dd><dt>解説</dt><dd>{explanation || '未入力'}</dd><dt>写真の出典と利用権</dt><dd>{photoRights || '未入力'}</dd><dt>参考写真</dt><dd>{photo?.file.name ?? (referenceAssetId ? '保存済み' : '未選択')}</dd><dt>非公開の撮影地点・半径</dt><dd>{areaStatus}</dd></dl></section>}
    </form> : step === 'A04' ? <>
      <DraftEditor draft={draft} setDraft={editDraft} materialChanged={materialChanged} sampleConfirm={sampleConfirm}
        setSampleConfirm={setSampleConfirm} onBack={() => setStep('A03')} onPreview={enterPreview} headingRef={a04HeadingRef} omitMemo={focused} />
      {connection && record && <DraftCandidate key={record.draftRevision + ':' + draftEdit} api={connection.api} saved={record} onApply={next => setDraft(current => focused ? { ...next, draftingNotes: current.draftingNotes } : next)} />}
    </> : <>
      <section className="form-section" aria-label="入力の完成状況">
        <p>未完成のプレビューも確認できます。公開には別途、素材・権利・安全・撮影範囲・試験の確認が必要です。</p>
        {(!name.trim() || (!focused && !evidence.trim())) && <p>素材の不足：{[!name.trim() && '対象名', !focused && !evidence.trim() && '対象とする理由'].filter(Boolean).join('・')}</p>}
        <button type="button" onClick={() => setStep('A03')}>素材と場所を編集</button>
      </section>
      <TravelerPreview challengeContent={{ title: draft.title, question: draft.question, hints: draft.hints, requiresBoat, requiresPaidFacility, price, photoNote }} afterClearContent={{ access, hours, promoComment, explanation }} mode={previewMode} onModeChange={setPreviewMode} headingRef={a05HeadingRef} onEdit={() => { setVisitedDraft(true); setStep('A04') }} areaLabel={areaLabel} /></>}
    </div>
    {connection && <section className="form-section" aria-label="下書きの保存">
      {record && <p>下書き版 {record.draftRevision}</p>}
      {saveState.status === 'saved' && <p role="status">下書きを保存しました。</p>}
      {saveState.status === 'error' && <p role="alert">{saveState.message}</p>}
      {inputError && <p role="alert">{inputError}</p>}
      <div className="admin-list-actions">
        <button type="button" disabled={saving || (saveState.status === 'error' && saveState.reload)} onClick={() => {
          saveDraft()
        }}>{saving ? '保存しています…' : '下書きを保存'}</button>
        {connection.onContinue && <>
          <button type="button" disabled={saving || (saveState.status === 'error' && saveState.reload)} onClick={() => saveDraft('areas')}>保存して撮影範囲へ</button>
          {draft.hints.map((hint, index) => hint.trim() && <button key={index} type="button" disabled={saving || (saveState.status === 'error' && saveState.reload)} onClick={() => saveDraft((index + 1) as 1 | 2 | 3)}>保存してヒント {index + 1}の画像へ</button>)}
          <button type="button" disabled={saving || (saveState.status === 'error' && saveState.reload)} onClick={() => saveDraft('publication')}>保存して試験・公開確認へ</button>
        </>}
        <button type="button" disabled={saving} onClick={connection.onBack}>問題一覧へ戻る</button>
      </div>
    </section>}
  </Root>
}
