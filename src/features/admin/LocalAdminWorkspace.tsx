import { GoogleContinue } from '../../components/GoogleContinue'
import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createApiClient } from '../../shared/api'
import type { ApiClient, LocalApiDataMode, ManagedQuest, ManagedReport, OrgMembership, Page } from '../../shared/api'
import { reportCategoryLabels } from '../../shared/reportLabels'
import { useRemote } from '../../shared/useRemote'
import type { AuthClient, AuthUser } from '../auth/authTypes'
import { AuthError, createFirebaseAuthClient } from '../auth/firebaseAuth'
import { useServerIdentity } from '../explore/useQuestConnection'
import { QuestStatusBadge } from './QuestStatusBadge'
import { PausePublication } from './PausePublication'
import QuestDraftForm from './QuestDraftForm'
import { AdminQuestWorkflow } from './AdminQuestWorkflow'
import { ShootingAreasEditor } from './ShootingAreasEditor'
import { PublicationWorkspace } from './PublicationWorkspace'
import { remainingWork } from './publicationReadiness'
import { HintAssetEditor } from './HintAssetEditor'
import { sortMemberships } from './membershipOrder'
import './admin.css'

function formatDateTime(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date)
}
type Editor = { kind: 'draft'; initial: ManagedQuest | null } | { kind: 'areas'; questId: string }
  | { kind: 'publication' | 'hint'; initial: ManagedQuest }

function Pager({ cursor, next, onMove }: { cursor?: string; next?: string | null; onMove: (cursor?: string) => void }) {
  return <div className="admin-list-actions">
    {cursor && <button type="button" onClick={() => onMove()}>最初へ</button>}
    {next && <button type="button" onClick={() => onMove(next)}>次へ</button>}
  </div>
}

