import { useEffect, useRef, useState } from 'react'

export function CameraPreview({ onClose }: { onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const photoRef = useRef<string | null>(null)
  const generation = useRef(0)
  const capturing = useRef(false)
  const [attempt, setAttempt] = useState(0)
  const [phase, setPhase] = useState<'opening' | 'live' | 'capturing' | 'photo' | 'error'>('opening')
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

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
    capturing.current = false
    stopCamera()
    releasePhoto()
  }

  function fail(message: string) {
    generation.current++
    capturing.current = false
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
    const video = videoRef.current
    if (!video?.videoWidth || !video.videoHeight || video.readyState < 2) {
      fail('カメラ映像を準備できませんでした。再試行してください。')
      return
    }
    capturing.current = true
    setPhase('capturing')
    const own = generation.current
    try {
      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      const context = canvas.getContext('2d')
      if (!context) throw new Error('no-context')
      context.drawImage(video, 0, 0)
      canvas.toBlob((blob) => {
        if (own !== generation.current) return
        if (!blob) { fail('写真を作成できませんでした。再試行してください。'); return }
        try {
          const url = URL.createObjectURL(blob)
          photoRef.current = url
          // The photo owns the view now; ignore a delayed play() result.
          generation.current++
          stopCamera()
          setPhotoUrl(url)
          setPhase('photo')
          capturing.current = false
        } catch { fail('写真を表示できませんでした。再試行してください。') }
      }, 'image/jpeg', 0.9)
    } catch { fail('写真を作成できませんでした。再試行してください。') }
  }

  function restart() {
    dispose()
    setPhotoUrl(null)
    setError(null)
    setPhase('opening')
    setAttempt((value) => value + 1)
  }

  return (
    <section className="camera-panel" aria-label="写真撮影と確認">
      <h4>{photoUrl ? '写真を確認' : '写真を撮影'}</h4>
      <p className="sample-note">写真はこの画面で確認するだけです。送信・保存・AI判定は行いません。</p>
      {photoUrl ? <img className="photo-preview" src={photoUrl} alt="撮影した写真のプレビュー" />
        : <video ref={videoRef} className="camera-video" autoPlay playsInline muted aria-label="カメラ映像"
          onLoadedData={ready} onCanPlay={ready} onError={() => fail('カメラ映像を表示できませんでした。再試行してください。')} />}
      {phase === 'opening' && <p role="status" className="camera-status">カメラを準備しています。許可の確認が出たら選択してください。</p>}
      {phase === 'capturing' && <p role="status" className="camera-status">写真を作成しています…</p>}
      {error && <p className="camera-error" role="alert">{error}</p>}
      <div className="camera-actions">
        {!photoUrl && <button type="button" className="primary-button" onClick={capture} disabled={phase !== 'live'}>撮影する</button>}
        {photoUrl && <button type="button" className="secondary-button" onClick={restart}>撮り直す</button>}
        {phase === 'error' && <button type="button" className="secondary-button" onClick={restart}>カメラを再試行</button>}
        <button type="button" className="secondary-button" onClick={onClose}>撮影を終了</button>
      </div>
    </section>
  )
}
