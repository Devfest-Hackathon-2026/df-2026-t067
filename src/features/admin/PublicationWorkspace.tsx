import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { ApiError, parsePublishManagedQuest } from '../../shared/api'
import type { ApiClient, ManagedQuest, OrgMembership, PhotoDecision, PublishManagedQuest, ReviewField } from '../../shared/api'
import { useRequestAction } from '../../shared/useRequestAction'

const reviewLabels: Record<ReviewField, string> = {
  'materials.name': '対象名', 'materials.evidence': '対象とする根拠', 'materials.photoRights': '写真の利用権',
  referenceAssetId: '参考写真', hintAssetId: '公開ヒント画像の用途', shootingAreas: '非公開の撮影範囲',
  'content.title': '問題タイトル', 'content.question': '問題文', 'content.hints': '3本のヒント',
  'content.verifiedFeatures': '確認済み特徴',
}
type Confirmation = keyof PublishManagedQuest['confirmations']
const confirmationLabels: ReadonlyArray<readonly [Confirmation, string]> = [
  ['fictionalData', '架空の素材と情報だけを使った'],
  ['visitConditions', '訪問条件と撮影時の注意を確認した'],
  ['photoRights', '写真の権利と公開する画像を確認した'],
  ['shootingArea', '非公開の撮影範囲を確認した'],
  ['testCases', '一致と別対象の試験を確認した'],
]
type Failure = { message: string; stale?: true }
type TestProofs = Partial<Record<'MATCH' | 'WRONG_TARGET', string>>

function publicationFailure(cause: unknown): Failure {
  const code = cause instanceof ApiError ? cause.code : undefined
  switch (code) {
    case 'DRAFT_CONFLICT': return { message: '下書きの版が変わりました。一覧から最新版を確認してください。', stale: true }
    case 'FORBIDDEN': return { message: '自組織の操作権限を確認できません。', stale: true }
    case 'PHOTO_TEST_REQUIRED': return { message: 'この版で異なる写真を使って一致・別対象の試験を確認してください。' }
    case 'REVIEW_REQUIRED': return { message: 'この版の確認依頼と確認項目を見直してください。' }
    case 'INVALID_INPUT': return { message: '試験写真・利用権と保存済みの参考素材を確認してください。' }
    case 'RATE_LIMITED': return { message: '試験の受付上限に達しました。時間をおいて再試行してください。' }
    case 'SYSTEM_ERROR': return { message: '開発用APIの設定と通信状況を確認してください。' }
    default: return { message: '結果を確認できませんでした。通信状況を確認して再試行してください。' }
  }
}

