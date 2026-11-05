import { useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { demoQuest } from './features/quests/demoQuest'
import { MapPreview } from './features/explore/MapPreview'
import { Icon } from './components/Icon'
import type { AuthClient, AuthSnapshot } from './features/auth/authTypes'
import { AuthError, createFirebaseAuthClient } from './features/auth/firebaseAuth'
import './App.css'

function connectionNotice(auth: AuthSnapshot): { title: string; description: string } {
  switch (auth.status) {
    case 'unconfigured':
      return { title: 'ログイン準備中', description: '問題はログインなしで閲覧できます。ログイン機能は準備中です。' }
    case 'unavailable':
      return { title: 'Googleログインを利用できません', description: auth.message }
    case 'checking':
      return { title: 'ログイン状態を確認中', description: '問題はそのまま閲覧できます。しばらくお待ちください。' }
    case 'signed-out':
      return { title: 'ゲストで閲覧中', description: '問題はログインなしで閲覧できます。撮影・写真判定・記録保存は準備中です。' }
    case 'signed-in':
      return { title: 'Googleログイン済み', description: (auth.user.displayName ?? 'Googleアカウント') + 'でログインしています。撮影・写真判定・記録保存は準備中です。' }
  }
}

export default function App({ authClient: providedClient }: { authClient?: AuthClient } = {}) {
  const [isQuestOpen, setIsQuestOpen] = useState(false)
  const questCard = useRef<HTMLElement>(null)
  const authClient = useMemo(() => providedClient ?? createFirebaseAuthClient(), [providedClient])
  const auth = useSyncExternalStore(authClient.subscribe, authClient.getSnapshot, authClient.getSnapshot)
  const [pending, setPending] = useState<'sign-in' | 'sign-out' | null>(null)
  const [feedback, setFeedback] = useState<{ error: boolean; text: string } | null>(null)
  const notice = connectionNotice(auth)

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
        <div className="brand">
          <span className="brand-mark"><Icon name="compass" /></span>
          <span className="brand-copy">全国観光謎アプリ<small>謎から、旅へ。</small></span>
        </div>
        <nav className="desktop-nav" aria-label="主要ナビゲーション">
          <a className="nav-active" href="#explore-title" aria-current="page"><Icon name="map" />謎を探す</a>
          <button type="button" disabled><Icon name="book" />自分の記録<span>準備中</span></button>
        </nav>
        <div className="account-area">
          <div className="account-status" role="status" aria-label="ログイン状態">
            <Icon name="user" /><span>{notice.title}</span>
            <span className="sr-only">{notice.description}</span>
          </div>
          {auth.status === 'signed-in' && (
            <button type="button" className="logout-button" disabled={pending !== null} onClick={logout}>
              {pending === 'sign-out' ? 'ログアウト中…' : 'ログアウト'}
            </button>
          )}
        </div>
      </header>

      <main id="main" className="page" tabIndex={-1}>
        <section className="explore" aria-labelledby="explore-title">
          <div className="explore-heading">
            <div>
              <p className="eyebrow">知らない街との、出会いを探そう</p>
              <h1 id="explore-title">全国から謎を探す</h1>
              <p className="explore-description">気になる謎を選んで、次の旅のきっかけに。</p>
            </div>
            <span className="preview-label"><span className="status-dot" />開発用プレビュー</span>
          </div>

          <div className="explore-workspace">
            <MapPreview selected={isQuestOpen} onSelectQuest={() => {
              setIsQuestOpen(true)
              questCard.current?.scrollIntoView?.({ block: 'start', behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
            }} />

            <aside className="quest-rail" aria-label="選べる謎">
              <div className="rail-heading"><h2>旅のきっかけになる謎</h2><span>デモ 1件</span></div>
              <p className="rail-description">ヒントを頼りに、街の新しい一面を見つけよう。</p>
              <article ref={questCard} className={'quest-card' + (isQuestOpen ? ' is-open' : '')} aria-labelledby="quest-title">
                <div className="quest-visual" aria-hidden="true">
                  <span className="visual-orbit orbit-one" /><span className="visual-orbit orbit-two" />
                  <Icon name="compass" /><span className="visual-caption">その街の、まだ知らない話。</span>
                </div>
                <div className="quest-card-content">
                  <div className="quest-meta"><span className="area-label"><Icon name="pin" />{demoQuest.areaLabel}</span><span className="sample-label">架空のサンプル問題</span></div>
                  <h3 id="quest-title">{demoQuest.title}</h3>
                  <p className="quest-intro">文章のヒントから、街の中に隠れた場所を見つけよう。</p>
                  <button type="button" className={'quest-toggle' + (isQuestOpen ? ' is-open' : '')}
                    aria-expanded={isQuestOpen} aria-controls="demo-quest-details"
                    onClick={() => setIsQuestOpen(!isQuestOpen)}>
                    <span>{isQuestOpen ? '問題を閉じる' : '問題を見てみる'}</span><Icon name="arrow" />
                  </button>
                  {isQuestOpen && (
                    <section id="demo-quest-details" className="quest-details" aria-label="サンプル問題の詳細">
                      <p className="question-step">この街をめぐる、小さな問い</p>
                      <h4>この場所はどこ？</h4>
                      <p className="clue-text">{demoQuest.clue}</p>
                      <p className="sample-note">{demoQuest.visitConditions}</p>
                      <button type="button" className="primary-button"
                        disabled={auth.status !== 'signed-out' || pending !== null}
                        onClick={login} aria-describedby="login-unavailable">
                        {auth.status === 'signed-in' ? 'ログイン済み・撮影機能は準備中'
                          : pending === 'sign-in' ? 'Googleログイン中…' : 'Googleログインして挑戦する'}
                      </button>
                      <p id="login-unavailable" className="unavailable-note">
                        {auth.status === 'signed-in' ? '選んだ問題を表示しています。撮影機能ができるまでお待ちください。'
                          : auth.status === 'signed-out' ? 'Googleのログイン画面を開きます。キャンセルしてもこの問題に戻れます。'
                            : auth.status === 'checking' ? 'ログイン状態の確認後に操作できます。'
                              : 'ログイン機能は準備中です。問題はそのまま閲覧できます。'}
                      </p>
                      {feedback && <p className="auth-feedback" role={feedback.error ? 'alert' : 'status'}>{feedback.text}</p>}
                    </section>
                  )}
                </div>
              </article>
              <div className="browse-note"><span className="browse-note-icon"><Icon name="compass" /></span><div><strong>まずは、気になる謎をひとつ。</strong><p>問題の閲覧にログインは必要ありません。</p></div></div>
              <div className="demo-note"><span className="demo-note-dot" /><p>今はデザイン確認用の架空の1問を表示しています。実際に訪問できる場所ではありません。</p></div>
            </aside>
          </div>
        </section>
        {!isQuestOpen && feedback && <p className="auth-feedback" role={feedback.error ? 'alert' : 'status'}>{feedback.text}</p>}
      </main>
      <footer className="site-footer"><span>謎を見つけて、街と出会う。</span><span>場所・問題は架空の開発用デモです。</span></footer>
      <nav className="mobile-nav" aria-label="スマホ用ナビゲーション">
        <a href="#explore-title" aria-current="page"><Icon name="map" /><span>謎を探す</span></a>
        <button type="button" disabled><Icon name="book" /><span>自分の記録<small>準備中</small></span></button>
      </nav>
    </>
  )
}
