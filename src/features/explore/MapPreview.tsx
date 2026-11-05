import { useState } from 'react'
import japanOverview from '../../assets/japan-overview.svg'
import japanOverviewWide from '../../assets/japan-overview-wide.svg'
import { Icon } from '../../components/Icon'

export function MapPreview({ selected, onSelectQuest, showMarker = true }: { selected: boolean; onSelectQuest: () => void; showMarker?: boolean }) {
  const [zoom, setZoom] = useState(1)
  return (
    <div className="map-preview">
      <div className="map-topline">
        <span className="map-scope"><Icon name="map" />全国の謎</span>
        <span className="demo-map-label">地図デザインのプレビュー</span>
      </div>
      <div className="map-viewport">
        <div className="map-canvas" style={{ transform: 'scale(' + zoom + ')' }}>
          <picture><source media="(min-width: 641px)" srcSet={japanOverviewWide} /><img className="map-image" src={japanOverview} alt="日本周辺の簡略地図" draggable={false} /></picture>
          {showMarker && <button type="button" className={'quest-pin' + (selected ? ' is-selected' : '')}
            aria-label="デモの謎を地図から見る" aria-pressed={selected} onClick={onSelectQuest}>
            <span className="pin-halo"><span className="pin-face"><Icon name="pin" /></span></span>
            <span className="pin-caption">架空のみなと町</span>
          </button>}
        </div>
      </div>
      <div className="map-zoom" aria-label="地図の表示操作">
        <button type="button" aria-label="地図を拡大" disabled={zoom >= 2} onClick={() => setZoom((v) => Math.min(2, v + .25))}><Icon name="plus" /></button>
        <button type="button" aria-label="地図を縮小" disabled={zoom <= 1} onClick={() => setZoom((v) => Math.max(1, v - .25))}><Icon name="minus" /></button>
        <button type="button" aria-label="地図の表示を戻す" disabled={zoom === 1} onClick={() => setZoom(1)}><Icon name="reset" /></button>
      </div>
      <div className="map-bottomline">
        <span>デモ位置・実在スポットではありません</span>
        <span className="map-credit">Natural Earth</span>
      </div>
      <output className="sr-only" aria-label="地図の表示倍率">{Math.round(zoom * 100)}%</output>
    </div>
  )
}
