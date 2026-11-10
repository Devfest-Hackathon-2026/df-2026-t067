import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { useState } from 'react'
import type { ComponentProps } from 'react'
import { createApiClient } from '../../shared/api'
import type { ManagedQuest, OrgMembership } from '../../shared/api'
import { parseDurableMapsLink, parseMapsSpotLink } from './mapsSpotLink'
import QuestDraftForm from './QuestDraftForm'
import { SpotEditor } from './SpotEditor'
import { initialSpotInput } from './mapsSpotLink'

function ControlledSpotEditor(props: Omit<ComponentProps<typeof SpotEditor>, 'input' | 'onChange'> & { initial?: ReturnType<typeof initialSpotInput> }) {
  const [input, setInput] = useState(props.initial ?? initialSpotInput())
  return <SpotEditor {...props} input={input} onChange={setInput} />
}

const member: OrgMembership = { orgId: 'test-org', areaId: 'n03-00001-2025', label: 'テスト自治体', role: 'editor',
  municipalityCode: '00001', exploration: { source: 'N03', name: '区域テスト', municipalityCode: '00001', year: 2025 } }

it('saves a complete Maps spot without a confirmation checkbox and restores it independently of the capture range', async () => {
  const user = userEvent.setup()
  const createManagedQuest = vi.fn<typeof api.createManagedQuest>(async (orgId, draft) => ({
    orgId, areaId: member.areaId, questId: 'test-quest', draftRevision: 1, publishedVersion: null,
    source: 'real', status: 'draft', shootingAreaStatus: 'unconfigured', draft,
  }))
  const api = createApiClient()
  const connection = { api: { ...api, createManagedQuest }, initial: null as ManagedQuest | null, member, onBack: vi.fn() }
  const view = render(<QuestDraftForm teamPreview connection={connection} />)
  expect(screen.getByText(/区域テスト/)).toBeVisible()
  await user.type(screen.getByLabelText('撮るもの'), '対象')
  await user.type(screen.getByLabelText('Google Maps共有URL'), 'https://www.google.com/maps/place/Pin/@35,139,15z/data=!3d36!4d140')
  await user.click(screen.getByRole('button', { name: '場所を取得' }))
  expect(screen.getByLabelText('緯度')).toHaveValue('36')
  await user.type(screen.getByLabelText('場所の名前'), '施設')
  await user.type(screen.getByLabelText('住所'), '確認住所')
  expect(screen.queryByRole('checkbox', { name: '位置・スポット名・住所を確認した' })).not.toBeInTheDocument()
  await user.clear(screen.getByLabelText('経度'))
  await user.type(screen.getByLabelText('経度'), '181')
  await user.click(screen.getByRole('button', { name: '下書きを保存' }))
  expect(createManagedQuest).not.toHaveBeenCalled()
  expect(screen.getByText('名称・住所・座標を入力')).toBeVisible()
  await user.clear(screen.getByLabelText('経度'))
  await user.type(screen.getByLabelText('経度'), '141')
  await user.click(screen.getByRole('button', { name: '下書きを保存' }))
  expect(await screen.findByText('保存済み')).toBeVisible()
  const saved = await createManagedQuest.mock.results[0].value
  expect(saved.draft.afterClear.spot).toEqual({ name: '施設', address: '確認住所', position: { latitude: 36, longitude: 141 } })
  view.unmount()
  render(<QuestDraftForm teamPreview connection={{ ...connection, initial: saved }} />)
  expect(screen.getByLabelText('住所')).toHaveValue('確認住所')
  expect(screen.getByLabelText('経度')).toHaveValue('141')
  expect(screen.getByLabelText('Google Maps共有URL')).toHaveValue('')
  await user.type(screen.getByLabelText('Google Maps共有URL'), 'https://www.google.com/maps/search/?api=1&query=place_id:ChIJ_other')
  await user.click(screen.getByRole('button', { name: '場所を取得' }))
  expect(screen.getByText('ChIJ_other')).toBeVisible()
  expect(screen.getByLabelText('場所の名前')).toHaveValue('')
  expect(screen.getByLabelText('住所')).toHaveValue('')
  expect(screen.getByLabelText('緯度')).toHaveValue('')
})

