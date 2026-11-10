import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { AdminQuestWorkflow } from './AdminQuestWorkflow'
import QuestDraftForm from './QuestDraftForm'
import { LocalAdminWorkspace } from './LocalAdminWorkspace'
import { ApiError, createApiClient, type ManagedQuest } from '../../shared/api'

const member = { orgId: 'org', areaId: 'area', label: '架空自治体', role: 'editor' as const }
const initial: ManagedQuest = {
  orgId: 'org', questId: 'q', areaId: 'area', draftRevision: 1, publishedVersion: null,
  source: 'real', status: 'draft', shootingAreaStatus: 'configured',
  draft: { materials: { name: '対象', evidence: '', requiresBoat: false, requiresPaidFacility: false, price: '', photoNote: '', photoRights: '' },
    content: { title: '問題', question: '文章', hints: ['一', '二', '三'], verifiedFeatures: '特徴', draftingNotes: '' },
    afterClear: { spot: { name: '架空', address: '架空', position: { latitude: 35, longitude: 135 } }, hours: '', access: '', promoComment: '', explanation: '' }, referenceAssetId: 'ref', hintAssetId: null },
}
afterEach(() => { cleanup(); history.replaceState(null, '', '/'); vi.restoreAllMocks() })
function api() {
  return { ...createApiClient(), getManagedQuestReadiness: vi.fn().mockRejectedValue(new Error('offline')),
    updateManagedQuest: vi.fn().mockImplementation(async (_org, _id, input) => ({ ...initial, draft: input.draft, draftRevision: 2 })) }
}
it('guards only dirty edits, restores URL step, and offers three focused navigation choices', async () => {
  history.replaceState(null, '', '/?quest=q&step=target')
  const client = api(); const onBack = vi.fn()
  render(<AdminQuestWorkflow api={client} initial={initial} member={member} teamPreview={false} photoTestSource="mock" areaUnclassified={false} onBack={onBack} onPublished={vi.fn()} />)
  expect(screen.getByRole('heading', { name: '非公開', level: 2 })).toBeVisible()
  expect(screen.getAllByRole('button', { name: '謎一覧へ戻る' })).toHaveLength(1)
  expect(screen.getByRole('button', { name: '謎一覧へ戻る' })).toBe(screen.getByLabelText('問題作成', { selector: 'header' }).firstElementChild)
  expect(window.dispatchEvent(new Event('beforeunload', { cancelable: true }))).toBe(true)
  fireEvent.change(screen.getByLabelText('撮るもの'), { target: { value: '変更' } })
  expect(window.dispatchEvent(new Event('beforeunload', { cancelable: true }))).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: '謎一覧へ戻る' }))
  expect(screen.getByRole('alertdialog')).toHaveFocus()
  fireEvent.click(screen.getByRole('button', { name: 'とどまる' }))
  expect(screen.queryByRole('alertdialog')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '謎一覧へ戻る' }))
  fireEvent.click(screen.getByRole('button', { name: '保存して移動' }))
  await waitFor(() => expect(onBack).toHaveBeenCalledTimes(1))
  expect(client.updateManagedQuest).toHaveBeenCalledTimes(1)
  expect(new URLSearchParams(location.search).get('step')).toBe('target')
  await waitFor(() => expect(window.dispatchEvent(new Event('beforeunload', { cancelable: true }))).toBe(true))
})
it('blocks reversed hours and negative or fractional prices, then resets success on failed save', async () => {
  const client = api()
  render(<QuestDraftForm connection={{ api: client, initial, member, taskFocused: true, onBack: vi.fn() }} />)
  fireEvent.click(screen.getByText('クリア後'))
  fireEvent.click(screen.getByRole('radio', { name: '時刻指定' }))
  fireEvent.change(screen.getByLabelText('開始時刻'), { target: { value: '18:00' } })
  fireEvent.change(screen.getByLabelText('終了時刻'), { target: { value: '09:00' } })
  fireEvent.click(screen.getByRole('button', { name: '下書きを保存' }))
  expect(client.updateManagedQuest).not.toHaveBeenCalled()
  expect(screen.getByLabelText('終了時刻')).toHaveAccessibleDescription(/終了時刻は/)
  fireEvent.click(screen.getByLabelText('翌日終了'))
  fireEvent.change(screen.getByLabelText('料金の区分'), { target: { value: '有料' } })
  fireEvent.click(screen.getByRole('checkbox', { name: '一律' }))
  for (const value of ['-50', '1.5', '1e3']) {
    fireEvent.change(screen.getByLabelText('一律の金額'), { target: { value } })
    fireEvent.click(screen.getByRole('button', { name: '下書きを保存' }))
    expect(client.updateManagedQuest).not.toHaveBeenCalled()
    expect(screen.getByLabelText('一律の金額')).toHaveAccessibleDescription('金額は0以上の整数')
  }
  fireEvent.change(screen.getByLabelText('一律の金額'), { target: { value: '0' } })
  fireEvent.click(screen.getByRole('button', { name: '下書きを保存' }))
  expect((await screen.findByText('保存済み')).closest('[role="status"]')).toHaveFocus()
  client.updateManagedQuest.mockRejectedValue(new Error('offline'))
  fireEvent.click(screen.getByRole('button', { name: '下書きを保存' }))
  expect(screen.queryByText('保存済み')).toBeNull()
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('下書きを保存できませんでした'))
})
it('never creates an empty draft and discards only after choosing to leave without saving', () => {
  const client = { ...api(), createManagedQuest: vi.fn() }; const onBack = vi.fn()
  render(<AdminQuestWorkflow api={client} initial={null} member={member} teamPreview={false} photoTestSource="mock" areaUnclassified={false} onBack={onBack} onPublished={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  expect(client.createManagedQuest).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
  fireEvent.change(screen.getByLabelText('撮るもの'), { target: { value: '未保存' } })
  fireEvent.click(screen.getByRole('button', { name: '謎一覧へ戻る' }))
  expect(onBack).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '保存せず移動' }))
  expect(onBack).toHaveBeenCalledTimes(1)
})
it.each(['q&step=1', 'q&step=2', 'q&step=3', 'q&step=4', 'q&step=content', 'missing&step=target', 'q&step=unknown'])('restores only valid quest and step URLs: %s', async value => {
  history.replaceState(null, '', '/?quest=' + value)
  const client = { ...api(), getSession: vi.fn().mockResolvedValue({ uid: 'manager' }),
    listMemberships: vi.fn().mockResolvedValue({ items: [{ ...member, prefectureCode: '07' }], nextCursor: null }),
    listManagedQuests: vi.fn().mockResolvedValue({ items: [initial], nextCursor: null }),
    getManagedQuest: vi.fn().mockRejectedValue(new Error('not found')) }
  const snapshot = { status: 'signed-in' as const, user: { uid: 'manager', displayName: null } }
  render(<LocalAdminWorkspace dataMode="durable-local" apiClient={client} authClient={{
    getSnapshot: () => snapshot, subscribe: () => () => {}, getIdToken: async () => 'test', signInWithGoogle: async () => {}, signOut: async () => {},
  }} />)
  if (value.startsWith('q&step=') && value !== 'q&step=unknown') {
    expect(await screen.findByRole('heading', { name: '問題とヒント' })).toBeVisible()
    expect(screen.getByLabelText('タイトル')).toHaveValue('問題')
    await waitFor(() => expect(screen.getByText('所属')).not.toBeVisible())
  } else {
    await waitFor(() => expect(location.search).toBe(''))
    expect(screen.getByRole('heading', { name: '謎一覧' })).toBeVisible()
    expect(screen.queryByRole('heading', { name: /STEP/ })).toBeNull()
  }
})

