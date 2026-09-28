import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useAnimations, useGLTF } from '@react-three/drei'
import { Bone, Group, MathUtils, MeshStandardMaterial, Object3D, Quaternion, SkinnedMesh, Vector3 } from 'three'
import { SkeletonUtils } from 'three/examples/jsm/Addons.js'
import { player, useStore } from '../../state/store'
import { FootstepSystem } from '../../systems/FootstepSystem'
import { MOVE, moveState, stepPlayer } from '../../systems/PlayerController'
import { vehicle } from '../../systems/VehicleController'
import { alignFeet, carTransfer, gripHand, plantOnGround, relaxPosture, solveExercise } from '../../systems/ExercisePose'
import { hand, isApproaching, stepHand } from '../../systems/HandAction'
import { applyHandPose } from '../../systems/HandPose'
import { boarding, stepBoarding } from '../../systems/Boarding'
import { twoBoneIK } from '../../lib/ik'
import { HeldItem } from './HeldItem'
import { applyCarry, carry, stepCarry } from '../../systems/Carry'
import { groundHeight } from '../../lib/terrain'
import { checkWorkoutRange, stepWorkout, workout } from '../../systems/Workout'
import { debugEnabled, registerClipProbe } from '../ui/DebugHud'
import { CharacterAnimator } from '../../systems/AnimationSystem'
import { applySwim, swimRoot } from '../../systems/Swim'
import { SwimSound } from '../../systems/SwimSound'
import { useHeadset } from './Headset'
import { useRadio } from '../ui/RadioCard'

export const WALK_SPEED = MOVE.walk
export const RUN_SPEED = MOVE.sprint

/**
 * Re-usable clone of a rigged character, with its own mixer. The clients are
 * separate MakeHuman bodies rather than the coach at another scale, but they
 * all carry the same Mixamo skeleton, so one loader serves all of them.
 */
export function useCoachModel(file = '/models/coach.glb') {
  const { scene, animations } = useGLTF(file)
  return useMemo(() => {
    const clone = SkeletonUtils.clone(scene) as Group
    clone.traverse((o) => {
      const m = o as SkinnedMesh
      if (!m.isSkinnedMesh) return
      m.castShadow = true
      m.receiveShadow = true
      // culled against the camera like everything else, with bounds grown to
      // cover any pose (an arm overhead, lying on a bench)
      m.frustumCulled = true
      m.computeBoundingSphere()
      if (m.boundingSphere) m.boundingSphere.radius *= 1.6
      // the generator ships everything as glossy plastic; skin and fabric need
      // to be matte and non-metallic or they read as a toy under any light
      const wasArray = Array.isArray(m.material)
      const mats = (wasArray ? m.material : [m.material]) as MeshStandardMaterial[]
      const fixed = mats.map((src) => {
        const mat = src.clone()
        // the Blender-built hero (tools/coach) ships its own tuned materials:
        // baked skin and fabric, a metal chain. Leave those as authored.
        if (mat.name.startsWith('CB_')) return mat
        mat.metalness = 0
        mat.roughness = 0.72
        mat.envMapIntensity = 0.75
        return mat
      })
      // Coach Blue's own shirt, in Coach Blue blue (see blueShirt); and the
      // skin the shirt covers, which is only drawn with the shirt off
      if (/coach/.test(file)) {
        fixed.forEach((mat) => { if (mat.name === 'CB_Shirt') blueShirt(mat) })
        const shirt = m.geometry.getAttribute('_shirt')
        if (shirt) {
          m.geometry.setAttribute('shirtMask', shirt)
          fixed.forEach((mat) => { if (mat.name === 'CB_Skin') coveredSkin(mat) })
        }
      }
      // a single-material mesh has no geometry groups — handing it an array
      // silently renders nothing
      m.material = wasArray ? fixed : fixed[0]
    })
    return { clone, animations }
  }, [scene, animations])
}

const smooth01 = (x: number) => x * x * (3 - 2 * x)
const _hp = new Vector3()
const _pl = new Vector3()

/**
 * Blends a solved pose back towards the pose the clips gave, bone by bone, so
 * getting onto a machine and off it again is a movement rather than a cut.
 * Capture the clip pose, let the solver overwrite it, then mix.
 */