function OrganizationWorkspace({ api, member, teamPreview, durable, photoTestSource, onEditing }: { onEditing: (editing: boolean) => void; api: ApiClient; member: OrgMembership; teamPreview: boolean; durable: boolean; photoTestSource: 'mock' | 'real' }) {
  const [section, setSection] = useState<'quests' | 'reports'>('quests')
  const [cursor, setCursor] = useState<string>()
  const [notice, setNotice] = useState('')
  const [actedQuest, setActedQuest] = useState<string | null>(null)
  const [pausedNotice, setPausedNotice] = useState(false)
  const listRoot = useRef<HTMLElement>(null)
  const [editor, setEditor] = useState<Editor | null>(null)
  const read = useCallback((signal: AbortSignal) => section === 'quests'
    ? api.listManagedQuests(member.orgId, { cursor, limit: 20 }, { signal })
    : api.listManagedReports(member.orgId, { cursor, limit: 20 }, { signal }), [api, member.orgId, cursor, section])
  const { result, retry } = useRemote<Page<ManagedQuest | ManagedReport>>(editor === null, read)
  const heading = section === 'quests' ? '謎一覧' : '報告一覧'
  // 実データ側では、都道府県コードの無い地域は「未分類」として作成・公開できない。
  // 開発用デモは地域の分類自体を持たないため対象外にする。
  const areaUnclassified = (teamPreview || durable) && !member.prefectureCode
  function select(next: typeof section) { setNotice(''); setCursor(undefined); setSection(next) }

  const restored = useRef(false)
  const listHeading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { onEditing(editor !== null) }, [editor, onEditing])
  useEffect(() => {
    if (restored.current || result.status !== 'ready') return
    restored.current = true
    const params = new URLSearchParams(location.search)
    const quest = params.get('quest'); const step = params.get('step')
    if (!quest) return
    const found = result.value.items.find((item): item is ManagedQuest => 'draft' in item && item.questId === quest)
    const clear = () => { const url = new URL(location.href); url.searchParams.delete('quest'); url.searchParams.delete('step'); history.replaceState(null, '', url) }
    if (step && !['1', '2', '3', '4', 'target', 'conditions', 'content', 'hints', 'publication'].includes(step)) { clear(); return }
    if (found || (quest === 'new' && !areaUnclassified)) queueMicrotask(() => setEditor({ kind: 'draft', initial: found ?? null }))
    else if (quest !== 'new') {
      void api.getManagedQuest(member.orgId, quest).then(record => {
        if (new URLSearchParams(location.search).get('quest') === quest) setEditor({ kind: 'draft', initial: record })
      }).catch(clear)
    } else clear()
  }, [result, api, member.orgId, areaUnclassified])
  useEffect(() => {
    if (editor || result.status !== 'ready') return
    const row = actedQuest && Array.from(listRoot.current?.querySelectorAll<HTMLElement>('[data-quest-id]') ?? []).find(row => row.dataset.questId === actedQuest)
    if (row) { row.focus({ preventScroll: true }); row.scrollIntoView?.({ block: 'center' }) }
    else listHeading.current?.focus()
  }, [editor, result, actedQuest])
  function republish(item: ManagedQuest) {
    const url = new URL(location.href); url.searchParams.set('step', 'publication'); history.replaceState(null, '', url)
    setEditor({ kind: 'draft', initial: item })
  }
  function published() { setActedQuest(editor && 'initial' in editor ? editor.initial?.questId ?? new URLSearchParams(location.search).get('quest') : null); setPausedNotice(false); setNotice('公開済み'); closeEditor() }
  function closeEditor() { const url = new URL(location.href); url.searchParams.delete('quest'); url.searchParams.delete('step'); history.replaceState(null, '', url); setEditor(null); retry() }
  if (editor?.kind === 'draft' && (durable || teamPreview)) return <AdminQuestWorkflow api={api} member={member} initial={editor.initial}
    teamPreview={teamPreview} photoTestSource={photoTestSource} areaUnclassified={areaUnclassified} onBack={closeEditor}
    onPublished={published} />
  if (editor?.kind === 'draft') return <QuestDraftForm teamPreview={teamPreview} connection={{ api, member, initial: editor.initial, onBack: closeEditor }} />
  if (editor?.kind === 'areas') return <ShootingAreasEditor enableMap={durable || teamPreview} api={api} orgId={member.orgId} questId={editor.questId} onBack={closeEditor} />
  if (editor?.kind === 'hint') return <HintAssetEditor rightsAssist={durable} api={api} initial={editor.initial} member={member} onBack={closeEditor} />
  if (editor?.kind === 'publication') return <PublicationWorkspace rightsAssist={durable} photoTestSource={photoTestSource} api={api} initial={editor.initial} areaUnclassified={areaUnclassified} onBack={closeEditor}
    onPublished={published} />

  return <section className="form-section admin-quest-list" aria-labelledby="org-workspace-title" ref={listRoot}>
    <h2 id="org-workspace-title" tabIndex={-1} ref={listHeading}>{heading}</h2>
    <p>{member.label}</p>
    {areaUnclassified && <p role="alert">地域未設定・作成不可・公開不可</p>}
    {notice && <div role="status" className="admin-operation-notice">{notice}{pausedNotice && result.status === 'ready' && result.value.items.filter((item): item is ManagedQuest => 'draft' in item && item.questId === actedQuest).map(item => <button key={item.questId} type="button" onClick={() => republish(item)}>再公開</button>)}</div>}
    {member.role === 'publisher' && !teamPreview && <div className="admin-list-actions">
      <button type="button" aria-pressed={section === 'quests'} onClick={() => select('quests')}>謎一覧</button>
      <button type="button" aria-pressed={section === 'reports'} onClick={() => select('reports')}>報告</button>
    </div>}
    {section === 'quests' && result.status === 'ready' && !areaUnclassified &&
      <button type="button" className="workflow-primary" onClick={() => setEditor({ kind: 'draft', initial: null })}>下書きを新規作成</button>}
    {result.status === 'loading' && <p role="status">読込中</p>}
    {result.status === 'error' && <><p role="alert">{result.code === 'FORBIDDEN' ? '組織の権限を確認'
      : section === 'reports' && result.code === 'SYSTEM_ERROR' ? '報告の接続失敗'
        : '一覧の読込失敗'}</p><button type="button" onClick={retry}>一覧を読み直す</button></>}
    {result.status === 'ready' && (result.value.items.length === 0 ? <p>{section === 'quests' ? '謎なし' : '報告なし'}</p>
      : <ul className="admin-read-list">{result.value.items.map((item) => 'draft' in item
        ? <li key={item.questId} data-quest-id={item.questId} tabIndex={-1}>
          <p className="admin-quest-status-row">
            <QuestStatusBadge status={item.status} />
            {item.publishedVersion !== null && item.status !== 'published' && <span>公開版あり</span>}
            {item.questNumber && <span>No. {item.questNumber}</span>}
          </p>
          <strong>{item.draft.content.title || '無題'}</strong>
          <button type="button" onClick={() => setEditor({ kind: 'draft', initial: item })}>{teamPreview || durable ? '編集' : '編集'}</button>
          {item.status === 'paused' && (teamPreview || durable) && <button type="button" onClick={() => republish(item)}>再公開</button>}
          {(teamPreview || durable) ? item.status !== 'published' && <details className="workflow-remaining">
            <summary>残りの作業 {remainingWork(item, true).length}件</summary>
            <ul>{remainingWork(item, true).map((work) => <li key={work}>{work}</li>)}</ul>
          </details> : <fieldset className="publish-prep"><legend>公開準備</legend>
            <p>撮影範囲：{item.shootingAreaStatus === 'configured' ? '設定済み' : '未設定'}</p>
            {areaUnclassified && item.status !== 'published' && <p>地域未設定・公開不可</p>}
            {item.status === 'published' ? <p>公開中</p> : <>
              {remainingWork(item).length > 0
                ? <><p>残りの作業</p><ul>{remainingWork(item).map((work) => <li key={work}>{work}</li>)}</ul></>
                : <p>入力済み</p>}

            </>}
            <div className="admin-list-actions">
              <button type="button" onClick={() => setEditor({ kind: 'areas', questId: item.questId })}>撮影範囲を設定</button>
              <button type="button" onClick={() => setEditor({ kind: 'hint', initial: item })}>ヒント画像を設定</button>
              {item.status !== 'published' &&
                <button type="button" onClick={() => setEditor({ kind: 'publication', initial: item })}>試験・公開</button>}
            </div>
          </fieldset>}
          {member.role === 'publisher' && item.status !== 'paused' && item.publishedVersion !== null &&
            <PausePublication key={item.publishedVersion} api={api} orgId={member.orgId} questId={item.questId} version={item.publishedVersion}
              onReload={retry} onPaused={() => { setActedQuest(item.questId); setPausedNotice(true); setNotice('休止済み'); retry() }} />}
        </li>
        : <li key={item.reportId}><strong>{reportCategoryLabels[item.category]}</strong>
          <p>{item.text}</p>
          <p><time dateTime={item.receivedAt}>{formatDateTime(item.receivedAt)}</time></p>
          <details><summary>詳細</summary>
            <p>問題 {item.questId}・版 {item.questVersion}</p>
          </details></li>)}</ul>)}
    <Pager cursor={cursor} next={result.status === 'ready' ? result.value.nextCursor : undefined} onMove={setCursor} />
  </section>
}

