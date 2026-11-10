import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, createApiClient } from '../../shared/api'
import type { ManagedQuest, ManagedQuestDraft } from '../../shared/api'
import QuestDraftForm from './QuestDraftForm'

const created: string[] = []
const revoked: string[] = []
let serial = 0

beforeEach(() => {
  created.length = 0
  revoked.length = 0
  serial = 0
  vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => { const value = `blob:demo-${++serial}`; created.push(value); return value }), revokeObjectURL: vi.fn(value => { revoked.push(value) }) })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

// 紹介欄を操作する既存テストは、初期折りたたみを明示的に開く。
function renderExpanded(element: Parameters<typeof render>[0]) {
  const result = render(element)
  fireEvent.click(screen.getByText('クリア後'))
  return result
}

function image(name = 'reference.png', size = 100, type = 'image/png') {
  return new File([new Uint8Array(size)], name, { type })
}

async function pasteText(user: ReturnType<typeof userEvent.setup>, label: string, value: string) {
  await user.click(screen.getByLabelText(label))
  await user.paste(value)
}

it('saves a local draft with its reference, then updates the saved revision and preserves a conflicting edit', async () => {
  const user = userEvent.setup()
  const uploadOrgAsset = vi.fn().mockResolvedValue({ assetId: 'demo-reference' })
  const saved = { questId: 'demo-draft', orgId: 'demo-org', areaId: 'demo-area', draftRevision: 1, publishedVersion: null,
    status: 'draft', source: 'mock', shootingAreaStatus: 'unconfigured' }
  const createManagedQuest = vi.fn().mockImplementation(async (_orgId: string, draft: ManagedQuestDraft) => ({ ...saved, draft }))
  const updateManagedQuest = vi.fn().mockRejectedValue(new ApiError('DRAFT_CONFLICT'))
  const api = { ...createApiClient(), uploadOrgAsset, createManagedQuest, updateManagedQuest }
  renderExpanded(<QuestDraftForm connection={{ api, initial: null, member: { orgId: 'demo-org', label: '架空自治体',
    role: 'editor', areaId: 'demo-area' }, onBack: vi.fn() }} />)
  const file = image()
  await user.type(screen.getByLabelText('撮るもの'), '架空の時計')
  await user.click(screen.getByRole('radio', { name: '補足' }))
  await user.type(screen.getByLabelText('時間補足'), '火曜から日曜')
  await user.type(screen.getByLabelText('写真の権利'), '自作の合成画像')
  await user.upload(screen.getByLabelText('正解の写真'), file)
  expect(uploadOrgAsset).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: '下書きを保存' }))
  expect(await screen.findByText('保存済み')).toBeVisible()
  expect(uploadOrgAsset).toHaveBeenCalledExactlyOnceWith('demo-org', {
    purpose: 'reference', photoRights: '自作の合成画像', photo: file, idempotencyKey: expect.any(String),
  }, { signal: expect.any(AbortSignal) })
  expect(createManagedQuest.mock.calls[0][1]).toMatchObject({
    referenceAssetId: 'demo-reference', hintAssetId: null, materials: { name: '架空の時計', evidence: '' },
    afterClear: { hours: '火曜から日曜' },
  })
  await user.selectOptions(screen.getByLabelText('料金の区分'), '無料')
  await user.click(screen.getByRole('button', { name: '下書きを保存' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('下書きの版が変わりました')
  expect(screen.getByLabelText('料金の区分')).toHaveValue('無料')
  expect(screen.getByRole('button', { name: '下書きを保存' })).toBeDisabled()
  expect(updateManagedQuest.mock.calls[0][2]).toMatchObject({
    expectedDraftRevision: 1, draft: { referenceAssetId: 'demo-reference', materials: { price: '無料' }, afterClear: { hours: '火曜から日曜' } },
  })
  expect(uploadOrgAsset).toHaveBeenCalledTimes(1)
})

it('blocks a second create when the response is lost and preserves the entered draft', async () => {
  const user = userEvent.setup()
  const createManagedQuest = vi.fn().mockRejectedValue(new ApiError('NETWORK_ERROR'))
  const api = { ...createApiClient(), createManagedQuest }
  const back = vi.fn()
  renderExpanded(<QuestDraftForm connection={{ api, initial: null, member: { orgId: 'demo-org', label: '架空自治体',
    role: 'editor', areaId: 'demo-area' }, onBack: back }} />)
  await user.type(screen.getByLabelText('撮るもの'), '架空の対象')
  await user.click(screen.getByRole('button', { name: '下書きを保存' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('再作成する前に一覧を確認')
  expect(screen.getByLabelText('撮るもの')).toHaveValue('架空の対象')
  expect(screen.getByRole('button', { name: '下書きを保存' })).toBeDisabled()
  expect(createManagedQuest).toHaveBeenCalledTimes(1)
  await user.click(screen.getByRole('button', { name: '謎一覧へ戻る' }))
  expect(back).toHaveBeenCalledOnce()
})

it.each([
  ['mock', '合成素材案'],
  ['real', 'Vertex AI案'],
] as const)('loads a %s candidate for the saved version and waits for explicit adoption and save', async (source, notice) => {
  const user = userEvent.setup()
  const initial: ManagedQuest = {
    orgId: 'demo-org', questId: 'demo-quest', areaId: 'demo-area', draftRevision: 3, publishedVersion: null,
    source: 'mock', status: 'draft', shootingAreaStatus: 'configured',
    draft: {
      materials: { name: '架空の対象', evidence: '確認材料', price: '', photoNote: '', photoRights: '自作',
        requiresBoat: false, requiresPaidFacility: false },
      content: { title: '手入力の題名', question: '', hints: ['', '', ''], verifiedFeatures: '', draftingNotes: '' },
      afterClear: { access: '', hours: '', promoComment: '', explanation: '' }, referenceAssetId: 'ref', hintAssetId: 'legacy-hint', hintAssetIds: ['hint-a', 'hint-b', null],
    },
  }
  const candidate = { ...initial.draft.content, title: '合成素材の候補', question: '架空の問題文', hints: ['1', '2', '3'],
    verifiedFeatures: '架空の特徴' }
  const generateManagedQuestDraft = vi.fn().mockResolvedValue({ orgId: initial.orgId, questId: initial.questId,
    draftRevision: 3, source, content: candidate })
  const updateManagedQuest = vi.fn().mockResolvedValue({ ...initial, draftRevision: 4 })
  const api = { ...createApiClient(), generateManagedQuestDraft, updateManagedQuest }
  renderExpanded(<QuestDraftForm connection={{ api, initial, member: { orgId: initial.orgId, label: '架空自治体',
    role: 'editor', areaId: initial.areaId }, onBack: vi.fn() }} />)
  await user.click(screen.getByRole('button', { name: '下書き・編集へ' }))
  await user.click(screen.getByText('下書き案を取り込む'))
  await user.click(screen.getByRole('button', { name: '下書き案を取得' }))
  expect(await screen.findByText(candidate.title)).toBeVisible()
  expect(screen.getByText(notice)).toBeVisible()
  expect(screen.getByLabelText('タイトル')).toHaveValue('手入力の題名')
  expect(generateManagedQuestDraft).toHaveBeenCalledExactlyOnceWith(initial.orgId, initial.questId, 3, { signal: expect.any(AbortSignal) })
  await user.type(screen.getByLabelText('タイトル'), '・追記')
  expect(screen.queryByText(candidate.title)).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '下書き案を取得' }))
  await user.click(await screen.findByRole('button', { name: 'この案を編集欄に入れる' }))
  expect(screen.getByLabelText('タイトル')).toHaveValue(candidate.title)
  expect(updateManagedQuest).not.toHaveBeenCalled()
  expect(screen.getByText('反映済み・未保存')).toBeVisible()
  expect(screen.getByLabelText('タイトル')).toHaveFocus()
  await user.click(screen.getByRole('button', { name: '元に戻す' }))
  expect(screen.getByLabelText('タイトル')).toHaveValue('手入力の題名・追記')
  await user.click(screen.getByRole('button', { name: '下書き案を取得' }))
  await user.click(await screen.findByRole('button', { name: 'この案を編集欄に入れる' }))
  await user.click(screen.getByRole('button', { name: '下書きを保存' }))
  expect(await screen.findByText('保存済み')).toBeVisible()
  expect(updateManagedQuest.mock.calls[0][2]).toMatchObject({ expectedDraftRevision: 3, draft: { content: candidate, hintAssetId: 'legacy-hint', hintAssetIds: ['hint-a', 'hint-b', null] } })
})

describe('A03 admin demo', () => {
  it('keeps the hourly selection across steps, restores legacy hours unchanged, and saves the existing string contract', async () => {
    const user = userEvent.setup()
    const legacyHours = '09:30〜17:30'
    const initial: ManagedQuest = {
      orgId: 'demo-org', questId: 'demo-quest', areaId: 'demo-area', draftRevision: 3, publishedVersion: null,
      source: 'mock', status: 'draft', shootingAreaStatus: 'unconfigured',
      draft: {
        materials: { name: '架空の対象', evidence: '確認材料', price: '', photoNote: '', photoRights: '自作', requiresBoat: false, requiresPaidFacility: false },
        content: { title: '', question: '', hints: ['', '', ''], verifiedFeatures: '', draftingNotes: '' },
        afterClear: { access: '', hours: legacyHours, promoComment: '', explanation: '' }, referenceAssetId: null, hintAssetId: null,
      },
    }
    const updateManagedQuest = vi.fn().mockImplementation(async (_orgId: string, _questId: string, request: { draft: ManagedQuestDraft }) => ({ ...initial, draft: request.draft }))
    const api = { ...createApiClient(), updateManagedQuest }
    renderExpanded(<QuestDraftForm connection={{ api, initial, member: { orgId: initial.orgId, label: '架空自治体', role: 'editor', areaId: initial.areaId }, onBack: vi.fn() }} />)
    expect(screen.getByRole('radio', { name: '補足' })).toBeChecked()
    expect(screen.getByLabelText('時間補足')).toHaveValue(legacyHours)
    await user.click(screen.getByRole('radio', { name: '時刻指定' }))
    expect(screen.queryByLabelText('時間補足')).not.toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('開始時刻'), '09:00')
    await user.selectOptions(screen.getByLabelText('終了時刻'), '17:00')
    await user.click(screen.getByRole('radio', { name: '補足' }))
    expect(screen.getByLabelText('時間補足')).toHaveValue(legacyHours)
    const supplementRadio = screen.getByRole('radio', { name: '補足' })
    supplementRadio.focus()
    await user.keyboard('{ArrowLeft}')
    expect(screen.getByRole('radio', { name: '時刻指定' })).toBeChecked()
    expect(screen.getByLabelText('開始時刻')).toHaveValue('09:00')
    expect(screen.getByLabelText('終了時刻')).toHaveValue('17:00')
    await user.click(screen.getByRole('button', { name: '下書きを保存' }))
    expect(await screen.findByText('保存済み')).toBeVisible()
    expect(updateManagedQuest.mock.calls[0][2].draft.afterClear.hours).toBe('09:00〜17:00')
  })

  it('blocks a partial hourly range from summary, navigation, and saving with a focused error', async () => {
    const user = userEvent.setup()
    const createManagedQuest = vi.fn()
    const api = { ...createApiClient(), createManagedQuest }
    renderExpanded(<QuestDraftForm connection={{ api, initial: null, member: { orgId: 'demo-org', label: '架空自治体', role: 'editor', areaId: 'demo-area' }, onBack: vi.fn() }} />)
    await user.click(screen.getByRole('radio', { name: '時刻指定' }))
    await user.selectOptions(screen.getByLabelText('開始時刻'), '09:00')
    await user.click(screen.getByRole('button', { name: '入力内容を確認' }))
    expect(screen.getByRole('alert')).toHaveTextContent('開始・終了時刻を選択')
    await waitFor(() => expect(screen.getByRole('alert')).toHaveFocus())
    expect(screen.queryByRole('heading', { name: '入力内容の確認' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '下書き・編集へ' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveFocus())
    expect(screen.getByRole('heading', { name: '非公開' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '下書きを保存' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveFocus())
    expect(createManagedQuest).not.toHaveBeenCalled()
  })

  it.each([
    ['09:00〜翌日 17:00', '時刻指定'],
    ['17:00〜09:00', '補足'],
    ['09:30〜17:30', '補足'],
    ['09:00〜24:00', '時刻指定'],
  ])('restores and saves %s without silently changing its meaning', async (hours, mode) => {
    const user = userEvent.setup()
    const initial: ManagedQuest = {
      orgId: 'test-org', questId: 'test-quest', areaId: 'test-area', draftRevision: 2, publishedVersion: null,
      source: 'mock', status: 'draft', shootingAreaStatus: 'unconfigured',
      draft: {
        materials: { name: '架空の場所', evidence: '確認済み', requiresBoat: false, requiresPaidFacility: false, price: '', photoNote: '', photoRights: '' },
        content: { title: '', question: '', hints: ['', '', ''], verifiedFeatures: '', draftingNotes: '' },
        afterClear: { access: '', hours, promoComment: '', explanation: '' }, referenceAssetId: null, hintAssetId: null,
      },
    }
    const updateManagedQuest = vi.fn().mockResolvedValue({ ...initial, draftRevision: 3 })
    renderExpanded(<QuestDraftForm connection={{ api: { ...createApiClient(), updateManagedQuest }, initial,
      member: { orgId: initial.orgId, areaId: initial.areaId, label: '架空自治体', role: 'editor' }, onBack: vi.fn() }} />)
    expect(screen.getByRole('radio', { name: mode })).toBeChecked()
    await user.click(screen.getByRole('button', { name: '下書きを保存' }))
    expect(await screen.findByText('保存済み')).toBeVisible()
    expect(updateManagedQuest.mock.calls[0][2].draft.afterClear.hours).toBe(hours)
  })

  it('keeps text input in component state and exposes A04/A05', async () => {
    const user = userEvent.setup()
    const { rerender } = renderExpanded(<QuestDraftForm />)
    await user.type(screen.getByLabelText('撮るもの'), '架空の時計台')
    await user.type(screen.getByLabelText('行き方'), '駅から歩く')
    await user.click(screen.getByRole('radio', { name: '終日' }))
    await user.type(screen.getByLabelText('紹介'), '地域のおすすめ')
    await user.type(screen.getByLabelText('解説'), 'スポットの背景です')
    await user.type(screen.getByLabelText('料金'), '無料')
    await user.type(screen.getByLabelText('写真の権利'), 'チーム撮影・利用許諾済み')
    rerender(<QuestDraftForm />)
    expect(screen.getByLabelText('撮るもの')).toHaveValue('架空の時計台')
    expect(screen.getByLabelText('行き方')).toHaveValue('駅から歩く')
    expect(screen.getByRole('radio', { name: '終日' })).toBeChecked()
    expect(screen.getByLabelText('紹介')).toHaveValue('地域のおすすめ')
    expect(screen.getByLabelText('解説')).toHaveValue('スポットの背景です')
    expect(screen.getByLabelText('料金')).toHaveValue('無料')
    expect(screen.getByLabelText('写真の権利')).toHaveValue('チーム撮影・利用許諾済み')
    expect(screen.getByRole('navigation', { name: '登録手順' })).toHaveTextContent('1/3')
    const steps = screen.getByRole('navigation', { name: '登録手順' })
    expect(within(steps).getByRole('button', { name: /2\/3.*下書き編集/ })).toBeEnabled()
    expect(within(steps).getByRole('button', { name: /3\/3.*プレビュー/ })).toBeEnabled()
  })

  it('notes AI auto-entry as preparing without offering an unusable choice', () => {
    renderExpanded(<QuestDraftForm />)
    expect(screen.queryByRole('radiogroup', { name: '紹介・解説の入力方法' })).not.toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: /AI自動入力/ })).not.toBeInTheDocument()
    expect(screen.queryByText('AIによる自動入力はまだ使えません。')).not.toBeInTheDocument()
    expect(screen.getByLabelText('紹介')).toBeEnabled()
    expect(screen.getByLabelText('解説')).toBeEnabled()
  })

  it('keeps the two shooting requirements independent and shows only selected indicators', async () => {
    const user = userEvent.setup()
    renderExpanded(<QuestDraftForm />)
    const boat = screen.getByRole('checkbox', { name: '船上・海上' })
    const paid = screen.getByRole('checkbox', { name: '有料施設内' })
    expect(boat).not.toBeChecked()
    expect(paid).not.toBeChecked()
    await user.click(boat)
    await user.type(screen.getByLabelText('撮るもの'), '場所')
    await user.click(screen.getByRole('button', { name: '下書き・編集へ' }))
    await user.click(screen.getByRole('button', { name: '表示プレビューへ' }))
    const challenge = screen.getByRole('article')
    expect(within(challenge).getByRole('img', { name: '船上・海上での撮影が必要' })).toBeVisible()
    expect(within(challenge).queryByText('有料施設内')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /1\/3.*素材・場所/ }))
    await user.click(screen.getByRole('checkbox', { name: '有料施設内' }))
    expect(screen.getByRole('checkbox', { name: '船上・海上' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: '有料施設内' })).toBeChecked()
    await user.click(screen.getByRole('button', { name: /2\/3.*下書き編集/ }))
    await user.click(screen.getByRole('button', { name: '表示プレビューへ' }))
    expect(screen.getByRole('article').querySelectorAll('.condition-indicator')).toHaveLength(2)
    expect(screen.getByRole('img', { name: '有料施設内での撮影が必要' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: /1\/3.*素材・場所/ }))
    await user.click(screen.getByRole('checkbox', { name: '船上・海上' }))
    await user.click(screen.getByRole('button', { name: /2\/3.*下書き編集/ }))
    await user.click(screen.getByRole('button', { name: '表示プレビューへ' }))
    expect(screen.getByRole('article').querySelectorAll('.condition-indicator')).toHaveLength(1)
    expect(screen.getByRole('img', { name: '有料施設内での撮影が必要' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: /1\/3.*素材・場所/ }))
    await user.click(screen.getByRole('checkbox', { name: '有料施設内' }))
    await user.click(screen.getByRole('button', { name: /2\/3.*下書き編集/ }))
    await user.click(screen.getByRole('button', { name: '表示プレビューへ' }))
    expect(screen.getByRole('article').querySelector('.condition-indicators')).toBeNull()
  })

  it('previews, replaces, deletes, and revokes object URLs', async () => {
    const user = userEvent.setup()
    const { unmount } = renderExpanded(<QuestDraftForm />)
    const input = screen.getByLabelText(/正解の写真/)
    await user.upload(input, image())
    expect(await screen.findByRole('img', { name: '選択した参考写真：reference.png' })).toHaveAttribute('src', 'blob:demo-1')
    await user.upload(input, image('replacement.webp', 80, 'image/webp'))
    expect(await screen.findByRole('img', { name: '選択した参考写真：replacement.webp' })).toHaveAttribute('src', 'blob:demo-2')
    expect(revoked).toContain('blob:demo-1')
    await user.click(screen.getByRole('button', { name: '削除' }))
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(revoked).toContain('blob:demo-2')
    await user.upload(input, image('last.jpg', 80, 'image/jpeg'))
    unmount()
    expect(revoked).toContain('blob:demo-3')
  })

  it('shows the selected filename and allows selecting the same reference photo again', async () => {
    const user = userEvent.setup()
    renderExpanded(<QuestDraftForm />)
    const input = screen.getByLabelText(/正解の写真/)
    await user.upload(input, image())
    expect(screen.getByRole('region', { name: '選択中の参考写真' })).toHaveTextContent('選択中：reference.png')
    await user.upload(input, image())
    expect(screen.getByRole('img', { name: '選択した参考写真：reference.png' })).toHaveAttribute('src', 'blob:demo-2')
    expect(revoked).toContain('blob:demo-1')
  })

  it('does not revoke the live preview under StrictMode and releases it on unmount', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<StrictMode><QuestDraftForm /></StrictMode>)
    await user.upload(screen.getByLabelText(/正解の写真/), image())
    expect(screen.getByRole('img')).toHaveAttribute('src', 'blob:demo-1')
    expect(revoked).not.toContain('blob:demo-1')
    unmount()
    expect(revoked.filter(url => url === 'blob:demo-1')).toHaveLength(1)
  })

  it('reports object URL creation failures and allows a later retry', async () => {
    const user = userEvent.setup()
    const createObjectURL = vi.fn().mockImplementationOnce(() => { throw new Error('unavailable') }).mockReturnValue('blob:recovered')
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL: vi.fn() })
    renderExpanded(<QuestDraftForm />)
    const input = screen.getByLabelText(/正解の写真/)
    await user.upload(input, image())
    expect(screen.getByRole('alert')).toHaveTextContent('画像読込失敗')
    await user.upload(input, image('retry.png'))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('img')).toHaveAttribute('src', 'blob:recovered')
  })

  it('reports invalid and oversized files and recovers with a valid selection', async () => {
    const user = userEvent.setup({ applyAccept: false })
    renderExpanded(<QuestDraftForm />)
    const input = screen.getByLabelText(/正解の写真/)
    await user.upload(input, image('empty.png', 0))
    expect(screen.getByRole('alert')).toHaveTextContent('空の画像')
    await user.upload(input, image('wrong.gif', 30, 'image/gif'))
    expect(screen.getByRole('alert')).toHaveTextContent('JPEG・PNG・WebP')
    await user.upload(input, image('large.png', 5 * 1024 * 1024 + 1))
    expect(screen.getByRole('alert')).toHaveTextContent('5MB')
    await user.upload(input, image())
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    expect(screen.getByRole('img')).toBeInTheDocument()
  })

  it('handles image load failure and offers retry', async () => {
    const user = userEvent.setup()
    renderExpanded(<QuestDraftForm />)
    await user.upload(screen.getByLabelText(/正解の写真/), image())
    fireEvent.error(screen.getByRole('img'))
    expect(screen.getByRole('alert')).toHaveTextContent('画像読込失敗')
    expect(screen.getByLabelText('正解の写真').closest('label')).toHaveTextContent('写真を選ぶ')
    await user.upload(screen.getByLabelText('正解の写真'), image('retry.png'))
    expect(screen.queryByText('画像読込失敗・選び直す')).not.toBeInTheDocument()
  })

  it('exposes accessible fieldsets, labels, focusable controls and no private coordinates or network actions', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    renderExpanded(<QuestDraftForm />)
    expect(screen.getByRole('group', { name: '撮影条件' })).toBeInTheDocument()
    expect(screen.getByLabelText('行き方')).toBeInTheDocument()
    expect(screen.getByText('未設定・接続待ち')).toBeInTheDocument()
    expect(screen.getByText(/自治体：青葉みらい市/)).toBeInTheDocument()
    expect(screen.getByText(/探索エリア：青葉みらい市/)).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/緯度|経度|半径\s*\d/)
    const user = userEvent.setup()
    await user.tab()
    expect(screen.getByLabelText('撮るもの')).toHaveFocus()
    await user.tab()
    expect(screen.getByLabelText(/正解の写真/)).toHaveFocus()
    await userEvent.setup().click(screen.getByRole('button', { name: '入力内容を確認' }))
    expect(screen.getByText(/未保存・再読込で消去・AI未接続/)).toBeInTheDocument()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(screen.getByLabelText('撮るもの')).toHaveFocus()
  })

  it('keeps focus on the field after a validation error and focuses the first missing field on a new attempt', async () => {
    const user = userEvent.setup()
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback)
      return frames.length
    })
    renderExpanded(<QuestDraftForm />)
    const confirm = screen.getByRole('button', { name: '入力内容を確認' })
    await user.click(confirm)
    const firstMissing = screen.getByLabelText('撮るもの')
    expect(firstMissing).toHaveFocus()

    const other = screen.getByLabelText('写真の権利')
    other.focus()
    frames.forEach((callback) => callback(0))
    expect(other).toHaveFocus()

    await user.click(confirm)
    expect(firstMissing).toHaveFocus()
  })

  it('supports keyboard toggling and discards all form state after unmount', async () => {
    const user = userEvent.setup()
    const { unmount } = renderExpanded(<QuestDraftForm />)
    const boat = screen.getByRole('checkbox', { name: '船上・海上' })
    boat.focus()
    await user.keyboard(' ')
    expect(boat).toBeChecked()
    await user.type(screen.getByLabelText('撮るもの'), '一時入力')
    unmount()
    renderExpanded(<QuestDraftForm />)
    expect(screen.getByLabelText('撮るもの')).toHaveValue('')
    expect(screen.getByRole('checkbox', { name: '船上・海上' })).not.toBeChecked()
  })

  it('retains a load failure when a replacement file is rejected', async () => {
    const user = userEvent.setup({ applyAccept: false })
    renderExpanded(<QuestDraftForm />)
    const input = screen.getByLabelText(/正解の写真/)
    await user.upload(input, image())
    fireEvent.error(screen.getByRole('img'))
    await user.upload(input, image('wrong.gif', 30, 'image/gif'))
    expect(screen.getAllByRole('alert').map(item => item.textContent).join(' ')).toMatch(/画像読込失敗/)
    expect(screen.getByLabelText('正解の写真').closest('label')).toHaveTextContent('写真を選ぶ')
  })

  it('keeps every A03 field, the photo URL, and edited draft through A03/A04 navigation', async () => {
    const user = userEvent.setup()
    const { unmount } = renderExpanded(<QuestDraftForm />)
    await user.type(screen.getByLabelText('撮るもの'), '架空の風車')
    await user.click(screen.getByRole('checkbox', { name: '船上・海上' }))
    await user.click(screen.getByRole('checkbox', { name: '有料施設内' }))
    await pasteText(user, '行き方', '駅から10分')
    await user.click(screen.getByRole('radio', { name: '補足' }))
    await pasteText(user, '時間補足', '日中')
    await pasteText(user, '紹介', '地元の魅力')
    await pasteText(user, '解説', '歴史の紹介')
    await pasteText(user, '料金', '無料')
    await pasteText(user, '写真の権利', 'チーム撮影')
    await user.upload(screen.getByLabelText(/正解の写真/), image())
    await user.click(screen.getByRole('button', { name: '下書き・編集へ' }))
    expect(screen.getByRole('heading', { name: '文章編集' })).toHaveFocus()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(revoked).not.toContain('blob:demo-1')
    await user.type(screen.getByLabelText('タイトル'), ' 手直し')
    await user.click(screen.getByRole('button', { name: '次のヒントを書く' }))
    await user.type(screen.getByLabelText('ヒント 2'), ' 追加の手掛かり')
    await user.click(screen.getByRole('button', { name: '素材へ' }))
    expect(screen.getByRole('heading', { name: '非公開' })).toHaveFocus()
    expect(screen.getByLabelText('撮るもの')).toHaveValue('架空の風車')
    expect(screen.getByRole('checkbox', { name: '船上・海上' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: '有料施設内' })).toBeChecked()
    expect(screen.getByLabelText('行き方')).toHaveValue('駅から10分')
    expect(screen.getByLabelText('時間補足')).toHaveValue('日中')
    expect(screen.getByLabelText('紹介')).toHaveValue('地元の魅力')
    expect(screen.getByLabelText('解説')).toHaveValue('歴史の紹介')
    expect(screen.getByLabelText('料金')).toHaveValue('無料')
    expect(screen.getByLabelText('写真の権利')).toHaveValue('チーム撮影')
    expect(screen.getByRole('img', { name: '選択した参考写真：reference.png' })).toHaveAttribute('src', 'blob:demo-1')
    expect(screen.queryByText('素材が変更されています。下書きを確認してください。')).not.toBeInTheDocument()
    await user.type(screen.getByLabelText('行き方'), '・徒歩')
    await user.click(screen.getByRole('button', { name: /2\/3.*下書き編集/ }))
    expect(screen.getByRole('status')).toHaveTextContent('素材が変更されています')
    expect(screen.getByLabelText('タイトル')).toHaveValue(' 手直し')
    expect(screen.getByLabelText('ヒント 2')).toHaveValue(' 追加の手掛かり')
    await user.click(screen.getByRole('button', { name: '素材へ' }))
    expect(revoked).not.toContain('blob:demo-1')
    unmount()
    expect(revoked.filter(url => url === 'blob:demo-1')).toHaveLength(1)
  })

  it('requires target before opening A04, with an inline error, and has no evidence field', async () => {
    const user = userEvent.setup()
    renderExpanded(<QuestDraftForm />)
    expect(screen.queryByLabelText('対象にした理由')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '下書き・編集へ' }))
    expect(screen.getByRole('alert')).toHaveTextContent('撮るものを入力')
    expect(screen.queryByLabelText('タイトル')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '入力内容を確認' }))
    expect(screen.getByRole('alert')).toHaveTextContent('撮るものを入力')
    expect(screen.queryByRole('heading', { name: '入力内容の確認' })).not.toBeInTheDocument()
    await user.type(screen.getByLabelText('撮るもの'), '   ')
    await user.click(screen.getByRole('button', { name: '下書き・編集へ' }))
    expect(screen.getByRole('alert')).toHaveTextContent('撮るものを入力')
    await user.clear(screen.getByLabelText('撮るもの'))
    await user.type(screen.getByLabelText('撮るもの'), '架空スポット')
    await user.click(screen.getByRole('button', { name: '入力内容を確認' }))
    expect(screen.getByRole('heading', { name: '入力内容の確認' })).toBeVisible()
    expect(screen.getByRole('region', { name: '入力内容の確認' })).not.toHaveTextContent('撮影の注意')
    await user.clear(screen.getByLabelText('撮るもの'))
    await user.click(screen.getByRole('button', { name: '入力内容を確認' }))
    expect(screen.getByRole('alert')).toHaveTextContent('撮るものを入力')
    expect(screen.queryByRole('heading', { name: '入力内容の確認' })).not.toBeInTheDocument()
    await user.type(screen.getByLabelText('撮るもの'), '架空スポット')
    const a04Step = screen.getByRole('button', { name: /2\/3.*下書き編集/ })
    a04Step.focus()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('heading', { name: '文章編集' })).toHaveFocus()
    expect(screen.getByLabelText('タイトル')).toHaveValue('')
  })

  it('loads a fictional sample only on request and confirms before overwriting edits', async () => {
    const user = userEvent.setup()
    renderExpanded(<QuestDraftForm />)
    await user.type(screen.getByLabelText('撮るもの'), '対象')
    await user.click(screen.getByRole('button', { name: '下書き・編集へ' }))
    expect(screen.getByLabelText('タイトル')).toHaveValue('')
    await user.click(screen.getByRole('button', { name: 'サンプル' }))
    expect(screen.getByLabelText('タイトル')).toHaveValue('青葉みらい市の風見の丘')
    expect((screen.getByLabelText('問題文') as HTMLTextAreaElement).value).toContain('架空')
    await user.clear(screen.getByLabelText('タイトル'))
    await user.type(screen.getByLabelText('タイトル'), '自分の編集')
    await user.click(screen.getByRole('button', { name: 'サンプル' }))
    expect(screen.getByRole('group', { name: 'サンプル置換の確認' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'キャンセル' }))
    expect(screen.getByLabelText('タイトル')).toHaveValue('自分の編集')
    await user.click(screen.getByRole('button', { name: 'サンプル' }))
    await user.click(screen.getByRole('button', { name: '置き換える' }))
    expect(screen.getByLabelText('タイトル')).toHaveValue('青葉みらい市の風見の丘')
    expect(screen.queryByText(/ヒント画像は、参考写真から自動流用しません/)).not.toBeInTheDocument()
  })

  it('renders user-entered markup as text and performs no network or storage writes', async () => {
    const user = userEvent.setup()
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const storageSpy = vi.spyOn(Storage.prototype, 'setItem')
    const alertSpy = vi.spyOn(window, 'alert')
    renderExpanded(<QuestDraftForm />)
    const payload = '<script>window.__demoExecuted = true</script><img src=x onerror=alert(1)>'
    await user.type(screen.getByLabelText('撮るもの'), payload)
    await user.click(screen.getByRole('button', { name: '下書き・編集へ' }))
    await user.type(screen.getByLabelText('問題文'), payload)
    expect(screen.getByLabelText('問題文')).toHaveValue(payload)
    expect(document.querySelector('.draft-editor script')).not.toBeInTheDocument()
    expect(document.querySelector('.draft-editor img')).not.toBeInTheDocument()
    expect((window as Window & { __demoExecuted?: boolean }).__demoExecuted).toBeUndefined()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(storageSpy).not.toHaveBeenCalled()
    expect(alertSpy).not.toHaveBeenCalled()
  })

  it('shows only the traveler allowlist and excludes private A03/A04 details and the reference photo', async () => {
    const user = userEvent.setup()
    renderExpanded(<QuestDraftForm />)
    await pasteText(user, '撮るもの', 'PRIVATE_TARGET_91')
    await pasteText(user, '写真の権利', 'PRIVATE_RIGHTS_91')
    await user.click(screen.getByRole('checkbox', { name: '船上・海上' }))
    await pasteText(user, '行き方', 'PUBLIC_ACCESS_91')
    await user.click(screen.getByRole('radio', { name: '補足' }))
    await pasteText(user, '時間補足', 'PUBLIC_HOURS_91')
    await pasteText(user, '紹介', 'PUBLIC_PROMO_91')
    await pasteText(user, '解説', 'PUBLIC_EXPLANATION_91')
    await pasteText(user, '料金', 'PUBLIC_PRICE_91')
    await user.upload(screen.getByLabelText(/正解の写真/), image('PRIVATE_FILENAME_91.png'))
    await user.click(screen.getByRole('button', { name: '下書き・編集へ' }))
    const privateMemo = 'PRIVATE_DRAFT_MEMO_91'
    await user.type(screen.getByLabelText('タイトル'), '<b>架空タイトル</b>')
    await user.type(screen.getByLabelText('問題文'), 'PUBLIC_QUESTION_91')
    await user.type(screen.getByLabelText('ヒント 1'), 'PUBLIC_HINT_91')
    await user.type(screen.getByLabelText('特徴'), 'PRIVATE_FEATURE_91')
    await user.type(screen.getByLabelText('下書きの根拠・人のメモ'), privateMemo)
    await user.click(screen.getByRole('button', { name: '表示プレビューへ' }))
    const preview = screen.getByRole('region', { name: 'プレビュー' })
    expect(preview).not.toHaveTextContent('撮影の注意')
    expect(within(preview).getByRole('heading', { level: 3, name: '<b>架空タイトル</b>' })).toBeInTheDocument()
    expect(within(preview).getByText('PUBLIC_QUESTION_91')).toBeInTheDocument()
    expect(within(preview).getByText('PUBLIC_HINT_91')).toBeInTheDocument()
    expect(within(preview).getByRole('img', { name: '船上・海上での撮影が必要' })).toBeVisible()
    for (const value of ['PUBLIC_PRICE_91']) {
      expect(within(preview).getByText(value)).toBeVisible()
    }
    for (const value of ['PUBLIC_ACCESS_91', 'PUBLIC_HOURS_91', 'PUBLIC_PROMO_91', 'PUBLIC_EXPLANATION_91']) {
      expect(preview.textContent).not.toContain(value)
    }
    expect(preview.textContent).toContain('青葉みらい市の行政区域')
    for (const privateValue of ['PRIVATE_TARGET_91', 'PRIVATE_RIGHTS_91', 'PRIVATE_FILENAME_91.png', privateMemo, 'PRIVATE_FEATURE_91', 'blob:demo-1']) {
      expect(preview.textContent).not.toContain(privateValue)
    }
    expect(preview.querySelector('img, b, script')).toBeNull()
    expect(preview.textContent).not.toContain('公開ヒント画像は未設定')
    await user.click(within(preview).getByRole('button', { name: 'クリア後' }))
    expect(within(preview).getByRole('button', { name: 'クリア後' })).toHaveAttribute('aria-pressed', 'true')
    for (const value of ['PUBLIC_ACCESS_91', 'PUBLIC_HOURS_91', 'PUBLIC_PROMO_91', 'PUBLIC_EXPLANATION_91']) {
      expect(within(preview).getByText(value)).toBeVisible()
    }
    for (const challengeValue of ['架空タイトル', 'PUBLIC_QUESTION_91', 'PUBLIC_HINT_91', '船上・海上', 'PRIVATE_TARGET_91', 'PRIVATE_RIGHTS_91']) {
      expect(preview.textContent).not.toContain(challengeValue)
    }
    expect(preview.querySelector('img, b, script')).toBeNull()
  }, 15000)

  it('opens hints with keyboard and resets them closed when the preview is re-entered', async () => {
    const user = userEvent.setup()
    renderExpanded(<QuestDraftForm />)
    await user.type(screen.getByLabelText('撮るもの'), '場所')
    await user.click(screen.getByRole('button', { name: '下書き・編集へ' }))
    await user.type(screen.getByLabelText('ヒント 1'), '風車のある場所')
    await user.click(screen.getByRole('button', { name: '表示プレビューへ' }))
    expect(screen.getByRole('heading', { name: 'プレビュー' })).toHaveFocus()
    const firstHint = screen.getByRole('button', { name: 'ヒント 1を見る' })
    firstHint.focus()
    await user.keyboard(' ')
    expect(firstHint).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('風車のある場所')).toBeVisible()
    await user.keyboard('{Enter}')
    expect(firstHint).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText('風車のある場所')).not.toBeVisible()
    await user.keyboard(' ')
    await user.click(screen.getByRole('button', { name: 'ヒント 2を見る' }))
    expect(firstHint).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: 'ヒント 2を見る' })).toHaveAttribute('aria-expanded', 'true')
    await user.click(screen.getByRole('button', { name: '文章を編集' }))
    await user.click(screen.getByRole('button', { name: '表示プレビューへ' }))
    expect(screen.getByRole('button', { name: 'ヒント 1を見る' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText('風車のある場所')).not.toBeVisible()
  })

  it('keeps A03/A04/photo state across A05 navigation, refreshes preview content, and releases photo on unmount', async () => {
    const user = userEvent.setup()
    const { unmount } = renderExpanded(<QuestDraftForm />)
    await user.type(screen.getByLabelText('撮るもの'), 'PRIVATE_SPOT')
    await user.click(screen.getByRole('checkbox', { name: '船上・海上' }))
    await user.click(screen.getByRole('checkbox', { name: '有料施設内' }))
    await user.type(screen.getByLabelText('行き方'), 'PUBLIC_ACCESS_BEFORE')
    await user.click(screen.getByRole('radio', { name: '補足' }))
    await user.type(screen.getByLabelText('時間補足'), 'PUBLIC_HOURS_BEFORE')
    await user.type(screen.getByLabelText('紹介'), 'PUBLIC_PROMO_BEFORE')
    await user.type(screen.getByLabelText('解説'), 'PUBLIC_EXPLANATION_BEFORE')
    await user.type(screen.getByLabelText('料金'), 'PUBLIC_PRICE_BEFORE')
    await user.type(screen.getByLabelText('写真の権利'), 'PRIVATE_RIGHTS')
    await user.upload(screen.getByLabelText(/正解の写真/), image('private-photo.png'))
    await user.click(screen.getByRole('button', { name: '下書き・編集へ' }))
    await user.type(screen.getByLabelText('タイトル'), 'PUBLIC_TITLE_BEFORE')
    await user.click(screen.getByRole('button', { name: '表示プレビューへ' }))
    expect(screen.getByText('PUBLIC_TITLE_BEFORE')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /1\/3.*素材・場所/ }))
    expect(screen.getByLabelText('撮るもの')).toHaveValue('PRIVATE_SPOT')
    expect(screen.getByRole('checkbox', { name: '船上・海上' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: '有料施設内' })).toBeChecked()
    expect(screen.getByLabelText('行き方')).toHaveValue('PUBLIC_ACCESS_BEFORE')
    expect(screen.getByLabelText('時間補足')).toHaveValue('PUBLIC_HOURS_BEFORE')
    expect(screen.getByLabelText('紹介')).toHaveValue('PUBLIC_PROMO_BEFORE')
    expect(screen.getByLabelText('解説')).toHaveValue('PUBLIC_EXPLANATION_BEFORE')
    expect(screen.getByLabelText('料金')).toHaveValue('PUBLIC_PRICE_BEFORE')
    expect(screen.getByLabelText('写真の権利')).toHaveValue('PRIVATE_RIGHTS')
    expect(screen.getByRole('img', { name: '選択した参考写真：private-photo.png' })).toHaveAttribute('src', 'blob:demo-1')
    expect(revoked).not.toContain('blob:demo-1')
    await user.click(screen.getByRole('button', { name: /2\/3.*下書き編集/ }))
    expect(screen.getByLabelText('タイトル')).toHaveValue('PUBLIC_TITLE_BEFORE')
    await user.clear(screen.getByLabelText('タイトル'))
    await user.type(screen.getByLabelText('タイトル'), 'PUBLIC_TITLE_AFTER')
    await user.click(screen.getByRole('button', { name: '表示プレビューへ' }))
    expect(screen.getByText('PUBLIC_TITLE_AFTER')).toBeInTheDocument()
    expect(screen.queryByText('PUBLIC_TITLE_BEFORE')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'クリア後' }))
    expect(screen.getByText('PUBLIC_ACCESS_BEFORE')).toBeVisible()
    expect(screen.getByText('PUBLIC_PROMO_BEFORE')).toBeVisible()
    expect(screen.getByText('PUBLIC_EXPLANATION_BEFORE')).toBeVisible()
    await user.click(screen.getByRole('button', { name: '文章を編集' }))
    expect(revoked).not.toContain('blob:demo-1')
    unmount()
    expect(revoked.filter(url => url === 'blob:demo-1')).toHaveLength(1)
  })

  it('shows empty after-clear fields and switches modes with the keyboard without clearing a quest', async () => {
    const user = userEvent.setup()
    renderExpanded(<QuestDraftForm />)
    await user.click(screen.getByRole('button', { name: /3\/3.*プレビュー/ }))
    const afterMode = screen.getByRole('button', { name: 'クリア後' })
    afterMode.focus()
    await user.keyboard('{Enter}')
    expect(afterMode).toHaveAttribute('aria-pressed', 'true')
    const explanation = screen.getByRole('article', { name: 'クリア後' })
    expect(within(explanation).getAllByText('未入力')).toHaveLength(4)
    expect(screen.getByRole('heading', { name: 'プレビュー' })).toHaveFocus()
    expect(screen.queryByRole('button', { name: /正解|クリアする|公開/ })).not.toBeInTheDocument()
    const challengeMode = screen.getByRole('button', { name: '挑戦前' })
    challengeMode.focus()
    await user.keyboard(' ')
    expect(challengeMode).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('article', { name: 'クリア後' })).not.toBeInTheDocument()
  })

  it('keeps explanation markup out of the question DOM and renders it only as text after switching', async () => {
    const user = userEvent.setup()
    const storageSpy = vi.spyOn(Storage.prototype, 'setItem')
    const payload = '<img src=x onerror=alert(91)><script>alert(91)</script>'
    renderExpanded(<QuestDraftForm />)
    await user.type(screen.getByLabelText('紹介'), payload)
    await user.type(screen.getByLabelText('解説', { exact: true }), 'EXPLANATION_ONLY_91')
    await user.click(screen.getByRole('button', { name: /3\/3.*プレビュー/ }))
    const preview = screen.getByRole('region', { name: 'プレビュー' })
    expect(preview).not.toHaveTextContent('撮影の注意')
    expect(preview.outerHTML).not.toContain('EXPLANATION_ONLY_91')
    expect(preview.outerHTML).not.toContain('alert(91)')
    await user.click(screen.getByRole('button', { name: 'クリア後' }))
    const explanation = screen.getByRole('article', { name: 'クリア後' })
    expect(within(explanation).getByText(payload)).toBeVisible()
    expect(within(explanation).getByText('EXPLANATION_ONLY_91')).toBeVisible()
    expect(explanation.querySelector('img, script')).toBeNull()
    expect(storageSpy).not.toHaveBeenCalled()
  })

  it('allows a blank preview without implying readiness and returns directly to editing its text', async () => {
    const user = userEvent.setup()
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const storageSpy = vi.spyOn(Storage.prototype, 'setItem')
    renderExpanded(<QuestDraftForm />)
    await user.click(screen.getByRole('button', { name: /3\/3.*プレビュー/ }))
    expect(screen.getByRole('heading', { name: 'プレビュー' })).toHaveFocus()
    const preview = screen.getByRole('region', { name: 'プレビュー' })
    expect(preview).not.toHaveTextContent('撮影の注意')
    expect(within(preview).getByRole('heading', { level: 3, name: '未入力' })).toBeInTheDocument()
    expect(within(preview).getByText('探索エリア')).toBeInTheDocument()
    expect(within(preview).queryByText('公開ヒント画像は未設定')).not.toBeInTheDocument()
    expect(screen.getByText('未公開プレビュー')).toBeInTheDocument()
    expect(within(preview).queryByRole('button', { name: /公開|判定|試験/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '文章を編集' }))
    expect(screen.getByRole('heading', { name: '文章編集' })).toHaveFocus()
    expect(screen.getByLabelText('タイトル')).toHaveValue('')
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(storageSpy).not.toHaveBeenCalled()
  })
})


