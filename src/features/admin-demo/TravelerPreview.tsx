import { useState, type RefObject } from 'react'
import ClearExplanationPreview, { type ClearExplanationContent } from './ClearExplanationPreview'

export type PreviewMode = 'challenge' | 'after-clear'

export type ChallengePreviewContent = {
  title: string
  question: string
  hints: [string, string, string]
  requiresBoat: boolean
  requiresPaidFacility: boolean
  price: string
  photoNote: string
}

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

function ConditionIndicator({ icon, label, accessibleLabel }: { icon: 'boat' | 'admission'; label: string; accessibleLabel: string }) {
  return <span className="condition-indicator" role="img" aria-label={accessibleLabel} title={accessibleLabel}>
    <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      {icon === 'boat' ? <><path d="M3 14h18l-2 5H7l-4-5Z" /><path d="M8 13V5h8v8M12 5V2M2 21c2 1 3 1 5 0s3-1 5 0 3 1 5 0 3-1 5 0" /></> : <><path d="M4 20V8l8-5 8 5v12" /><path d="M8 20v-7h8v7M8 8h.01M12 8h.01M16 8h.01" /></>}
    </svg>
    <span>{label}</span>
  </span>
}

function ChallengePreview({ content }: { content: ChallengePreviewContent }) {
  const [openHints, setOpenHints] = useState([false, false, false])

  return <article className="traveler-card" id="challenge-preview">
    <header className="challenge-title-row">
      <h3>{shown(content.title)}</h3>
      {(content.requiresBoat || content.requiresPaidFacility) && <div className="condition-indicators" aria-label="撮影に必要な条件">
        {content.requiresBoat && <ConditionIndicator icon="boat" label="船上・海上" accessibleLabel="船上・海上での撮影が必要" />}
        {content.requiresPaidFacility && <ConditionIndicator icon="admission" label="有料施設内" accessibleLabel="有料施設内での撮影が必要" />}
      </div>}
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
