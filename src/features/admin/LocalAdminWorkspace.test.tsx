import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { createApiClient } from '../../shared/api'
import type { ManagedQuest } from '../../shared/api'
import type { AuthClient, AuthSnapshot } from '../auth/authTypes'
import { LocalAdminWorkspace } from './LocalAdminWorkspace'

const quest: ManagedQuest = {
  orgId: 'demo-publish', areaId: 'demo-area', questId: 'local-quest', draftRevision: 2, publishedVersion: 1,
  status: 'review_pending', shootingAreaStatus: 'configured', source: 'mock',
  draft: {
    materials: { name: '', evidence: '', photoRights: '', price: '', photoNote: '', requiresBoat: false, requiresPaidFacility: false },
    content: { title: '確認待ちの架空問題', question: '', hints: ['', '', ''], verifiedFeatures: '', draftingNotes: '' },
    afterClear: { access: '', hours: '', promoComment: '', explanation: '' }, referenceAssetId: null, hintAssetId: null,
  },
}
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: {
  'Content-Type': 'application/json', 'X-Quest-Data-Mode': 'demo',
} })
const page = (items: unknown[]) => json({ items, nextCursor: null })

it('confirms durable identity and membership before saving a real-source shooting area revision', async () => {
  const user = userEvent.setup()
  const snapshot: AuthSnapshot = { status: 'signed-in', user: { uid: 'test-manager', displayName: null } }
  const authClient: AuthClient = {
    getSnapshot: () => snapshot, subscribe: () => () => {},
    signInWithGoogle: async () => {}, signOut: async () => {}, getIdToken: async () => 'test-token',
  }
  const saved = { ...quest, source: 'real', shootingAreaStatus: 'unconfigured' }
  const areas = { orgId: quest.orgId, questId: quest.questId, draftRevision: quest.draftRevision, source: 'real', zones: [] }
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const path = String(input)
    let body: unknown
    if (path === '/api/v1/session') body = { uid: snapshot.user.uid }
    else if (path.startsWith('/api/v1/me/memberships?')) body = { items: [{
      orgId: quest.orgId, areaId: quest.areaId, label: '永続の架空自治体', role: 'publisher',
    }], nextCursor: null }
    else if (path.endsWith('/shooting-areas')) body = init?.method === 'PUT'
      ? { ...areas, draftRevision: 3, zones: JSON.parse(String(init.body)).zones } : areas
    else if (path.startsWith('/api/v1/orgs/' + quest.orgId + '/quests?')) body = { items: [saved], nextCursor: null }
    else throw new Error('Unexpected durable request: ' + path)
    return new Response(JSON.stringify(body), { headers: {
      'Content-Type': 'application/json', 'X-Quest-Data-Mode': 'durable-local',
    } })
  })
  vi.stubGlobal('fetch', fetcher)
  try {
    render(<LocalAdminWorkspace authClient={authClient} dataMode="durable-local" />)
    await user.click(await screen.findByRole('button', { name: /永続の架空自治体/ }))
    expect(await screen.findByText(quest.draft.content.title)).toBeVisible()
    await user.click(screen.getByRole('button', { name: '撮影範囲を設定' }))
    await user.click(await screen.findByRole('button', { name: '範囲を追加' }))
    await user.type(screen.getByLabelText('緯度'), '0')
    await user.type(screen.getByLabelText('経度'), '0')
    await user.type(screen.getByLabelText('半径（m）'), '100')
    await user.click(screen.getByRole('button', { name: '撮影範囲を保存' }))
    expect(await screen.findByText('非公開の撮影範囲を保存しました。')).toBeVisible()
    const writes = fetcher.mock.calls.filter(([, init]) => init?.method === 'PUT')
    expect(writes).toHaveLength(1)
    expect(JSON.parse(String(writes[0][1]?.body))).toMatchObject({ expectedDraftRevision: 2,
      zones: [{ latitude: 0, longitude: 0 }] })
    expect(fetcher.mock.calls[0][0]).toBe('/api/v1/session')
    for (const [, init] of fetcher.mock.calls) {
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer test-token')
    }
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  } finally { vi.unstubAllGlobals() }
})

