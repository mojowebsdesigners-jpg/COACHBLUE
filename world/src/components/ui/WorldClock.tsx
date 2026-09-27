import { useStore } from '../../state/store'
import { formatClock, phaseAt } from '../../systems/TimeSystem'

/**
 * The in-world time, top left. It re-renders only when the minute changes,
 * because Lighting only publishes the clock to the store on a minute boundary
 * — a per-frame state update here would cost more than everything it draws.
 */
export function WorldClock() {
  const t = useStore((s) => s.timeOfDay)
  const phase = phaseAt(t)

  return (
    <div className="world-clock" aria-hidden>
      <span className="world-clock__time">{formatClock(t)}</span>
      <span className="world-clock__phase">{phase}</span>
    </div>
  )
}
