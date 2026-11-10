import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import App from '../../App'
import { createApiClient } from '../../shared/api'
import { challenge, discovery, quest } from '../../shared/api/testFixtures'
import type { AttemptResult } from '../../shared/api/types'
import type { AuthClient } from '../auth/authTypes'

// D-64：クリア直後に詳細へ戻った時、再読み込みなしでクリア済み表示になること。
// 記録一覧は送信前は空・送信後はサーバーの真実を返すよう振る舞わせ、受付が
// 返した記録IDの即時反映（noteCleared）と戻り時の取り直しの両方で追いつくことを見る。
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function position() {
  return { coords: { latitude: 35, longitude: 135, accuracy: 12.4, altitude: null,
    altitudeAccuracy: null, heading: null, speed: null }, timestamp: Date.now() } as GeolocationPosition
}

function media() {
  const stop = vi.fn()
  const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream
  vi.stubGlobal('navigator', Object.assign(Object.create(navigator), {
    mediaDevices: { getUserMedia: vi.fn(async () => stream) },
    geolocation: { getCurrentPosition: vi.fn<Geolocation['getCurrentPosition']>((success) => success(position())) },
  }))
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({ drawImage: vi.fn(), translate: vi.fn(), rotate: vi.fn() }) as unknown as CanvasRenderingContext2D)
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(new Blob(['synthetic-photo'], { type: 'image/jpeg' })))
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 640, height: 480, close: vi.fn() }) as unknown as ImageBitmap))
  vi.stubGlobal('URL', class extends URL { static createObjectURL = vi.fn(() => 'blob:synthetic-photo'); static revokeObjectURL = vi.fn() })
  return { stream }
}

async function loadFrame(stream: MediaStream) {
  const video = screen.getByLabelText('カメラ映像') as HTMLVideoElement
  await waitFor(() => expect(video.srcObject).toBe(stream))
  Object.defineProperties(video, {
    videoWidth: { value: 640, configurable: true }, videoHeight: { value: 480, configurable: true }, readyState: { value: 2, configurable: true },
  })
  fireEvent.loadedData(video)
}

it('shows the quest as cleared right after clearing, without a reload', async () => {
  const { stream } = media()
  const signedIn = { status: 'signed-in', user: { uid: 'synthetic-user', displayName: null } } as const
  const auth: AuthClient = {
    getSnapshot: () => signedIn, subscribe: () => () => {},
    signInWithGoogle: vi.fn(), signOut: vi.fn(), getIdToken: vi.fn(async () => 'token'),
  }
  // placeName は問題タイトル（架空の時計）と別名にして、記録詳細の見出しと混同しない。
  const saved = { ...discovery, discoveryId: 'saved-record', placeName: '架空の時計台' }
  let serverCleared = false
  const receipt: AttemptResult = { attemptId: 'attempt-1', state: 'RECEIVED', outcome: null, nextAction: 'WAIT', source: 'real' }
  const completed: AttemptResult = { attemptId: 'attempt-1', state: 'COMPLETED', outcome: 'CORRECT', nextAction: 'VIEW_DISCOVERY', source: 'real', optionalDiscoveryId: 'saved-record' }
  const api = {
    ...createApiClient(),
    createChallenge: vi.fn(async () => challenge),
    getSession: vi.fn(async () => ({ uid: 'synthetic-user' })),
    listDiscoveries: vi.fn(async () => ({ items: serverCleared ? [saved] : [], nextCursor: null })),
    submitAnswer: vi.fn(async () => { serverCleared = true; return receipt }),
    getAttempt: vi.fn(async () => completed),
    getDiscovery: vi.fn(async () => saved),
    getDiscoveryPhoto: vi.fn(async () => new Blob(['photo'], { type: 'image/jpeg' })),
  }
  const user = userEvent.setup()
  const view = render(<App authClient={auth} apiClient={api} quest={quest} apiMode apiDataMode="durable-local" />)

  await user.click(screen.getByRole('button', { name: '問題を見る' }))
  expect(await screen.findByRole('button', { name: '挑戦する' })).toBeVisible()
  expect(screen.queryByText('クリア済み')).not.toBeInTheDocument()

  // 挑戦→撮影→送信→正解確定まで実フローで進める。
  await user.click(screen.getByRole('button', { name: '挑戦する' }))
  await loadFrame(stream)
  await user.click(await screen.findByRole('button', { name: '撮影' }))
  const submit = await screen.findByRole('button', { name: '送る' })
  await waitFor(() => expect(submit).toBeEnabled())
  await user.click(submit)
  // 判定中は待ち表示のみ（判定を確認は出さない）。自動ポーリングでクリア画面へ進む。
  expect(await screen.findByRole('status', { name: '写真の判定待ち' })).toBeVisible()
  expect(screen.queryByRole('button', { name: '判定を確認' })).not.toBeInTheDocument()
  // 初回クリアでは全画面のクリア画面（D-63）が出る。ここでは「地図に戻る」で
  // 詳細へ戻る退出を選び、戻った先がその場でクリア済み表示になることを見る。
  expect(await screen.findByRole('heading', { name: 'クリア！' })).toBeVisible()
  // fullbleed 殻が常駐するため「地図に戻る」が複数候補になり得る。クリア画面のダイアログ内だけを押す。
  await user.click(within(screen.getByRole('dialog', { name: 'クリア！' })).getByRole('button', { name: '地図に戻る' }))

  expect(screen.getByText('クリア済み', { selector: '.quest-cleared-label' })).toBeVisible()
  expect(screen.getByRole('group', { name: 'クリア状況' })).toBeVisible()
  expect(screen.queryByRole('button', { name: '挑戦する' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '撮影' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '記録を見る' })).toBeVisible()
  expect(view.container.querySelector('.explore-quest-cleared, .quest-cleared-label')).not.toBeNull()
})
