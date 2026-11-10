import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { expect, it, vi } from 'vitest'
import { MapSpotEditor } from './MapSpotEditor'
import { initialSpotInput, spotForDraft } from './mapsSpotLink'
import type { MapPlaceDetails } from './ShootingAreasMap'

const mock = vi.hoisted(() => ({ first: vi.fn<() => Promise<MapPlaceDetails>>(), second: vi.fn<() => Promise<MapPlaceDetails>>() }))
vi.mock('./ShootingAreasMap', () => ({
  ShootingAreasMap: ({ onSelect, onAvailabilityChange }: { onAvailabilityChange: (unavailable: boolean) => void; onSelect: (lat: number, lng: number, place: { id: string; loadDetails: () => Promise<MapPlaceDetails> }) => void }) => <>
    <button onClick={() => onAvailabilityChange(false)}>地図読込完了</button>
    <button onClick={() => onAvailabilityChange(true)}>地図読込失敗</button>
    <button onClick={() => onSelect(35, 135, { id: 'old', loadDetails: mock.first })}>地図の場所A</button>
    <button onClick={() => onSelect(36, 136, { id: 'new', loadDetails: mock.second })}>地図の場所B</button>
  </>,
}))

it('uses only the latest map candidates after explicit confirmation', async () => {
  const user = userEvent.setup()
  let finishFirst!: (value: MapPlaceDetails) => void
  mock.first.mockReturnValue(new Promise((resolve) => { finishFirst = resolve }))
  mock.second.mockResolvedValue({ name: '地図の名称候補', address: '地図の住所候補' })
  function Harness() {
    const [input, setInput] = useState(initialSpotInput)
    return <>
      <MapSpotEditor input={input} invalid={false} orgId="fixture" onChange={setInput} />
      <output data-testid="spot">{JSON.stringify(spotForDraft(input))}</output>
    </>
  }
  render(<Harness />)
  await user.click(screen.getByRole('button', { name: '地図の場所A' }))
  await user.click(screen.getByRole('button', { name: '地図の場所B' }))
  expect(await screen.findByText('名称候補：地図の名称候補')).toBeVisible()
  expect(screen.getByText('住所候補：地図の住所候補')).toBeVisible()
  expect(screen.getByLabelText('住所')).toHaveValue('')
  await act(() => finishFirst({ name: '古い候補' }))
  expect(screen.queryByText(/古い候補/)).not.toBeInTheDocument()
  expect(screen.getByTestId('spot')).toHaveTextContent('incomplete')
  await user.click(screen.getByRole('button', { name: '名前・住所を使う' }))
  expect(screen.getByLabelText('場所の名前')).toHaveValue('地図の名称候補')
  expect(screen.getByLabelText('住所')).toHaveValue('地図の住所候補')
  expect(JSON.parse(screen.getByTestId('spot').textContent ?? '')).toEqual({
    name: '地図の名称候補', address: '地図の住所候補', position: { latitude: 36, longitude: 136 }, googlePlaceId: 'new',
  })
})

it('keeps manually entered values when a map candidate omits them', async () => {
  const user = userEvent.setup()
  mock.first.mockResolvedValue({ name: '', address: '候補の住所' })
  function Harness() {
    const [input, setInput] = useState(initialSpotInput)
    return <MapSpotEditor input={input} invalid={false} orgId="fixture" onChange={setInput} />
  }
  render(<Harness />)
  await user.click(screen.getByRole('button', { name: '地図の場所A' }))
  await screen.findByText('住所候補：候補の住所')
  await user.type(screen.getByLabelText('場所の名前'), '手入力の場所')
  await user.click(screen.getByRole('button', { name: '名前・住所を使う' }))
  expect(screen.getByLabelText('場所の名前')).toHaveValue('手入力の場所')
  expect(screen.getByLabelText('住所')).toHaveValue('候補の住所')
  expect(screen.getByLabelText('緯度')).toHaveValue('35')
  expect(screen.getByLabelText('経度')).toHaveValue('135')
})


it('starts with the map open and clears the selected place and candidate', async () => {
  const user = userEvent.setup()
  mock.first.mockResolvedValue({ name: '候補' })
  function Harness() {
    const [input, setInput] = useState(initialSpotInput)
    return <MapSpotEditor input={input} invalid={false} orgId="fixture" onChange={setInput} />
  }
  render(<Harness />)
  expect(screen.queryByRole('button', { name: '地図' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '地図の場所A' }))
  await screen.findByText('名称候補：候補')
  await user.click(screen.getByRole('button', { name: 'やり直す' }))
  expect(screen.queryByText('名称候補：候補')).not.toBeInTheDocument()
  expect(screen.getByLabelText('緯度')).toHaveValue('')
})

it('hides coordinates when usable and restores them after a map failure', async () => {
  const user = userEvent.setup()
  render(<MapSpotEditor input={initialSpotInput()} invalid orgId="fixture" onChange={vi.fn()} locationError="エリアの外です" />)
  await user.click(screen.getByRole('button', { name: '地図読込完了' }))
  expect(screen.queryByLabelText('緯度')).not.toBeInTheDocument()
  expect(screen.getByRole('group', { name: '場所' })).toHaveAttribute('aria-describedby', 'spot-area-error')
  expect(screen.getByText('エリアの外です')).toHaveAttribute('id', 'spot-area-error')
  await user.click(screen.getByRole('button', { name: '地図読込失敗' }))
  expect(screen.getByLabelText('緯度')).toBeVisible()
  expect(screen.getByLabelText('経度')).toHaveAttribute('aria-invalid', 'true')
})


it('keeps name and address on reselection and retry, while removing coordinates and Place ID', async () => {
  const user = userEvent.setup()
  mock.first.mockResolvedValue({ name: '', address: '候補の住所' })
  const original = { ...initialSpotInput(), name: '確認済みの名称', address: '確認済みの住所', latitude: '34', longitude: '134', googlePlaceId: 'original' }
  function Harness() {
    const [input, setInput] = useState<ReturnType<typeof initialSpotInput>>(original)
    return <><MapSpotEditor input={input} invalid={false} orgId="fixture" onChange={setInput} /><output data-testid="input">{JSON.stringify(input)}</output></>
  }
  render(<Harness />)
  await user.click(screen.getByRole('button', { name: '地図の場所A' }))
  await screen.findByText('住所候補：候補の住所')
  expect(screen.getByLabelText('場所の名前')).toHaveValue(original.name)
  expect(screen.getByLabelText('住所')).toHaveValue(original.address)
  await user.click(screen.getByRole('button', { name: '名前・住所を使う' }))
  expect(screen.getByLabelText('場所の名前')).toHaveValue(original.name)
  expect(screen.getByLabelText('住所')).toHaveValue('候補の住所')
  await user.click(screen.getByRole('button', { name: 'やり直す' }))
  expect(JSON.parse(screen.getByTestId('input').textContent!)).toEqual({ ...original, address: '候補の住所', latitude: '', longitude: '', googlePlaceId: undefined })
})
