import { useState } from 'react'
import type { Dispatch, RefObject, SetStateAction } from 'react'
import type { ManagedQuestDraft } from '../../shared/api'

export type DraftFields = ManagedQuestDraft['content']

type Props = {
  draft: DraftFields
  setDraft: Dispatch<SetStateAction<DraftFields>>
  materialChanged: boolean
  sampleConfirm: boolean
  setSampleConfirm: (value: boolean) => void
  onBack: () => void
  onPreview: () => void
  workflow?: boolean
  requiredErrors?: boolean
  featuresInvalid?: boolean
  omitMemo?: boolean
  allowSample?: boolean
  headingRef: RefObject<HTMLHeadingElement | null>
}

const sample: DraftFields = {
  title: '青葉みらい市の風見の丘',
  question: '青葉みらい市の架空の丘にある、小さな風車が並ぶ場所を探してください。',
  hints: ['市の中心部から見える、緑の丘を目指しましょう。', '丘の上には風を受けて回るものが並んでいます。', '風車が並ぶ場所が目的地です。'],
  verifiedFeatures: '丘の上に小型風車が並ぶ',
  draftingNotes: '',
}

export default function DraftEditor({ draft, setDraft, materialChanged, sampleConfirm, setSampleConfirm, onBack, onPreview, headingRef, workflow = false, requiredErrors = false, featuresInvalid = false, omitMemo = false, allowSample = true }: Props) {
  const edited = Object.values(draft).some(value => Array.isArray(value) ? value.some(item => item !== '') : value !== '')
  const filledHints = draft.hints.filter(hint => hint.trim()).length
  const [revealedHints, setRevealedHints] = useState(1)
  const visibleHints = workflow ? 3 : Math.max(revealedHints, Math.min(3, filledHints + 1))
  const [featureLine, setFeatureLine] = useState('')
  function loadSample() {
    setDraft(omitMemo ? { ...sample, draftingNotes: draft.draftingNotes } : sample)
    setSampleConfirm(false)
  }
  function addFeatureLine() {
    const line = featureLine.trim()
    if (!line) return
    setDraft(current => ({ ...current, verifiedFeatures: current.verifiedFeatures.trim() ? `${current.verifiedFeatures.replace(/\s+$/, '')}\n${line}` : line }))
    setFeatureLine('')
  }

  return <section className="form-section draft-editor" aria-labelledby="draft-heading">
    <h2 id="draft-heading" ref={headingRef} tabIndex={-1} >{workflow ? '問題とヒント' : '文章編集'}</h2>
    {!workflow && <p className="demo-notice" role="note">非公開素材</p>}
    {materialChanged && <p className="field-error" role="status">素材が変更されています。下書きを確認してください。</p>}
    {allowSample && <div className="sample-actions">
      <button type="button" onClick={() => edited ? setSampleConfirm(true) : loadSample()}>サンプル</button>
      {sampleConfirm && <div className="confirm-inline" role="group" aria-label="サンプル置換の確認"><p>現在の下書きをサンプルで置き換えますか？</p><button type="button" onClick={() => setSampleConfirm(false)}>キャンセル</button><button type="button" onClick={loadSample}>置き換える</button></div>}
    </div>}
    <label>タイトル<input aria-label="タイトル" placeholder="例：丘の上で回るものは？" id="workflow-title" aria-describedby={requiredErrors && !draft.title.trim() ? "title-error" : undefined} aria-required={workflow} aria-invalid={requiredErrors && !draft.title.trim()} value={draft.title} onChange={event => setDraft(current => ({ ...current, title: event.target.value }))} /></label>
    {requiredErrors && !draft.title.trim() && <p id="title-error" className="field-error">タイトルを入力してください。</p>}
    <label>問題文<textarea aria-label="問題文" placeholder="例：町を見渡す丘に、風を受けて回るものが並んでいます。" id="workflow-question" aria-describedby={requiredErrors && !draft.question.trim() ? "question-error" : undefined} aria-required={workflow} aria-invalid={requiredErrors && !draft.question.trim()} rows={4} value={draft.question} onChange={event => setDraft(current => ({ ...current, question: event.target.value }))} /></label>
    {requiredErrors && !draft.question.trim() && <p id="question-error" className="field-error">問題文を入力してください。</p>}
    <fieldset><legend id="workflow-hints" tabIndex={-1}>ヒント</legend>
      {draft.hints.slice(0, visibleHints).map((hint, index) => <label key={index}>ヒント {index + 1}<textarea aria-label={`ヒント ${index + 1}`} placeholder={['例：大まかな地域', '例：近くの目印', '例：ほぼ答え'][index]} id={'workflow-hint-' + index} aria-describedby={requiredErrors && !hint.trim() ? 'hint-error-' + index : undefined} aria-required={workflow} aria-invalid={requiredErrors && !hint.trim()} rows={2} value={hint} onChange={event => setDraft(current => ({ ...current, hints: current.hints.map((item, itemIndex) => itemIndex === index ? event.target.value : item) as DraftFields['hints'] }))} />{requiredErrors && !hint.trim() && <span id={'hint-error-' + index} className="field-error">ヒントを入力してください。</span>}</label>)}

      {visibleHints < 3 && <button type="button" onClick={() => setRevealedHints(visibleHints + 1)}>次のヒントを書く</button>}
    </fieldset>
    <h3>非公開</h3>
    <label>特徴<textarea aria-label="特徴" placeholder={"写真で見える色・形・文字を1行に1つ\n例：赤い三角屋根\n例：白い文字盤の時計が柱の上にある"} id="workflow-features" aria-describedby={requiredErrors && featuresInvalid ? "features-error" : undefined} aria-required={workflow} aria-invalid={requiredErrors && featuresInvalid} rows={3} value={draft.verifiedFeatures} onChange={event => setDraft(current => ({ ...current, verifiedFeatures: event.target.value }))} /></label>
    {requiredErrors && featuresInvalid && <p id="features-error" className="field-error">特徴を1〜20行で、1行300文字以内で入力してください。</p>}
    <div className="feature-line-builder">
      <label>特徴を1行で追加<input value={featureLine} onChange={event => setFeatureLine(event.target.value)} placeholder="例：赤い三角屋根がある" /></label>
      <button type="button" disabled={!featureLine.trim()} onClick={addFeatureLine}>特徴を追加</button>
    </div>
    {!omitMemo && <label>下書きの根拠・人のメモ<textarea id="workflow-notes" rows={3} value={draft.draftingNotes} onChange={event => setDraft(current => ({ ...current, draftingNotes: event.target.value }))} /></label>}
    {!workflow && <button className="submit-button" type="button" onClick={onPreview}>表示プレビューへ</button>}
    {!workflow && <button type="button" onClick={onBack}>素材へ</button>}
  </section>
}