it.each([
  ['draft', '下書き', '公開'], ['published', '公開中', '修正を公開'], ['paused', '休止中', '公開を再開'],
] as const)('shows %s status beside the workflow heading and names the publication action', async (status, label, action) => {
  history.replaceState(null, '', '/?quest=q&step=publication')
  const record = { ...initial, status }
  const client = { ...api(), getManagedQuestReadiness: vi.fn().mockResolvedValue({ quest: record, missing: [] }) }
  render(<AdminQuestWorkflow api={client} initial={record} member={member} teamPreview photoTestSource="mock" areaUnclassified={false} onBack={vi.fn()} onPublished={vi.fn()} />)
  expect(screen.getByText(label).closest('header')).toHaveAttribute('aria-label', '問題作成')
  expect(screen.getByRole('button', { name: action })).toBeVisible()
  expect(screen.getAllByRole('button', { name: '謎一覧へ戻る' })).toHaveLength(1)
  await waitFor(() => expect(client.getManagedQuestReadiness).toHaveBeenCalled())
})

it('lists every missing field, disables both photo trials, and focuses the selected field', async () => {
  history.replaceState(null, '', '/?quest=q&step=publication')
  const client = { ...api(), getManagedQuestReadiness: vi.fn().mockResolvedValue({ quest: initial, missing: ['materials.name', 'referenceAssetId', 'content.question', 'content.hints'] }) }
  render(<AdminQuestWorkflow api={client} initial={initial} member={member} teamPreview photoTestSource="mock" areaUnclassified={false} onBack={vi.fn()} onPublished={vi.fn()} />)
  for (const label of ['撮るもの', '正解の写真', '問題文', '3本のヒント']) expect(await screen.findByRole('button', { name: label + 'の入力へ' })).toBeVisible()
  expect(screen.getByLabelText('正解写真で試す')).toBeDisabled()
  expect(screen.getByLabelText('別の写真で試す')).toBeDisabled()
  expect(screen.getByText('不足項目')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '3本のヒントの入力へ' }))
  expect(screen.getByLabelText('ヒント 1')).toHaveFocus()
})

