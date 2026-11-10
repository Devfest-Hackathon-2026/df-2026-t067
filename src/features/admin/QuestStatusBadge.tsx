import type { ManagedQuest } from '../../shared/api'
const labels = { draft: '下書き', review_pending: '確認待ち', published: '公開中', paused: '休止中' }
const icons = { draft: '✎', review_pending: '◷', published: '✓', paused: 'Ⅱ' }
export function QuestStatusBadge({ status }: { status: ManagedQuest['status'] }) {
  return <span className="admin-quest-status" data-status={status}><span aria-hidden="true">{icons[status]}</span>{labels[status]}</span>
}
