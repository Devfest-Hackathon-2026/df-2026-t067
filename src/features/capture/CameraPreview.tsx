import { useEffect, useRef, useState } from 'react'
import { parseCaptureMetadata } from '../../shared/api'
import type { CaptureMetadata } from '../../shared/api/types'
import { DemoAnswerSubmission } from './DemoAnswerSubmission'
import type { DemoAnswerContext } from './DemoAnswerSubmission'

export function CameraPreview({ onClose, answer }: { onClose: () => void; answer?: DemoAnswerContext }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const photoRef = useRef<string | null>(null)
  const generation = useRef(0)
  const locationGeneration = useRef(0)
  const capturedAtRef = useRef<string | null>(null)
  const capturing = useRef(false)
  const [attempt, setAttempt] = useState(0)
  const [phase, setPhase] = useState<'opening' | 'live' | 'capturing' | 'photo' | 'error'>('opening')
  const [photo, setPhoto] = useState<{ url: string; blob: Blob } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [metadata, setMetadata] = useState<CaptureMetadata | null>(null)
  const [locating, setLocating] = useState(false)
  const photoUrl = photo?.url

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
      fail(name === 'NotAllowedError' ? 'カメラの使用が許可されませんでした。ブラウザの設定を確認して再試行できます。'
        : 'カメラを起動できませんでした。利用できる環境か確認して再試行してください。')
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
      fail('カメラ映像を準備できませんでした。再試行してください。')
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
        if (!blob) { fail('写真を作成できませんでした。再試行してください。'); return }
        try {
          const url = URL.createObjectURL(blob)
          photoRef.current = url
          // The photo owns the view now; ignore a delayed play() result.
          generation.current++
          stopCamera()
          setPhoto({ url, blob })
          setPhase('photo')
          capturing.current = false
        } catch { fail('写真を表示できませんでした。再試行してください。') }
      }, 'image/jpeg', 0.9)
    } catch { fail('写真を作成できませんでした。再試行してください。') }
  }

  function requestLocation() {
    if (!navigator.geolocation) {
      setError('この端末では位置情報を取得できません。写真は撮影済みです。')
      return
    }
    setLocating(true)
    setError(null)
    const ownLocationRequest = ++locationGeneration.current
    function locationFailed(message: string) {
      if (ownLocationRequest !== locationGeneration.current) return
      locationGeneration.current++
      setLocating(false)
      setError(`${message} 写真は撮影済みです。位置情報を再試行できます。`)
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
        } catch { locationFailed('撮影地の位置情報を確認できませんでした。') }
      }, (cause) => locationFailed(cause.code === cause.PERMISSION_DENIED
        ? '撮影地の取得が許可されませんでした。ブラウザの位置情報設定を確認してください。'
        : '撮影地を取得できませんでした。位置情報を確認してください。'),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 })
    } catch { locationFailed('撮影地を取得できませんでした。位置情報を確認してください。') }
  }

  function restart() {
    dispose()
    setLocating(false)
    setPhoto(null)
    setError(null)
    setMetadata(null)
    capturedAtRef.current = null
    setPhase('opening')
    setAttempt((value) => value + 1)
  }

  return (
    <section className="camera-panel" aria-label="写真撮影と確認">
      <h4>{photoUrl ? '写真を確認' : '写真を撮影'}</h4>
      <p className="sample-note">{answer
        ? answer.dataMode === 'durable-local'
          ? 'テスト送信を押すと写真・位置・精度・時刻をローカルAPIへ送ります。合成画像と架空の座標を使ってください。'
          : '撮影時に現在地を1回取得します。「写真と位置をデモ送信」を押すと、写真・位置・精度・時刻を開発用のローカルAPIへ送ります。受付と位置条件の確認までを試せます。'
        : '撮影時に現在地を1回取得します。写真・位置情報・撮影と測位の時刻はこの画面内だけで保持し、送信・保存・AI判定は行いません。'}</p>
      {photoUrl ? <img className="photo-preview" src={photoUrl} alt="撮影した写真のプレビュー" />
        : <video ref={videoRef} className="camera-video" autoPlay playsInline muted aria-label="カメラ映像"
          onLoadedData={ready} onCanPlay={ready} onError={() => fail('カメラ映像を表示できませんでした。再試行してください。')} />}
      {phase === 'opening' && <p role="status" className="camera-status">カメラを準備しています。許可の確認が出たら選択してください。</p>}
      {phase === 'capturing' && <p role="status" className="camera-status">写真を作成しています…</p>}
      {locating && <p role="status" className="camera-status">撮影地を取得しています…</p>}
      {photoUrl && metadata && <p className="camera-status" role="status">撮影地を写真に紐づけました（精度 約{Math.round(metadata.position.accuracyMeters)}m）。この画面を閉じると破棄されます。</p>}
      {photoUrl && metadata && <div className="camera-map-reference">
        <a
          className="secondary-button"
          href={`https://www.google.com/maps/search/?api=1&query=${metadata.position.latitude}%2C${metadata.position.longitude}`}
          target="_blank"
          rel="noreferrer"
        >撮影地を地図で見る（Googleマップ）</a>
        <p className="sample-note">リンクを開くと撮影地の座標がGoogleマップに送られます。</p>
      </div>}
      {error && <p className="camera-error" role="alert">{error}</p>}
      {answer && photo && metadata && <DemoAnswerSubmission context={answer} photo={photo.blob} metadata={metadata} />}
      <div className="camera-actions">
        {!photoUrl && <button type="button" className="primary-button" onClick={capture} disabled={phase !== 'live'}>{phase === 'capturing' ? '写真を作成しています…' : '撮影する'}</button>}
        {photoUrl && !metadata && <button type="button" className="primary-button" onClick={requestLocation} disabled={locating}>{locating ? '撮影地を取得中…' : '位置情報を再試行'}</button>}
        {photoUrl && <button type="button" className="secondary-button" onClick={restart}>撮り直す</button>}
        {phase === 'error' && <button type="button" className="secondary-button" onClick={restart}>カメラを再試行</button>}
        <button type="button" className="secondary-button" onClick={() => { dispose(); setLocating(false); onClose() }}>撮影を終了</button>
      </div>
    </section>
  )
}
