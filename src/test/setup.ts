import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, expect, vi } from 'vitest'
import { FIREBASE_ENV_NAMES } from '../features/auth/config'

const fetchRequest = vi.fn()
const xhrRequest = vi.fn()
const requestPosition = vi.fn()
const watchPosition = vi.fn()
const requestCamera = vi.fn()

// jsdom exposes the element but does not implement opening or closing it.
if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function () { this.open = true }
  HTMLDialogElement.prototype.close = function () { this.open = false }
}

beforeEach(() => {
  sessionStorage.clear()
  // 画面タブの ?view= などがテスト間に残ると、次の App マウントが記録画面から始まる。
  window.history.replaceState(null, '', '/')
  vi.stubEnv('VITE_QUEST_DATA_SOURCE', 'preview')
  // .env.localの実設定を単体テストへ持ち込まず、明示したテスト用設定だけを使う。
  for (const name of FIREBASE_ENV_NAMES) vi.stubEnv(name, '')
  vi.stubGlobal('fetch', fetchRequest)
  vi.spyOn(XMLHttpRequest.prototype, 'open').mockImplementation(xhrRequest)
  vi.stubGlobal('navigator', Object.assign(Object.create(navigator), {
    geolocation: {
      getCurrentPosition: requestPosition,
      watchPosition,
    },
    mediaDevices: { getUserMedia: requestCamera },
  }))
})

afterEach(() => {
  cleanup()
  window.history.replaceState(null, '', '/')
  expect(fetchRequest, '未接続の土台ではAPIを呼ばない').not.toHaveBeenCalled()
  expect(xhrRequest, '未接続の土台ではAPIを呼ばない').not.toHaveBeenCalled()
  expect(requestPosition, '閲覧時に位置情報を要求しない').not.toHaveBeenCalled()
  expect(watchPosition, '位置情報を追跡しない').not.toHaveBeenCalled()
  expect(requestCamera, '閲覧時にカメラを要求しない').not.toHaveBeenCalled()
})
