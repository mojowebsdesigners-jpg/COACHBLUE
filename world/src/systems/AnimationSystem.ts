import { MathUtils, Object3D, Quaternion, Vector3, type AnimationAction } from 'three'
import type { MoveState } from './PlayerController'

/**
 * Drives the character from three Mixamo clips (idle / walk / run) plus a layer
 * of procedural motion on top: breathing, weight shifts, a glance around, lean
 * into turns, and a tuck in the air. Clip rates are matched to ground speed so
 * the feet stay planted.
 */

// metres per second each clip was authored at, measured from the stride
const WALK_NATIVE = 1.49   // measured off the rig: planted-foot speed of the walk clip
const RUN_NATIVE = 3.21    // and of the run; a mismatch slides the feet

export type Bones = {
  hips: Object3D
  spine: Object3D
  spine2: Object3D
  head: Object3D
  lArm: Object3D
  rArm: Object3D
  lUpLeg: Object3D
  rUpLeg: Object3D
  lLeg: Object3D
  rLeg: Object3D
}

export type Rig = {
  idle?: AnimationAction
  walk?: AnimationAction
  run?: AnimationAction
  gesture?: AnimationAction
}

const _q = new Quaternion()
const _pq = new Quaternion()
const _axis = new Vector3()

function addRotation(bone: Object3D, axis: Vector3, angle: number) {
  if (!bone || Math.abs(angle) < 1e-5) return
  bone.updateWorldMatrix(true, false)
  _q.setFromAxisAngle(axis, angle)
  bone.parent?.getWorldQuaternion(_pq)
  bone.quaternion.premultiply(_pq.clone().invert().multiply(_q).multiply(_pq))
}

export class CharacterAnimator {
  private idleTimer = 0
  private glance = 0
  private glanceTarget = 0
  private airTime = 0
  private landTime = 0
  private bob = 0

  private rig: Rig
  private bones: Bones
  /** rest rotation of every bone this layer touches */
  private restQ = new Map<Object3D, Quaternion>()
  /** the subset of those the clips actually write each frame */
  private driven = new Set<Object3D>()

  constructor(rig: Rig, bones: Bones) {
    this.rig = rig
    this.bones = bones

    // The procedural layer premultiplies onto bone.quaternion. That is only
    // safe for bones the mixer rewrites from the clip every frame — anything
    // it does not drive keeps last frame's offset, and the additions compound
    // until the character folds up or turns upside down. So remember the rest
    // pose, and work out which bones the clips own.
    const drivenNames = new Set<string>()
    for (const action of [rig.idle, rig.walk, rig.run, rig.gesture]) {
      const clip = action?.getClip?.()
      if (!clip) continue
      for (const track of clip.tracks) drivenNames.add(track.name.split('.')[0])
    }
    for (const bone of Object.values(bones) as Object3D[]) {
      if (!bone) continue
      this.restQ.set(bone, bone.quaternion.clone())
      if (drivenNames.has(bone.name)) this.driven.add(bone)
    }
    // if nothing matched, the names are not what we expect — leave well alone
    if (this.driven.size === 0) this.restQ.clear()
    this.play()
  }

  /**
   * Start the locomotion clips. This is a method rather than constructor-only
   * work because React remounts the character — in StrictMode every mount is
   * followed by an unmount and a remount — and the unmount stops every action
   * on the mixer. The memoised animator is not rebuilt on the way back, so
   * without an explicit restart the clips stay stopped: weights look correct
   * while nothing is actually playing, and the skeleton sits in its rest pose.
   */
  play() {
    const { idle, walk, run } = this.rig
    idle?.reset().play()
    walk?.reset().play()
    run?.reset().play()
    if (idle) idle.weight = 1
    if (walk) walk.weight = 0
    if (run) run.weight = 0
  }