it('automatically opens the only team-preview organization', async () => {
  sessionStorage.clear()
  const client = { ...api(), getSession: vi.fn().mockResolvedValue({ uid: 'manager' }),
    listMemberships: vi.fn().mockResolvedValue({ items: [{ ...member, prefectureCode: '07' }], nextCursor: null }),
    listManagedQuests: vi.fn().mockResolvedValue({ items: [initial], nextCursor: null }) }
  const snapshot = { status: 'signed-in' as const, user: { uid: 'manager', displayName: null } }
  render(<LocalAdminWorkspace dataMode="team-preview" apiClient={client} authClient={{ getSnapshot: () => snapshot, subscribe: () => () => {}, getIdToken: async () => 'test', signInWithGoogle: async () => {}, signOut: async () => {} }} />)
  expect(await screen.findByText('問題')).toBeVisible()
  expect(client.listManagedQuests).toHaveBeenCalledWith(member.orgId, expect.anything(), expect.anything())
})

it.each([
  ['1', 'target-heading'], ['2', 'conditions-heading'], ['3', 'draft-heading'], ['4', 'publication-section'],
  ['target', 'target-heading'], ['conditions', 'conditions-heading'], ['content', 'draft-heading'],
  ['hints', 'hint-asset-title'], ['publication', 'publication-section'],
])('scrolls legacy step=%s to its section without hiding the other sections', (step, id) => {
  const scroll = vi.fn()
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scroll })
  history.replaceState(null, '', '/?quest=q&step=' + step)
  render(<AdminQuestWorkflow api={api()} initial={initial} member={member} teamPreview photoTestSource="mock" areaUnclassified={false} onBack={vi.fn()} onPublished={vi.fn()} />)
  expect(scroll.mock.contexts).toContain(document.getElementById(id))
  for (const name of ['非公開', '挑戦条件', '問題とヒント', 'ヒント画像', 'AI写真判定']) {
    expect(screen.getByRole('heading', { name, level: 2 })).toBeVisible()
  }
  expect(screen.queryByText(/STEP/)).toBeNull()
  expect(screen.queryAllByText('必須')).toHaveLength(0)
  expect(screen.getAllByRole('button', { name: '保存' })).toHaveLength(1)
  expect(screen.getByRole('button', { name: '保存' }).closest('.admin-save-bar')).not.toBeNull()
  expect(screen.queryByRole('button', { name: '保存して次へ' })).toBeNull()
})