it('leaves manual inputs usable after an unresolved short link', async () => {
  const user = userEvent.setup()
  render(<QuestDraftForm teamPreview connection={{ api: createApiClient(), initial: null, member, onBack: vi.fn() }} />)
  await user.type(screen.getByLabelText('Google Maps共有URL'), 'https://maps.app.goo.gl/test?ignored=true')
  await user.click(screen.getByRole('button', { name: '場所を取得' }))
  expect(screen.getByText(/表示されたURLを貼り直してください/)).toBeVisible()
  expect(screen.getByRole('link', { name: /Google Mapsを開く/ })).toHaveAttribute('href', 'https://maps.app.goo.gl/test')
  await user.type(screen.getByLabelText('緯度'), '36')
  await user.type(screen.getByLabelText('経度'), '140')
  await user.type(screen.getByLabelText('場所の名前'), '施設')
  await user.type(screen.getByLabelText('住所'), '住所')
  expect(screen.getByLabelText('緯度')).toHaveValue('36')
  expect(screen.getByLabelText('住所')).toHaveValue('住所')
})

it('parses only permitted Maps links and separates labels, coordinate pins and Place IDs', () => {
  expect(parseDurableMapsLink('https://www.google.com/maps/place/Example+Hall/@1,2,15z/data=!3d35!4d139!1sChIJfixture'))
    .toMatchObject({ kind: 'place', position: { latitude: 35, longitude: 139 }, label: 'Example Hall', googlePlaceId: 'ChIJfixture' })
  expect(parseDurableMapsLink('https://www.google.com/maps/search/?api=1&query=Example+Hall')).toMatchObject({ kind: 'place', position: null, label: 'Example Hall' })
  expect(parseDurableMapsLink('https://maps.google.co.jp/?q=35,139')).toMatchObject({ kind: 'place', position: { latitude: 35, longitude: 139 } })
  expect(parseDurableMapsLink('https://goo.gl/maps/sample')).toEqual({ kind: 'short', href: 'https://goo.gl/maps/sample' })
  for (const url of ['http://maps.app.goo.gl/test', 'https://maps.app.goo.gl@127.0.0.1/test', 'https://www.google.com.evil.test/maps?q=1,2']) {
    expect(parseDurableMapsLink(url)).toEqual({ kind: 'invalid' })
  }
  for (const url of ['https://www.google.com/maps/@35,139,15z', 'https://www.google.com/maps/dir/Start/End',
    'https://www.google.com/maps/place/Hall/data=!3d35!4d139?q=36,139',
    'https://www.google.com/maps/search/?query=place_id:ChIJ_first&query_place_id=ChIJ_second']) {
    expect(parseDurableMapsLink(url)).toEqual({ kind: 'unsupported' })
  }
})

it('does not infer a spot from the viewport, an arbitrary host, or a directions URL', () => {
  for (const url of ['https://www.google.com/maps/@35,139,18z', 'https://www.google.com.attacker.test/maps?q=35,139',
    'https://www.google.com/maps/dir/Start/End/data=!3d35!4d139', 'https://www.google.com@127.0.0.1/maps?q=35,139']) {
    expect(parseMapsSpotLink(url).position).toBeFalsy()
  }
  expect(parseMapsSpotLink('https://www.google.com/maps/search/?api=1&query=35,139&query_place_id=ChIJ_example'))
    .toMatchObject({ position: { latitude: 35, longitude: 139 }, googlePlaceId: 'ChIJ_example' })
})

it('shows a Google Maps address candidate separately from the confirmed address field', async () => {
  const lookupSpotAddress = vi.fn(async () => ({ orgId: 'test-org', status: 'candidate' as const, source: 'nearby' as const, address: '候補住所' }))
  const input = initialSpotInput()
  const user = userEvent.setup()
  render(<ControlledSpotEditor initial={input} durable orgId="test-org" canLookupSpotAddress lookupSpotAddress={lookupSpotAddress} />)
  await user.type(screen.getByLabelText('Google Maps共有URL'), 'https://www.google.com/maps/?q=35,139')
  await user.click(screen.getByRole('button', { name: '場所を取得' }))
  expect(await screen.findByText('座標周辺の住所候補：候補住所')).toBeVisible()
  expect(screen.getByText('Google Maps')).toHaveAttribute('translate', 'no')
  expect(screen.getByLabelText('住所')).toHaveValue('')
  await user.type(screen.getByLabelText('住所'), '本人確認済み')
  expect(screen.getByLabelText('住所')).toHaveValue('本人確認済み')
  expect(screen.getByText('座標周辺の住所候補：候補住所')).toBeVisible()
  expect(lookupSpotAddress).toHaveBeenCalledWith('test-org', { position: { latitude: 35, longitude: 139 } }, expect.objectContaining({ signal: expect.any(AbortSignal) }))
})

