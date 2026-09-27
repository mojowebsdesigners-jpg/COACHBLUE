import { Vector3 } from 'three'
import { player } from '../state/store'
import type { Grip } from './ExercisePose'
import { repRate } from './ExercisePose'
import { consumeTaps, input } from '../lib/input'
import type { ExerciseDef } from '../data/exercises'

/**
 * The player's own training.
 *
 * Walking up to a station and pressing E hands the character to the same IK
 * poses the coach and the clients use, on the same measured grip heights, so
 * the player lifts the actual bar rather than miming beside it.
 *
 * The player drives the set rather than watching it. Getting on is a step and
 * a reach (the body blends from standing into the exercise), every rep is a
 * press, and finishing lets go and stands back up — idle, preparation, work,
 * recovery, idle — with no pose ever snapping into place.
 *
 * Scoring is deliberately quiet until it matters: nothing about points is on
 * screen while you are exploring. They appear when a set starts, count up as
 * repetitions complete, and fold into a session total when you stop.
 *
 * Nothing here updates React per frame. Listeners are notified when a rep or a
 * set completes — a few times a second at most — and the character itself is
 * driven from the render loop.
 */
export type Station = {
  id: string
  /** the exercise performed here */
  def: ExerciseDef
  /** where the athlete stands, in world x/z */
  spot: [number, number]
  /** which way they face */
  yaw: number
  /** floor height at the spot */
  ground: number
  grip?: Grip
  barHeight?: number
  /** an NPC currently using this station, who should step aside */
  occupiedBy?: string
  /**
   * The NPC station to clear when this one is taken, when it is not this one:
   * the rack's pull-up bar hangs over the coach's squat spot, so using the bar
   * has to move him even though his station is the squat.
   */
  displaces?: string
  /**
   * Stations that move as you work them: the boulder along its lane, the grip
   * up the rope. Given how far the work has got, returns where the athlete is.
   */
  track?: (distance: number) => { spot: [number, number]; ground: number }
  /** how far the work can go: the lane's length, the rope's height */
  length?: number
  /** called when the work reaches its end (the boulder home, the bell rung) */
  onComplete?: () => void
  /**
   * Where he stands when he gets off, if not where he got on: over the wall,
   * out of the far end of the net. Given how far the work got.
   */
  exitAt?: (distance: number) => [number, number]
}

export type RepEvent = { reps: number; points: number; gained: number; at: Vector3 }

/** How the last press was timed, for the on-screen call. */
export type Grade = '' | 'perfect' | 'good'

export const workout = {
  station: null as Station | null,
  phase: 0,
  reps: 0,
  set: 1,
  /** points earned in this session, across every set */
  points: 0,
  /** career total, carried between sessions in this visit */
  total: 0,
  /** world position of each hand, written every frame while training */
  hands: [new Vector3(), new Vector3()] as [Vector3, Vector3],
  /**
   * 0 standing where the player was, 1 fully in the exercise. It climbs as he
   * steps onto the kit and takes hold, and runs back down when the set is
   * finished.
   */
  enter: 0,
  leaving: false,
  from: { x: 0, y: 0, z: 0, yaw: 0 },
  /** reps the player has asked for and not yet done */
  credits: 0,
  /** presses on the beat in a row */
  streak: 0,
  grade: '' as Grade,
  gradeStamp: 0,
  /** treadmill: belt speed in m/s, and metres covered this session */
  belt: 0,
  distance: 0,
}

export const isWorkingOut = () => workout.station !== null
/** true only while actually exercising: not while stepping on or off */
export const isExercising = () => workout.station !== null && !workout.leaving && workout.enter >= 1

type Listener = () => void
const listeners = new Set<Listener>()

/** Subscribe to rep, set and start/stop changes. Never called per frame. */
export function onWorkoutChange(fn: Listener) {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}
const notify = () => listeners.forEach((fn) => fn())

