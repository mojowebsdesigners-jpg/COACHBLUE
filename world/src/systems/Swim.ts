import { MathUtils, Object3D, Quaternion, Vector3 } from 'three'
import { aimBone, rotateBoneWorld, twoBoneIK } from '../lib/ik'
import type { Bones } from './ExercisePose'

/**
 * Swimming, drawn on top of the idle clip.
 *
 * Moving, it is a front crawl: the body lies nearly flat along the surface,
 * the arms turn over alternately — reach, catch, pull under the body, push
 * past the hip, recover high over the water with the elbow up — the legs
 * flutter from the hip two beats to each arm, and the head turns to breathe
 * every third stroke. Still, he treads water upright: hands sculling
 * figure-eights at chest depth, legs in a slow eggbeater.
 *
 * `blend` goes 0 (treading) to 1 (swimming) so starting and stopping ease
 * between the two instead of snapping.
 */
export const SWIM = {
  enterDepth: 1.3,      // water this deep over the floor lifts him off his feet
  leaveDepth: 1.05,     // and he stands again below this
  speed: 1.25,          // a steady crawl, m/s
  sprint: 1.9,
  tread: 0.45,          // drifting while treading
  strokeRate: 0.85,     // arm cycles per second at the crawl
  pitch: 1.36,          // how flat the body lies, radians from upright
}

const F = new Vector3()
const L = new Vector3()
const U = new Vector3(0, 1, 0)
const A = new Vector3()

/**
 * Where the body goes: returns the root position and pitch for this frame.
 * Upright when treading (head and shoulders out), flat when swimming (the
 * back at the surface).
 */
export function swimRoot(surface: number, blend: number, bob: number) {
  const pitch = SWIM.pitch * blend
  // the point on the body held at the surface: the collarbones when treading,
  // the middle of the back when swimming
  const hold = MathUtils.lerp(1.42, 1.1, blend)
  const y = surface - hold * Math.cos(pitch) - MathUtils.lerp(0.05, 0.12, blend) + bob
  // lying forward about the feet would push the body a body-length ahead;
  // pull it back so the hips stay over the player's position
  const back = 0.95 * Math.sin(pitch)
  return { y, pitch, back }
}

const Fb = new Vector3()   // along the body, towards the head
const Db = new Vector3()   // out of the chest: straight down while prone
const Lb = new Vector3()   // the body's left
const _q = new Quaternion()
const _s = new Vector3()
const _t = new Vector3()
const _p = new Vector3()
const _d = new Vector3()
const _a = new Vector3()
const _b = new Vector3()

const len = (a: Object3D, b: Object3D) =>
  a.getWorldPosition(_a).distanceTo(b.getWorldPosition(_b))