  /** Blend the clips. Call before the mixer updates. */
  update(dt: number, move: MoveState, reducedMotion: boolean) {
    const { idle, walk, run } = this.rig
    const speed = Math.abs(move.speed)
    const reversing = move.speed < -0.05

    // walk fades in from a standstill, run takes over as speed climbs
    const walkW = MathUtils.clamp(speed / 1.6, 0, 1)
    const runW = MathUtils.clamp((speed - 2.2) / 2.6, 0, 1)

    // turning on the spot still shuffles the feet rather than pivoting rigidly
    const turnShuffle = speed < 0.3 ? Math.abs(move.turning) * 0.45 : 0

    if (idle) idle.weight = MathUtils.damp(idle.weight, Math.max(0, 1 - walkW - turnShuffle), 12, dt)
    if (walk) {
      walk.weight = MathUtils.damp(walk.weight, Math.max(walkW * (1 - runW), turnShuffle), 12, dt)
      const rate = speed > 0.2 ? speed / WALK_NATIVE : 0.55
      walk.timeScale = MathUtils.clamp(rate, 0.35, 2.2) * (reversing ? -1 : 1)
    }
    if (run) {
      run.weight = MathUtils.damp(run.weight, walkW * runW, 12, dt)
      run.timeScale = MathUtils.clamp(speed / RUN_NATIVE, 0.6, 1.9)
    }

    if (move.airborne) {
      this.airTime += dt
      if (walk) walk.timeScale = 0.1
      if (run) run.timeScale = 0.1
    } else {
      if (this.airTime > 0.25) this.landTime = 0.32
      this.airTime = 0
    }
    if (this.landTime > 0) this.landTime -= dt

    this.idleTimer += dt
    if (speed < 0.2 && !reducedMotion) {
      // every so often, look around
      if (this.idleTimer > 6 + Math.random() * 6) {
        this.idleTimer = 0
        this.glanceTarget = (Math.random() - 0.5) * 1.1
      }
    } else {
      this.glanceTarget = 0
    }
    this.glance = MathUtils.damp(this.glance, this.glanceTarget, 2.2, dt)
    this.bob += dt * (0.9 + speed * 0.35)
  }

  /**
   * Procedural layer, applied after the mixer has posed the skeleton so it
   * adds to the clip rather than being overwritten by it.
   */
  applyProcedural(_dt: number, move: MoveState, yaw: number, reducedMotion: boolean) {
    const b = this.bones
    if (!b.spine || !b.head) return

    // clear last frame's additions from the bones no clip rewrites
    for (const [bone, q] of this.restQ) {
      if (!this.driven.has(bone)) bone.quaternion.copy(q)
    }
    const speed = Math.abs(move.speed)
    const scale = reducedMotion ? 0.35 : 1

    const forward = _axis.set(Math.sin(yaw), 0, Math.cos(yaw))
    const side = new Vector3(forward.z, 0, -forward.x)
    const up = new Vector3(0, 1, 0)

    // breathing — chest rises, strongest when standing or recovering from a run
    const breathRate = 0.9 + speed * 0.25
    const breath = Math.sin(this.bob * breathRate) * 0.022 * scale
    addRotation(b.spine, side, breath)
    addRotation(b.spine2, side, breath * 0.6)

    // weight shift while idle, so the stance isn't frozen
    if (speed < 0.2) {
      const shift = Math.sin(this.bob * 0.32) * 0.035 * scale
      addRotation(b.hips, forward, shift)
      addRotation(b.spine, forward, -shift * 0.5)
    }

    // lean into turns, and forward into a sprint
    const lean = MathUtils.clamp(move.turning * (speed / 6), -0.5, 0.5)
    addRotation(b.hips, forward, -lean * 0.18 * scale)
    addRotation(b.spine, forward, -lean * 0.12 * scale)
    const sprintLean = MathUtils.clamp((speed - 3) / 5, 0, 1) * 0.12 * scale
    addRotation(b.hips, side, sprintLean)

    // head: counter the turn a little, plus the occasional glance
    addRotation(b.head, up, this.glance * scale - move.turning * 0.16 * scale)
    addRotation(b.head, side, -sprintLean * 0.8)

    // in the air: tuck the legs and raise the arms slightly
    if (move.airborne) {
      const t = MathUtils.clamp(this.airTime * 3, 0, 1)
      addRotation(b.lUpLeg, side, -0.5 * t)
      addRotation(b.rUpLeg, side, -0.35 * t)
      addRotation(b.lLeg, side, 0.7 * t)
      addRotation(b.rLeg, side, 0.5 * t)
      addRotation(b.lArm, forward, 0.35 * t)
      addRotation(b.rArm, forward, -0.35 * t)
    } else if (this.landTime > 0) {
      // absorb the landing through the knees
      const t = this.landTime / 0.32
      addRotation(b.lUpLeg, side, -0.3 * t)
      addRotation(b.rUpLeg, side, -0.3 * t)
      addRotation(b.lLeg, side, 0.45 * t)
      addRotation(b.rLeg, side, 0.45 * t)
      addRotation(b.spine, side, 0.18 * t)
    }

    // the generated body is broader than the animation rig — hold the arms out
    // a little so the hands don't cut through the hips
    const spread = (0.2 - Math.min(0.13, speed * 0.028)) * scale
    addRotation(b.lArm, forward, spread)
    addRotation(b.rArm, forward, -spread)
  }
}
