import { useCallback, useEffect, useRef, useState } from 'react'
import type { ApiClient, ManagedQuest, OrgMembership, ReviewField } from '../../shared/api'
import { useRemote } from '../../shared/useRemote'
import { QuestStatusBadge } from './QuestStatusBadge'
import QuestDraftForm from './QuestDraftForm'
import { HintAssetEditor } from './HintAssetEditor'
import { PublicationWorkspace } from './PublicationWorkspace'

type Part = 'target' | 'conditions' | 'content' | 'hints' | 'publication'
type Destination = { part: Part; field?: ReviewField } | 'list'
const sectionIds: Record<Part, string> = { target: 'target-heading', conditions: 'conditions-heading', content: 'draft-heading', hints: 'hint-asset-title', publication: 'publication-section' }
const inputTargets: Partial<Record<ReviewField, string>> = {
  'materials.photoRights': 'workflow-reference',
  'materials.name': 'workflow-target-name', referenceAssetId: 'workflow-reference', referenceApproval: 'workflow-reference',
  targetSpot: 'workflow-spot', shootingAreas: 'workflow-spot', hintApproval: 'workflow-hint-image', hintAssetId: 'workflow-hint-image',
  'content.title': 'workflow-title', 'content.question': 'workflow-question', 'content.hints': 'workflow-hint-0', 'content.verifiedFeatures': 'workflow-features',
}

function editPart(field: ReviewField): Part {
  if (field === 'hintAssetId' || field === 'hintApproval') return 'hints'
  if (field.startsWith('content.')) return 'content'
  return 'target'
}

