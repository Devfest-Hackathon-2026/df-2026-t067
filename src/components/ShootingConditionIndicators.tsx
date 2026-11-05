import type { ShootingConditions } from '../shared/api/types'
import './ShootingConditionIndicators.css'

function ConditionIndicator({ icon, label, accessibleLabel }: { icon: 'boat' | 'admission'; label: string; accessibleLabel: string }) {
  return <span className="condition-indicator" role="img" aria-label={accessibleLabel} title={accessibleLabel}>
    <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      {icon === 'boat' ? <><path d="M3 14h18l-2 5H7l-4-5Z" /><path d="M8 13V5h8v8M12 5V2M2 21c2 1 3 1 5 0s3-1 5 0 3 1 5 0 3-1 5 0" /></> : <><path d="M4 20V8l8-5 8 5v12" /><path d="M8 20v-7h8v7M8 8h.01M12 8h.01M16 8h.01" /></>}
    </svg>
    <span>{label}</span>
  </span>
}

export function ShootingConditionIndicators({ conditions }: { conditions?: ShootingConditions }) {
  if (!conditions || (!conditions.requiresBoat && !conditions.requiresPaidFacility)) return null
  return <div className="condition-indicators" role="group" aria-label="撮影に必要な条件">
    {conditions.requiresBoat && <ConditionIndicator icon="boat" label="船上・海上" accessibleLabel="船上・海上での撮影が必要" />}
    {conditions.requiresPaidFacility && <ConditionIndicator icon="admission" label="有料施設内" accessibleLabel="有料施設内での撮影が必要" />}
  </div>
}
