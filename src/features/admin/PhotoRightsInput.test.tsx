import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it } from 'vitest'
import { PhotoRightsInput } from './PhotoRightsInput'

function Harness({ purpose = 'reference' as 'reference' | 'public_hint' | 'test', initial = '' }) {
  const [value, setValue] = useState(initial)
  return <PhotoRightsInput purpose={purpose} label="写真の利用権" value={value} onChange={setValue} />
}

it('keeps existing text and requires explicit choice, details, purpose confirmation and application', async () => {
  const user = userEvent.setup()
  render(<Harness initial="既存の出典・条件" />)
  await user.click(screen.getByText('選択して権利文を作る'))
  const apply = screen.getByRole('button', { name: '権利文に追記' })
  expect(apply).toBeDisabled()
  await user.selectOptions(screen.getByLabelText('権利の根拠'), 'self')
  await user.type(screen.getByLabelText('撮影者・所有者・許諾元と利用条件'), '架空の担当者、非公開照合のみ')
  expect(screen.getByLabelText('写真の利用権')).toHaveValue('既存の出典・条件')
  expect(apply).toBeDisabled()
  await user.click(screen.getByLabelText('この写真を非公開の参考写真・照合に使えることを確認した'))
  await user.click(apply)
  expect(screen.getByLabelText('写真の利用権')).toHaveValue('既存の出典・条件\n自分で撮影。架空の担当者、非公開照合のみ。用途：非公開の参考写真・照合。')
  expect(apply).toBeDisabled()
})

it.each([
  ['public_hint', '公開ヒント画像'], ['test', '非公開の写真試験'],
] as const)('requires the actual %s purpose and never defaults to rights granted', async (purpose, label) => {
  const user = userEvent.setup()
  render(<Harness purpose={purpose} />)
  await user.click(screen.getByText('選択して権利文を作る'))
  expect(screen.getByLabelText('権利の根拠')).toHaveValue('')
  expect(screen.getByLabelText('写真の利用権')).toHaveValue('')
  const confirm = screen.getByLabelText(`この写真を${label}に使えることを確認した`)
  expect(confirm).not.toBeChecked()
  await user.selectOptions(screen.getByLabelText('権利の根拠'), 'permission')
  await user.type(screen.getByLabelText('撮影者・所有者・許諾元と利用条件'), '架空の許諾元、用途限定')
  await user.click(confirm)
  await user.selectOptions(screen.getByLabelText('権利の根拠'), 'municipal')
  expect(confirm).not.toBeChecked()
  expect(screen.getByRole('button', { name: '権利文に追記' })).toBeDisabled()
})
