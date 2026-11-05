import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createApiClient } from '../../shared/api'
import type { ApiClient, ManagedQuest, ManagedReport, OrgMembership, Page } from '../../shared/api'
import { reportCategoryLabels } from '../../shared/reportLabels'
import { useRemote } from '../../shared/useRemote'
import type { AuthClient } from '../auth/authTypes'
import { AuthError, createFirebaseAuthClient } from '../auth/firebaseAuth'
import { useServerIdentity } from '../explore/useQuestConnection'
import { PausePublication } from './PausePublication'
import AdminDemo from './AdminDemo'
import './adminDemo.css'

const statusLabels: Record<ManagedQuest['status'], string> = {
  draft: '下書き', review_pending: '確認待ち', published: '公開中', paused: '休止中',
}
const roleLabels: Record<OrgMembership['role'], string> = { editor: '編集担当', publisher: '公開担当' }

function Pager({ cursor, next, onMove }: { cursor?: string; next?: string | null; onMove: (cursor?: string) => void }) {
  return <div className="admin-list-actions">
    {cursor && <button type="button" onClick={() => onMove()}>最初のページへ</button>}
    {next && <button type="button" onClick={() => onMove(next)}>次のページへ</button>}
  </div>
}

function OrganizationWorkspace({ api, member }: { api: ApiClient; member: OrgMembership }) {
  const [section, setSection] = useState<'quests' | 'reports'>('quests')
  const [cursor, setCursor] = useState<string>()
  const [notice, setNotice] = useState('')
  const [editing, setEditing] = useState<ManagedQuest | null>()
  const read = useCallback((signal: AbortSignal) => section === 'quests'
    ? api.listManagedQuests(member.orgId, { cursor, limit: 20 }, { signal })
    : api.listManagedReports(member.orgId, { cursor, limit: 20 }, { signal }), [api, member.orgId, cursor, section])
  const { result, retry } = useRemote<Page<ManagedQuest | ManagedReport>>(editing === undefined, read)
  const heading = section === 'quests' ? '自組織の問題' : '自組織の報告'
  function select(next: typeof section) { setNotice(''); setCursor(undefined); setSection(next) }

  if (editing !== undefined) return <AdminDemo connection={{ api, member, initial: editing,
    onBack: () => { setEditing(undefined); retry() } }} />

  return <section className="form-section" aria-labelledby="org-workspace-title">
    <h2 id="org-workspace-title">{heading}</h2>
    <p>{member.label}・{roleLabels[member.role]}</p>
    {notice && <p role="status">{notice}</p>}
    {member.role === 'publisher' && <div className="admin-list-actions">
      <button type="button" aria-pressed={section === 'quests'} onClick={() => select('quests')}>問題一覧</button>
      <button type="button" aria-pressed={section === 'reports'} onClick={() => select('reports')}>問題報告</button>
    </div>}
    {section === 'quests' && result.status === 'ready' &&
      <button type="button" onClick={() => setEditing(null)}>下書きを新規作成</button>}
    {result.status === 'loading' && <p role="status">読み込んでいます…</p>}
    {result.status === 'error' && <><p role="alert">{result.code === 'FORBIDDEN' ? 'この組織の操作権限を確認できません。'
      : section === 'reports' && result.code === 'SYSTEM_ERROR' ? '報告の保存先に接続できません。'
        : '一覧を読み込めませんでした。'}</p><button type="button" onClick={retry}>一覧を読み直す</button></>}
    {result.status === 'ready' && (result.value.items.length === 0 ? <p>{section === 'quests' ? '問題はまだありません。' : '報告はまだありません。'}</p>
      : <ul className="admin-read-list">{result.value.items.map((item) => 'draft' in item
        ? <li key={item.questId}><strong>{item.draft.content.title || '無題の下書き'}</strong>
          <p>問題 {item.questId}・{statusLabels[item.status]}・下書き版 {item.draftRevision}{item.publishedVersion !== null && '・公開版 ' + item.publishedVersion}</p>
          <button type="button" onClick={() => setEditing(item)}>下書きを編集</button>
          {member.role === 'publisher' && item.publishedVersion !== null &&
            <PausePublication key={item.publishedVersion} api={api} orgId={member.orgId} questId={item.questId} version={item.publishedVersion}
              onReload={retry} onPaused={() => { setNotice('開発用の公開を休止しました。'); retry() }} />}
        </li>
        : <li key={item.reportId}><strong>{reportCategoryLabels[item.category]}</strong>
          <p>{item.text}</p><p>問題 {item.questId}・版 {item.questVersion}・<time dateTime={item.receivedAt}>{item.receivedAt}</time></p></li>)}</ul>)}
    <Pager cursor={cursor} next={result.status === 'ready' ? result.value.nextCursor : undefined} onMove={setCursor} />
  </section>
}