it('does not fall back to the memory API when the selected persistent API returns a different mode', async () => {
  const snapshot: AuthSnapshot = { status: 'signed-in', user: { uid: 'test-manager', displayName: null } }
  const authClient: AuthClient = {
    getSnapshot: () => snapshot, subscribe: () => () => {},
    signInWithGoogle: async () => {}, signOut: async () => {}, getIdToken: async () => 'test-token',
  }
  const fetcher = vi.fn<typeof fetch>(async () => json({ uid: 'test-manager' }))
  vi.stubGlobal('fetch', fetcher)
  try {
    render(<LocalAdminWorkspace authClient={authClient} dataMode="durable-local" />)
    expect(await screen.findByRole('alert')).toHaveTextContent('ログインを確認できませんでした。')
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('heading', { name: '所属する組織' })).not.toBeInTheDocument()
  } finally {
    vi.unstubAllGlobals()
  }
})

it('requires verified membership, cancels an old organization read, and shows reports only for a publisher', async () => {
  const user = userEvent.setup()
  let snapshot: AuthSnapshot = { status: 'signed-out', user: null }
  const listeners = new Set<() => void>()
  const emit = (next: AuthSnapshot) => { snapshot = next; listeners.forEach((listener) => listener()) }
  const authClient: AuthClient = {
    getSnapshot: () => snapshot, subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    signInWithGoogle: async () => emit({ status: 'signed-in', user: { uid: 'demo-user', displayName: null } }),
    signOut: async () => emit({ status: 'signed-out', user: null }),
    getIdToken: async () => 'demo-token',
  }
  let finishEditor!: (value: Response) => void
  let publishedVersion: number | null = 1
  const fetcher = vi.fn<typeof fetch>(async (input) => {
    const path = String(input)
    if (path === '/api/v1/session') return json({ uid: 'demo-user' })
    if (path.startsWith('/api/v1/me/memberships')) return page([
      { orgId: 'demo-edit', label: '編集の架空自治体', role: 'editor', areaId: 'demo-area' },
      { orgId: 'demo-publish', label: '公開の架空自治体', role: 'publisher', areaId: 'demo-area' },
    ])
    if (path.startsWith('/api/v1/orgs/demo-edit/quests')) return new Promise((resolve) => { finishEditor = resolve })
    if (path === '/api/v1/orgs/demo-publish/quests/local-quest/pause') {
      if (publishedVersion === 1) {
        publishedVersion = 2
        return new Response(JSON.stringify({ error: { code: 'QUEST_CHANGED', retryable: false } }), {
          status: 409, headers: { 'Content-Type': 'application/json', 'X-Quest-Data-Mode': 'demo' },
        })
      }
      publishedVersion = null
      return json({ ...quest, status: 'paused', draftRevision: 3, publishedVersion })
    }
    if (path.startsWith('/api/v1/orgs/demo-publish/quests')) {
      return page([publishedVersion === null ? { ...quest, publishedVersion, status: 'paused', draftRevision: 3 } : { ...quest, publishedVersion }])
    }
    if (path.startsWith('/api/v1/orgs/demo-publish/reports')) return page([{
      reportId: 'demo-report', source: 'mock', orgId: 'demo-publish', questId: 'local-quest',
      questVersion: 1, category: 'UNSAFE_GUIDANCE', text: '架空の報告本文', receivedAt: '2026-11-06T00:00:00Z',
    }])
    throw new Error('Unexpected local request')
  })
  const apiClient = createApiClient({ fetch: fetcher, expectedDataMode: 'demo', getIdToken: authClient.getIdToken })
  render(<LocalAdminWorkspace authClient={authClient} apiClient={apiClient} />)
  expect(fetcher).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Googleログイン' }))
  await user.click(await screen.findByRole('button', { name: /編集の架空自治体/ }))
  expect(screen.queryByRole('button', { name: '問題報告' })).not.toBeInTheDocument()
  await waitFor(() => expect(finishEditor).toBeTypeOf('function'))
  const oldRead = fetcher.mock.calls.find(([path]) => String(path).startsWith('/api/v1/orgs/demo-edit/quests'))?.[1]
  await user.click(screen.getByRole('button', { name: /公開の架空自治体/ }))
  expect(oldRead?.signal?.aborted).toBe(true)
  expect(await screen.findByText(quest.draft.content.title)).toBeVisible()
  await act(async () => finishEditor(page([{ ...quest, orgId: 'demo-edit', draft: { ...quest.draft, content: { ...quest.draft.content, title: '古い応答' } } }])))
  expect(screen.queryByText('古い応答')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '公開を休止' }))
  await user.click(screen.getByRole('button', { name: 'キャンセル' }))
  const pauseCalls = () => fetcher.mock.calls.filter(([path]) => String(path).endsWith('/pause'))
  expect(pauseCalls()).toHaveLength(0)
  await user.click(screen.getByRole('button', { name: '公開を休止' }))
  await user.type(screen.getByLabelText('休止理由'), '架空の撮影確認')
  await user.click(screen.getByRole('button', { name: 'この公開版を休止する' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('公開版が変わりました')
  expect(pauseCalls()).toHaveLength(1)
  await user.click(screen.getByRole('button', { name: '最新の問題一覧を確認' }))
  await user.click(await screen.findByRole('button', { name: '公開を休止' }))
  await user.type(screen.getByLabelText('休止理由'), '架空の撮影確認')
  await user.click(screen.getByRole('button', { name: 'この公開版を休止する' }))
  expect(await screen.findByText('開発用の公開を休止しました。')).toBeVisible()
  expect(await screen.findByText(/問題 local-quest・休止中・下書き版 3/)).toBeVisible()
  expect(screen.queryByRole('button', { name: '公開を休止' })).not.toBeInTheDocument()
  expect(pauseCalls().map(([, init]) => JSON.parse(String(init?.body)))).toEqual([
    { expectedPublishedVersion: 1, reason: '架空の撮影確認' },
    { expectedPublishedVersion: 2, reason: '架空の撮影確認' },
  ])
  await user.click(screen.getByRole('button', { name: '問題報告' }))
  expect(await screen.findByText('架空の報告本文')).toBeVisible()
  const reportCall = fetcher.mock.calls.find(([path]) => String(path).startsWith('/api/v1/orgs/demo-publish/reports'))
  expect(new Headers(reportCall?.[1]?.headers).get('Authorization')).toBe('Bearer demo-token')
  await user.click(screen.getByRole('button', { name: 'ログアウト' }))
  expect(screen.queryByText('架空の報告本文')).not.toBeInTheDocument()
})


it.each(['demo', 'durable-local'] as const)('uses the selected %s API mode and describes its storage', async (dataMode) => {
  const snapshot: AuthSnapshot = { status: 'signed-in', user: { uid: 'demo-user', displayName: null } }
  const authClient: AuthClient = {
    getSnapshot: () => snapshot, subscribe: () => () => {},
    signInWithGoogle: async () => {}, signOut: async () => {}, getIdToken: async () => 'demo-token',
  }
  const fetcher = vi.fn<typeof fetch>(async (input) => new Response(JSON.stringify(
    String(input).endsWith('/session') ? { uid: 'demo-user' } : { items: [], nextCursor: null },
  ), { headers: { 'Content-Type': 'application/json', 'X-Quest-Data-Mode': dataMode } }))
  vi.stubGlobal('fetch', fetcher)
  try {
    render(<LocalAdminWorkspace authClient={authClient} dataMode={dataMode} />)
    expect(await screen.findByText('利用できる所属がありません。')).toBeVisible()
    expect(screen.getByText(dataMode === 'demo' ? /サーバーの一時領域に保存/ : /ローカル永続ストアに保存/)).toBeVisible()
    expect(screen.getByRole('link', { name: /未認証・未接続の架空フォーム/ })).toHaveAttribute('href', '/admin-demo')
  } finally { vi.unstubAllGlobals() }
})
