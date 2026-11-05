import { useState, type RefObject } from 'react'

export type PreviewContent = {
  title: string
  question: string
  hints: [string, string, string]
  availableModes: string[]
  requiredModes: string[]
  access: string
  hours: string
  price: string
  photoNote: string
}

type Props = {
  content: PreviewContent
  headingRef: RefObject<HTMLHeadingElement | null>
  onEdit: () => void
}

function shown(value: string) {
  return value.trim() || '未入力'
}

export default function TravelerPreview({ content, headingRef, onEdit }: Props) {
  const [openHints, setOpenHints] = useState([false, false, false])

  return <section className="form-section traveler-preview" aria-labelledby="preview-heading">
    <h2 id="preview-heading" ref={headingRef} tabIndex={-1}>旅行者向け表示の確認（未公開）</h2>
    <p className="demo-notice" role="note">管理用プレビュー・表示確認のみ。実際の旅行者画面、写真判定、公開には未接続です。</p>
    <article className="traveler-card">
      <h3>{shown(content.title)}</h3>
      <p>{shown(content.question)}</p>
      <section aria-labelledby="preview-area-heading"><h4 id="preview-area-heading">公開探索エリア</h4><p>青葉みらい市の行政区域（デモ用の架空エリア）</p></section>
      <section aria-labelledby="preview-access-heading"><h4 id="preview-access-heading">利用条件</h4>
        <dl><dt>利用可能な交通手段</dt><dd>{content.availableModes.length ? content.availableModes.join('、') : '未入力'}</dd><dt>必須の交通手段</dt><dd>{content.requiredModes.length ? content.requiredModes.join('、') : '未入力'}</dd><dt>アクセス補足</dt><dd>{shown(content.access)}</dd><dt>利用できる時間</dt><dd>{shown(content.hours)}</dd><dt>料金</dt><dd>{shown(content.price)}</dd><dt>撮影時の注意</dt><dd>{shown(content.photoNote)}</dd></dl>
      </section>
      <section aria-labelledby="preview-hints-heading"><h4 id="preview-hints-heading">ヒント</h4>
        {content.hints.map((hint, index) => (
          <div className="preview-hint" key={index}>
            <button
              type="button"
              aria-expanded={openHints[index]}
              aria-controls={`preview-hint-${index}`}
              onClick={() => setOpenHints(current => current.map((open, itemIndex) => itemIndex === index ? !open : open))}
            >ヒント {index + 1}を見る</button>
            <p id={`preview-hint-${index}`} hidden={!openHints[index]}>{shown(hint)}</p>
          </div>
        ))}
        <p className="helper">公開ヒント画像は未設定</p>
      </section>
    </article>
    <button type="button" onClick={onEdit}>A04編集へ戻る</button>
  </section>
}
