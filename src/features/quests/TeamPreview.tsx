import { useMemo, useState, useSyncExternalStore } from 'react'
import { createApiClient, type ApiClient } from '../../shared/api'
import type { AuthClient } from '../auth/authTypes'
import { AuthError, createFirebaseAuthClient } from '../auth/firebaseAuth'
import { useServerIdentity } from '../explore/useQuestConnection'
import { ApiQuestApp } from './ApiQuestApp'

export function TeamPreview({ authClient, apiClient }: { authClient?: AuthClient; apiClient?: ApiClient } = {}) {
  const auth = useMemo(() => authClient ?? createFirebaseAuthClient(), [authClient])
  const api = useMemo(() => apiClient ?? createApiClient({ expectedDataMode: 'team-preview', getIdToken: auth.getIdToken }), [auth, apiClient])
  const snapshot = useSyncExternalStore(auth.subscribe, auth.getSnapshot, auth.getSnapshot)
  const identity = useServerIdentity(true, api, snapshot)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  async function authenticate(action: 'in' | 'out') {
    setPending(true)
    setError('')
    try {
      if (action === 'in') await auth.signInWithGoogle()
      else await auth.signOut()
    } catch (cause) {
      setError(cause instanceof AuthError ? cause.message : 'ログイン操作を完了できませんでした。')
    } finally { setPending(false) }
  }

  if (snapshot.status === 'signed-in' && identity.result?.status === 'ready') {
    return <ApiQuestApp key={snapshot.user.uid} api={api} authClient={auth} dataMode="team-preview" />
  }

  return <main className="page owner-records">
    <h1>チーム共有検証</h1>
    <p>招待されたGoogleアカウントでログインしてください。</p>
    {snapshot.status === 'signed-out' && <button type="button" className="primary-button" disabled={pending}
      onClick={() => void authenticate('in')}>Googleログイン</button>}
    {snapshot.status === 'signed-in' && <button type="button" className="secondary-button" disabled={pending}
      onClick={() => void authenticate('out')}>ログアウト</button>}
    {(snapshot.status === 'checking' || pending || identity.result?.status === 'loading') && <p role="status">ログインを確認しています…</p>}
    {(snapshot.status === 'unconfigured' || snapshot.status === 'unavailable') && <p role="alert">Googleログインの設定を確認してください。</p>}
    {identity.result?.status === 'error' && (identity.result.code === 'FORBIDDEN'
      ? <p role="alert">このアカウントは共有検証に招待されていません。</p>
      : <><p role="alert">ログインを確認できませんでした。</p><button type="button" className="retry-button" onClick={identity.retry}>確認し直す</button></>)}
    {error && <p role="alert">{error}</p>}
  </main>
}
