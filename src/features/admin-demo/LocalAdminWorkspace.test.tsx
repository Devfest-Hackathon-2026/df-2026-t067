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
  const fetcher = vi.fn<typeof fetch>(async (input) => {
    const path = String(input)
    if (path === '/api/v1/session') return json({ uid: 'demo-user' })
    if (path.startsWith('/api/v1/me/memberships')) return page([
      { orgId: 'demo-edit', label: '編集の架空自治体', role: 'editor', areaId: 'demo-area' },
      { orgId: 'demo-publish', label: '公開の架空自治体', role: 'publisher', areaId: 'demo-area' },
    ])
    if (path.startsWith('/api/v1/orgs/demo-edit/quests')) return new Promise((resolve) => { finishEditor = resolve })
    if (path.startsWith('/api/v1/orgs/demo-publish/quests')) return page([quest])
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
  await user.click(screen.getByRole('button', { name: '問題報告' }))
  expect(await screen.findByText('架空の報告本文')).toBeVisible()
  const reportCall = fetcher.mock.calls.find(([path]) => String(path).startsWith('/api/v1/orgs/demo-publish/reports'))
  expect(new Headers(reportCall?.[1]?.headers).get('Authorization')).toBe('Bearer demo-token')
  await user.click(screen.getByRole('button', { name: 'ログアウト' }))
  expect(screen.queryByText('架空の報告本文')).not.toBeInTheDocument()
})