export type Finished = { def: ExerciseDef; points: number; reps: number; sets: number }
/** Told once a session is over, with what was done — the world answers it. */
const finishers = new Set<(done: Finished) => void>()
export function onWorkoutFinished(fn: (done: Finished) => void) {
  finishers.add(fn)
  return () => { finishers.delete(fn) }
}

/** The most recent completed rep, for the floating feedback. */
export const lastRep = { n: 0, gained: 0, stamp: 0 }

/** Stations whose NPC has been asked to step away, by station id. */
export const yielded = new Set<string>()

const ENTER_TIME = 0.8      // seconds to step on and take hold
const LEAVE_TIME = 0.65     // and to let go and stand

/** Treadmill belt limits, m/s: a brisk walk to a hard run. */
export const BELT = { min: 0.8, max: 6.8, start: 1.3, accel: 1.8 }

/**
 * The player lifts at a livelier tempo than the NPCs' unhurried loops: under
 * the player's own thumb, a five-second bench rep feels like lag, not effort.
 */
const PLAYER_TEMPO = 1.8

/** Metres of treadmill per counted rep. */
const TREAD_REP = 25

export function startWorkout(station: Station) {
  if (workout.station) return
  workout.from = { x: player.pos.x, y: player.pos.y, z: player.pos.z, yaw: player.yaw }
  workout.station = station
  workout.phase = 0
  workout.reps = 0
  workout.set = 1
  workout.points = 0
  workout.enter = 0
  workout.leaving = false
  workout.credits = 0
  workout.streak = 0
  workout.grade = ''
  workout.belt = station.def.pose === 'run' ? BELT.start : 0
  workout.distance = 0
  consumeTaps()
  // ask whoever is using it to finish their rep and move off
  if (station.occupiedBy || station.displaces) yielded.add(station.displaces ?? station.id)
  // the player's position is the station from now on (the camera frames it);
  // the body itself walks in over ENTER_TIME
  player.pos.set(station.spot[0], station.ground, station.spot[1])
  player.yaw = station.yaw
  player.speed = 0
  player.frozen = true
  notify()
}

/** Finish: let go of the kit and stand up. The session is scored now. */
export function stopWorkout() {
  const st = workout.station
  if (!st || workout.leaving) return 0
  const earned = workout.points
  workout.total += earned
  workout.leaving = true
  // step off at the far end if the work carried him there
  if (st.exitAt) {
    const [x, z] = st.exitAt(workout.distance)
    workout.from = { x, y: st.ground, z, yaw: st.yaw }
  }
  workout.credits = 0
  notify()
  return earned
}

function finish() {
  const st = workout.station!
  const done: Finished = {
    def: st.def,
    points: workout.points,
    reps: workout.reps + (workout.set - 1) * st.def.repsPerSet,
    sets: workout.set,
  }
  // hand the equipment back, so whoever stepped aside can resume
  yielded.delete(st.displaces ?? st.id)
  workout.station = null
  workout.leaving = false
  workout.enter = 0
  workout.phase = 0
  workout.reps = 0
  workout.belt = 0
  // he steps back to where he got on from, clear of the kit
  player.pos.set(workout.from.x, workout.from.y, workout.from.z)
  player.frozen = false
  notify()
  finishers.forEach((fn) => fn(done))
}

function award(count: number, bonus: number) {
  const st = workout.station!
  const gained = Math.round(count * st.def.pointsPerRep * bonus)
  workout.reps += count
  workout.points += gained
  lastRep.n = workout.reps
  lastRep.gained = gained
  lastRep.stamp = performance.now()
  // a finished set rolls into the next one rather than ending the session
  if (workout.reps >= st.def.repsPerSet) {
    workout.set += 1
    workout.reps = 0
    if (st.def.pose !== 'run') workout.phase = 0
  }
  notify()
}