export function AdminQuestWorkflow({ api, initial, member, teamPreview, photoTestSource, areaUnclassified, onBack, onPublished }: {
  api: ApiClient; initial: ManagedQuest | null; member: OrgMembership; teamPreview: boolean
  photoTestSource: 'mock' | 'real'; areaUnclassified: boolean; onBack: () => void; onPublished: () => void
}) {
  const [reloadKey, setReloadKey] = useState(0)
  const [record, setRecord] = useState(initial)
  const [part, setPart] = useState<Part>(() => {
    const value = new URLSearchParams(location.search).get('step') ?? ''
    return ({ '1': 'target', '2': 'conditions', '3': 'content', '4': 'publication', target: 'target', conditions: 'conditions', content: 'content', hints: 'hints', publication: 'publication' } as Record<string, Part>)[value] ?? 'target'
  })
  const [dirty, setDirty] = useState(false)
  const [hintDirty, setHintDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<Destination | null>(null)
  const [focusField, setFocusField] = useState<ReviewField | null>(null)
  const [lastTrialRevision, setLastTrialRevision] = useState<number | null>(null)
  const dialog = useRef<HTMLDivElement>(null)
  useEffect(() => { if (pending) dialog.current?.focus() }, [pending])
  useEffect(() => {
    if (!dirty && !hintDirty) return
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [dirty, hintDirty])
  useEffect(() => {
    const url = new URL(location.href)
    url.searchParams.set('quest', record?.questId ?? 'new')
    url.searchParams.set('step', part)
    history.replaceState(null, '', url)
  }, [record?.questId, part])
  const heading = useRef<HTMLElement>(null)
  const root = useRef<HTMLElement>(null)
  const questId = record?.questId
  const revision = record?.draftRevision
  const read = useCallback((signal: AbortSignal) => api.getManagedQuestReadiness(member.orgId, questId!, { signal }), [api, member.orgId, questId])
  const { result, retry } = useRemote(Boolean(questId), read)
  const remote = result.status === 'ready' ? result.value : undefined
  const readiness = remote?.quest.draftRevision === revision ? remote : undefined
  const newerVersion = remote && !readiness

  useEffect(() => {
    const id = focusField && inputTargets[focusField]
    const field = id && root.current?.querySelector<HTMLElement>('#' + id)
    if (field) field.focus()
    else { const section = document.getElementById(sectionIds[part]); section?.scrollIntoView?.({ block: 'start' }); section?.focus() }
  }, [part, focusField])

  function move(destination: Destination) {
    setPending(null)
    if (destination === 'list') setDirty(false)
    if (destination === 'list') { onBack(); return }
    setPart(destination.part)
    setFocusField(destination.field ?? null)
    if (destination.part === 'publication') {
      retry()
    }
  }

  function navigate(destination: Destination) {
    if (busy) return
    if (destination !== 'list') { move(destination); return }
    if (dirty || hintDirty) setPending(destination)
    else move(destination)
  }

  function saved(savedRecord: ManagedQuest, advance: boolean) {
    setRecord(savedRecord)
    setDirty(false)
    setHintDirty(false)
    retry()
    if (pending) { move(pending); return }
    if (advance) move({ part: part === 'target' ? 'conditions' : part === 'conditions' ? 'content' : 'hints' })
  }

  function fix(field: ReviewField) { navigate({ part: editPart(field), field }) }

  return <section className="admin-workflow" aria-label="問題作成" ref={root}>
    <header className="workflow-heading" ref={heading} tabIndex={-1} aria-label="問題作成">
      <button className="admin-back-link" type="button" aria-label="謎一覧へ戻る" disabled={busy} onClick={() => navigate('list')}>← 謎一覧</button>
      <QuestStatusBadge status={record?.status ?? 'draft'} />
    </header>
    {pending && <div role="alertdialog" aria-label="未保存の入力" className="unsaved-dialog" tabIndex={-1} ref={dialog} onKeyDown={event => {
      if (event.key === 'Escape') { setPending(null); heading.current?.focus() }
      if (event.key === 'Tab') {
        const buttons = dialog.current?.querySelectorAll('button')
        if (!buttons?.length) return
        if (event.shiftKey && (document.activeElement === buttons[0] || document.activeElement === dialog.current)) { event.preventDefault(); buttons[buttons.length - 1].focus() }
        else if (!event.shiftKey && document.activeElement === buttons[buttons.length - 1]) { event.preventDefault(); buttons[0].focus() }
      }
    }}>
      <p>未保存</p>
      <button type="button" className="workflow-primary" disabled={busy} onClick={() => document.dispatchEvent(new Event('admin-save-draft'))}>保存して移動</button>
      <button type="button" disabled={busy} onClick={() => move(pending)}>保存せず移動</button>
      <button type="button" disabled={busy} onClick={() => { setPending(null); heading.current?.focus() }}>とどまる</button>
    </div>}
    <div inert={busy || Boolean(pending)}>
    <div inert={hintDirty}><QuestDraftForm key={reloadKey} teamPreview={teamPreview} connection={{ workflowPart: 'all', saveBlocked: hintDirty,
      api, initial: record, member, onBack, onWorkflowSave: saved, onDirty: setDirty, onSaving: setBusy }} /></div>
    <div inert={dirty}>
    {record ? <HintAssetEditor key={revision} api={api} initial={record} member={member} embedded
      onBack={() => {}} onDirty={setHintDirty} onSaving={setBusy}
      onSaved={(updated) => saved(updated, false)} onContinue={() => {}} />
      : <section><h2>ヒント画像</h2><fieldset disabled><label className="photo-picker">ヒント画像<span className="photo-picker-button" aria-hidden="true">写真を選ぶ</span><input aria-label="ヒント画像" type="file" /></label></fieldset></section>}
    <section id="publication-section" tabIndex={-1} aria-label="AI写真判定">
      <h2>AI写真判定</h2>
      {!record && <fieldset disabled><button type="button">正解写真で試す</button><button type="button">別の写真で試す</button><button type="button">公開する</button></fieldset>}
      {newerVersion && <p role="alert">別の操作で下書きが更新されました。
        <button type="button" disabled={busy || dirty || hintDirty} onClick={() => { setRecord(remote.quest); setReloadKey(key => key + 1) }}>最新の内容を読み込む</button>
      </p>}
      {lastTrialRevision !== null && lastTrialRevision !== revision && <p role="status">変更あり・再テスト</p>}
      {record && <PublicationWorkspace key={revision} api={api} initial={record} approvedAssets embedded blocked={dirty || hintDirty}
        photoTestSource={photoTestSource} areaUnclassified={areaUnclassified}
        onBack={() => navigate('list')} onFix={fix} onPublished={onPublished} onBusy={setBusy}
        onTrialConfirmed={() => setLastTrialRevision(record.draftRevision)}
        readiness={readiness} readinessFailed={result.status === 'error'} onReadinessRetry={retry} />}
    </section>
    </div></div>
  </section>
}
