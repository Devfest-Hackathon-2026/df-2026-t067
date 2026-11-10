import { PHOTO_UPLOAD_MAX_BYTES, PHOTO_UPLOAD_MIME_TYPES, PHOTO_UPLOAD_ACCEPT } from '../../shared/mediaLimits'
import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { ApiError, parsePublishManagedQuest } from '../../shared/api'
import type { ApiClient, ManagedQuest, PhotoDecision, PublishManagedQuest, ReviewField, ReviewSubmission } from '../../shared/api'
import { PhotoRightsInput } from './PhotoRightsInput'
import { fixturePngUrl, matchFixturePngBase64, otherFixturePngBase64 } from './photoTestFixtures'
import { useRequestAction } from '../../shared/useRequestAction'

import { reviewLabels } from './publicationReadiness'

type Confirmation = keyof NonNullable<PublishManagedQuest['confirmations']>
const confirmationLabels: ReadonlyArray<readonly [Confirmation, string]> = [
  ['fictionalData', '素材・情報を確認'],
  ['visitConditions', '訪問・撮影条件を確認'],
  ['photoRights', '権利・公開画像を確認'],
  ['shootingArea', '撮影範囲を確認'],
  ['testCases', '試験結果を確認'],
]
type Failure = { message: string; stale?: true }
type TrialKind = 'MATCH' | 'WRONG_TARGET'
type TestProofs = Partial<Record<TrialKind, string>>
type TrialFeedback = { kind: 'pending' | 'success' | 'error'; message: string }

function publicationFailure(cause: unknown, realPhotoTest: boolean): Failure {
  const code = cause instanceof ApiError ? cause.code : undefined
  switch (code) {
    case 'DRAFT_CONFLICT': return { message: '下書きに変更・一覧を再読込', stale: true }
    case 'FORBIDDEN': return { message: '組織の権限を確認', stale: true }
    case 'PHOTO_APPROVAL_REQUIRED': return { message: '素材未承認・承認依頼・写真を選び直す' }
    case 'NETWORK_ERROR': return { message: '通信失敗・同じ写真で再送' }
    case 'PHOTO_TEST_REQUIRED': return { message: '正解写真・別対象を再テスト' }
    case 'REVIEW_REQUIRED': return { message: '公開失敗・入力と写真を確認' }
    case 'INVALID_INPUT': return { message: '写真の形式・正解写真を確認' }
    case 'RATE_LIMITED': return { message: '受付上限・時間をおいて再試行' }
    case 'SYSTEM_ERROR': return realPhotoTest
      ? { message: 'テスト失敗・時間をおいて再試行' }
      : { message: 'テスト失敗・合成写真限定' }
    default: return { message: '結果未確認・通信を確認・再試行' }
  }
}

