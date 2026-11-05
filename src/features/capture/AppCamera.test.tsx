import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import App from '../../App'
import type { AuthClient, AuthSnapshot } from '../auth/authTypes'
import { demoQuest } from '../quests/demoQuest'

function mediaFixture() {
  const stop = vi.fn()
  const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream
  const getUserMedia = vi.fn(async () => stream)
  vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { mediaDevices: { getUserMedia } }))
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
  return { stop, stream, getUserMedia }
}

function mount() {
  const media = mediaFixture()
  let auth: AuthSnapshot = { status: 'signed-in', user: { uid: 'camera-test-user', displayName: null } }
  const listeners = new Set<() => void>()
  const emit = (next: AuthSnapshot) => { auth = next; listeners.forEach((listener) => listener()) }
  const client: AuthClient = {
    getSnapshot: () => auth,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
    signInWithGoogle: vi.fn(),
    signOut: vi.fn(async () => { emit({ status: 'signed-out', user: null }) }),
    getIdToken: vi.fn(async () => 'test-token'),
  }
  const view = render(<App authClient={client} />)
  return { ...media, ...view, emit, client, user: userEvent.setup() }
}

async function start(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: '問題を見てみる' }))
  await user.click(screen.getByRole('button', { name: '撮影を始める' }))
}

describe('camera ownership and cleanup', () => {
  it('stops camera access when B supplies a different question', async () => {
    const media = mount()
    await start(media.user)
    await waitFor(() => expect(screen.getByLabelText('カメラ映像')).toHaveProperty('srcObject', media.stream))
    media.rerender(<App authClient={media.client} quest={{ ...demoQuest, questId: 'different-quest', version: 3 }} />)
    expect(media.stop).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('region', { name: '写真撮影と確認' })).not.toBeInTheDocument()
  })
  it('stops the camera when the selected question closes', async () => {
    const media = mount()
    await start(media.user)
    await waitFor(() => expect(screen.getByLabelText('カメラ映像')).toHaveProperty('srcObject', media.stream))
    await media.user.click(screen.getByRole('button', { name: '問題を閉じる' }))
    expect(media.stop).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('region', { name: '写真撮影と確認' })).not.toBeInTheDocument()
  })

  it('stops the camera and removes the photo panel on logout', async () => {
    const media = mount()
    await start(media.user)
    await waitFor(() => expect(screen.getByLabelText('カメラ映像')).toHaveProperty('srcObject', media.stream))
    await media.user.click(screen.getByRole('button', { name: 'ログアウト' }))
    expect(media.stop).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('region', { name: '写真撮影と確認' })).not.toBeInTheDocument()
  })

  it('disposes a permission result that arrives after the user closes the camera', async () => {
    const media = mount()
    let resolve!: (stream: MediaStream) => void
    media.getUserMedia.mockImplementationOnce(() => new Promise((done) => { resolve = done }))
    await start(media.user)
    await media.user.click(screen.getByRole('button', { name: '撮影を終了' }))
    await act(async () => resolve(media.stream))
    expect(media.stop).toHaveBeenCalledTimes(1)
    expect(screen.queryByLabelText('カメラ映像')).not.toBeInTheDocument()
  })

  it('disposes a permission result after the page unmounts', async () => {
    const media = mount()
    let resolve!: (stream: MediaStream) => void
    media.getUserMedia.mockImplementationOnce(() => new Promise((done) => { resolve = done }))
    await start(media.user)
    media.unmount()
    await act(async () => resolve(media.stream))
    expect(media.stop).toHaveBeenCalledTimes(1)
  })

  it('does not reopen the camera for a switched user or when the original user returns', async () => {
    const media = mount()
    await start(media.user)
    await waitFor(() => expect(screen.getByLabelText('カメラ映像')).toHaveProperty('srcObject', media.stream))
    act(() => media.emit({ status: 'signed-in', user: { uid: 'other-user', displayName: null } }))
    expect(media.stop).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('region', { name: '写真撮影と確認' })).not.toBeInTheDocument()
    act(() => media.emit({ status: 'signed-in', user: { uid: 'camera-test-user', displayName: null } }))
    expect(screen.queryByRole('region', { name: '写真撮影と確認' })).not.toBeInTheDocument()
    expect(media.getUserMedia).toHaveBeenCalledTimes(1)
  })

  it('stops camera access when returning to the map', async () => {
    const media = mount()
    await start(media.user)
    await waitFor(() => expect(screen.getByLabelText('カメラ映像')).toHaveProperty('srcObject', media.stream))
    await media.user.click(screen.getAllByRole('link', { name: '謎を探す' })[0])
    expect(media.stop).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('region', { name: '写真撮影と確認' })).not.toBeInTheDocument()
  })
})
