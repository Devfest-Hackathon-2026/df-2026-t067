import { useCallback, useState } from 'react'
import type { ApiClient, ManagedQuest, OrgMembership } from '../../shared/api'
import { useRemote } from '../../shared/useRemote'
import QuestDraftForm from './QuestDraftForm'
import { ShootingAreasEditor } from './ShootingAreasEditor'
import { HintAssetEditor } from './HintAssetEditor'
import { PublicationWorkspace } from './PublicationWorkspace'

type Destination = 'areas' | 'publication' | 1 | 2 | 3
// Child editors retain their own authorization, revision and explicit save checks.
export function QuestTaskWorkspace({ api, initial, member, onBack }: {
  api: ApiClient; initial: ManagedQuest | null; member: OrgMembership; onBack: () => void
}) {
  const [record, setRecord] = useState(initial)
  const [destination, setDestination] = useState<Destination | 'draft'>('draft')
  const [refresh, setRefresh] = useState(false)
  const read = useCallback((signal: AbortSignal) => api.getManagedQuest(member.orgId, record!.questId, { signal }), [api, member.orgId, record])
  const { result, retry } = useRemote(refresh, read)
  function returnToDraft() { setRefresh(true) }
  if (refresh) return <section>
    {result.status === 'loading' && <p role="status">最新の下書きを確認しています…</p>}
    {result.status === 'error' && <><p role="alert">最新版を取得できませんでした。</p><button onClick={retry}>読み直す</button></>}
    {result.status === 'ready' && <QuestDraftForm key={result.value.draftRevision} connection={{ taskFocused: true, api, initial: result.value, member, onBack, onContinue: (saved, next) => { setRecord(saved); setDestination(next); setRefresh(false) } }} />}
    {result.status !== 'ready' && <button onClick={onBack}>謎一覧へ</button>}
  </section>
  if (destination === 'draft' || !record) return <QuestDraftForm connection={{ taskFocused: true, api, initial: record, member, onBack,
    onContinue: (saved, next) => { setRecord(saved); setDestination(next) } }} />
  return <section aria-label="一件の公開準備">
    <h1>{record.draft.content.title || '無題'}の公開準備</h1>
    {destination === 'areas' ? <ShootingAreasEditor enableMap api={api} orgId={member.orgId} questId={record.questId} onBack={returnToDraft} backLabel="本文へ" />
      : destination === 'publication' ? <PublicationWorkspace rightsAssist api={api} initial={record} onBack={returnToDraft} onPublished={returnToDraft} backLabel="本文へ" />
        : <HintAssetEditor rightsAssist api={api} initial={record} member={member} initialSlot={destination} onBack={returnToDraft} backLabel="本文へ" />}
  </section>
}
