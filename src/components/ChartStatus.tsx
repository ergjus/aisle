import { dramaLabel, dramaScore } from '../constraints'
import type { Violation } from '../types'
import { cn } from '@/lib/utils'

/**
 * One line in the masthead on how the seating stands: how many of the
 * attending guests have a chair, and whether every rule is kept. Brick with a
 * Fix button while rules are broken, sage once the room is complete.
 */
export function ChartStatus({
  empty,
  seated,
  attending,
  violations,
  onFix,
}: {
  empty: boolean
  seated: number
  attending: number
  violations: Violation[]
  onFix?: () => void
}) {
  if (empty) return null
  const broken = violations.length
  const complete = broken === 0 && attending > 0 && seated === attending
  const tone = broken > 0 ? 'broken' : complete ? 'complete' : 'working'
  const rules = broken > 0 ? `${broken} rule${broken === 1 ? '' : 's'} broken` : 'All rules kept'
  const mood = dramaLabel(dramaScore(violations))

  return (
    <div
      className={cn('chart-status', `chart-status-${tone}`)}
      role="status"
      aria-live="polite"
      title={broken > 0 ? `${mood}. Fix runs the solver in repair mode, moving as few guests as possible.` : mood}
    >
      <span className="chart-status-dot" aria-hidden="true" />
      <span className="figures">
        {seated} of {attending} seated
      </span>
      <span className="chart-status-sep" aria-hidden="true">·</span>
      <span>{rules}</span>
      {broken > 0 && onFix && (
        <button type="button" className="chart-status-fix" onClick={onFix}>
          Fix
        </button>
      )}
    </div>
  )
}
