import type { AfterClearContent } from '../../shared/api/admin'

export type ClearExplanationContent = AfterClearContent

type Props = {
  content: ClearExplanationContent
}

function shown(value: string) {
  return value.trim() || '未入力'
}

export default function ClearExplanationPreview({ content }: Props) {
  return <article className="traveler-card" id="after-clear-preview" aria-labelledby="after-clear-heading">
    <h3 id="after-clear-heading">クリア後の解説（デモ）</h3>
    <dl>
      <dt>アクセス補足</dt><dd>{shown(content.access)}</dd>
      <dt>利用できる時間</dt><dd>{shown(content.hours)}</dd>
      <dt>自治体からの紹介</dt><dd>{shown(content.promoComment)}</dd>
      <dt>解説</dt><dd>{shown(content.explanation)}</dd>
    </dl>
  </article>
}
