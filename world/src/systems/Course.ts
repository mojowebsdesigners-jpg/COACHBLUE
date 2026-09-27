import { Vector3 } from 'three'
import { player, useStore } from '../state/store'
import { cue } from '../lib/audio'
import { offerCoaching } from './Coaching'

/**
 * Timed runs through a line of gates: the hill sprint, the cone drill.
 *
 * Start at the first gate, a three-second count, then run the gates in order
 * — the next one is lit, the rest wait — and the clock stops at the last. The
 * best time is kept for the visit. Nothing here renders; the gates and the
 * clock read this state.
 */
export type CourseDef = {
  id: string
  name: string
  gates: Vector3[]
  /** how close counts as through a gate */
  radius: number
  /** what to say to a good time */
  praise: string
}

type Listener = () => void
const listeners = new Set<Listener>()
export const onCourseChange = (fn: Listener) => { listeners.add(fn); return () => { listeners.delete(fn) } }
const notify = () => listeners.forEach((f) => f())

export const course = {
  def: null as CourseDef | null,
  /** -3..0 counting down, then seconds on the clock */
  clock: 0,
  running: false,
  next: 0,
  best: {} as Record<string, number>,
  last: 0,
}

export function startCourse(def: CourseDef) {
  if (course.def) return
  course.def = def
  course.clock = -3
  course.running = false
  course.next = 1
  cue('interact')
  useStore.getState().showToast(def.name.toUpperCase(), 'Ready… the clock starts on GO')
  notify()
}

export function cancelCourse() {
  if (!course.def) return
  course.def = null
  course.running = false
  notify()
}

let lastWhole = 0
export function stepCourse(dt: number) {
  const def = course.def
  if (!def) return
  course.clock += dt
  if (!course.running) {
    const whole = Math.ceil(-course.clock)
    if (whole !== lastWhole) {
      lastWhole = whole
      if (whole > 0) cue('interact')
    }
    if (course.clock >= 0) {
      course.running = true
      course.clock = 0
      cue('discover')
      notify()
    }
    return
  }
  // wandering off abandons it
  if (course.clock > 180) { cancelCourse(); return }
  const g = def.gates[course.next]
  if (Math.hypot(player.pos.x - g.x, player.pos.z - g.z) < def.radius) {
    cue('interact')
    course.next++
    if (course.next >= def.gates.length) finish(def)
    notify()
  }
}

function finish(def: CourseDef) {
  const time = course.clock
  const prev = course.best[def.id]
  const best = prev === undefined || time < prev
  if (best) course.best[def.id] = time
  course.last = time
  course.def = null
  course.running = false
  cue('discover')
  useStore.getState().showToast(
    best ? `${def.praise} · NEW BEST` : def.praise,
    `${def.name}: ${time.toFixed(1)} s${prev !== undefined && !best ? ` (best ${prev.toFixed(1)} s)` : ''}`,
  )
  offerCoaching({
    topic: `course:${def.id}`,
    title: `${def.name} · ${time.toFixed(1)} s`,
    body: 'Want to take seconds off that? Coach Blue writes speed and conditioning plans.',
    goal: 'Lose Weight',
  })
}