export class PoseBlend {
  private bones: Object3D[] = []
  private saved: Quaternion[] = []
  private pos = new Vector3()
  private quat = new Quaternion()
  capture(root: Object3D, group: Object3D) {
    if (!this.bones.length) {
      root.traverse((o) => { if ((o as Bone).isBone) this.bones.push(o) })
      this.saved = this.bones.map(() => new Quaternion())
    }
    for (let i = 0; i < this.bones.length; i++) this.saved[i].copy(this.bones[i].quaternion)
    this.pos.copy(group.position)
    this.quat.copy(group.quaternion)
  }
  /** w = 0 keeps the captured pose, 1 keeps the solved one. */
  mix(group: Object3D, w: number) {
    for (let i = 0; i < this.bones.length; i++) this.bones[i].quaternion.slerpQuaternions(this.saved[i], this.bones[i].quaternion, w)
    group.position.lerpVectors(this.pos, group.position, w)
    group.quaternion.slerpQuaternions(this.quat, group.quaternion, w)
    group.updateMatrixWorld(true)
  }
}

/**
 * The shirt is baked near-black; tinting a dark texture only darkens it. So
 * its colour is remapped in the shader instead: the knit's own light and
 * shade (folds, seams, stitching) drive a ramp from deep navy to a bright
 * royal blue, and the white logo, which is far brighter than any fabric,
 * is left as it is.
 */
function blueShirt(mat: MeshStandardMaterial) {
  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#include <map_fragment>
       {
         float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
         float logo = smoothstep(0.3, 0.5, lum);
         vec3 blue = mix(vec3(0.012, 0.045, 0.16), vec3(0.06, 0.2, 0.62), clamp(lum * 4.0, 0.0, 1.0));
         diffuseColor.rgb = mix(blue, diffuseColor.rgb, logo);
       }`,
    )
  }
  mat.customProgramCacheKey = () => 'cb-blue-shirt'
  mat.needsUpdate = true
}

/**
 * The skin under the shirt is part of the one skin mesh, marked by a vertex
 * attribute from the export (tools/coach/export_game.py). With the shirt on
 * it is discarded — exactly the skin that used to be cut away under the cloth
 * — and with it off it is drawn, continuous with the rest of the body.
 */
function coveredSkin(mat: MeshStandardMaterial) {
  const on = { value: 1 }
  mat.userData.shirtOn = on
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uShirtOn = on
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute float shirtMask;
varying float vShirt;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vShirt = shirtMask;`)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uShirtOn;
varying float vShirt;`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
if (uShirtOn > 0.5 && vShirt > 0.02) discard;`)
  }
  mat.customProgramCacheKey = () => 'cb-covered-skin'
  mat.needsUpdate = true
}

/** Show one outfit: the shirt, or the torso the shirt covers. */
export function wearOutfit(root: Object3D, outfit: 'shirt' | 'shirtless') {
  root.traverse((o) => {
    const m = o as SkinnedMesh
    if (!m.isSkinnedMesh) return
    const mat = m.material as MeshStandardMaterial
    if (mat.name === 'CB_Shirt') m.visible = outfit === 'shirt'
    if (mat.userData.shirtOn) mat.userData.shirtOn.value = outfit === 'shirt' ? 1 : 0
  })
}

export function findBones(root: Object3D) {
  const get = (n: string) => root.getObjectByName(`mixamorig${n}`) ?? root.getObjectByName(`mixamorig:${n}`)
  return {
    hips: get('Hips')!,
    spine: get('Spine')!,
    spine2: get('Spine2')!,
    head: get('Head')!,
    lArm: get('LeftArm')!,
    lFore: get('LeftForeArm')!,
    lHand: get('LeftHand')!,
    rArm: get('RightArm')!,
    rFore: get('RightForeArm')!,
    rHand: get('RightHand')!,
    lUpLeg: get('LeftUpLeg')!,
    lLeg: get('LeftLeg')!,
    lFoot: get('LeftFoot')!,
    rUpLeg: get('RightUpLeg')!,
    rLeg: get('RightLeg')!,
    rFoot: get('RightFoot')!,
  }
}

