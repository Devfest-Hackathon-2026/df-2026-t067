import { normalizePrice } from '../../shared/api/admin'
import { useState, type RefObject } from 'react'
import ClearExplanationPreview, { type ClearExplanationContent } from './ClearExplanationPreview'
import type { ManagedQuestDraft, ShootingConditions } from '../../shared/api/admin'
import { ShootingConditionIndicators } from '../../components/ShootingConditionIndicators'

export type PreviewMode = 'challenge' | 'after-clear'

type ChallengePreviewContent = Pick<ManagedQuestDraft['content'], 'title' | 'question' | 'hints'> &
  ShootingConditions & Pick<ManagedQuestDraft['materials'], 'price'>

type Props = {
  challengeContent: ChallengePreviewContent
  afterClearContent: ClearExplanationContent
  mode: PreviewMode
  onModeChange: (mode: PreviewMode) => void
  headingRef: RefObject<HTMLHeadingElement | null>
  onEdit: () => void
  areaLabel?: string
}

function shown(value: string) {
  return value.trim() || '未入力'
}

function ChallengePreview({ content, areaLabel }: { content: ChallengePreviewContent; areaLabel?: string }) {
  const [openHints, setOpenHints] = useState([false, false, false])

  return <article className="traveler-card" id="challenge-preview">
    <header className="challenge-title-row">
      <h3>{shown(content.title)}</h3>
      <ShootingConditionIndicators conditions={content} />
    </header>
    <p>{shown(content.question)}</p>
    <section aria-labelledby="preview-area-heading"><h4 id="preview-area-heading">探索エリア</h4><p>{areaLabel ?? '青葉みらい市の行政区域'}</p></section>
    {content.price.trim() && <section aria-labelledby="preview-conditions-heading"><h4 id="preview-conditions-heading">挑戦前の条件</h4>
      <dl><dt>料金</dt><dd>{shown(normalizePrice(content.price))}</dd></dl>
    </section>}
    <section aria-labelledby="preview-hints-heading"><h4 id="preview-hints-heading">ヒント</h4>
      {content.hints.map((hint, index) => (
        <div className="preview-hint" key={index}>
          <button type="button" aria-expanded={openHints[index]} aria-controls={`preview-hint-${index}`} onClick={() => setOpenHints(current => current.map((open, itemIndex) => itemIndex === index ? !open : open))}>ヒント {index + 1}を見る</button>
          <p id={`preview-hint-${index}`} hidden={!openHints[index]}>{shown(hint)}</p>
        </div>
      ))}
    </section>
  </article>
}

export default function TravelerPreview({ challengeContent, afterClearContent, mode, onModeChange, headingRef, onEdit, areaLabel }: Props) {
  return <section className="form-section traveler-preview" aria-labelledby="preview-heading">
    <h2 id="preview-heading" ref={headingRef} tabIndex={-1}>プレビュー</h2>
    <p className="demo-notice" role="note">未公開プレビュー</p>
    <div className="preview-mode" role="group" aria-label="表示する内容">
      <button type="button" aria-pressed={mode === 'challenge'} onClick={() => onModeChange('challenge')}>挑戦前</button>
      <button type="button" aria-pressed={mode === 'after-clear'} onClick={() => onModeChange('after-clear')}>クリア後</button>
    </div>
    {mode === 'challenge' ? <ChallengePreview content={challengeContent} areaLabel={areaLabel} /> : <ClearExplanationPreview content={afterClearContent} />}
    <button type="button" onClick={onEdit}>文章を編集</button>
  </section>
}
