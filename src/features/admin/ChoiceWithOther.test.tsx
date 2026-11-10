import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ChoiceWithOther } from './ChoiceWithOther'
import { PriceInput } from './PriceInput'

afterEach(cleanup)
it('selects only complete stock phrases and retains the rest as other text', () => {
  const onChange = vi.fn()
  render(<ChoiceWithOther label="撮影の注意" phrases={['日中のみ', '安全確認']} value={'日中のみ。安全確認をお願いします。独自の注意'} onChange={onChange} />)
  expect(screen.getByLabelText('日中のみ')).toBeChecked()
  expect(screen.getByLabelText('安全確認')).not.toBeChecked()
  expect(screen.getByLabelText('撮影の注意のその他')).toHaveValue('安全確認をお願いします。独自の注意')
  fireEvent.click(screen.getByLabelText('日中のみ'))
  expect(onChange).toHaveBeenLastCalledWith('安全確認をお願いします。独自の注意')
})
it('shows other input only when selected and publishes only selected values', () => {
  function Harness() {
    const [value, setValue] = useState('')
    return <><ChoiceWithOther label="休業例外" phrases={['月曜休業', '祝日は休業']} value={value} onChange={setValue} /><output>{value}</output></>
  }
  render(<Harness />)
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  fireEvent.click(screen.getByLabelText('月曜休業'))
  fireEvent.click(screen.getByLabelText('祝日は休業'))
  fireEvent.click(screen.getByLabelText('休業例外のその他を選択'))
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '夏季は営業' } })
  expect(screen.getByRole('status')).toHaveTextContent('月曜休業 祝日は休業 夏季は営業')
  fireEvent.click(screen.getByLabelText('休業例外のその他を選択'))
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  expect(screen.getByRole('status')).not.toHaveTextContent('夏季')
})
it.each(['受付で要確認', '未確認', '未設定'])('keeps legacy price %s untouched without a text input', value => {
  const onChange = vi.fn()
  render(<PriceInput value={value} onChange={onChange} />)
  expect(screen.getByLabelText('料金の区分')).toHaveValue('')
  expect(screen.getByText(value)).toBeVisible()
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  expect(onChange).not.toHaveBeenCalled()
})
it('retains punctuation and line breaks while editing other alongside a selection', () => {
  function Harness() {
    const [value, setValue] = useState('月曜休業')
    return <ChoiceWithOther label="休業例外" phrases={['月曜休業']} value={value} onChange={setValue} />
  }
  render(<Harness />)
  fireEvent.click(screen.getByLabelText('休業例外のその他を選択'))
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '独自の休業。\n' } })
  expect(screen.getByRole('textbox')).toHaveValue('独自の休業。\n')
})
