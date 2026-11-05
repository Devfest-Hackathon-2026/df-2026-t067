import { useEffect, useRef, useState } from 'react'
import './adminDemo.css'
import DraftEditor, { type DraftFields } from './DraftEditor'
import TravelerPreview, { type PreviewMode } from './TravelerPreview'

const maxPhotoBytes = 5 * 1024 * 1024
const allowedTypes = ['image/jpeg', 'image/png', 'image/webp']

type Photo = { file: File; url: string }

export default function AdminDemo() {
  const [name, setName] = useState('')
  const [evidence, setEvidence] = useState('')
  const [requiresBoat, setRequiresBoat] = useState(false)
  const [requiresPaidFacility, setRequiresPaidFacility] = useState(false)
  const [photo, setPhoto] = useState<Photo | null>(null)
  const [photoError, setPhotoError] = useState('')
  const [photoLoadFailed, setPhotoLoadFailed] = useState(false)
  const [access, setAccess] = useState('')
  const [hours, setHours] = useState('')
  const [promoComment, setPromoComment] = useState('')
  const [explanation, setExplanation] = useState('')
  const [price, setPrice] = useState('')
  const [photoNote, setPhotoNote] = useState('')
  const [photoRights, setPhotoRights] = useState('')
  const [showSummary, setShowSummary] = useState(false)
  const [step, setStep] = useState<'A03' | 'A04' | 'A05'>('A03')
  const [previewMode, setPreviewMode] = useState<PreviewMode>('challenge')
  const [draft, setDraft] = useState<DraftFields>({ title: '', question: '', hints: ['', '', ''], verifiedFeatures: '', draftingNotes: '' })
  const [draftEntryError, setDraftEntryError] = useState('')
  const [sampleConfirm, setSampleConfirm] = useState(false)
  const [visitedDraft, setVisitedDraft] = useState(false)
  const [materialChanged, setMaterialChanged] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const a03HeadingRef = useRef<HTMLHeadingElement>(null)
  const a04HeadingRef = useRef<HTMLHeadingElement>(null)
  const a05HeadingRef = useRef<HTMLHeadingElement>(null)
  const draftErrorRef = useRef<HTMLParagraphElement>(null)

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
    if (step === 'A03' && draftEntryError) draftErrorRef.current?.focus()
  }, [draftEntryError, step])

  function markMaterialChange() {
    if (visitedDraft) setMaterialChanged(true)
  }

  function enterDraft() {
    if (!name.trim() || !evidence.trim()) {
      setDraftEntryError('A04へ進む前に、対象名と対象とする根拠を入力してください。')
      setStep('A03')
      return
    }
    setDraftEntryError('')
    setVisitedDraft(true)
    setStep('A04')
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
    if (file.size > maxPhotoBytes) { setPhotoError('デモ上限の5 MBを超えています。小さい画像を選んでください。'); return false }
    try {
      const url = URL.createObjectURL(file)
      setPhotoLoadFailed(false)
      setPhoto({ file, url })
      return true
    } catch {
      setPhotoError('画像プレビューを準備できませんでした。もう一度選んでください。')
      return false
    }
  }

  function enterPreview() {
    setPreviewMode('challenge')
    setStep('A05')
  }

  return <main className="admin-demo">
    <header className="admin-header"><div><span className="eyebrow">自治体向け・操作デモ</span><h1>{step === 'A03' ? '問題の素材と場所を登録' : step === 'A04' ? '問題の下書きを編集' : '旅行者向け表示の確認'}</h1></div><span className="demo-badge">未認証・未接続</span></header>
    <nav className="steps" aria-label="登録手順">
      <button type="button" aria-current={step === 'A03' ? 'step' : undefined} onClick={() => setStep('A03')}><b>A03</b><span>素材・場所登録</span></button><button type="button" aria-current={step === 'A04' ? 'step' : undefined} onClick={enterDraft}><b>A04</b><span>下書き・編集（AI未接続）</span></button><button type="button" aria-current={step === 'A05' ? 'step' : undefined} onClick={enterPreview}><b>A05</b><span>表示プレビュー（未公開）</span></button>
    </nav>
    <p className="demo-notice" role="note">未認証の操作デモです。入力と写真の送信・保存は行いません。再読み込みで入力は消えます。AI・認証・認可・正解判定・公開は未接続です。</p>

    {step === 'A03' ? <form onSubmit={event => { event.preventDefault(); setShowSummary(true) }}>
      <section className="form-section" aria-labelledby="target-heading"><h2 id="target-heading" ref={a03HeadingRef} tabIndex={-1}>A03 素材・場所登録：対象と根拠</h2>
        <label>対象名<input value={name} onChange={event => { setName(event.target.value); markMaterialChange() }} placeholder="例：広場の時計" /></label>
        <label>対象とする根拠<textarea value={evidence} onChange={event => { setEvidence(event.target.value); markMaterialChange() }} rows={3} placeholder="例：自治体が管理する施設で、撮影可能なことを確認" /></label>
        <label className="file-label">参考写真（公開ヒントには自動流用しません）<input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" aria-describedby="photo-help photo-error" onChange={event => { if (choosePhoto(event.target.files?.[0])) markMaterialChange(); event.currentTarget.value = '' }} /></label>
        <p id="photo-help" className="helper">JPEG / PNG / WebP、デモ上限5 MB。参考写真の選択・プレビューのみです。</p>
        {photoError && <p id="photo-error" role="alert" className="field-error">{photoError}</p>}
        {photoLoadFailed && <p role="alert" className="field-error">画像を読み込めませんでした。もう一度選ぶか、画像を削除してください。</p>}
        {photo && <div className="photo-preview"><img src={photo.url} alt={`選択した参考写真：${photo.file.name}`} onError={() => setPhotoLoadFailed(true)} /><div><span>{photo.file.name}</span><button type="button" onClick={() => inputRef.current?.click()}>変更</button><button type="button" onClick={clearPhoto}>削除</button>{photoLoadFailed && <button type="button" onClick={() => inputRef.current?.click()}>再試行</button>}</div></div>}
      </section>
      <section className="form-section" aria-labelledby="area-heading"><h2 id="area-heading">公開する探索エリア</h2>
        <p><strong>架空自治体：青葉みらい市（デモ専用・実在しません）</strong></p>
        <p>公開探索エリア：青葉みらい市の行政区域（デモ用の架空エリア）。自治体の行政区域から自動設定する構想の表示で、実際の地図・区域データには未接続です。</p>
        <div className="private-setting"><strong>非公開の撮影地点・半径</strong><span>未設定・接続待ち</span><small>安全上、このデモでは値や入力欄を表示しません。</small></div>
      </section>
      <section className="form-section" aria-labelledby="conditions-heading"><h2 id="conditions-heading">挑戦前に伝える条件</h2>
        <fieldset><legend>撮影に必要な条件</legend><div className="check-grid"><label className="check-option"><input type="checkbox" checked={requiresBoat} onChange={event => { setRequiresBoat(event.target.checked); markMaterialChange() }} />船上・海上での撮影が必要</label><label className="check-option"><input type="checkbox" checked={requiresPaidFacility} onChange={event => { setRequiresPaidFacility(event.target.checked); markMaterialChange() }} />有料施設内での撮影が必要</label></div><p className="helper">陸から撮影できる場合、船上・海上の条件は選びません。</p></fieldset>
        <label>料金<input value={price} onChange={event => { setPrice(event.target.value); markMaterialChange() }} placeholder="例：入館料が必要" /></label>
        <label>撮影時の注意<textarea value={photoNote} onChange={event => { setPhotoNote(event.target.value); markMaterialChange() }} rows={2} placeholder="撮影できる時間や安全上の制約は、挑戦前にここへ記載" /></label>
      </section>
      <section className="form-section" aria-labelledby="after-clear-heading"><h2 id="after-clear-heading">クリア後の紹介・解説</h2>
        <label>アクセス補足<textarea value={access} onChange={event => { setAccess(event.target.value); markMaterialChange() }} rows={2} placeholder="例：駅から徒歩約10分" /></label>
        <label>利用できる時間<input value={hours} onChange={event => { setHours(event.target.value); markMaterialChange() }} placeholder="例：平日 9:00〜17:00" /></label>
        <label>自治体のアピールコメント<textarea value={promoComment} onChange={event => { setPromoComment(event.target.value); markMaterialChange() }} rows={2} /></label>
        <label>解説<textarea value={explanation} onChange={event => { setExplanation(event.target.value); markMaterialChange() }} rows={3} /></label>
      </section>
      <section className="form-section" aria-labelledby="rights-heading"><h2 id="rights-heading">写真の権利</h2>
        <label>写真の出典と利用権<textarea value={photoRights} onChange={event => { setPhotoRights(event.target.value); markMaterialChange() }} rows={2} placeholder="出典・撮影者・利用許諾など" /></label>
      </section>
      {draftEntryError && <p ref={draftErrorRef} tabIndex={-1} role="alert" className="field-error">{draftEntryError}</p>}
      <button className="submit-button" type="button" onClick={enterDraft}>下書き・編集へ</button>
      <button className="submit-button" type="submit">入力内容を確認（デモ）</button>
      {showSummary && <section aria-labelledby="summary-heading" className="form-section summary"><h2 id="summary-heading">入力内容の確認</h2><p>これは画面内の確認表示です。送信・保存はしていません。</p><dl><dt>架空自治体・探索エリア</dt><dd>青葉みらい市（架空）・青葉みらい市の行政区域（架空）</dd><dt>対象名</dt><dd>{name || '未入力'}</dd><dt>根拠</dt><dd>{evidence || '未入力'}</dd><dt>船上・海上での撮影</dt><dd>{requiresBoat ? '必要' : '未選択'}</dd><dt>有料施設内での撮影</dt><dd>{requiresPaidFacility ? '必要' : '未選択'}</dd><dt>挑戦前の料金</dt><dd>{price || '未入力'}</dd><dt>撮影時の注意</dt><dd>{photoNote || '未入力'}</dd><dt>クリア後のアクセス補足</dt><dd>{access || '未入力'}</dd><dt>クリア後に利用できる時間</dt><dd>{hours || '未入力'}</dd><dt>自治体のアピールコメント</dt><dd>{promoComment || '未入力'}</dd><dt>解説</dt><dd>{explanation || '未入力'}</dd><dt>写真の出典と利用権</dt><dd>{photoRights || '未入力'}</dd><dt>参考写真</dt><dd>{photo?.file.name || '未選択'}</dd><dt>非公開の撮影地点・半径</dt><dd>未設定・接続待ち</dd></dl></section>}
    </form> : step === 'A04' ? <DraftEditor draft={draft} setDraft={setDraft} materialChanged={materialChanged} sampleConfirm={sampleConfirm} setSampleConfirm={setSampleConfirm} onBack={() => setStep('A03')} onPreview={enterPreview} headingRef={a04HeadingRef} /> : <TravelerPreview challengeContent={{ title: draft.title, question: draft.question, hints: draft.hints, requiresBoat, requiresPaidFacility, price, photoNote }} afterClearContent={{ access, hours, promoComment, explanation }} mode={previewMode} onModeChange={setPreviewMode} headingRef={a05HeadingRef} onEdit={enterDraft} />}
  </main>
}