function Memberships({ api, teamPreview, durable, photoTestSource }: { api: ApiClient; teamPreview: boolean; durable: boolean; photoTestSource: 'mock' | 'real' }) {
  const [cursor, setCursor] = useState<string>()
  const [editing, setEditing] = useState(false)
  const [selected, setSelected] = useState<string | null>(() => { try { return sessionStorage.getItem('admin-selected-org') } catch { return null } })
  const read = useCallback((signal: AbortSignal) => api.listMemberships({ cursor, limit: 20 }, { signal }), [api, cursor])
  const { result, retry } = useRemote(true, read)
  const onlyMembership = result.status === 'ready' && !cursor && !result.value.nextCursor && result.value.items.length === 1 ? result.value.items[0] : undefined
  const current = result.status === 'ready' ? onlyMembership ?? result.value.items.find((member) => member.orgId === selected) : undefined
  return <>
    <section hidden={editing} className="form-section" aria-labelledby="membership-title">
      <h2 id="membership-title">所属</h2>
      {result.status === 'loading' && <p role="status">所属確認中</p>}
      {result.status === 'error' && <><p role="alert">所属の確認失敗</p>
        <button type="button" onClick={retry}>所属を確認し直す</button></>}
      {result.status === 'ready' && (result.value.items.length === 0 ? <p>所属なし</p>
        : onlyMembership ? <p>{onlyMembership.label}</p>
          : <ul className="admin-read-list admin-membership-list">{sortMemberships(result.value.items).map((member) => <li key={member.orgId}>
          <button type="button" aria-pressed={member.orgId === current?.orgId} onClick={() => { setSelected(member.orgId); try { sessionStorage.setItem('admin-selected-org', member.orgId) } catch { /* Selection still works without session storage. */ } }}>
            {member.label}
          </button></li>)}</ul>)}
      <Pager cursor={cursor} next={result.status === 'ready' ? result.value.nextCursor : undefined}
        onMove={(next) => { setSelected(null); setCursor(next) }} />
    </section>
    {current && <OrganizationWorkspace onEditing={setEditing} key={JSON.stringify([current.orgId, current.role])} api={api} member={current} teamPreview={teamPreview} durable={durable} photoTestSource={photoTestSource} />}
  </>
}