function Memberships({ api }: { api: ApiClient }) {
  const [cursor, setCursor] = useState<string>()
  const [selected, setSelected] = useState<string | null>(null)
  const read = useCallback((signal: AbortSignal) => api.listMemberships({ cursor, limit: 20 }, { signal }), [api, cursor])
  const { result, retry } = useRemote(true, read)
  const current = result.status === 'ready' ? result.value.items.find((member) => member.orgId === selected) : undefined
  return <>
    <section className="form-section" aria-labelledby="membership-title">
      <h2 id="membership-title">所属する組織</h2>
      {result.status === 'loading' && <p role="status">所属を確認しています…</p>}
      {result.status === 'error' && <><p role="alert">所属を確認できませんでした。</p>
        <button type="button" onClick={retry}>所属を確認し直す</button></>}
      {result.status === 'ready' && (result.value.items.length === 0 ? <p>利用できる所属がありません。</p>
        : <ul className="admin-read-list">{result.value.items.map((member) => <li key={member.orgId}>
          <button type="button" aria-pressed={member.orgId === selected} onClick={() => setSelected(member.orgId)}>
            {member.label}・{roleLabels[member.role]}
          </button></li>)}</ul>)}
      <Pager cursor={cursor} next={result.status === 'ready' ? result.value.nextCursor : undefined}
        onMove={(next) => { setSelected(null); setCursor(next) }} />
    </section>
    {current && <OrganizationWorkspace key={JSON.stringify([current.orgId, current.role])} api={api} member={current} />}
  </>
}

export function LocalAdminWorkspace({ authClient: providedAuth, apiClient: providedApi }: { authClient?: AuthClient; apiClient?: ApiClient } = {}) {
  const authClient = useMemo(() => providedAuth ?? createFirebaseAuthClient(), [providedAuth])
  const api = useMemo(() => providedApi ?? createApiClient({ expectedDataMode: 'demo', getIdToken: authClient.getIdToken }), [providedApi, authClient])
  const auth = useSyncExternalStore(authClient.subscribe, authClient.getSnapshot, authClient.getSnapshot)
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
      setError(cause instanceof AuthError ? cause.message : 'ログイン操作を完了できませんでした。')
    } finally { action.current = false; setPending(false) }
  }

  return <main className="admin-demo">
    <header className="admin-header"><h1>自治体向けローカル管理</h1><a href="/">旅行者画面へ</a></header>
    <p className="demo-notice">架空の組織と開発用APIを使います。下書きと報告はサーバーの一時領域に保存されます。</p>
    <section className="form-section" aria-label="担当者ログイン">
      {auth.status === 'signed-out' && <button type="button" disabled={pending} onClick={() => void authenticate('login')}>Googleログイン</button>}
      {auth.status === 'signed-in' && <button type="button" disabled={pending} onClick={() => void authenticate('logout')}>ログアウト</button>}
      {(pending || auth.status === 'checking') && <p role="status">ログイン状態を確認しています…</p>}
      {(auth.status === 'unconfigured' || auth.status === 'unavailable') && <p>Googleログインの設定を確認してください。</p>}
      {error && <p role="alert">{error}</p>}
    </section>
    {!pending && auth.status === 'signed-in' && (identity.result?.status === 'ready' ? <Memberships key={auth.user.uid} api={api} />
      : identity.result?.status === 'error' ? <div className="form-section"><p role="alert">ログインを確認できませんでした。</p>
        <button type="button" onClick={identity.retry}>ログインを確認し直す</button></div>
        : <p role="status">サーバーでログインを確認しています…</p>)}
    <p><a href="/admin-demo">素材・文章・プレビューの操作デモへ</a></p>
  </main>
}
