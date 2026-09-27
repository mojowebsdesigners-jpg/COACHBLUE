/**
 * The world clock. One place owns the time of day; the sky, the lights, the
 * street lamps and the HUD all read from here rather than each keeping their
 * own notion of "night".
 *
 * The clock is deliberately slow. A ten minute day meant night arrived before
 * you had walked anywhere, and you never saw the hours in between — which are
 * the ones worth looking at.
 */

/** In-game minutes per real minute. Raise it to make the day pass faster. */
export const GAME_TIME_SCALE = 8

const MINUTES_PER_DAY = 24 * 60

/** Real seconds for one full in-game day. At scale 8 that is three hours. */
export const DAY_LENGTH_SECONDS = (MINUTES_PER_DAY / GAME_TIME_SCALE) * 60

/** The phases the world moves through, as fractions of a day. */
export const PHASES = [
  { at: 0.0, name: 'night' },
  { at: 0.22, name: 'pre-dawn' },     // 05:17
  { at: 0.25, name: 'sunrise' },      // 06:00
  { at: 0.33, name: 'morning' },      // 08:00
  { at: 0.5, name: 'midday' },        // 12:00
  { at: 0.66, name: 'afternoon' },    // 16:00
  { at: 0.75, name: 'sunset' },       // 18:00
  { at: 0.79, name: 'blue hour' },    // 19:00
  { at: 0.84, name: 'night' },        // 20:00
] as const

export type DayPhase = (typeof PHASES)[number]['name']

/** Advance a 0..1 clock by a real-time delta. */
export function advance(clock: number, dtSeconds: number) {
  return (clock + dtSeconds / DAY_LENGTH_SECONDS) % 1
}

/** Whole in-game minutes since midnight. */
export const minutesOfDay = (clock: number) =>
  Math.floor(clock * MINUTES_PER_DAY) % MINUTES_PER_DAY

/** "08:42 AM", the way a clock on a wall would read. */
export function formatClock(clock: number) {
  const total = minutesOfDay(clock)
  const h24 = Math.floor(total / 60)
  const m = total % 60
  const suffix = h24 < 12 ? 'AM' : 'PM'
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return `${String(h12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${suffix}`
}

export function phaseAt(clock: number): DayPhase {
  let found: DayPhase = 'night'
  for (const p of PHASES) {
    if (clock >= p.at) found = p.name
  }
  return found
}
