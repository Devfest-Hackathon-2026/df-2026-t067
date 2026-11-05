import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { demoQuest } from './features/quests/demoQuest'
import type { AuthClient, AuthSnapshot } from './features/auth/authTypes'
import { AuthError, createFirebaseAuthClient } from './features/auth/firebaseAuth'
import './App.css'

function connectionNotice(auth: AuthSnapshot): { title: string; description: string } {
  switch (auth.status) {
    case 'unconfigured':
      return { title: 'Firebase未接続', description: '画面確認用のプレビューです。ログイン・写真判定・記録の保存は、まだ利用できません。' }
    case 'unavailable':
      return { title: 'Googleログインを利用できません', description: auth.message }
    case 'checking':
      return { title: 'ログイン状態を確認中', description: '問題はそのまま閲覧できます。しばらくお待ちください。' }
    case 'signed-out':
      return { title: 'Googleログインを利用できます', description: '問題はログインなしで閲覧できます。撮影・写真判定・記録保存は準備中です。' }
    case 'signed-in':
      return { title: 'Googleログイン済み', description: (auth.user.displayName ?? 'Googleアカウント') + 'でログインしています。撮影・写真判定・記録保存は準備中です。' }
  }
}

export default function App({ authClient: providedClient }: { authClient?: AuthClient } = {}) {
  const [isQuestOpen, setIsQuestOpen] = useState(false)
  const authClient = useMemo(() => providedClient ?? createFirebaseAuthClient(), [providedClient])
  const auth = useSyncExternalStore(authClient.subscribe, authClient.getSnapshot, authClient.getSnapshot)
  const [pending, setPending] = useState<'sign-in' | 'sign-out' | null>(null)
  const [feedback, setFeedback] = useState<{ error: boolean; text: string } | null>(null)
  const [cameraOpen, setCameraOpen] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const notice = connectionNotice(auth)

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
  }

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    if (photoUrl) URL.revokeObjectURL(photoUrl)
  }, [photoUrl])

  async function openCamera() {
    setCameraError(null)
    setPhotoUrl(null)
    setCameraOpen(true)
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('unsupported')
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
    } catch (error) {
      setCameraError(error instanceof DOMException && error.name === 'NotAllowedError'
        ? 'カメラの使用が許可されませんでした。ブラウザの設定で許可してから、もう一度お試しください。'
        : 'カメラを起動できませんでした。カメラを利用できる環境か確認して、もう一度お試しください。')
      stopCamera()
    }
  }

  function capturePhoto() {
    const video = videoRef.current
    if (!video || !video.videoWidth || !video.videoHeight) {
      setCameraError('カメラ映像を準備できません。少し待ってから撮影してください。')
      return
    }
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d')?.drawImage(video, 0, 0)
    canvas.toBlob((blob) => {
      if (!blob) {
        setCameraError('写真を作成できませんでした。もう一度撮影してください。')
        return
      }
      setPhotoUrl(URL.createObjectURL(blob))
      stopCamera()
    }, 'image/jpeg', 0.9)
  }

  function closeCamera() {
    stopCamera()
    setCameraOpen(false)
    setCameraError(null)
    setPhotoUrl(null)
  }

  async function login() {
    if (pending || auth.status !== 'signed-out') return
    setFeedback(null)
    setPending('sign-in')
    try { await authClient.signInWithGoogle() }
    catch (error) {
      const safe = error instanceof AuthError ? error : new AuthError('unknown')
      setFeedback({ error: safe.code !== 'cancelled', text: safe.message })
    } finally { setPending(null) }
  }

  async function logout() {
    if (pending) return
    setFeedback(null)
    setPending('sign-out')
    try { await authClient.signOut() }
    catch (error) {
      const safe = error instanceof AuthError ? error : new AuthError('unknown')
      setFeedback({ error: true, text: safe.message })
    } finally { setPending(null) }
  }

  return (
    <>
      <a className="skip-link" href="#main">本文へ移動</a>
      <header className="site-header">
        <span className="brand">全国観光謎アプリ <small>（仮称）</small></span>
        <span className="preview-label">開発用プレビュー</span>
        {auth.status === 'signed-in' && (
          <button type="button" className="secondary-button" disabled={pending !== null} onClick={logout}>
            {pending === 'sign-out' ? 'ログアウト中…' : 'ログアウト'}
          </button>
        )}
      </header>

      <main id="main" className="page" tabIndex={-1}>
        <section className="hero" aria-labelledby="hero-title">
          <p className="eyebrow">まだ知らない場所に、出会いにいこう。</p>
          <h1 id="hero-title">全国の謎を、<br />旅のきっかけに。</h1>
          <p className="hero-description">
            地図から気になる謎を見つけて、現地で写真を撮る。
            その場所での発見を、自分だけの記録に。
          </p>
        </section>

        <aside className="connection-notice" role="status">
          <strong>{notice.title}</strong>
          <p>{notice.description}</p>
        </aside>

        <section className="explore" aria-labelledby="explore-title">
          <div className="section-heading">
            <h2 id="explore-title">全国から謎を探す</h2>
            <p>完成後は、自治体が出題した謎を一つの地図で選べます。</p>
          </div>
          <div className="explore-grid">
            <div className="map-placeholder">
              <span className="map-symbol" aria-hidden="true">＋</span>
              <h3>全国地図は準備中です</h3>
              <p>今はサンプル問題で、画面の入口を確認できます。</p>
            </div>

            <article className="quest-card" aria-labelledby="quest-title">
              <p className="sample-label">架空のサンプル問題</p>
              <p className="area-label">{demoQuest.areaLabel}</p>
              <h3 id="quest-title">{demoQuest.title}</h3>
              <p>謎の閲覧にログインは必要ありません。</p>
              <button
                type="button"
                className="primary-button"
                aria-expanded={isQuestOpen}
                aria-controls="demo-quest-details"
                onClick={() => setIsQuestOpen(!isQuestOpen)}
              >
                {isQuestOpen ? '問題を閉じる' : '問題を見てみる'}
              </button>
              {isQuestOpen && (
                <section id="demo-quest-details" className="quest-details" aria-label="サンプル問題の詳細">
                  <h4>この場所はどこ？</h4>
                  <p>{demoQuest.clue}</p>
                  <p className="sample-note">{demoQuest.visitConditions}</p>
                  <button
                    type="button"
                    className="primary-button"
                    disabled={(auth.status !== 'signed-out' && auth.status !== 'signed-in') || pending !== null}
                    onClick={auth.status === 'signed-in' ? openCamera : login}
                    aria-describedby="login-unavailable"
                  >
                    {auth.status === 'signed-in' ? 'ログイン済み・撮影画面を試す'
                      : pending === 'sign-in' ? 'Googleログイン中…' : 'Googleログインして挑戦する'}
                  </button>
                  <p id="login-unavailable" className="unavailable-note">
                    {auth.status === 'signed-in' ? '架空の問題です。写真はこの画面で確認するだけで、送信・保存されません。'
                      : auth.status === 'signed-out' ? 'Googleのログイン画面を開きます。キャンセルしてもこの問題に戻れます。'
                        : auth.status === 'checking' ? 'ログイン状態の確認後に操作できます。'
                          : 'Googleログインの準備ができていません。現在は挑戦を開始できません。'}
                  </p>
                  {auth.status === 'signed-in' && !cameraOpen && (
                    <button type="button" className="primary-button" onClick={openCamera}>撮影を始める</button>
                  )}
                  {cameraOpen && (
                    <section className="camera-panel" aria-label="写真撮影と確認">
                      <h4>{photoUrl ? '写真を確認' : '写真を撮影'}</h4>
                      {photoUrl ? <img className="photo-preview" src={photoUrl} alt="撮影した写真のプレビュー" />
                        : <video ref={videoRef} className="camera-video" autoPlay playsInline muted aria-label="カメラ映像" />}
                      {cameraError && <p className="camera-error" role="alert">{cameraError}</p>}
                      <p className="sample-note">撮影した写真はこの画面で確認するだけです。送信・保存は行いません。</p>
                      <div className="camera-actions">
                        {!photoUrl && <button type="button" className="primary-button" onClick={capturePhoto} disabled={Boolean(cameraError)}>撮影する</button>}
                        {photoUrl && <button type="button" className="secondary-button" onClick={openCamera}>撮り直す</button>}
                        <button type="button" className="secondary-button" onClick={closeCamera}>撮影を終了</button>
                      </div>
                    </section>
                  )}
                  {feedback && (
                    <p className="auth-feedback" role={feedback.error ? 'alert' : 'status'}>{feedback.text}</p>
                  )}
                </section>
              )}
            </article>
          </div>
        </section>
      </main>
      {!isQuestOpen && feedback && (
        <p className="page auth-feedback" role={feedback.error ? 'alert' : 'status'}>{feedback.text}</p>
      )}

      <footer className="site-footer">
        掲載内容は開発用サンプルです。実在の自治体・観光スポットの問題ではありません。
      </footer>
    </>
  )
}
