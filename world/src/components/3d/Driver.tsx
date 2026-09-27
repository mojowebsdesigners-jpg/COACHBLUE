import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useAnimations } from '@react-three/drei'
import { Group, Matrix4, Object3D, Quaternion, Vector3 } from 'three'
import { findBones, useCoachModel } from './Player'
import { useHeadset } from './Headset'
import { useRadio } from '../ui/RadioCard'
import { aimBone, rotateBoneWorld, twoBoneIK } from '../../lib/ik'
import { vehicle } from '../../systems/VehicleController'

/** The car's own markers, read from car.glb (tools/car/interior.py). */
export type CarMarkers = {
  seat: Object3D
  gripL: Object3D
  gripR: Object3D
  pedals: Object3D
}

// the hip joint sits a little above the cushion surface the marker is on
const HIP_ABOVE_SEAT = 0.1
// how far the torso lies back from upright, like a low sports seat
const RECLINE = 0.36

const _seat = new Vector3()
const _hips = new Vector3()
const _t = new Vector3()
const _pole = new Vector3()
const _fwd = new Vector3()
const _side = new Vector3()
const _up = new Vector3()
const _q = new Quaternion()
const _inv = new Matrix4()

/**
 * The player, sat in the driver's seat.
 *
 * Nothing here is a guessed offset. Each frame the body is posed, then moved
 * until its hip joint lands on the car's own seat marker; the hands are then
 * solved onto the steering wheel's grip points — which turn with the wheel —
 * and the right foot onto the pedal. Mounted inside the car's body group, so
 * the driver takes every bit of the car's yaw, pitch and roll, and is hidden
 * by the bodywork exactly as a real occupant is: seen through the glass.
 */
export function SeatedDriver({ markers }: { markers: CarMarkers }) {
  const group = useRef<Group>(null)
  const { clone, animations } = useCoachModel()
  const { actions, mixer } = useAnimations(animations, clone)
  const bones = useMemo(() => findBones(clone), [clone])
  const { playing: music } = useRadio()
  useHeadset(clone, music)

  useEffect(() => {
    actions.idle?.reset().play()
    if (actions.idle) actions.idle.weight = 1
    return () => { actions.idle?.stop() }
  }, [actions])

  useFrame(() => {
    const g = group.current
    if (!g || !g.parent) return
    // start from the clip's idle pose each frame; everything below is on top
    g.position.set(0, 0, 0)
    mixer.update(0)
    g.updateMatrixWorld(true)

    // the car's axes in world space
    g.parent.getWorldQuaternion(_q)
    _fwd.set(0, 0, 1).applyQuaternion(_q)
    _side.set(1, 0, 0).applyQuaternion(_q)
    _up.set(0, 1, 0).applyQuaternion(_q)

    // lie back into the seat through the spine, so the hips stay put while the
    // shoulders go back; the head comes forward again to watch the road
    rotateBoneWorld(bones.hips, _side, RECLINE * 0.35)
    rotateBoneWorld(bones.spine, _side, RECLINE * 0.4)
    rotateBoneWorld(bones.spine2, _side, RECLINE * 0.25)

    // thighs forward and a touch apart, before the body is placed
    for (const [upper, lower, s] of [
      [bones.lUpLeg, bones.lLeg, 1], [bones.rUpLeg, bones.rLeg, -1],
    ] as const) {
      aimBone(upper, lower, _t.copy(_fwd).addScaledVector(_up, 0.12).addScaledVector(_side, s * 0.12).normalize())
    }

    // put the hip joint on the seat
    markers.seat.getWorldPosition(_seat).addScaledVector(_up, HIP_ABOVE_SEAT)
    bones.hips.getWorldPosition(_hips)
    _t.copy(_seat).sub(_hips)
    g.parent.updateWorldMatrix(true, false)
    _inv.copy(g.parent.matrixWorld).invert()
    const local = _seat.clone().applyMatrix4(_inv).sub(_hips.clone().applyMatrix4(_inv))
    g.position.add(local)
    g.updateMatrixWorld(true)

    // hands on the wheel at nine and three, elbows down and out
    const steer = vehicle.steer
    for (const [arm, fore, hand, grip, s] of [
      [bones.lArm, bones.lFore, bones.lHand, markers.gripL, 1],
      [bones.rArm, bones.rFore, bones.rHand, markers.gripR, -1],
    ] as const) {
      grip.getWorldPosition(_t)
      _pole.copy(_up).multiplyScalar(-1).addScaledVector(_side, s * 0.8).addScaledVector(_fwd, -0.2).normalize()
      twoBoneIK(arm, fore, hand, _t, _pole)
    }

    // right foot on the pedal, left foot resting beside it; knees up and out
    markers.pedals.getWorldPosition(_t)
    _pole.copy(_up).addScaledVector(_fwd, 0.5).addScaledVector(_side, -0.2).normalize()
    twoBoneIK(bones.rUpLeg, bones.rLeg, bones.rFoot, _t, _pole)
    _t.addScaledVector(_side, 0.24).addScaledVector(_fwd, -0.08).addScaledVector(_up, 0.02)
    _pole.copy(_up).addScaledVector(_fwd, 0.5).addScaledVector(_side, 0.2).normalize()
    twoBoneIK(bones.lUpLeg, bones.lLeg, bones.lFoot, _t, _pole)

    // eyes on the road, glancing into the turn
    aimBone(bones.head, bones.head.children[0] ?? bones.head,
      _t.copy(_up).addScaledVector(_fwd, 0.2).addScaledVector(_side, steer * 0.08).normalize())
  }, 1)

  return (
    <group ref={group}>
      <primitive object={clone} />
    </group>
  )
}