function AdminAccountMenu({ user, pending, onLogout }: {
  user: AuthUser
  pending: boolean
  onLogout: () => void
}) {
  const [open, setOpen] = useState(false)
  const menu = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const panelId = useId()
  const name = user.displayName?.trim()

  useEffect(() => {
    if (!open) return
    function closeOutside(event: PointerEvent) {
      if (event.target instanceof Node && !menu.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => document.removeEventListener('pointerdown', closeOutside)
  }, [open])

  return <div className="admin-account" ref={menu} onKeyDown={(event) => {
    if (open && event.key === 'Escape') {
      event.preventDefault()
      setOpen(false)
      trigger.current?.focus()
    }
  }}>
    <button type="button" className="admin-account-trigger" ref={trigger} aria-label="アカウントメニュー"
      aria-haspopup="menu" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(!open)}>
      {user.photoURL ? <img src={user.photoURL} alt="" /> : <span aria-hidden="true">{name ? Array.from(name).slice(0, 2).join('') : '担当'}</span>}
    </button>
    <div className="admin-account-panel" role="menu" id={panelId} hidden={!open}>
      <p>{name || 'ログイン中のアカウント'}</p>
      <a role="menuitem" href="/">旅行者画面</a>
      <button type="button" role="menuitem" disabled={pending} onClick={onLogout}>{pending ? 'ログアウト中…' : 'ログアウト'}</button>
    </div>
  </div>
}

export function LocalAdminWorkspace({ authClient: providedAuth, apiClient: providedApi, dataMode = 'demo' }: { authClient?: AuthClient; apiClient?: ApiClient; dataMode?: LocalApiDataMode } = {}) {
  const authClient = useMemo(() => providedAuth ?? createFirebaseAuthClient(), [providedAuth])
  const api = useMemo(() => providedApi ?? createApiClient({ expectedDataMode: dataMode, getIdToken: authClient.getIdToken }), [providedApi, authClient, dataMode])
  const auth = useSyncExternalStore(authClient.subscribe, authClient.getSnapshot, authClient.getSnapshot)
  const teamPreview = dataMode === 'team-preview'
  // Build-time mirror of the server's QUEST_TEAM_ANSWER_TRIAL switch, the
  // same pattern as the traveler side (TeamPreview). With the trial on, the
  // server runs admin photo tests against real Vertex matching (D-18); the
  // source on each returned result stays authoritative.
  const photoTestSource = teamPreview && import.meta.env.VITE_QUEST_TEAM_ANSWER_TRIAL === 'true' ? 'real' as const : 'mock' as const
  const identity = useServerIdentity(true, api, auth)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const action = useRef(false)

  async function authenticate(kind: 'login' | 'logout') {
    if (action.current) return
    action.current = true
    setPending(true)
    setError('')
    try {
      if (kind === 'login') await authClient.signInWithGoogle()
      else await authClient.signOut()
    } catch (cause) {
      setError(cause instanceof AuthError ? cause.message : 'ログイン失敗')
    } finally { action.current = false; setPending(false) }
  }

  return <main className={'admin-demo' + (teamPreview || dataMode === 'durable-local' ? ' admin-managed' : '') + (auth.status !== 'signed-in' ? ' admin-signed-out' : '')}>
    <header className={auth.status === 'signed-in' ? 'admin-header admin-header-account' : 'admin-header admin-login-heading'}>
      <a className="brand" href="/" aria-label="旅行者画面">
        <span className="brand-mark"><img src="/favicon.svg" alt="" aria-hidden="true" /></span>
        <span className="brand-copy">NAZOP</span>
      </a>
      <h1>謎づくり</h1>
      <div className="admin-header-actions">
      {auth.status === 'signed-in'
        ? <AdminAccountMenu key={auth.user.uid} user={auth.user} pending={pending} onLogout={() => void authenticate('logout')} />
        : null}
      </div>
    </header>
    {(auth.status !== 'signed-in' || error) && <section className="admin-login" aria-label="担当者ログイン">
      {auth.status === 'signed-out' && <button className="google-continue" type="button" disabled={pending} onClick={() => void authenticate('login')}><GoogleContinue /></button>}
      {auth.status === 'signed-out' && <p className="login-terms">続行すると<a href="/terms">利用規約</a>に同意したものとみなします</p>}
      {(pending || auth.status === 'checking') && <p role="status">ログイン確認中</p>}
      {(auth.status === 'unconfigured' || auth.status === 'unavailable') && <p>Googleログイン設定を確認</p>}
      {error && <p role="alert">{error}</p>}
    </section>}
    {!pending && auth.status === 'signed-in' && (identity.result?.status === 'ready' ? <Memberships key={auth.user.uid} api={api} teamPreview={teamPreview} durable={dataMode === 'durable-local'} photoTestSource={photoTestSource} />
      : identity.result?.status === 'error' ? <div className="form-section"><p role="alert">{teamPreview && identity.result.code === 'FORBIDDEN'
        ? '共有検証の招待なし' : 'ログインの確認失敗'}</p>
        <button type="button" onClick={identity.retry}>ログインを確認し直す</button></div>
        : <p role="status">ログイン確認中</p>)}
    {auth.status === 'signed-in' && !teamPreview && <p>{dataMode === 'demo' ? '一時保存' : '検証環境'}</p>}
    {dataMode === 'demo' && <p><a href="/admin-demo">ログインなしで試せるフォームへ戻る</a></p>}
  </main>
}
