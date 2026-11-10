import { create } from 'qrcode'
import { useMemo } from 'react'

// QRはクライアント側だけで生成する（URLを外部サービスへ送らない）。
// 余白（クワイエットゾーン）4モジュールを含めて描画する。
export function QuestQrCode({ value, label }: { value: string; label: string }) {
  const qr = useMemo(() => {
    const { size, data } = create(value, { errorCorrectionLevel: 'M' }).modules
    let path = ''
    for (let y = 0; y < size; y++) {
      let runStart = -1
      for (let x = 0; x < size; x++) {
        const dark = data[y * size + x] === 1
        if (dark && runStart < 0) runStart = x
        if (!dark && runStart >= 0) {
          path += `M${runStart} ${y}h${x - runStart}v1h${runStart - x}z`
          runStart = -1
        }
      }
      if (runStart >= 0) path += `M${runStart} ${y}h${size - runStart}v1h${runStart - size}z`
    }
    return { size, path }
  }, [value])
  const margin = 4
  const extent = qr.size + margin * 2
  return (
    <svg className="quest-qr" viewBox={`${-margin} ${-margin} ${extent} ${extent}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect x={-margin} y={-margin} width={extent} height={extent} fill="#ffffff" />
      <path d={qr.path} fill="#000000" />
    </svg>
  )
}
