import type { Dispatch, RefObject, SetStateAction } from 'react'

export type DraftFields = {
  title: string
  question: string
  hints: [string, string, string]
  verifiedFeatures: string
  draftingNotes: string
}

type Props = {
  draft: DraftFields
  setDraft: Dispatch<SetStateAction<DraftFields>>
  materialChanged: boolean
  sampleConfirm: boolean
  setSampleConfirm: (value: boolean) => void
  onBack: () => void
  onPreview: () => void
  headingRef: RefObject<HTMLHeadingElement | null>
}

const sample: DraftFields = {
  title: '青葉みらい市の風見の丘',
  question: '青葉みらい市の架空の丘にある、小さな風車が並ぶ場所を探してください。',
  hints: ['市の中心部から見える、緑の丘を目指しましょう。', '丘の上には風を受けて回るものが並んでいます。', '風車が並ぶ場所が目的地です。'],
  verifiedFeatures: '丘の上に小型風車が並ぶ（このサンプル内の架空設定）',
  draftingNotes: '架空サンプルの例文。現地確認や事実確認を行った内容ではありません。',
}

export default function DraftEditor({ draft, setDraft, materialChanged, sampleConfirm, setSampleConfirm, onBack, onPreview, headingRef }: Props) {
  const edited = Object.values(draft).some(value => Array.isArray(value) ? value.some(item => item !== '') : value !== '')
  function loadSample() {
    setDraft(sample)
    setSampleConfirm(false)
  }

  return <section className="form-section draft-editor" aria-labelledby="draft-heading">
    <h2 id="draft-heading" ref={headingRef} tabIndex={-1}>A04 下書き・編集（AI未接続）</h2>
    <p className="demo-notice" role="note">この画面は手入力用の下書きデモです。AI生成・保存・公開は行いません。根拠・対象名・写真情報は公開用文章へ自動挿入しません。</p>
    {materialChanged && <p className="field-error" role="status">素材が変更されています。下書きを確認してください。</p>}
    <p className="helper">部分ヒント写真：未設定・参考写真から自動流用しません。</p>
    <div className="sample-actions">
      <button type="button" onClick={() => edited ? setSampleConfirm(true) : loadSample()}>架空サンプルを読み込む（AI未使用）</button>
      {sampleConfirm && <div className="confirm-inline" role="group" aria-label="サンプル置換の確認"><p>現在の下書きを架空サンプルで置き換えますか？</p><button type="button" onClick={() => setSampleConfirm(false)}>キャンセル</button><button type="button" onClick={loadSample}>置き換える</button></div>}
    </div>
    <label>問題タイトル<input value={draft.title} onChange={event => setDraft(current => ({ ...current, title: event.target.value }))} /></label>
    <label>問題文<textarea rows={4} value={draft.question} onChange={event => setDraft(current => ({ ...current, question: event.target.value }))} /></label>
    <fieldset><legend>段階ヒント（3段階）</legend>{draft.hints.map((hint, index) => <label key={index}>ヒント {index + 1}<textarea rows={2} value={hint} onChange={event => setDraft(current => ({ ...current, hints: current.hints.map((item, itemIndex) => itemIndex === index ? event.target.value : item) as DraftFields['hints'] }))} /></label>)}</fieldset>
    <label>確認済み特徴<textarea rows={3} value={draft.verifiedFeatures} onChange={event => setDraft(current => ({ ...current, verifiedFeatures: event.target.value }))} /></label>
    <label>下書きの根拠・人のメモ<textarea rows={3} value={draft.draftingNotes} onChange={event => setDraft(current => ({ ...current, draftingNotes: event.target.value }))} /></label>
    <p className="helper">入力内容はこの画面の一時状態だけに保持します。AI、通信、保存、公開には接続していません。</p>
    <button className="submit-button" type="button" onClick={onPreview}>表示プレビューへ</button>
    <button type="button" onClick={onBack}>素材・場所へ戻る</button>
  </section>
}
