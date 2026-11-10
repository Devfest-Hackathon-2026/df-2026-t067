import { inertBackground } from '../../components/inertBackground'
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { QuestHandoff } from '../../components/QuestHandoff'
import { createPortal } from 'react-dom'
import { useWideViewport } from '../quests/useWideViewport'
import { parseCaptureMetadata } from '../../shared/api'
import type { CaptureMetadata } from '../../shared/api/types'
import { DemoAnswerSubmission } from './DemoAnswerSubmission'
import type { DemoAnswerContext } from './DemoAnswerSubmission'
import { CaptureLocationMap } from './CaptureLocationMap'
import { isCaptureLocationMapDebugEnabled } from './captureMapDebug'

type CameraPreviewProps = { onClose: () => void; answer?: DemoAnswerContext; handoffUrl?: string; clue?: string; hints?: string[] }

export function CameraPreview(props: CameraPreviewProps) {
  const wide = useWideViewport()
  if (wide) return <QuestHandoff value={props.handoffUrl} title={props.answer?.questTitle} />
  return <MobileCameraPreview {...props} />
}

function MobileCameraPreview({ onClose, answer, clue, hints = [] }: CameraPreviewProps) {
  const wide = useWideViewport()
  const showCaptureLocationMapDebug = isCaptureLocationMapDebugEnabled(import.meta.env.DEV, import.meta.env.VITE_CAPTURE_LOCATION_MAP_DEBUG)
  const closing = useRef(false)
  const panelRef = useRef<HTMLElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const photoRef = useRef<string | null>(null)
  const generation = useRef(0)
  const locationGeneration = useRef(0)
  const rotationGeneration = useRef(0)
  const capturedAtRef = useRef<string | null>(null)
  const capturing = useRef(false)
  const [attempt, setAttempt] = useState(0)
  const [phase, setPhase] = useState<'opening' | 'live' | 'capturing' | 'photo' | 'error'>('opening')
  const [photo, setPhoto] = useState<{ url: string; blob: Blob; originalBlob: Blob; rotation: number } | null>(null)
  const [rotating, setRotating] = useState(false)
  const [submissionStarted, setSubmissionStarted] = useState(false)
  const [judging, setJudging] = useState(false)
  const [retakeLocked, setRetakeLocked] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [metadata, setMetadata] = useState<CaptureMetadata | null>(null)
  const [locating, setLocating] = useState(false)
  const [showLocationMap, setShowLocationMap] = useState(false)
  const photoUrl = photo?.url

  function requestClose(fromBack = false) {
    if (photoRef.current && !submissionStarted && !window.confirm('未送信の写真を破棄して撮影を終了しますか？')) return false
    closing.current = true
    if (!fromBack && window.history.state?.camera) {
      window.history.back()
    }
    dispose(); setLocating(false); onClose(); return true
  }
  const closeFromEvent = useEffectEvent(requestClose)
  useEffect(() => {
    const previous = document.activeElement
    const releaseBackground = inertBackground(panelRef.current)
    closeRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (document.querySelector('.clear-screen')) return
      if (event.key === 'Escape') { event.preventDefault(); closeFromEvent() }
      if (event.key === 'Tab') {
        const items = Array.from(panelRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), summary, [tabindex="0"]') ?? [])
        const first = items[0], last = items.at(-1)
        if (event.shiftKey && (document.activeElement === first || !panelRef.current?.contains(document.activeElement))) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && (document.activeElement === last || !panelRef.current?.contains(document.activeElement))) { event.preventDefault(); first?.focus() }
      }
    }
    const onBack = (event: PopStateEvent) => {
      event.stopImmediatePropagation()
      if (closing.current) return
      if (!closeFromEvent(true)) window.history.pushState({ ...window.history.state, camera: true }, '')
    }
    if (!window.history.state?.camera) window.history.pushState({ ...window.history.state, camera: true }, '')
    window.addEventListener('keydown', onKey)
    window.addEventListener('popstate', onBack, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('popstate', onBack, true)
      releaseBackground()
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus()
    }
  }, [])

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
  }

  function releasePhoto() {
    if (photoRef.current) URL.revokeObjectURL(photoRef.current)
    photoRef.current = null
  }

  function dispose() {
    generation.current++
    locationGeneration.current++
    rotationGeneration.current++
    capturing.current = false
    stopCamera()
    releasePhoto()
  }

  function fail(message: string) {
    generation.current++
    locationGeneration.current++
    capturing.current = false
    setLocating(false)
    stopCamera()
    setError(message)
    setPhase('error')
  }

  useEffect(() => {
    const own = ++generation.current
    // Defer acquisition so the first StrictMode setup can be cleaned up before
    // it opens a second permission request. Late permission results are stopped.
    void Promise.resolve().then(async () => {
      if (own !== generation.current) return
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('unsupported')
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      if (own !== generation.current) { stream.getTracks().forEach((track) => track.stop()); return }
      streamRef.current = stream
      const video = videoRef.current
      if (!video) throw new Error('no-video')
      video.srcObject = stream
      await video.play()
      if (own === generation.current && video.videoWidth > 0 && video.videoHeight > 0 && video.readyState >= 2) setPhase('live')
    }).catch((cause: unknown) => {
      if (own !== generation.current) return
      const name = cause instanceof DOMException || cause instanceof Error ? cause.name : ''
      fail(name === 'NotAllowedError' ? 'カメラ未許可。サイト設定で許可'
        : 'カメラ起動失敗')
    })
    const leave = () => { dispose(); onClose() }
    window.addEventListener('pagehide', leave)
    return () => {
      dispose()
      window.removeEventListener('pagehide', leave)
    }
  }, [attempt, onClose])

  function ready() {
    const video = videoRef.current
    if (phase === 'opening' && streamRef.current && video && video.videoWidth > 0 && video.videoHeight > 0 && video.readyState >= 2) setPhase('live')
  }

  function capture() {
    if (phase !== 'live' || capturing.current) return
    capturing.current = true
    setError(null)
    capturedAtRef.current = new Date().toISOString()
    capturePhoto()
  }

  function capturePhoto() {
    if (phase !== 'live') { capturing.current = false; return }
    const video = videoRef.current
    if (!video?.videoWidth || !video.videoHeight || video.readyState < 2) {
      fail('カメラ準備失敗')
      return
    }
    setPhase('capturing')
    const own = generation.current
    try {
      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      const context = canvas.getContext('2d')
      if (!context) throw new Error('no-context')
      context.drawImage(video, 0, 0)
      // Freeze the frame first; GPS acquisition happens only after this snapshot.
      requestLocation()
      canvas.toBlob((blob) => {
        if (own !== generation.current) return
        if (!blob) { fail('写真作成失敗'); return }
        try {
          const url = URL.createObjectURL(blob)
          photoRef.current = url
          // The photo owns the view now; ignore a delayed play() result.
          generation.current++
          stopCamera()
          setPhoto({ url, blob, originalBlob: blob, rotation: 0 })
          setPhase('photo')
          capturing.current = false
        } catch { fail('写真表示失敗') }
      }, 'image/jpeg', 0.9)
    } catch { fail('写真作成失敗') }
  }

  function requestLocation() {
    if (!navigator.geolocation) {
      setError('位置情報非対応')
      return
    }
    setLocating(true)
    setError(null)
    const ownLocationRequest = ++locationGeneration.current
    function locationFailed(message: string) {
      if (ownLocationRequest !== locationGeneration.current) return
      locationGeneration.current++
      setLocating(false)
      setError(`${message}`)
    }
    try {
      navigator.geolocation.getCurrentPosition((location) => {
        if (ownLocationRequest !== locationGeneration.current) return
        try {
          const captureMetadata = parseCaptureMetadata({ capturedAt: capturedAtRef.current, position: {
            latitude: location.coords.latitude, longitude: location.coords.longitude,
            accuracyMeters: location.coords.accuracy, measuredAt: new Date(location.timestamp).toISOString(),
          } })
          setMetadata(captureMetadata)
          setLocating(false)
          setError(null)
        } catch { locationFailed('撮影地取得失敗') }
      }, (cause) => locationFailed(cause.code === cause.PERMISSION_DENIED
        ? '位置情報未許可。サイト設定で許可'
        : '撮影地取得失敗'),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 })
    } catch { locationFailed('撮影地取得失敗') }
  }

  function restart() {
    if (retakeLocked) return
    dispose()
    setRotating(false)
    setLocating(false)
    setPhoto(null)
    setSubmissionStarted(false)
    setError(null)
    setMetadata(null)
    setShowLocationMap(false)
    capturedAtRef.current = null
    setPhase('opening')
    setAttempt((value) => value + 1)
  }

  async function rotatePhoto(direction: -1 | 1) {
    if (!photo || rotating || submissionStarted) return
    const own = ++rotationGeneration.current
    const nextRotation = (photo.rotation + direction + 4) % 4
    setRotating(true)
    setError(null)
    let bitmap: ImageBitmap | null = null
    try {
      bitmap = await createImageBitmap(photo.originalBlob)
      if (own !== rotationGeneration.current) return
      const quarterTurn = nextRotation % 2 === 1
      const canvas = document.createElement('canvas')
      canvas.width = quarterTurn ? bitmap.height : bitmap.width
      canvas.height = quarterTurn ? bitmap.width : bitmap.height
      const context = canvas.getContext('2d')
      if (!context) throw new Error('no-context')
      context.translate(canvas.width / 2, canvas.height / 2)
      context.rotate(nextRotation * Math.PI / 2)
      context.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2)
      const rotatedBlob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('no-blob')), 'image/jpeg', 0.9)
      })
      if (own !== rotationGeneration.current) return
      const url = URL.createObjectURL(rotatedBlob)
      const oldUrl = photoRef.current
      photoRef.current = url
      setPhoto({ ...photo, url, blob: rotatedBlob, rotation: nextRotation })
      if (oldUrl) URL.revokeObjectURL(oldUrl)
    } catch {
      if (own === rotationGeneration.current) setError('写真回転失敗')
    } finally {
      bitmap?.close()
      if (own === rotationGeneration.current) setRotating(false)
    }
  }

  const panel = (
    <section ref={panelRef} role="dialog" aria-modal="true" className={wide ? "camera-panel" : "camera-panel camera-overlay"} aria-label="写真撮影と確認">
      <header className="camera-heading"><h4>{answer?.questTitle ?? (photoUrl ? '写真確認' : '撮影')}</h4>
        {(clue || hints.length > 0) && <details><summary>手がかり</summary>{clue && <p>{clue}</p>}{hints.map((hint, index) => <p key={index}>{hint}</p>)}</details>}
      </header>
      {photoUrl ? <img className="photo-preview" src={photoUrl} alt="撮影した写真のプレビュー" />
        : <video ref={videoRef} className="camera-video" autoPlay playsInline muted aria-label="カメラ映像"
          onLoadedData={ready} onCanPlay={ready} onError={() => fail('カメラ表示失敗')} />}
      {phase === 'opening' && <p role="status" className="camera-status">カメラの使用を許可</p>}
      {phase === 'capturing' && <p role="status" className="camera-status">写真作成中</p>}
      {locating && <p role="status" className="camera-status">撮影地取得中</p>}
      {rotating && <p role="status" className="camera-status">回転中</p>}
      {/* 撮影地の紐づけ自体は metadata で行い、精度の一行表示は出さない（表示のみ削除）。 */}
      {showCaptureLocationMapDebug && photoUrl && metadata && <div className="camera-map-reference">
        <button type="button" className="secondary-button" aria-expanded={showLocationMap}
          onClick={() => setShowLocationMap((visible) => !visible)}>撮影地</button>
        {showLocationMap && <CaptureLocationMap latitude={metadata.position.latitude} longitude={metadata.position.longitude} />}
      </div>}
      {error && <p className="camera-error" role="alert">{error}</p>}
      {photo && !submissionStarted && <div className="camera-actions photo-rotation-actions" aria-label="写真の向き">
        <button type="button" className="secondary-button" onClick={() => void rotatePhoto(-1)} disabled={rotating || submissionStarted}>左に回す</button>
        <button type="button" className="secondary-button" onClick={() => void rotatePhoto(1)} disabled={rotating || submissionStarted}>右に回す</button>
      </div>}
      {answer && photo && metadata && <DemoAnswerSubmission initialSubmitLabel="送る" context={answer} photo={photo.blob} metadata={metadata} disabled={rotating}
        onSubmissionStarted={() => { setSubmissionStarted(true); setRetakeLocked(true) }}
        onSubmissionResolved={() => setRetakeLocked(false)}
        onWaitingChange={setJudging} />}
      {!judging && <div className="camera-actions">
        {!photoUrl && phase !== 'error' && <div className="camera-shutter-controls"><button type="button" className="primary-button camera-shutter" aria-label="撮影" onClick={capture} disabled={phase !== 'live'} /></div>}
        {photoUrl && !metadata && <button type="button" className="secondary-button" onClick={requestLocation} disabled={locating}>位置を再取得</button>}
        {photoUrl && (!answer || !metadata) && <button type="button" className="primary-button" disabled>送る</button>}
        {photoUrl && <button type="button" className={submissionStarted && !retakeLocked ? "primary-button" : "secondary-button"} onClick={restart} disabled={retakeLocked}>撮り直す</button>}
        {phase === 'error' && <button type="button" className="primary-button" onClick={restart}>カメラを再試行</button>}
        <button ref={closeRef} type="button" className="secondary-button" onClick={() => requestClose()}>撮影を終了</button>
      </div>}
    </section>
  )
  return wide ? panel : createPortal(panel, document.body)
}
