import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { Icon } from '../../components/Icon'
import type { PublicArea, PublicQuest } from '../../shared/api/types'

// 選択状態に連動する謎リスト。並ぶのは呼び出し側が選択（地域の選択・地方／都道府県の
// 絞り込み）で絞った問題だけであり、地図の表示範囲では変わらない（D-45）。問題の選択
// はピンと同じく所属地域の選択を伴い、その地域の問題へ一覧を絞る。
// 地図が使えない場合も同じ。
// 行は題名と地域名・番号の2行にし、選んだ行の直下に詳細（QuestDetails）を開く
// アコーディオンにする（D-46）。詳細を別枠で下に置くと、タイトルが一覧と詳細で
// 二重に出てパネル／シートが煩雑になるため。
export function ExploreQuestList({ areas, quests, highlightArea, selectedQuestId = '', clearedQuestIds, onOpenQuest, onDeselectQuest, scrollToHighlight = true, detailContent, detailRef, loading = false, filters, discardClosingDetail = false, detailOwner }: {
  filters?: ReactNode
  areas: PublicArea[]
  quests: PublicQuest[]
  highlightArea?: PublicArea
  selectedQuestId?: string
  clearedQuestIds?: ReadonlySet<string>
  onOpenQuest?: (questId: string) => void
  /** 選択中の行をもう一度押した時の選択解除（D-55）。ピンの再タップ（D-44）と
      揃え、行・カードでも再タップで選択を外せるようにする。 */
  onDeselectQuest?: () => void
  /** 読み込み中は件数と「謎はありません」を出さず、行の場所だけを確保する。
      一瞬だけ「0件／空です」が見えるチラつきと、読み込み前後の大きさの変化を防ぐ。
      この読み込み表示は行がまだ無い初回だけに使う（D-75）。再取得中に行が
      ある場合は、前の件数と行をそのまま残し、「読み込み中」へ切り替えない。 */
  loading?: boolean
  /** ハイライトされた地域の先頭カードへリスト内スクロールするか。地図下の一覧（#70）では
      ページ側のスクロールと競合するため切る。 */
  scrollToHighlight?: boolean
  /** 選択中の問題の詳細。選択中の行の直下にだけ差し込む（同時に開くのは1つだけ）。 */
  detailContent?: ReactNode
  /** 詳細のラッパへの ref。呼び出し側が「問題を見る」の着地（#70）に使う。 */
  detailRef?: RefObject<HTMLDivElement | null>
  /** Immediately unmount a detail moved to the other list, avoiding duplicate stateful instances. */
  discardClosingDetail?: boolean
  /** Identifies which persistent list owns the stateful detail during a deliberate handoff. */
  detailOwner?: 'sheet' | 'belowMap'
}) {
  const clearedLabelId = useId()
  const listRef = useRef<HTMLUListElement>(null)
  // アコーディオンを閉じた問題。選択解除の受け口が無い使われ方でのみ使い、
  // 選択自体は変えず、詳細の表示だけを畳む（受け口がある場合は再タップ＝選択解除）。
  const [closedQuestId, setClosedQuestId] = useState('')
  // 詳細の開閉は高さアニメーションで滑らせる（D-59、方式は下記の追記で変更）。
  // 閉じる時は最後の内容を保持したまま畳んでから外す。状態の追随は App.tsx の
  // ディープリンク処理と同じく、レンダー中に前回値と比較して調整する形に揃える。
  const [prevExpandedQuestId, setPrevExpandedQuestId] = useState('')
  const [lastDetail, setLastDetail] = useState<{ questId: string; content: ReactNode } | null>(null)
  const [closingDetail, setClosingDetail] = useState<{ questId: string; content: ReactNode } | null>(null)
  const [previousDetailOwner, setPreviousDetailOwner] = useState(detailOwner)
  const detailOwnerChanged = previousDetailOwner !== detailOwner
  // ピンで選ばれた地域の問題は先頭に寄せ、シートを開いた時にスクロールなしで先頭に出るようにする。
  const orderedQuests = highlightArea
    ? [...quests.filter((quest) => quest.areaId === highlightArea.areaId), ...quests.filter((quest) => quest.areaId !== highlightArea.areaId)]
    : quests
  const expandedQuestId = detailContent && selectedQuestId && closedQuestId !== selectedQuestId ? selectedQuestId : ''

  // 開いている間は最新の詳細を覚える（閉じる時に保持する内容）。
  if (expandedQuestId && detailContent && (lastDetail?.questId !== expandedQuestId || lastDetail.content !== detailContent)) {
    setLastDetail({ questId: expandedQuestId, content: detailContent })
  }
  if (detailOwnerChanged) {
    setPreviousDetailOwner(detailOwner)
    setLastDetail(null)
    setClosingDetail(null)
  }
  if (expandedQuestId !== prevExpandedQuestId) {
    setPrevExpandedQuestId(expandedQuestId)
    if (!detailOwnerChanged && lastDetail && lastDetail.questId !== expandedQuestId && !discardClosingDetail) setClosingDetail(lastDetail)
    else if (discardClosingDetail) setClosingDetail(null)
    else if (closingDetail?.questId === expandedQuestId) setClosingDetail(null)
  }

  // 閉じ終わったら保持していた内容を外す（遷移 280ms の後に外れるよう少し長く取る）。
  useEffect(() => {
    if (!closingDetail) return
    const timeout = window.setTimeout(() => setClosingDetail(null), 300)
    return () => window.clearTimeout(timeout)
  }, [closingDetail])

  useEffect(() => {
    if (!scrollToHighlight || !highlightArea || !listRef.current) return
    for (const item of listRef.current.querySelectorAll('[data-area-id]')) {
      if (item.getAttribute('data-area-id') !== highlightArea.areaId) continue
      try { (item as HTMLElement).scrollIntoView({ block: 'nearest' }) } catch { /* スクロール位置の補助であり、失敗しても一覧は使える。 */ }
      break
    }
  }, [highlightArea, scrollToHighlight])

  // Scroll after the selected row and its detail have been committed, including async loads.
  useLayoutEffect(() => {
    if (!expandedQuestId) return
    const row = listRef.current?.querySelector<HTMLElement>('[aria-expanded="true"]')?.closest('li')
    const align = () => {
      if (!row) return
      const behavior = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'
      const scroller = row.closest<HTMLElement>('.explore-side-panel, .explore-sheet-body')
      if (scroller?.scrollTo) {
        const stickyHeight = scroller.classList.contains('explore-side-panel')
          ? scroller.querySelector('.side-panel-filters')?.getBoundingClientRect().height ?? 0 : 0
        scroller.scrollTo({ top: scroller.scrollTop + row.getBoundingClientRect().top - scroller.getBoundingClientRect().top - stickyHeight, behavior })
      } else row.scrollIntoView?.({ block: 'start', behavior })
    }
    align()
    const detail = row?.querySelector('.explore-quest-detail-wrap')
    const onExpanded = (event: Event) => { if (event.target === detail) align() }
    detail?.addEventListener('transitionend', onExpanded)
    return () => detail?.removeEventListener('transitionend', onExpanded)
  }, [expandedQuestId])

  useEffect(() => {
    if (!expandedQuestId) return
    const close = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      listRef.current?.querySelector<HTMLButtonElement>('[aria-expanded="true"]')?.focus({ preventScroll: true })
      if (onDeselectQuest) onDeselectQuest()
      else setClosedQuestId(expandedQuestId)
    }
    document.addEventListener('keydown', close)
    return () => document.removeEventListener('keydown', close)
  }, [expandedQuestId, onDeselectQuest])

  const handleRowClick = (questId: string) => {
    if (questId === selectedQuestId) {
      // 選択中の行の再タップは選択解除に統一する（D-55、ピンの再タップ D-44 と同じ）。
      // 解除すると詳細も閉じ、地図は未選択の表示へ戻る。解除の受け口が無い使われ方
      // では、従来どおりアコーディオンの開閉だけを行う。
      if (onDeselectQuest) {
        setClosedQuestId('')
        onDeselectQuest()
        return
      }
      if (detailContent) {
        setClosedQuestId((current) => (current === questId ? '' : questId))
        return
      }
    }
    setClosedQuestId('')
    onOpenQuest?.(questId)
  }

  return (
    <section className="explore-list" aria-label="選べる謎の一覧">
      <div className="explore-list-head">
        <span>{loading && quests.length === 0 ? '読み込み中' : `${quests.length}件`}</span>
        {filters}
      </div>
      {quests.length === 0 && loading
        ? <ul className="explore-quest-list" aria-hidden="true">
          {[0, 1, 2, 3, 4].map((index) => <li key={index}><div className="explore-quest-skeleton" aria-hidden="true" /></li>)}
        </ul>
        : quests.length === 0
        ? <p className="explore-list-empty">該当なし</p>
        : <ul ref={listRef} className="explore-quest-list">
          {orderedQuests.map((quest) => {
            const cleared = clearedQuestIds?.has(quest.questId) ?? false
            const expanded = quest.questId === expandedQuestId
            const closing = !expanded && closingDetail?.questId === quest.questId
            const content = <>
              <span className={'explore-row-icon' + (cleared ? ' is-cleared' : '')} aria-hidden="true"><Icon name={cleared ? 'check' : 'pin'} /></span>
              <span className="explore-row-copy">
                <span className="explore-quest-title traveler-row-title">{quest.title}</span>
                <span className="traveler-row-secondary">
                  <span className="traveler-row-meta">{[areas.find((area) => area.areaId === quest.areaId)?.label, quest.questNumber && `No. ${quest.questNumber}`].filter(Boolean).join(' · ')}</span>
                  {cleared && <span className="sr-only" id={`${clearedLabelId}-${quest.questId}`}>クリア済み</span>}
                </span>
              </span>
            </>
            return <li key={quest.questId} data-area-id={quest.areaId} className={highlightArea?.areaId === quest.areaId ? 'is-highlighted' : undefined}>
              {onOpenQuest
                ? <button type="button" className={'explore-quest-card traveler-list-row' + (quest.questId === selectedQuestId ? ' is-selected' : '')}
                  {...(detailContent
                    ? { 'aria-expanded': expanded }
                    : { 'aria-pressed': selectedQuestId ? quest.questId === selectedQuestId : undefined })}
                  aria-describedby={cleared ? `${clearedLabelId}-${quest.questId}` : undefined}
                  aria-label={`${quest.title}の詳細を見る`} onClick={() => handleRowClick(quest.questId)}>{content}</button>
                : <div className="explore-quest-card traveler-list-row">{content}</div>}
              {/* 開閉の枠は「場所で絞る」と同じく常時マウントし、開状態のクラスだけで
                  grid-template-rows を切り替える（D-59 追記）。展開の瞬間にマウントして
                  次フレームでクラスを足す形では、閉じた高さ（0fr）が画面に確定する前に
                  開状態へ変わり、遷移の開始値が無いため実物ではアニメーションが
                  起きなかった。枠が常駐していれば 0fr が確定済みで、クラスの切り替えが
                  そのまま遷移になる。中身は開いている行（と、閉じ終わるまでの行）だけが持つ。 */}
              <div className={'explore-quest-detail-wrap' + (expanded ? ' is-open' : '')}
                aria-hidden={!expanded || undefined}>
                <div className="explore-quest-detail-clip">
                  {expanded
                    ? <div ref={detailRef} className="explore-quest-detail">{detailContent}</div>
                    : closing && <div className="explore-quest-detail">{closingDetail?.content}</div>}
                </div>
              </div>
            </li>
          })}
        </ul>}
    </section>
  )
}