export function PublicationWorkspace({ api, initial, member, onBack, onPublished }: {
  api: ApiClient; initial: ManagedQuest; member: OrgMembership; onBack: () => void; onPublished: () => void
}) {
  const [quest, setQuest] = useState(initial)
  const [photo, setPhoto] = useState<File | null>(null)
  const [rights, setRights] = useState('')
  const key = useRef<string | null>(null)
  const [outcome, setOutcome] = useState<PhotoDecision | null>(null)
  const [proofs, setProofs] = useState<TestProofs>({})
  const [missing, setMissing] = useState<ReviewField[]>([])
  const [checked, setChecked] = useState<Confirmation[]>([])
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<Failure | null>(null)
  const begin = useRequestAction()
  const { orgId, questId, draftRevision } = quest
  const disabled = busy || !!failure?.stale
  const photoValid = photo !== null && photo.size > 0 && photo.size <= 4 * 1024 * 1024 &&
    ['image/jpeg', 'image/png', 'image/webp'].includes(photo.type)
  const reviewed = quest.status === 'review_pending' && !!proofs.MATCH && !!proofs.WRONG_TARGET
  const ready = reviewed && confirmationLabels.every(([item]) => checked.includes(item))

  async function perform<T>(work: (signal: AbortSignal) => Promise<T>, receive: (value: T) => void) {
    if (failure?.stale) return
    const operation = begin(() => {
      setFailure({ message: '操作の確認に時間がかかっています。通信状況を確認してください。' })
      setBusy(false)
    })
    if (!operation) return
    setBusy(true)
    setFailure(null)
    try {
      const result = await work(operation.signal)
      if (operation.isCurrent()) receive(result)
    } catch (cause) {
      if (operation.isCurrent()) setFailure(publicationFailure(cause))
    } finally {
      if (operation.isCurrent()) setBusy(false)
      operation.finish()
    }
  }

  function trial(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!photoValid || !rights.trim()) return
    void perform((signal) => api.testManagedQuest(orgId, questId, {
      expectedDraftRevision: draftRevision, photo, photoRights: rights,
      idempotencyKey: key.current ??= crypto.randomUUID(),
    }, { signal }), (result) => {
      if (result.source !== 'mock') throw new ApiError('INVALID_RESPONSE')
      setOutcome(result.outcome)
      setChecked([])
      if (result.outcome !== 'IMAGE_UNCERTAIN') {
        setProofs((current) => ({ ...current, [result.outcome]: result.testId }))
      }
    })
  }

  function review() {
    void perform((signal) => api.submitManagedQuestReview(orgId, questId, draftRevision, { signal }), (result) => {
      setQuest(result.quest)
      setMissing(result.missing)
      setChecked([])
    })
  }

  function publish() {
    if (!ready || member.role !== 'publisher') return
    void perform((signal) => api.publishManagedQuest(orgId, questId, parsePublishManagedQuest({
      expectedDraftRevision: draftRevision, matchTestId: proofs.MATCH, mismatchTestId: proofs.WRONG_TARGET,
      confirmations: Object.fromEntries(checked.map((item) => [item, true])),
    }), { signal }), onPublished)
  }

  return <section className="form-section" aria-labelledby="publication-workspace-title">
    <h2 id="publication-workspace-title">開発用の写真試験と公開確認</h2>
    <p>{quest.draft.content.title || '無題の下書き'}・下書き版 {draftRevision}</p>
    <p>合成写真を使います。同じ画面で試験と確認を終えてください。</p>
    <button type="button" onClick={onBack}>問題一覧へ戻る</button>
    {failure && <p role="alert">{failure.message}</p>}
    {busy && <p role="status">操作結果を確認しています…</p>}
    <form onSubmit={trial}>
      <fieldset disabled={disabled}>
        <legend>A05 写真試験</legend>
        <label>試験写真<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => {
          setPhoto(event.target.files?.[0] ?? null); key.current = null; setOutcome(null)
        }} /></label>
        <label>試験写真の利用権<input maxLength={2000} value={rights} onChange={(event) => {
          setRights(event.target.value); key.current = null; setOutcome(null)
        }} /></label>
        {photo && !photoValid && <p>4 MiB以内のJPEG・PNG・WebPを選んでください。</p>}
        <button type="submit" disabled={!photoValid || !rights.trim()}>写真試験を送信</button>
      </fieldset>
    </form>
    {proofs.MATCH && <p role="status">一致試験を確認しました。</p>}
    {proofs.WRONG_TARGET && <p role="status">別対象の試験を確認しました。</p>}
    {outcome === 'IMAGE_UNCERTAIN' && <p role="status">試験写真を確認できませんでした。別の合成写真でお試しください。</p>}
    <fieldset disabled={disabled}>
      <legend>A06 確認依頼</legend>
      <button type="button" onClick={review}>この版の確認を依頼</button>
      {quest.status === 'review_pending' && <p role="status">この下書きは確認待ちです。</p>}
      {missing.length > 0 && <><p>次の項目を確認してください。</p><ul>{missing.map((item) => <li key={item}>{reviewLabels[item]}</li>)}</ul></>}
    </fieldset>
    {member.role === 'publisher' && <fieldset disabled={disabled || !reviewed}>
      <legend>公開担当者の確認</legend>
      {confirmationLabels.map(([item, label]) => <label key={item} className="check-option">
        <input type="checkbox" checked={checked.includes(item)} onChange={(event) => {
          setChecked(event.target.checked ? [...checked, item] : checked.filter((value) => value !== item))
        }} />{label}
      </label>)}
      <button type="button" disabled={!ready} onClick={publish}>この版を開発用に公開</button>
    </fieldset>}
  </section>
}