it('ignores a stale address result after the Maps URL changes', async () => {
  let resolveLookup!: (result: { orgId: string; status: 'candidate'; source: 'place'; address: string }) => void
  const lookupSpotAddress = vi.fn(() => new Promise<{ orgId: string; status: 'candidate'; source: 'place'; address: string }>(resolve => { resolveLookup = resolve }))
  const user = userEvent.setup()
  render(<ControlledSpotEditor durable orgId="test-org" canLookupSpotAddress lookupSpotAddress={lookupSpotAddress} />)
  const url = screen.getByLabelText('Google Maps共有URL')
  await user.type(url, 'https://www.google.com/maps/search/?query_place_id=ChIJfixture')
  await user.click(screen.getByRole('button', { name: '場所を取得' }))
  await waitFor(() => expect(lookupSpotAddress).toHaveBeenCalledOnce())
  await user.clear(url)
  await user.type(url, 'https://www.google.com/maps/?q=35,139')
  await act(async () => { resolveLookup({ orgId: 'test-org', status: 'candidate', source: 'place', address: '古い住所' }) })
  expect(screen.queryByText(/古い住所/)).not.toBeInTheDocument()
  expect(screen.queryByText('施設名・住所・位置は、地図や自治体の資料で確認して入力してください。')).not.toBeInTheDocument()
})

it('ignores a pending address result after the coordinates change', async () => {
  let resolveLookup!: (result: { orgId: string; status: 'candidate'; source: 'place'; address: string }) => void
  const lookupSpotAddress = vi.fn(() => new Promise<{ orgId: string; status: 'candidate'; source: 'place'; address: string }>(resolve => { resolveLookup = resolve }))
  const user = userEvent.setup()
  render(<ControlledSpotEditor durable orgId="test-org" canLookupSpotAddress lookupSpotAddress={lookupSpotAddress} />)
  await user.type(screen.getByLabelText('Google Maps共有URL'), 'https://www.google.com/maps/search/?query_place_id=ChIJfixture')
  await user.click(screen.getByRole('button', { name: '場所を取得' }))
  await waitFor(() => expect(lookupSpotAddress).toHaveBeenCalledOnce())
  await user.type(screen.getByLabelText('緯度'), '36')
  await act(async () => { resolveLookup({ orgId: 'test-org', status: 'candidate', source: 'place', address: '古い場所の住所' }) })
  expect(screen.queryByText(/古い場所の住所/)).not.toBeInTheDocument()
})

it('keeps the matching address candidate visible when adopting the same link coordinates', async () => {
  const lookupSpotAddress = vi.fn(async () => ({ orgId: 'test-org', status: 'candidate' as const, source: 'place' as const, address: '候補住所' }))
  const user = userEvent.setup()
  render(<ControlledSpotEditor durable orgId="test-org" canLookupSpotAddress lookupSpotAddress={lookupSpotAddress} />)
  await user.type(screen.getByLabelText('Google Maps共有URL'), 'https://www.google.com/maps/search/?query=35,139&query_place_id=ChIJfixture')
  await user.click(screen.getByRole('button', { name: '場所を取得' }))
  expect(await screen.findByText('Place IDの住所候補：候補住所')).toBeVisible()
  await user.click(screen.getByRole('button', { name: '座標を使う' }))
  expect(screen.getByLabelText('緯度')).toHaveValue('35')
  expect(screen.getByLabelText('住所')).toHaveValue('')
  expect(screen.getByText('Place IDの住所候補：候補住所')).toBeVisible()
})

it('shows lookup failures without changing the manual address', async () => {
  const user = userEvent.setup()
  render(<ControlledSpotEditor durable orgId="test-org" canLookupSpotAddress lookupSpotAddress={vi.fn().mockRejectedValue(new Error('offline'))} />)
  await user.type(screen.getByLabelText('Google Maps共有URL'), 'https://www.google.com/maps/?q=35,139')
  await user.click(screen.getByRole('button', { name: '場所を取得' }))
  expect(await screen.findByText('住所候補を取得できませんでした。住所を手入力してください。')).toBeVisible()
  await user.type(screen.getByLabelText('住所'), '住所')
  expect(screen.getByLabelText('住所')).toHaveValue('住所')
})
