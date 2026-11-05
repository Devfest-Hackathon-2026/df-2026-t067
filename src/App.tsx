import { useState } from 'react'
import { demoQuest } from './features/quests/demoQuest'
import './App.css'

export default function App() {
  const [isQuestOpen, setIsQuestOpen] = useState(false)

  return (
    <>
      <a className="skip-link" href="#main">本文へ移動</a>
      <header className="site-header">
        <span className="brand">全国観光謎アプリ <small>（仮称）</small></span>
        <span className="preview-label">開発用プレビュー</span>
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
          <strong>Firebase未接続</strong>
          <p>画面確認用のプレビューです。ログイン・写真判定・記録の保存は、まだ利用できません。</p>
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
                  <button type="button" className="primary-button" disabled aria-describedby="login-unavailable">
                    Googleログインして挑戦する
                  </button>
                  <p id="login-unavailable" className="unavailable-note">
                    Googleログインは準備中です。現在は挑戦を開始できません。
                  </p>
                </section>
              )}
            </article>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        掲載内容は開発用サンプルです。実在の自治体・観光スポットの問題ではありません。
      </footer>
    </>
  )
}
