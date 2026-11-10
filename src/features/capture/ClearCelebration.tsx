import { motion, useReducedMotion } from 'motion/react'
import { Icon } from '../../components/Icon'

// クリア確定（初回クリア）の瞬間だけ出す小さな演出。装飾のみで、結果の文言は
// 呼び出し側の status 表示が担う（これは aria-hidden）。
// 振り付け（D-42）: 主役はチェックのバッジで、スプリングでポップする。脇役の
// きらめきはバッジが着地する頃に遅れて広がり、距離と遅れは1つずつ変える
// （一律の stagger にしない）。全体は1秒以内に終わり、操作は妨げない。
const SPARKS = [
  { x: -46, y: -26, delay: 0.16, color: 'var(--ui-accent)' },
  { x: 44, y: -32, delay: 0.2, color: 'var(--ui-tint)' },
  { x: -52, y: 12, delay: 0.24, color: 'var(--ui-blue)' },
  { x: 52, y: 8, delay: 0.18, color: 'var(--ui-badge)' },
  { x: -24, y: 34, delay: 0.27, color: 'var(--ui-tint)' },
  { x: 26, y: 36, delay: 0.22, color: 'var(--ui-accent)' },
] as const

export function ClearCelebration({ large = false }: { large?: boolean }) {
  const reduce = useReducedMotion()
  // 全画面のクリア画面（D-63）では主役として拡大する。きらめきの届く距離も
  // バッジの大きさに合わせて広げる（相対関係は通常サイズと同じに保つ）。
  const reach = large ? 2.1 : 1
  return (
    <div className={large ? 'clear-celebration clear-celebration-large' : 'clear-celebration'} aria-hidden="true">
      {!reduce && SPARKS.map((spark) => (
        <motion.span key={`${spark.x}:${spark.y}`} className="clear-celebration-spark"
          style={{ background: spark.color }}
          initial={{ opacity: 0, x: 0, y: 0, scale: 1 }}
          animate={{ opacity: [0, 1, 0], x: spark.x * reach, y: spark.y * reach, scale: 0.35 }}
          transition={{ duration: 0.55, delay: spark.delay, ease: [0.23, 1, 0.32, 1] }} />
      ))}
      <motion.span className="clear-celebration-badge"
        initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.4 }}
        animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1 }}
        transition={reduce ? { duration: 0.2 } : { type: 'spring', duration: 0.5, bounce: 0.35 }}>
        <Icon name="check" />
      </motion.span>
    </div>
  )
}
