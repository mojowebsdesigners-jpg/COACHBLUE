import { Object3D, Vector3 } from 'three'
import { rotateBoneWorld, twoBoneIK } from '../lib/ik'
import type { Bones } from './ExercisePose'

/**
 * Carrying the cross, the way a landmine bar is driven: the long beam held
 * across the chest with both hands, the right hand low at the sternum and the
 * left further up the beam, elbows bent and tucked, the beam angled up and
 * away in front of him with the crossbar high at the far end. He leans into
 * it and walks or runs behind it.
 *
 * A press rep drives it up and out: arms extend, the beam rises, then it comes
 * back to the chest under control.
 */
export const CROSS = {
  length: 2.7,          // the upright
  arm: 1.5,             // the crossbar
  beam: 0.17,           // square timber
  crossAt: 0.72,        // crossbar position along the upright, from the head end
  carrySpeed: 0.72,     // fraction of normal pace under the load
  pressTime: 1.2,       // seconds for one press rep
}

export const carry = {
  active: false,
  press: 0,             // 0..1..0 through a rep
  pressT: -1,           // time into the current rep, -1 when not pressing
  reps: 0,
  /** where the cross is, published every frame for the prop to follow */
  base: new Vector3(),  // the bottom (foot) of the upright, in the right hand's side
  axis: new Vector3(0, 0, 1),
  side: new Vector3(1, 0, 0),
}

const F = new Vector3()
const L = new Vector3()
const U = new Vector3(0, 1, 0)
const chest = new Vector3()
const _t = new Vector3()
const _pole = new Vector3()

export function startPress() {
  if (carry.pressT < 0) carry.pressT = 0
}

/** Advance the press rep. */
export function stepCarry(dt: number) {
  if (carry.pressT >= 0) {
    carry.pressT += dt
    const t = carry.pressT / CROSS.pressTime
    // quick drive up (35%), a beat at lockout, slower return
    carry.press = t < 0.35 ? t / 0.35 : t < 0.45 ? 1 : Math.max(0, 1 - (t - 0.45) / 0.55)
    carry.press = carry.press * carry.press * (3 - 2 * carry.press)
    if (t >= 1) {
      carry.pressT = -1
      carry.press = 0
      carry.reps++
    }
  }
}

/**
 * Pose the arms onto the beam and publish where the cross sits. Call after
 * the locomotion clip has posed the body (so the legs keep walking).
 */
export function applyCarry(bones: Bones, root: Object3D, speed: number) {
  root.updateMatrixWorld(true)
  root.getWorldDirection(F)
  F.y = 0
  F.normalize()
  L.crossVectors(U, F).normalize()
  const p = carry.press

  // lean into the load, more when moving
  const lean = 0.1 + Math.min(0.12, speed * 0.03) - p * 0.06
  rotateBoneWorld(bones.spine, L, lean * 0.6)
  rotateBoneWorld(bones.spine2, L, lean * 0.4)
  rotateBoneWorld(bones.head, L, -lean * 0.8)

  bones.lArm.getWorldPosition(_t)
  bones.rArm.getWorldPosition(chest)
  chest.add(_t).multiplyScalar(0.5)
  // the hold point: in front of the sternum, a little right of centre
  chest.addScaledVector(U, -0.2).addScaledVector(F, 0.24 + p * 0.3).addScaledVector(L, -0.05)

  // the beam: forward and up, angled a little across the body to the left;
  // a press lifts it and pushes it out
  const rise = 0.42 + p * 0.5
  carry.axis.copy(F).multiplyScalar(Math.cos(rise)).addScaledVector(U, Math.sin(rise)).addScaledVector(L, 0.18).normalize()
  carry.side.crossVectors(U, carry.axis).normalize()

  // right hand at the hold point, left hand 45 cm further up the beam
  const right = _t.copy(chest)
  _pole.copy(U).multiplyScalar(-1).addScaledVector(L, -0.6).addScaledVector(F, -0.2).normalize()
  twoBoneIK(bones.rArm, bones.rFore, bones.rHand, right, _pole)
  const left = right.clone().addScaledVector(carry.axis, 0.45)
  _pole.copy(U).multiplyScalar(-1).addScaledVector(L, 0.6).addScaledVector(F, -0.2).normalize()
  twoBoneIK(bones.lArm, bones.lFore, bones.lHand, left, _pole)

  // the foot of the upright tucks just behind the right hand
  carry.base.copy(chest).addScaledVector(carry.axis, -0.28)
}