function PhotoTrial({ expected, disabled, feedback, onTest, onSelection }:   {
  expected: TrialKind; disabled: boolean; feedback?: TrialFeedback; onSelection: (kind: TrialKind) => void
  onTest: (file: File, key: string, expected: TrialKind) => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const key = useRef<string | null>(null)
  const label = expected === 'MATCH' ? '正解写真で試す' : '別の写真で試す'
  const valid = file && file.size > 0 && file.size <= PHOTO_UPLOAD_MAX_BYTES && PHOTO_UPLOAD_MIME_TYPES.includes(file.type)
  return <form onSubmit={(event) => {
    event.preventDefault()
    if (valid && !disabled) onTest(file, key.current ??= crypto.randomUUID(), expected)
  }}>
    <fieldset disabled={disabled}>
      <legend>{label}</legend>
      <label className="photo-picker">{label}<span className="photo-picker-button" aria-hidden="true">写真を選ぶ</span><input aria-label={label} type="file" accept={PHOTO_UPLOAD_ACCEPT} onChange={(event) => {
        setFile(event.target.files?.[0] ?? null)
        key.current = null
        onSelection(expected)
      }} /></label>
      {file && <p>{file.name}</p>}
      {file && !valid && <p>JPEG・PNG・WebP／4MiB以下</p>}
      <button type="submit" disabled={!valid}>{label}</button>
      {feedback && <p role={feedback.kind === 'error' ? 'alert' : 'status'}>{feedback.message}</p>}
    </fieldset>
  </form>
}

export function PublicationWorkspace({ api, initial, onBack, onPublished, rightsAssist = false, backLabel = '謎一覧へ', photoTestSource = 'mock', areaUnclassified = false, approvedAssets = false, onFix, onBusy, onTrialConfirmed, readiness, readinessFailed, onReadinessRetry, embedded = false, blocked = false }: {
  embedded?: boolean; blocked?: boolean; api: ApiClient; initial: ManagedQuest; rightsAssist?: boolean; backLabel?: string; photoTestSource?: 'mock' | 'real'; areaUnclassified?: boolean; approvedAssets?: boolean; onFix?: (field: ReviewField) => void; onBusy?: (busy: boolean) => void; onTrialConfirmed?: () => void;
  readiness?: ReviewSubmission; readinessFailed?: boolean; onReadinessRetry?: () => void; onBack: () => void; onPublished: () => void
}) {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const publishTrigger = useRef<HTMLButtonElement>(null)
  const cancelButton = useRef<HTMLButtonElement>(null)
  useEffect(() => { if (confirmOpen) cancelButton.current?.focus() }, [confirmOpen])
  function closeConfirm() { setConfirmOpen(false); publishTrigger.current?.focus() }
  const [quest, setQuest] = useState(initial)
  const [photo, setPhoto] = useState<File | null>(null)
  const [rights, setRights] = useState('')
  const [reuseNeeded, setReuseNeeded] = useState(false)
  const previousPhoto = useRef<File | null>(null)
  const key = useRef<string | null>(null)
  const [outcome, setOutcome] = useState<PhotoDecision | null>(null)
  const [proofs, setProofs] = useState<TestProofs>({})
  const [trialFeedback, setTrialFeedback] = useState<Partial<Record<TrialKind, TrialFeedback>>>({})
  const [reviewMissing, setMissing] = useState<ReviewField[]>([])
  const [checked, setChecked] = useState<Confirmation[]>([])
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<Failure | null>(null)
  const begin = useRequestAction()
  const { orgId, questId, draftRevision } = quest
  const disabled = blocked || busy || !!failure?.stale
  const photoValid = photo !== null && photo.size > 0 && photo.size <= PHOTO_UPLOAD_MAX_BYTES &&
    PHOTO_UPLOAD_MIME_TYPES.includes(photo.type)
  const missing = approvedAssets ? readiness?.missing ?? [] : reviewMissing
  const checkReason = areaUnclassified ? '地域未設定・公開不可'
    : approvedAssets && !readiness ? readinessFailed ? '保存状態の取得失敗' : '保存状態の読込中'
    : missing.length ? '不足項目を入力'
    : !approvedAssets && quest.status !== 'review_pending' ? '公開条件を確認'
    : !proofs.MATCH || !proofs.WRONG_TARGET ? '正解写真・別対象をテスト'
    : ''
  const trialDisabled = disabled || missing.length > 0 || (approvedAssets && !readiness)
  const reviewed = !checkReason
  const ready = reviewed && (approvedAssets || confirmationLabels.every(([item]) => checked.includes(item)))
  const realPhotoTest = photoTestSource === 'real'

  async function perform<T>(work: (signal: AbortSignal) => Promise<T>, receive: (value: T) => void,
    report?: (result: TrialFeedback) => void) {
    if (failure?.stale) return
    const operation = begin(() => {
      const message = '通信待機中断・同じ写真で再送'
      if (report) report({ kind: 'error', message })
      else setFailure({ message })
      setBusy(false)
      onBusy?.(false)
    })
    if (!operation) return
    setBusy(true)
    onBusy?.(true)
    setFailure(null)
    report?.({ kind: 'pending', message: '判定中' })
    try {
      const result = await work(operation.signal)
      if (operation.isCurrent()) receive(result)
    } catch (cause) {
      if (operation.isCurrent()) {
        const failure = publicationFailure(cause, realPhotoTest)
        if (report) report({ kind: 'error', message: failure.message })
        if (!report || failure.stale) setFailure(failure)
        if (cause instanceof ApiError && ['PHOTO_APPROVAL_REQUIRED', 'REVIEW_REQUIRED', 'DRAFT_CONFLICT'].includes(cause.code)) onReadinessRetry?.()
      }
    } finally {
      if (operation.isCurrent()) { setBusy(false); onBusy?.(false) }
      operation.finish()
    }
  }

  function trial(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (trialDisabled || !photoValid || !rights.trim() || reuseNeeded) return
    sendTrial(photo!, key.current ??= crypto.randomUUID())
  }

  function resetTrial(kind: TrialKind) {
    setTrialFeedback((current) => ({ ...current, [kind]: undefined }))
    setProofs((current) => ({ ...current, [kind]: undefined }))
    setChecked([])
  }

  function sendTrial(file: File, idempotencyKey: string, expected?: TrialKind) {
    if (trialDisabled) return
    const report = expected && ((feedback: TrialFeedback) => {
      setTrialFeedback((current) => ({ ...current, [expected]: feedback }))
      if (feedback.kind === 'pending') setProofs((current) => ({ ...current, [expected]: undefined }))
    })
    void perform((signal) => api.testManagedQuest(orgId, questId, {
      expectedDraftRevision: draftRevision, photo: file, ...(approvedAssets ? {} : { photoRights: rights }), idempotencyKey,
    }, { signal }), (result) => {
      if (result.source !== photoTestSource) throw new ApiError('INVALID_RESPONSE')
      setOutcome(result.outcome)
      setChecked([])
      if (expected && result.outcome !== expected) {
        const message = result.outcome === 'IMAGE_UNCERTAIN' ? '判定不能・鮮明な写真で再テスト'
          : '判定の相違・特徴と写真を確認'
        report?.({ kind: 'error', message })
        return
      }
      if (result.outcome !== 'IMAGE_UNCERTAIN') {
        setProofs((current) => ({ ...current, [result.outcome]: result.testId }))
        onTrialConfirmed?.()
        report?.({ kind: 'success', message: result.outcome === 'MATCH' ? '正解' : '別対象' })
      }
    }, report)
  }

  function review() {
    void perform((signal) => api.submitManagedQuestReview(orgId, questId, draftRevision, { signal }), (result) => {
      setQuest(result.quest)
      setMissing(result.missing)
      setChecked([])
      onReadinessRetry?.()
    })
  }

  function publish() {
    if (!ready || areaUnclassified) return
    void perform(async (signal) => {
      if (approvedAssets && readiness?.quest.status !== 'review_pending' && readiness?.quest.status !== 'published') {
        const result = await api.submitManagedQuestReview(orgId, questId, draftRevision, { signal })
        if (result.missing.length) throw new ApiError('REVIEW_REQUIRED')
      }
      return api.publishManagedQuest(orgId, questId, parsePublishManagedQuest({
        expectedDraftRevision: draftRevision, matchTestId: proofs.MATCH, mismatchTestId: proofs.WRONG_TARGET,
        ...(approvedAssets ? {} : { confirmations: Object.fromEntries(checked.map((item) => [item, true])) }),
      }, approvedAssets), { signal })
    }, onPublished)
  }

  return <section className="form-section" aria-labelledby="publication-workspace-title">
    <h2 id="publication-workspace-title" className={embedded ? "sr-only" : undefined}>試験・公開</h2>
    {!embedded && <button type="button" onClick={onBack}>{backLabel}</button>}
    {areaUnclassified && <p role="alert">地域未設定・公開不可</p>}
    {failure && <p role="alert">{failure.message}</p>}
    {busy && <p role="status">確認中</p>}
    {!approvedAssets && <fieldset disabled={disabled}>
      <legend>公開条件の確認</legend>
      <button type="button" onClick={review}>公開条件を確認</button>
      {quest.status === 'review_pending' && <p role="status">確認待ち</p>}
    </fieldset>}
    {missing.length > 0 && <div><p>不足項目</p><ul>{missing.map(item => <li key={item}>{onFix ? <button type="button" onClick={() => onFix(item)}>{reviewLabels[item]}の入力へ</button> : reviewLabels[item]}</li>)}</ul></div>}
    {approvedAssets ? <>
      {!realPhotoTest && <p>合成写真限定<br /><a href={fixturePngUrl(matchFixturePngBase64)} download="match.png">一致用の合成写真</a> ・ <a href={fixturePngUrl(otherFixturePngBase64)} download="other-target.png">別対象の合成写真</a></p>}
      <PhotoTrial expected="MATCH" disabled={trialDisabled} feedback={trialFeedback.MATCH} onTest={sendTrial} onSelection={resetTrial} />
      <PhotoTrial expected="WRONG_TARGET" disabled={trialDisabled} feedback={trialFeedback.WRONG_TARGET} onTest={sendTrial} onSelection={resetTrial} />
    </> : <form onSubmit={trial}>
      <fieldset disabled={trialDisabled}>
        <legend>写真試験</legend>
        {realPhotoTest
          ? <p>実写真照合・送信枠を共用</p>
          : <><p>合成写真限定・実写真未対応</p>
            <ul>
              <li><a href={fixturePngUrl(matchFixturePngBase64)} download="match.png">一致用の合成写真をダウンロード</a></li>
              <li><a href={fixturePngUrl(otherFixturePngBase64)} download="other-target.png">別対象の合成写真をダウンロード</a></li>
            </ul></>}
        <label className="photo-picker">試験写真<span className="photo-picker-button" aria-hidden="true">写真を選ぶ</span><input aria-label="試験写真" type="file" accept={PHOTO_UPLOAD_ACCEPT} onChange={(event) => {
          const next = event.target.files?.[0] ?? null
          if (rightsAssist && next && previousPhoto.current && rights.trim()) setReuseNeeded(true)
          if (next) previousPhoto.current = next
          setPhoto(next); key.current = null; setOutcome(null)
        }} /></label>
        {rightsAssist ? <PhotoRightsInput key={photo ? `${photo.name}:${photo.lastModified}` : 'empty'} purpose="test" label="利用権" value={rights} onChange={(value) => {
          setRights(value); setReuseNeeded(false); key.current = null; setOutcome(null)
        }} /> : <label>利用権<textarea value={rights} onChange={event => { setRights(event.target.value); key.current = null; setOutcome(null) }} /></label>}
        {reuseNeeded && <label><input type="checkbox" checked={false} onChange={() => setReuseNeeded(false)} />差し替え写真の利用権を確認</label>}
        {photo && <p>{photo.name}</p>}
        {photo && !photoValid && <p>JPEG・PNG・WebP／4MiB以下</p>}
        <button type="submit" disabled={!photoValid || !rights.trim() || reuseNeeded}>写真試験を送信</button>
      </fieldset>
    </form>}
    {!approvedAssets && proofs.MATCH && <p role="status">正解</p>}
    {!approvedAssets && proofs.WRONG_TARGET && <p role="status">別対象</p>}
    {!approvedAssets && outcome === 'IMAGE_UNCERTAIN' && <p role="status">{realPhotoTest ? '写真確認不能・鮮明な写真を選択' : '写真確認不能・別の合成写真を選択'}</p>}
    <fieldset disabled={disabled}>
      <legend>{approvedAssets ? '公開' : '公開前のチェック'}</legend>
      {checkReason && <p>{checkReason}</p>}
      {approvedAssets && readinessFailed && <button type="button" onClick={onReadinessRetry}>保存状態を読み直す</button>}
      {!approvedAssets && confirmationLabels.map(([item, label]) => <label key={item} className="check-option">
        <input type="checkbox" disabled={!reviewed} checked={checked.includes(item)} onChange={(event) => {
          setChecked(event.target.checked ? [...checked, item] : checked.filter((value) => value !== item))
        }} />{label}
      </label>)}
      <button className={confirmOpen ? undefined : 'workflow-primary'} type="button" disabled={!ready || areaUnclassified} ref={publishTrigger} onClick={() => setConfirmOpen(true)}>{initial.status === 'published' ? '修正を公開' : initial.status === 'paused' ? '公開を再開' : '公開'}</button>
    </fieldset>
    {confirmOpen && <div role="dialog" aria-label="公開の確認" className="publication-confirm">
      <p>問題・ヒントを公開</p>
      <div className="admin-list-actions"><button type="button" ref={cancelButton} onClick={closeConfirm}>やめる</button>
      <button type="button" className="workflow-primary" onClick={() => { closeConfirm(); publish() }}>公開</button></div>
    </div>}
  </section>
}
