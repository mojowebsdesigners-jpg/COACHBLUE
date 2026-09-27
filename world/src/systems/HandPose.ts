import { Object3D, Vector3 } from 'three'
import { rotateBoneWorld, twoBoneIK } from '../lib/ik'
import { gripHand, type Bones } from './ExercisePose'
import { GRAB_AT, hand } from './HandAction'

/**
 * The body for HandAction: reaching down for something and coming back up
 * with it, bringing it to the mouth, setting it down. Drawn over the idle
 * clip, after it, right hand only.
 */
const _F = new Vector3()
const _L = new Vector3()
const U = new Vector3(0, 1, 0)
const _h = new Vector3()
const _t = new Vector3()
const _p = new Vector3()
const _head = new Vector3()

const smooth = (x: number) => { const c = Math.min(1, Math.max(0, x)); return c * c * (3 - 2 * c) }

/** How far the reach has got, 0..1..0, over a pick-up or put-down. */
export function reachAmount(u: number) {
  const hold = 0.12
  if (u < GRAB_AT) return smooth(u / GRAB_AT)
  if (u < GRAB_AT + hold) return 1
  return 1 - smooth((u - GRAB_AT - hold) / (1 - GRAB_AT - hold))
}

/** How high the hand is raised to the mouth, 0..1..0, over eating or drinking. */
export function raiseAmount(u: number) {
  if (u < 0.35) return smooth(u / 0.35)
  if (u < 0.78) return 1
  return 1 - smooth((u - 0.78) / 0.22)
}

/**
 * Pose the body for the current hand action. Returns how far he is crouched
 * (0..1), so the caller can pin his feet to the ground while he bends.
 */
export function applyHandPose(bones: Bones, g: Object3D, ground: number, t: number) {
  const a = hand.action
  g.getWorldDirection(_F)
  _F.y = 0
  _F.normalize()
  _L.crossVectors(U, _F).normalize()

  if (!a) {
    // just holding it: the hand stays closed round it
    if (hand.held) gripHand(bones.rHand, 0.75)
    return 0
  }
  const u = Math.max(0, Math.min(1, a.t / a.dur))

  if (a.kind === 'consume') {
    const raise = raiseAmount(u)
    bones.head.getWorldPosition(_head)
    // the mouth: in front of the face, a little below the head joint
    _t.copy(_head).addScaledVector(_F, 0.13).addScaledVector(U, -0.08).addScaledVector(_L, -0.02)
    bones.rHand.getWorldPosition(_h)
    _t.lerpVectors(_h, _t, raise)
    _p.copy(U).multiplyScalar(-1).addScaledVector(_L, -0.7).addScaledVector(_F, -0.2).normalize()
    twoBoneIK(bones.rArm, bones.rFore, bones.rHand, _t, _p)
    if (hand.held === 'bottle' || hand.empty) {
      // tip the head back to drink
      const drink = raise * smooth((u - 0.3) / 0.15) * (1 - smooth((u - 0.72) / 0.1))
      rotateBoneWorld(bones.head, _L, -0.42 * drink)
      rotateBoneWorld(bones.spine2, _L, -0.08 * drink)
    } else {
      // chewing
      rotateBoneWorld(bones.head, _L, Math.sin(t * 17) * 0.035 * raise)
    }
    gripHand(bones.rHand, 0.8)
    return 0
  }

  // pick up / put down
  const reach = reachAmount(u)
  const low = Math.min(1, Math.max(0, (1.05 - (a.target.y - ground)) / 0.95))
  const crouch = reach * low
  // bend at the knees (the feet are pinned by the caller) and fold at the hips
  g.position.y -= crouch * 0.4
  g.updateMatrixWorld(true)
  const fold = crouch * 0.55 + reach * 0.2
  rotateBoneWorld(bones.hips, _L, fold * 0.45)
  rotateBoneWorld(bones.spine, _L, fold * 0.35)
  rotateBoneWorld(bones.spine2, _L, fold * 0.2)
  rotateBoneWorld(bones.head, _L, -fold * 0.3)
  // the right hand goes to the object, fingers first
  bones.rHand.getWorldPosition(_h)
  _t.copy(a.target).addScaledVector(U, a.kind === 'putdown' ? 0.1 : 0.06)
  _t.lerpVectors(_h, _t, reach)
  _p.copy(_L).multiplyScalar(-1).addScaledVector(U, 0.3).addScaledVector(_F, -0.3).normalize()
  twoBoneIK(bones.rArm, bones.rFore, bones.rHand, _t, _p)
  // close the hand as it arrives; open it as it lets go
  const closed = a.kind === 'pickup' ? smooth((u - GRAB_AT + 0.08) / 0.1) : 1 - smooth((u - GRAB_AT) / 0.1)
  if (closed > 0.01) gripHand(bones.rHand, 0.8 * closed)
  return crouch
}
