import type { ResolvedTier } from '../lib/quality'
import { useStore } from '../state/store'

/**
 * Keeps the frame rate honest.
 *
 * A fixed quality tier is a guess about a machine we have never seen. This
 * watches what the frame is actually costing and steps the tier down when it
 * is plainly not keeping up — fewer tufts of grass, fewer trees, smaller
 * shadows — rather than letting the world run at fifteen frames a second
 * because it was told to run at ULTRA.
 *
 * Three rules keep it from being worse than the problem:
 *
 *  - It only ever steps *down* automatically. Stepping back up on a brief good
 *    patch produces a world that pulses between settings, which is far more
 *    noticeable than simply being one tier lower.
 *  - It ignores the first couple of seconds after a change, because the change
 *    itself costs frames.
 *  - It never touches anything if the player has chosen a tier by hand. An
 *    explicit choice outranks our guess.
 */
const ORDER: ResolvedTier[] = ['ultra', 'high', 'medium', 'low']

/** Below this, for long enough, the experience is not acceptable. */
const FLOOR_FPS = 45
/** Sustained seconds under the floor before acting. */
const PATIENCE = 4
/** Grace after a change, in seconds. */
const SETTLE = 2.5

const state = {
  slow: 0,
  settle: 0,
  /** the tier we last chose ourselves, so a manual pick is recognisable */
  ours: null as ResolvedTier | null,
}

export function resetPerformanceWatch() {
  state.slow = 0
  state.settle = SETTLE
  state.ours = null
}

/**
 * Call once per frame with the frame time in seconds. Returns the tier it
 * moved to, or null if nothing changed.
 */
export function watchPerformance(dt: number): ResolvedTier | null {
  if (state.settle > 0) {
    state.settle -= dt
    return null
  }

  const store = useStore.getState()
  // an explicit choice is the player's business, not ours
  if (store.settings.tier !== 'auto') return null
  const current = store.preset.name as ResolvedTier

  // a single long frame is a hitch, not a trend; only sustained cost counts
  const fps = dt > 0 ? 1 / dt : 60
  state.slow = fps < FLOOR_FPS ? state.slow + dt : Math.max(0, state.slow - dt * 2)
  if (state.slow < PATIENCE) return null

  const i = ORDER.indexOf(current)
  if (i < 0 || i >= ORDER.length - 1) {
    state.slow = 0
    return null
  }
  const next = ORDER[i + 1]
  state.slow = 0
  state.settle = SETTLE
  state.ours = next
  store.setAutoTier(next)
  return next
}

/** Whether the current tier was chosen by this watcher rather than the player. */
export const tierWasAutomatic = () => state.ours !== null