export function applySwim(bones: Bones, root: Object3D, phase: number, blend: number, reduced: boolean) {
  root.updateMatrixWorld(true)
  // the body's own axes: forward is where the head points once lying flat
  root.getWorldDirection(F)
  F.y = 0
  F.normalize()
  L.crossVectors(U, F).normalize()
  const amp = reduced ? 0.6 : 1

  // ---------------------------------------------------------------- crawl
  // Posed absolutely, not layered on the idle clip: rotations added to a
  // standing pose drift wherever that pose happens to be, which is how the
  // legs ended up splayed in a V. Every limb here is aimed from the body's
  // own frame, so the stroke is the same whatever the clip was doing.
  if (blend > 0.01) {
    const k = blend * amp
    root.getWorldQuaternion(_q)
    Fb.set(0, 1, 0).applyQuaternion(_q)
    Db.set(0, 0, 1).applyQuaternion(_q)
    Lb.set(1, 0, 0).applyQuaternion(_q)
    const cycle = phase * SWIM.strokeRate          // strokes, 1 = both arms once

    // the body rolls towards the pulling arm, which is what lets the other
    // arm clear the water on its recovery
    const roll = Math.sin(cycle * Math.PI * 2) * 0.55 * k
    rotateBoneWorld(bones.hips, Fb, roll * 0.6)
    rotateBoneWorld(bones.spine, Fb, roll * 0.25)
    rotateBoneWorld(bones.spine2, Fb, roll * 0.15)

    // ---- legs: long, together, a small quick flutter from the hip; six
    // beats to each full stroke, knees soft on the down-beat, toes pointed
    for (const [up, lo, ft, side, off] of [
      [bones.lUpLeg, bones.lLeg, bones.lFoot, 1, 0], [bones.rUpLeg, bones.rLeg, bones.rFoot, -1, Math.PI],
    ] as const) {
      const kick = Math.sin(cycle * Math.PI * 6 + off) * 0.16
      _d.copy(Fb).negate().addScaledVector(Db, kick).addScaledVector(Lb, -side * 0.035).normalize()
      blendAim(up, lo, _d, k)
      _d.copy(Fb).negate().addScaledVector(Db, kick * 1.5 + Math.max(0, kick) * 0.8 + 0.06)
        .addScaledVector(Lb, -side * 0.02).normalize()
      blendAim(lo, ft, _d, k)
      const toe = ft.children[0]
      if (toe) {
        _d.copy(Fb).negate().addScaledVector(Db, 0.25).normalize()
        blendAim(ft, toe, _d, k)
      }
    }

    // ---- arms: the stroke path. A stroke is a circle about the shoulder
    // in the plane of the body: reach forward, catch, pull under the chest,
    // push past the hip (the underwater 60%), then the recovery high over the
    // water with the elbow up and the hand trailing (the other 40%).
    for (const [up, fo, hand, side, off] of [
      [bones.lArm, bones.lFore, bones.lHand, 1, 0], [bones.rArm, bones.rFore, bones.rHand, -1, 0.5],
    ] as const) {
      const reach = (len(up, fo) + len(fo, hand)) * 0.98
      const a = (((cycle + off) % 1) + 1) % 1
      let theta: number, dist: number, lateral: number
      _p.set(0, 0, 0)
      if (a < 0.6) {
        // pull: 0 at the reach, PI at the thigh; the elbow bends through the
        // middle of it (a high-elbow catch) and the hand sweeps in under the chest
        const u = a / 0.6
        theta = u * Math.PI
        dist = reach * (1 - 0.3 * Math.sin(theta))
        lateral = -side * 0.08 * Math.sin(theta)
        _p.copy(Db).multiplyScalar(-0.5).addScaledVector(Lb, side).normalize()   // elbow out and up
      } else {
        // recovery: back round over the top, elbow leading high
        const u = (a - 0.6) / 0.4
        theta = Math.PI + u * Math.PI
        dist = reach * (0.62 + 0.36 * Math.abs(Math.cos(theta)))
        lateral = side * 0.22 * Math.abs(Math.sin(theta))
        _p.copy(Db).multiplyScalar(-1).addScaledVector(Lb, side * 0.6).normalize()  // elbow to the sky
      }
      _d.copy(Fb).multiplyScalar(Math.cos(theta)).addScaledVector(Db, Math.sin(theta))
        .addScaledVector(Lb, lateral).normalize()
      up.getWorldPosition(_s)
      _t.copy(_s).addScaledVector(_d, dist)
      if (k >= 0.999) twoBoneIK(up, fo, hand, _t, _p)
      else {
        // ease the stroke in from treading
        hand.getWorldPosition(_a)
        _t.lerpVectors(_a, _t, k)
        twoBoneIK(up, fo, hand, _t, _p)
      }
      // flat hand, fingers leading
      blendAim(hand, hand.children[0] ?? hand, _d, k * 0.8)
    }

    // ---- head: in line with the spine, eyes down and a little ahead; every
    // third stroke it turns with the roll to breathe on the recovering side
    rotateBoneWorld(bones.head, Lb, -0.25 * k)
    const breathCycle = (cycle / 1.5) % 2
    const breathe = Math.max(0, Math.sin(Math.min(1, breathCycle) * Math.PI)) ** 2
    rotateBoneWorld(bones.head, Fb, breathe * 1.05 * k)
  }

  // ---------------------------------------------------------------- tread
  if (blend < 0.99) {
    const k = (1 - blend) * amp
    const t = phase * 1.6
    for (const [upper, fore, side] of [[bones.lArm, bones.lFore, 1], [bones.rArm, bones.rFore, -1]] as const) {
      // arms out in front at chest depth, forearms sweeping side to side
      rotateBoneWorld(upper, L, -0.75 * k)
      rotateBoneWorld(upper, U, side * (0.35 + Math.sin(t) * 0.35) * k)
      rotateBoneWorld(fore, U, side * Math.sin(t + 0.8) * 0.4 * k)
      A.copy(F).multiplyScalar(-1)
      rotateBoneWorld(fore, A, side * 0.3 * k)
    }
    // eggbeater: thighs forward and apart, shins circling
    for (const [upper, lower, side, off] of [
      [bones.lUpLeg, bones.lLeg, 1, 0], [bones.rUpLeg, bones.rLeg, -1, Math.PI],
    ] as const) {
      rotateBoneWorld(upper, L, -0.55 * k)
      rotateBoneWorld(upper, F, side * 0.14 * k)
      rotateBoneWorld(lower, L, (0.9 + Math.sin(t * 1.2 + off) * 0.35) * k)
    }
    rotateBoneWorld(bones.head, L, 0.1 * k)
  }
}

/** Aim a bone along a world direction, eased by weight. */
const _qa = new Quaternion()
function blendAim(bone: Object3D, child: Object3D, dir: Vector3, w: number) {
  if (w >= 0.999) { aimBone(bone, child, dir); return }
  _qa.copy(bone.quaternion)
  aimBone(bone, child, dir)
  bone.quaternion.slerpQuaternions(_qa, bone.quaternion, w)
  bone.updateWorldMatrix(false, true)
}