/**
 * Advance the activity. The player drives it:
 *
 * - lifts: every press of Space is one rep. Holding Space keeps them coming at
 *   the exercise's natural pace; let go and he finishes the rep he is on and
 *   holds at rest. A press made as the current rep comes home is on the beat
 *   and scores extra, and a run of them builds a streak.
 * - the treadmill: W/S (or the arrows) set the belt speed; the gait follows
 *   the belt, and every 25 m covered is a rep, worth more the faster it ran.
 *
 * Returns true on the frame a repetition completes.
 */
export function stepWorkout(dt: number) {
  const st = workout.station
  if (!st) return false

  if (workout.leaving) {
    workout.enter = Math.max(0, workout.enter - dt / LEAVE_TIME)
    // the belt runs down as he steps off
    workout.belt = Math.max(0, workout.belt - BELT.accel * 3 * dt)
    if (workout.enter <= 0) finish()
    return false
  }
  if (workout.enter < 1) {
    workout.enter = Math.min(1, workout.enter + dt / ENTER_TIME)
    consumeTaps()      // presses while stepping on do not bank reps
    return false
  }

  if (st.def.pose === 'push') {
    // hold W (or Space) and drive: it is heavy, so it takes a moment to get
    // going and stops almost as soon as you do
    consumeTaps()
    const driving = input.forward > 0 || input.actionHeld
    workout.belt += ((driving ? 0.85 : 0) - workout.belt) * Math.min(1, dt * (driving ? 1.4 : 5))
    workout.phase += dt * workout.belt
    return advanceTrack(st, workout.belt * dt, 2)
  }

  if (st.def.pose === 'crawl' || st.def.pose === 'tyres') {
    // hold W (or Space) and go; under the net it is slow going
    consumeTaps()
    const top = st.def.pose === 'crawl' ? 0.6 : 2.3
    const driving = input.forward > 0 || input.actionHeld
    workout.belt += ((driving ? top : 0) - workout.belt) * Math.min(1, dt * (driving ? 3 : 6))
    workout.phase += dt * workout.belt
    const moved = advanceTrack(st, workout.belt * dt, st.def.pose === 'crawl' ? 2 : 3)
    if (st.def.pose === 'tyres') {
      // the pose runs him along the lane from its start; the camera follows
      const f = st.yaw
      player.pos.set(st.spot[0] + Math.sin(f) * workout.distance, st.ground, st.spot[1] + Math.cos(f) * workout.distance)
    }
    return moved
  }

  if (st.def.pose === 'wall') {
    // each press of Space is the next move: jump and catch, pull up, over,
    // down the far side
    const taps = consumeTaps()
    workout.credits = Math.min(4, workout.credits + taps)
    if (workout.credits > 0 && workout.distance < (st.length ?? 4)) {
      const before = workout.distance
      const next = Math.floor(before + 1e-6) + 1
      workout.distance = Math.min(next, before + dt * 1.5)
      if (workout.distance >= next - 1e-6) {
        workout.credits--
        if (next >= (st.length ?? 4)) {
          award(1, 2)
          st.onComplete?.()
        }
      }
      const f = st.yaw
      const along = Math.min(1.3, workout.distance * 0.33)
      player.pos.set(st.spot[0] + Math.sin(f) * along, st.ground + Math.min(2, workout.distance), st.spot[1] + Math.cos(f) * along)
      return true
    }
    return false
  }

  if (st.def.pose === 'climb') {
    // each press of Space is a pull: one hand over the other, half a metre
    const taps = consumeTaps()
    workout.credits = Math.min(4, workout.credits + taps)
    if (workout.credits > 0 || input.actionHeld) {
      const step = dt * 1.25
      workout.phase += step / 0.45                 // hands swap once per pull
      workout.belt = 1.25
      const before = workout.distance
      const moved = advanceTrack(st, step, 99)
      if (Math.floor(before / 0.45) !== Math.floor(workout.distance / 0.45)) {
        workout.credits = Math.max(0, workout.credits - 1)
      }
      st.barHeight = 2.05 + workout.distance
      // the camera follows him up the rope
      player.pos.y = st.ground + workout.distance
      return moved
    }
    workout.belt = 0
    st.barHeight = 2.05 + workout.distance
    return false
  }

  if (st.def.pose === 'run') {
    consumeTaps()
    if (input.forward > 0) workout.belt = Math.min(BELT.max, workout.belt + BELT.accel * dt)
    else if (input.forward < 0) workout.belt = Math.max(BELT.min, workout.belt - BELT.accel * 1.4 * dt)
    workout.phase += dt
    const before = Math.floor(workout.distance / TREAD_REP)
    workout.distance += workout.belt * dt
    const after = Math.floor(workout.distance / TREAD_REP)
    if (after > before) {
      award(after - before, 0.6 + workout.belt / 6)
      return true
    }
    return false
  }

  const rate = repRate(st.def.pose)
  if (!rate) return false
  const period = (Math.PI * 2) / rate
  const taps = consumeTaps()
  if (taps > 0) {
    // how far through the rep in flight we are, 0..1
    const moving = workout.credits > 0 || input.actionHeld
    const t = (workout.phase % period) / period
    if (moving && workout.credits <= 1 && t > 0.7) {
      workout.grade = 'perfect'
      workout.streak += 1
    } else if (moving && t > 0.5) {
      workout.grade = 'good'
    } else {
      workout.grade = ''
      if (!moving) workout.streak = 0
    }
    workout.gradeStamp = performance.now()
    workout.credits = Math.min(3, workout.credits + taps)
  }

  if (!(workout.credits > 0 || input.actionHeld)) return false

  const next = (Math.floor(workout.phase / period + 1e-6) + 1) * period
  workout.phase += dt * PLAYER_TEMPO
  if (workout.phase < next) return false

  workout.credits = Math.max(0, workout.credits - 1)
  const onBeat = workout.grade === 'perfect' && performance.now() - workout.gradeStamp < (period / PLAYER_TEMPO) * 1200
  workout.grade = onBeat ? 'perfect' : workout.grade === 'perfect' ? '' : workout.grade
  const rolledOver = workout.reps + 1 >= st.def.repsPerSet
  award(1, onBeat ? 1.5 + Math.min(workout.streak, 10) * 0.05 : 1)
  // nothing more asked for: come to rest exactly at the bottom of the rep
  if (!rolledOver && !(workout.credits > 0 || input.actionHeld)) workout.phase = next
  return true
}

