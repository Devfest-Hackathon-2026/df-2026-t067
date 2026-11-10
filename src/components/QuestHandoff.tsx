import { QuestQrCode } from './QuestQrCode'

export function QuestHandoff({ value = window.location.href, title = 'この問題' }: { value?: string; title?: string }) {
  return <div className="quest-handoff">
    {<div className="quest-handoff-panel">
      <QuestQrCode value={value} label={`${title}をスマートフォンで開くQRコード`} />
      <p className="handoff-caption">スマホで挑戦</p>
    </div>}
  </div>
}