export function Player() {
  const group = useRef<Group>(null)
  const { clone, animations } = useCoachModel()
  // the player is never culled: the camera is always on him, and a bounding
  // sphere that lags a pose (lying down, climbing) must not make him vanish
  useMemo(() => clone.traverse((o) => { if ((o as SkinnedMesh).isSkinnedMesh) o.frustumCulled = false }), [clone])
  const { actions, mixer } = useAnimations(animations, clone)
  const view = useStore((s) => s.view)
  const soundOn = useStore((s) => s.settings.sound)
  const reduced = useStore((s) => s.settings.reducedMotion)
  const bones = useMemo(() => findBones(clone), [clone])
  const steps = useMemo(() => new FootstepSystem(), [])
  const swimPhase = useRef(0)
  const { playing: music } = useRadio()
  useHeadset(clone, music)
  const splash = useMemo(() => new SwimSound(), [])
  const blend = useMemo(() => new PoseBlend(), [])
  const outfit = useStore((s) => s.outfit)
  useEffect(() => wearOutfit(clone, outfit), [clone, outfit])
  const transfer = useRef<ReturnType<typeof stepBoarding> | null>(null)
  const reach = useRef(0)
  const handle = useRef(new Vector3())

  const animator = useMemo(
    () =>
      new CharacterAnimator(
        {
          idle: actions.idle ?? undefined,
          walk: actions.walk ?? undefined,
          run: actions.run ?? undefined,
          gesture: actions.agree ?? undefined,
        },
        bones,
      ),
    [actions, bones],
  )

  useEffect(() => {
    animator.play()
    return () => { mixer.stopAllAction() }
  }, [animator, mixer])

  // publish what the clips are actually doing, so the read-out can show it
  useEffect(() => {
    if (!debugEnabled()) return
    return registerClipProbe('player', () => ({
      idle: actions.idle?.weight ?? -1,
      walk: actions.walk?.weight ?? -1,
      run: actions.run?.weight ?? -1,
      running: actions.idle?.isRunning() ? 1 : 0,
      t: mixer.time % 10,
    }))
  }, [actions, mixer])

  // movement and clip blending — runs before the mixer poses the skeleton
  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05)
    const g = group.current
    if (!g) return

    // While driving, the vehicle owns the player's position, so running the
    // character's own gravity and collisions as well just fights it — and the
    // character must not be left standing in the middle of his own car.
    g.visible = view === 'third' && !vehicle.occupied
    if (vehicle.occupied) return

    // Working out hands the character to the same IK poses the coach and the
    // clients use, on the same measured grip heights, so the player lifts the
    // actual bar rather than miming beside it.
    if (workout.station) {
      const st = workout.station
      stepWorkout(dt)
      checkWorkoutRange()
      // Standing place for this frame: walking from where he pressed E to the
      // kit as the blend rises, and back again as it falls. The exercise
      // solver then works from here, and the procedural pass blends the two.
      const e = smooth01(workout.enter)
      const onBelt = st.def.pose === 'run'
      const fx = workout.from.x, fz = workout.from.z
      g.position.set(
        fx + (st.spot[0] - fx) * e,
        workout.from.y + (st.ground - workout.from.y) * e,
        fz + (st.spot[1] - fz) * e,
      )
      let dy = st.yaw - workout.from.yaw
      dy = Math.atan2(Math.sin(dy), Math.cos(dy))
      g.rotation.set(0, workout.from.yaw + dy * Math.min(1, e * 1.6), 0)
      // the treadmill is locomotion: the gait follows the belt the player sets
      // (a walk, a jog, a run); every other station holds the idle clip under
      // the solved pose, and uses the walk while stepping on and off
      const stepping = workout.enter > 0 && workout.enter < 1
      const pushing = st.def.pose === 'push'
      const speed = onBelt ? (workout.enter >= 1 || workout.leaving ? workout.belt : 1.2)
        : pushing && workout.belt > 0.05 ? 1.2 + workout.belt * 1.6    // legs driving
        : stepping ? 1.1 : 0
      animator.update(dt, { ...moveState, speed, turning: 0, airborne: false }, reduced)
      return
    }

    // getting into the car or out of it
    if (boarding.kind) {
      const b = stepBoarding(dt)
      player.pos.y = groundHeight(player.pos.x, player.pos.z)
      g.rotation.set(0, player.yaw, 0)
      g.position.copy(player.pos)
      transfer.current = b.mode === 'transfer' ? b : null
      reach.current = b.reach
      handle.current.copy(b.handle)
      animator.update(dt, { ...moveState, speed: b.mode === 'walk' ? 1.3 : 0, turning: 0, airborne: false }, reduced)
      return
    }
    transfer.current = null
    reach.current = 0

    // reaching for something, eating, drinking: he stands where he is
    if (hand.action) {
      stepHand(dt)
      player.pos.y = groundHeight(player.pos.x, player.pos.z)
      g.rotation.set(0, player.yaw, 0)
      g.position.copy(player.pos)
      // stepping in walks; reaching stands still
      animator.update(dt, { ...moveState, speed: isApproaching() ? 1.1 : 0, turning: 0, airborne: false }, reduced)
      return
    }

    const move = stepPlayer(dt)
    if (move.swimming) {
      // lie along the surface; the stroke is drawn in the procedural pass
      swimPhase.current += dt * (0.35 + 0.65 * player.swimBlend) * Math.max(0.4, Math.min(1.4, move.speed / 1.25))
      const bob = Math.sin(swimPhase.current * 2.2) * 0.03
      // underwater the whole body goes down with the dive, tipped head-down
      // going deeper and head-up coming back to the light
      const r = swimRoot(player.waterSurface - player.dive, player.swimBlend, player.dive > 0.5 ? 0 : bob)
      const tilt = MathUtils.clamp(player.diveVel * 0.35, -0.55, 0.55)
      g.rotation.set(r.pitch + tilt, player.yaw, 0, 'YXZ')
      g.position.set(
        player.pos.x - Math.sin(player.yaw) * r.back, r.y, player.pos.z - Math.cos(player.yaw) * r.back,
      )
      animator.update(dt, { ...move, speed: 0, turning: 0, airborne: false }, reduced)
      splash.update(dt, move.speed, player.swimBlend, soundOn)
      return
    }
    g.rotation.set(0, player.yaw, 0)
    g.position.copy(player.pos)

    animator.update(dt, move, reduced)

    steps.update(dt, move, soundOn)
  })

  // procedural layer — after the mixer, so it adds to the clip
  useFrame((_, delta) => {
    const g = group.current
    if (!g) return
    g.updateMatrixWorld(true)

    const st = workout.station
    if (st) {
      const w = smooth01(workout.enter)
      // the clip pose is "standing"; the solver's is "in the exercise"
      if (w < 1) blend.capture(clone, g)
      solveExercise({
        bones, group: g, exercise: st.def.pose, position: st.spot,
        rotation: st.yaw, ground: st.ground, phase: workout.phase,
        grip: st.grip, barHeight: st.barHeight, progress: workout.distance,
      })
      if (w < 1) blend.mix(g, w)
      if (st.def.pose === 'run') alignFeet(bones, g, () => st.ground, Math.min(delta, 0.05))
      if (st.def.pose === 'push') alignFeet(bones, g, groundHeight, Math.min(delta, 0.05))
      // publish the hands so whatever is being lifted can follow them
      bones.lHand.updateWorldMatrix(true, false)
      bones.rHand.updateWorldMatrix(true, false)
      workout.hands[0].setFromMatrixPosition(bones.lHand.matrixWorld)
      workout.hands[1].setFromMatrixPosition(bones.rHand.matrixWorld)
      return
    }

    if (moveState.swimming) {
      applySwim(bones, g, swimPhase.current, player.swimBlend, reduced)
      return
    }
    animator.applyProcedural(Math.min(delta, 0.05), moveState, player.yaw, reduced)
    // stand like the athlete he is: arms beside the body, chest up; eased off
    // at speed so the run keeps its arm swing
    relaxPosture(bones, g, Math.max(0.35, 1 - Math.abs(moveState.speed) / 6))
    // sitting into the car, a leg at a time (or climbing out)
    const tr = transfer.current
    if (tr) {
      carTransfer(bones, g, tr.hip, tr.yaw, tr.sit, tr.feet, tr.lift)
      return
    }
    // reaching for the car's door handle
    if (reach.current > 0.01) {
      bones.rHand.getWorldPosition(_hp)
      _hp.lerp(handle.current, reach.current)
      _pl.set(Math.cos(g.rotation.y), -0.5, -Math.sin(g.rotation.y)).multiplyScalar(-1).normalize()
      twoBoneIK(bones.rArm, bones.rFore, bones.rHand, _hp, _pl)
      gripHand(bones.rHand, reach.current)
    }
    // hands: reaching down for something, eating, drinking, or just holding
    const crouch = applyHandPose(bones, g, groundHeight(player.pos.x, player.pos.z), performance.now() / 1000)
    // feet on the real ground, standing or striding: each foot is placed on
    // the ground under it, so slopes, kerbs and steps never swallow a leg.
    // While he bends down for something the feet are pinned instead, and the
    // knees take the bend.
    if (crouch > 0.001) plantOnGround(bones, g, groundHeight, 1)
    else if (!moveState.airborne) alignFeet(bones, g, groundHeight, Math.min(delta, 0.05))
    if (carry.active) {
      stepCarry(Math.min(delta, 0.05))
      applyCarry(bones, g, moveState.speed)
      gripHand(bones.lHand)
      gripHand(bones.rHand)
    }
  }, 1)

  return (
    <>
      <group ref={group} visible={view === 'third'}>
        <primitive object={clone} />
      </group>
      <HeldItem hand={bones.rHand} />
    </>
  )
}

useGLTF.preload('/models/coach.glb')