it.each([false, true])('investigates PR119 with durable form, saved=%s, photo and corrected input', async (saved) => {
  const user = userEvent.setup()
  const draft: ManagedQuestDraft = {
    materials: { name: '保存済み対象', evidence: '保存済み根拠', requiresBoat: false, requiresPaidFacility: false, price: '', photoNote: '', photoRights: '合成' },
    content: { title: '', question: '', hints: ['', '', ''], verifiedFeatures: '', draftingNotes: '' },
    afterClear: { access: '', hours: '', promoComment: '', explanation: '' }, referenceAssetId: null, hintAssetId: null,
  }
  const initial: ManagedQuest = { questId: 'investigation', orgId: 'org', areaId: 'area', draftRevision: 1, publishedVersion: null, status: 'draft', source: 'real', shootingAreaStatus: 'unconfigured', draft }
  renderExpanded(<QuestDraftForm teamPreview connection={{ api: createApiClient({ expectedDataMode: 'durable-local' }), initial: saved ? initial : null, member: { orgId: 'org', areaId: 'area', label: '架空', role: 'editor' }, onBack: vi.fn() }} />)
  if (saved) {
    await user.clear(screen.getByLabelText('撮るもの'))
  }
  await user.click(screen.getByRole('button', { name: '下書き・編集へ' }))
  expect(screen.getByRole('alert')).toHaveTextContent('撮るものを入力')
  await pasteText(user, '撮るもの', '　入力済み対象　')
  await user.upload(screen.getByLabelText('正解の写真'), image())
  await user.click(screen.getByRole('button', { name: '下書き・編集へ' }))
  expect(screen.getByRole('heading', { name: '文章編集' })).toHaveFocus()
  expect(screen.queryByText(/撮るものを入力/)).not.toBeInTheDocument()
})