it('keeps the inventory fields and distinct actions on one page', () => {
  render(<AdminQuestWorkflow api={api()} initial={initial} member={member} teamPreview photoTestSource="mock" areaUnclassified={false} onBack={vi.fn()} onPublished={vi.fn()} />)
  fireEvent.click(screen.getByText('クリア後'))
  for (const label of ['撮るもの', '正解の写真', '場所の名前', '住所', '緯度', '経度', '船上・海上', '有料施設内', '料金の区分', '行き方', '交通手段', '所要分数', '紹介', '解説', 'タイトル', '問題文', 'ヒント 1', 'ヒント 2', 'ヒント 3', '特徴', '特徴を1行で追加', '設定するヒント', 'ヒント画像', '正解写真で試す', '別の写真で試す']) {
    expect(screen.getByLabelText(label, { exact: true, selector: 'input, textarea, select' })).toBeVisible()
  }
  expect(screen.queryByRole('group', { name: '撮影の注意' })).not.toBeInTheDocument()
  for (const name of ['参照を外す', '行き方の文を作る', '特徴を追加', '画像を保存', '正解写真で試す', '別の写真で試す', '公開', '謎一覧へ戻る']) {
    expect(screen.getByRole('button', { name })).toBeVisible()
  }
  expect(screen.getByText('下書き案を取り込む')).toBeVisible()
  expect(screen.getByRole('link', { name: '一致用の合成写真' })).toHaveAttribute('download', 'match.png')
  expect(screen.getByRole('link', { name: '別対象の合成写真' })).toHaveAttribute('download', 'other-target.png')
  expect(screen.getByText((_, element) => element?.tagName === 'P' && Boolean(element.textContent?.startsWith('合成写真限定')))).toBeVisible()
})

it('saves a hint selection on guarded exit and retains it on the next body save', async () => {
  const client = { ...api(), uploadOrgAsset: vi.fn().mockResolvedValue({ assetId: 'hint-image' }) }
  client.updateManagedQuest.mockImplementation(async (_org, _id, input) => ({ ...initial, draft: input.draft, draftRevision: input.expectedDraftRevision + 1 }))
  const onBack = vi.fn()
  render(<AdminQuestWorkflow api={client} initial={initial} member={member} teamPreview photoTestSource="mock" areaUnclassified={false} onBack={onBack} onPublished={vi.fn()} />)
  fireEvent.change(screen.getByLabelText('ヒント画像', { selector: 'input' }), { target: { files: [new File(['hint'], 'hint.png', { type: 'image/png' })] } })
  expect(window.dispatchEvent(new Event('beforeunload', { cancelable: true }))).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: '画像を保存' }))
  await waitFor(() => expect(client.updateManagedQuest).toHaveBeenCalledTimes(1))
  await waitFor(() => expect(screen.queryByRole('button', { name: '選択を取り消す' })).toBeNull())
  expect(screen.getByRole('button', { name: 'ヒント 1の画像を外す' })).toBeVisible()
  fireEvent.change(screen.getByLabelText('問題文'), { target: { value: '修正した文章' } })
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  await waitFor(() => expect(client.updateManagedQuest).toHaveBeenCalledTimes(2))
  expect(client.updateManagedQuest.mock.calls[1][2].draft.hintAssetIds).toEqual(['hint-image', null, null])
  fireEvent.change(screen.getByLabelText('ヒント画像', { selector: 'input' }), { target: { files: [new File(['next'], 'next.png', { type: 'image/png' })] } })
  fireEvent.click(screen.getByRole('button', { name: '謎一覧へ戻る' }))
  fireEvent.click(screen.getByRole('button', { name: '保存して移動' }))
  await waitFor(() => expect(onBack).toHaveBeenCalledTimes(1))
  expect(client.updateManagedQuest).toHaveBeenCalledTimes(3)
})

