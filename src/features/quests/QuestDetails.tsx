import type { PublicQuest } from '../../shared/api/types'
import { Icon } from '../../components/Icon'
import type { createApiClient } from '../../shared/api/client'
import { useId } from 'react'

export type ChallengeSelection = Parameters<ReturnType<typeof createApiClient>['createChallenge']>[0]

interface QuestDetailsProps {
  quest: PublicQuest
  areaLabel: string
  open: boolean
  disabled: boolean
  buttonLabel: string
  note: string
  sourceLabel?: string
  feedback?: { error: boolean; text: string } | null
  onToggle(): void
  onStart(selection: ChallengeSelection): void | Promise<unknown>
}

export function QuestDetails({ quest, areaLabel, open, disabled, buttonLabel, note, sourceLabel = '架空のサンプル問題', feedback, onToggle, onStart }: QuestDetailsProps) {
  const detailsId = `quest-details-${useId().replaceAll(':', '')}`
  return (
    <article className={'quest-card' + (open ? ' is-open' : '')} aria-labelledby={`${detailsId}-title`}>
      <div className="quest-visual" aria-hidden="true">
        <span className="visual-orbit orbit-one" /><span className="visual-orbit orbit-two" />
        <Icon name="compass" /><span className="visual-caption">その街の、まだ知らない話。</span>
      </div>
      <div className="quest-card-content">
        <div className="quest-meta"><span className="area-label"><Icon name="pin" />{areaLabel}</span><span className="sample-label">{sourceLabel}</span></div>
        <h3 id={`${detailsId}-title`}>{quest.title}</h3>
        <p className="quest-intro">文章のヒントから、街の中に隠れた場所を見つけよう。</p>
        <button type="button" className={'quest-toggle' + (open ? ' is-open' : '')}
          aria-expanded={open} aria-controls={detailsId} onClick={onToggle}>
          <span>{open ? '問題を閉じる' : '問題を見てみる'}</span><Icon name="arrow" />
        </button>
        {open && (
          <section id={detailsId} className="quest-details" aria-label="サンプル問題の詳細">
            <p className="question-step">この街をめぐる、小さな問い</p>
            <h4>この場所はどこ？</h4>
            <p className="clue-text">{quest.clue}</p>
            <p className="sample-note">{quest.visitConditions}</p>
            <button type="button" className="primary-button" disabled={disabled} onClick={() => onStart({ questId: quest.questId, expectedVersion: quest.version })} aria-describedby={`${detailsId}-note`}>
              {buttonLabel}
            </button>
            <p id={`${detailsId}-note`} className="unavailable-note">{note}</p>
            {feedback && <p className="auth-feedback" role={feedback.error ? 'alert' : 'status'}>{feedback.text}</p>}
          </section>
        )}
      </div>
    </article>
  )
}