/**
 * Move a tracking station on by `step` metres of work. A rep is counted every
 * `per` metres; reaching the end completes it (and counts one more).
 */
function advanceTrack(st: Station, step: number, per: number) {
  const len = st.length ?? 10
  if (workout.distance >= len) return false
  const before = workout.distance
  workout.distance = Math.min(len, workout.distance + step)
  if (st.track) {
    const p = st.track(workout.distance)
    st.spot = p.spot
    st.ground = p.ground
    player.pos.set(p.spot[0], p.ground, p.spot[1])
  }
  let landed = false
  if (Math.floor(workout.distance / per) > Math.floor(before / per)) {
    award(1, 1)
    landed = true
  }
  if (workout.distance >= len) {
    award(1, 1.5)
    st.onComplete?.()
    landed = true
  }
  return landed
}

/**
 * End the set if the player has wandered off. Freezing movement during a set
 * means this should not happen, but a cinematic or a panel can move them, and
 * a character stuck lifting an invisible bar is worse than one that stops.
 */
export function checkWorkoutRange() {
  const st = workout.station
  if (!st) return
  if (st.track) return
  const d = Math.hypot(player.pos.x - st.spot[0], player.pos.z - st.spot[1])
  if (d > st.def.reach + 4) stopWorkout()
}

/** The exercise being performed, for read-outs. */
export const currentExercise = () => workout.station?.def ?? null
