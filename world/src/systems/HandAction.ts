import { Vector3 } from 'three'
import { player, useStore } from '../state/store'
import { groundHeight, resolveCollisions } from '../lib/terrain'

/**
 * Things he picks up with his own hand: a mushroom off the woodland floor, a
 * bottle of water from the gym.
 *
 * Nothing teleports into his grip. Picking up is a movement: he turns to it,
 * bends at the knees and hips if it is low, reaches until his hand is on it,
 * closes the hand, and stands back up holding it — the object leaves the
 * ground only at the moment the hand is there. Eating and drinking bring the
 * hand to the mouth (the bottle tipped, the head back), hold, and lower it.
 * The pose itself is drawn in the Player's procedural pass from `hand`.
 */
export type Item = 'mushroom' | 'bottle'
export type Kind = 'pickup' | 'consume' | 'putdown'

export const hand = {
  held: null as Item | null,
  /** the bottle is drunk; it can be put down again */
  empty: false,
  action: null as null | {
    kind: Kind
    t: number
    dur: number
    /** world point the hand goes to (pick up / put down) */
    target: Vector3
    /** fired the instant the hand closes on (or lets go of) the item */
    grabbed: boolean
    onGrab?: () => void
    onDone?: () => void
    /** where he walks from, and to, before reaching (arm's length away) */
    from: Vector3
    to: Vector3
    /** seconds spent stepping in, before the reach begins */
    walk: number
  },
}

/** Arm's length: where he stands to reach something. */
const REACH_STAND = 0.5

export const isBusyHand = () => hand.action !== null
/** true while stepping in towards the thing to be picked up */
export const isApproaching = () => !!hand.action && hand.action.t < 0

const DUR: Record<Kind, number> = { pickup: 1.5, consume: 2.4, putdown: 1.3 }
/** the fraction of the move at which the hand is on the object */
export const GRAB_AT = 0.45

function begin(kind: Kind, target: Vector3, onGrab?: () => void, onDone?: () => void) {
  if (hand.action) return false
  const from = player.pos.clone()
  const to = player.pos.clone()
  let walk = 0
  if (kind !== 'consume') {
    // face it, and step in to arm's length if it is further than that
    const dx = target.x - player.pos.x, dz = target.z - player.pos.z
    const d = Math.hypot(dx, dz)
    player.yaw = Math.atan2(dx, dz)
    // things on a table are reached with a lean from further back than
    // things on the ground, which he crouches right over
    const high = target.y - groundHeight(target.x, target.z) > 0.5
    const stand = high ? REACH_STAND + 0.3 : REACH_STAND
    if (d > stand + 0.1) {
      // and never into the table itself, or anything else solid
      const c = resolveCollisions(target.x - (dx / d) * stand, target.z - (dz / d) * stand, 0.3)
      to.set(c.x, player.pos.y, c.z)
      walk = Math.hypot(to.x - from.x, to.z - from.z) / 1.1   // at a relaxed walking pace
      player.yaw = Math.atan2(target.x - to.x, target.z - to.z)
    }
  }
  hand.action = {
    kind, t: -walk, dur: DUR[kind], target: target.clone(), grabbed: false, onGrab, onDone, from, to, walk,
  }
  player.speed = 0
  player.frozen = true
  return true
}

export function pickUp(item: Item, at: Vector3, onGrab: () => void) {
  if (hand.held) return false
  return begin('pickup', at, () => {
    hand.held = item
    hand.empty = false
    onGrab()
  })
}

export function consume() {
  const item = hand.held
  if (!item || hand.empty) return false
  return begin('consume', player.pos, () => {
    if (item === 'mushroom') hand.held = null      // eaten
    else hand.empty = true                          // drunk; still in the hand
  }, () => {
    const s = useStore.getState()
    if (item === 'mushroom') s.showToast('FUEL FROM THE FOREST', 'Whole foods, found on the trail')
    else s.showToast('HYDRATED', 'Water first — every session, every day')
  })
}

/** Set the held item down on the ground in front of him. */
export function putDown(onRelease: (at: Vector3) => void) {
  if (!hand.held) return false
  const at = new Vector3(
    player.pos.x + Math.sin(player.yaw) * 0.55, player.pos.y, player.pos.z + Math.cos(player.yaw) * 0.55,
  )
  return begin('putdown', at, () => {
    hand.held = null
    hand.empty = false
    onRelease(at)
  })
}

/** Advance the current action; called once a frame from the Player. */
export function stepHand(dt: number) {
  const a = hand.action
  if (!a) return
  a.t += dt
  // the walk in comes first (t runs from -walk up to 0)
  if (a.t < 0) {
    const k = 1 + a.t / a.walk
    player.pos.lerpVectors(a.from, a.to, k)
    return
  }
  if (a.walk > 0) player.pos.copy(a.to)
  const u = a.t / a.dur
  if (!a.grabbed && u >= (a.kind === 'consume' ? 0.55 : GRAB_AT)) {
    a.grabbed = true
    a.onGrab?.()
  }
  if (u >= 1) {
    hand.action = null
    player.frozen = false
    a.onDone?.()
  }
}
