import './App.css'
import './Terms.css'

export function Terms() {
  return <div className="terms-page">
    <header>
      <a className="brand" href="/" aria-label="NAZOP 旅行者画面へ戻る">
        <span className="brand-mark"><img src="/favicon.svg" alt="" /></span>
        <span className="brand-copy">NAZOP</span>
      </a>
    </header>
    <main>
      <h1>利用規約</h1>
      <section aria-labelledby="shooting-rules">
        <h2 id="shooting-rules">撮影の決まり</h2>
        <ul>
          <li>立入禁止の場所に入らない</li>
          <li>他人の顔を写さない</li>
          <li>私有地や施設のルールを守る</li>
          <li>歩きながら撮らない</li>
          <li>交通に気をつける</li>
          <li>通行や施設の利用を妨げない</li>
        </ul>
      </section>
    </main>
  </div>
}
