import { useState, type RefObject } from 'react'
import ClearExplanationPreview, { type ClearExplanationContent } from './ClearExplanationPreview'
import type { ManagedQuestDraft, ShootingConditions } from '../../shared/api/admin'
import { ShootingConditionIndicators } from '../../components/ShootingConditionIndicators'

export type PreviewMode = 'challenge' | 'after-clear'

export type ChallengePreviewContent = Pick<ManagedQuestDraft['content'], 'title' | 'question' | 'hints'> &
  ShootingConditions & Pick<ManagedQuestDraft['materials'], 'price' | 'photoNote'>

type Props = {
  challengeContent: ChallengePreviewContent
  afterClearContent: ClearExplanationContent
  mode: PreviewMode
  onModeChange: (mode: PreviewMode) => void
  headingRef: RefObject<HTMLHeadingElement | null>
  onEdit: () => void
}

function shown(value: string) {
  return value.trim() || '未入力'
}

function ChallengePreview({ content }: { content: ChallengePreviewContent }) {
  const [openHints, setOpenHints] = useState([false, false, false])

  return <article className="traveler-card" id="challenge-preview">
    <header className="challenge-title-row">
      <h3>{shown(content.title)}</h3>
      <ShootingConditionIndicators conditions={content} />
    </header>
    <p>{shown(content.question)}</p>
    <section aria-labelledby="preview-area-heading"><h4 id="preview-area-heading">公開探索エリア</h4><p>青葉みらい市の行政区域（デモ用の架空エリア）</p></section>
    <section aria-labelledby="preview-conditions-heading"><h4 id="preview-conditions-heading">挑戦前の条件</h4>
      <dl><dt>料金</dt><dd>{shown(content.price)}</dd><dt>撮影時の注意</dt><dd>{shown(content.photoNote)}</dd></dl>
    </section>
    <section aria-labelledby="preview-hints-heading"><h4 id="preview-hints-heading">ヒント</h4>
      {content.hints.map((hint, index) => (
        <div className="preview-hint" key={index}>
          <button type="button" aria-expanded={openHints[index]} aria-controls={`preview-hint-${index}`} onClick={() => setOpenHints(current => current.map((open, itemIndex) => itemIndex === index ? !open : open))}>ヒント {index + 1}を見る</button>
          <p id={`preview-hint-${index}`} hidden={!openHints[index]}>{shown(hint)}</p>
        </div>
      ))}
      <p className="helper">公開ヒント画像は未設定</p>
    </section>
  </article>
}

export default function TravelerPreview({ challengeContent, afterClearContent, mode, onModeChange, headingRef, onEdit }: Props) {
  return <section className="form-section traveler-preview" aria-labelledby="preview-heading">
    <h2 id="preview-heading" ref={headingRef} tabIndex={-1}>旅行者向け表示の確認（未公開）</h2>
    <p className="demo-notice" role="note">管理用プレビュー・表示確認のみ。実際の旅行者画面、写真判定、公開には未接続です。</p>
    <div className="preview-mode" role="group" aria-label="表示する内容">
      <button type="button" aria-pressed={mode === 'challenge'} onClick={() => onModeChange('challenge')}>挑戦前の問題</button>
      <button type="button" aria-pressed={mode === 'after-clear'} onClick={() => onModeChange('after-clear')}>クリア後の解説（デモ）</button>
    </div>
    {mode === 'challenge' ? <ChallengePreview content={challengeContent} /> : <ClearExplanationPreview content={afterClearContent} />}
    <button type="button" onClick={onEdit}>A04編集へ戻る</button>
  </section>
}