it('shows fallback coordinates and retains Japanese photo selectors without requiring them for an empty draft', () => {
  render(<AdminQuestWorkflow api={api()} initial={null} member={member} teamPreview photoTestSource="mock" areaUnclassified={false} onBack={vi.fn()} onPublished={vi.fn()} />)
  expect(screen.getByLabelText('緯度')).toBeVisible()
  const photo = screen.getByLabelText('正解の写真')
  expect(photo.closest('label')).toHaveTextContent('写真を選ぶ')
  photo.focus()
  expect(photo).toHaveFocus()
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
})


it('saves and resaves a title-only draft with one save action while trials remain disabled', async () => {
  const client = { ...api(), createManagedQuest: vi.fn().mockImplementation(async (_org, draft) => ({
    ...initial, draft, shootingAreaStatus: 'unconfigured',
  })) }
  client.getManagedQuestReadiness.mockResolvedValue({ quest: { ...initial, draftRevision: 1 }, missing: ['referenceAssetId', 'shootingAreas', 'materials.name', 'content.question'] })
  render(<AdminQuestWorkflow api={client} initial={null} member={member} teamPreview photoTestSource="mock" areaUnclassified={false} onBack={vi.fn()} onPublished={vi.fn()} />)
  expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
  expect(screen.getByLabelText('ヒント画像', { selector: 'input' })).toBeDisabled()
  expect(screen.queryByText('下書きを保存')).toBeNull()
  fireEvent.change(screen.getByLabelText('タイトル'), { target: { value: '途中の謎' } })
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  await waitFor(() => expect(client.createManagedQuest).toHaveBeenCalledTimes(1))
  await waitFor(() => expect(screen.getByRole('button', { name: '保存' })).toBeDisabled())
  const saved = client.createManagedQuest.mock.calls[0][1]
  expect(saved.materials.name).toBe('')
  expect(saved.referenceAssetId).toBeNull()
  expect(saved.afterClear.spot).toBeUndefined()
  expect(saved.content.question).toBe('')
  expect(screen.getByLabelText('正解写真で試す')).toBeDisabled()
  expect(screen.getByLabelText('別の写真で試す')).toBeDisabled()
  expect(screen.queryByText('変更を保存')).toBeNull()
  fireEvent.change(screen.getByLabelText('タイトル'), { target: { value: '続きの謎' } })
  expect(screen.getByRole('button', { name: '保存' })).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  await waitFor(() => expect(client.updateManagedQuest).toHaveBeenCalledTimes(1))
  expect(client.updateManagedQuest.mock.calls[0][2].draft.content.title).toBe('続きの謎')
})

it('shows a server boundary rejection at the place and clears it when the place changes', async () => {
  const client = api()
  client.updateManagedQuest.mockRejectedValue(new ApiError('SPOT_OUTSIDE_AREA'))
  render(<AdminQuestWorkflow api={client} initial={initial} member={member} teamPreview photoTestSource="mock" areaUnclassified={false} onBack={vi.fn()} onPublished={vi.fn()} />)
  fireEvent.change(screen.getByLabelText('タイトル'), { target: { value: '外の謎' } })
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  await waitFor(() => expect(screen.getByRole('group', { name: '場所' })).toHaveAttribute('aria-describedby', 'spot-area-error'))
  expect(document.getElementById('spot-area-error')).toHaveTextContent('エリアの外です')
  fireEvent.change(screen.getByLabelText('緯度'), { target: { value: '1' } })
  expect(document.getElementById('spot-area-error')).toBeNull()
})
