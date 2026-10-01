import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useAnimations, useGLTF } from '@react-three/drei'
import { Color, Group, MeshStandardMaterial, SkinnedMesh, Vector3 } from 'three'
import { findBones, useCoachModel } from './Player'
import { aimBone } from '../../lib/ik'
import { addDynamicCollider, groundHeight } from '../../lib/terrain'
import { relaxPosture, solveExercise, type Exercise, type Grip } from '../../systems/ExercisePose'
import { yielded } from '../../systems/Workout'
import { useNearActive } from './Props'

export type { Exercise }

export type { Grip }

type Props = {
  position: [number, number]
  rotation?: number
  exercise?: Exercise
  /** height of the pull-up bar above the ground (kept for existing callers) */
  barHeight?: number
  grip?: Grip
  scale?: number
  speed?: number
  lookAt?: Vector3 | null
  /** floor height override — the gym stands on a raised rubber slab */
  y?: number
  /** clothing tint, so the clients aren't all dressed identically */
  tint?: string
  /** lighter/heavier build: x is width, y is height */
  build?: [number, number]
  /** called every frame with the world position of each hand */
  onHands?: (left: Vector3, right: Vector3) => void
  /** phase offset so a row of people isn't perfectly in sync */
  offset?: number
  /** which rigged character to wear; defaults to Coach Blue */
  model?: string
  /** the station this athlete is using, if any */
  station?: string
  /** where they wait once the player takes that station */
  stepAside?: [number, number]
}

const _t = new Vector3()
const _dir = new Vector3()
const _lh = new Vector3()
const _rh = new Vector3()
const _tint = new Color()

/**
 * A rigged athlete placed in the world. Idle/run come from the clip set; the
 * exercises are solved with IK on top so the hands stay on the bar, the handle
 * or the floor while the body moves through the rep.
 */
export function Athlete({
  position,
  rotation = 0,
  exercise = 'idle',
  barHeight = 2.35,
  grip,
  scale = 1,
  speed = 1,
  lookAt = null,
  y,
  tint,
  build,
  onHands,
  offset,
  model,
  station,
  stepAside,
}: Props) {
  const group = useRef<Group>(null)
  // Coach Blue in the world is a lighter copy (tools/coach, simplified); the
  // player keeps the full model
  const { clone, animations } = useCoachModel(model ?? '/models/coach-npc.glb')
  const { actions, mixer } = useAnimations(animations, clone)
  const bones = useMemo(() => findBones(clone), [clone])
  const ground = useMemo(
    () => (y !== undefined ? y : groundHeight(position[0], position[1])),
    [position, y],
  )
  const phase = useRef(offset ?? Math.random() * Math.PI * 2)

  // people are solid too: you step round them, not through them
  useEffect(() => addDynamicCollider(() => {
    const g = group.current
    return g ? { x: g.position.x, z: g.position.z, r: 0.3 } : null
  }), [])
  const ceded = useRef(false)

  // Clothing tint. Only the trousers are recoloured — tinting the body map too
  // would drain the skin, and different-coloured kit is what actually reads as
  // a different person at this distance.
  useEffect(() => {
    if (!tint) return
    _tint.set(tint)
    clone.traverse((o) => {
      const m = o as SkinnedMesh
      if (!m.isSkinnedMesh) return
      const mats = (Array.isArray(m.material) ? m.material : [m.material]) as MeshStandardMaterial[]
      mats.forEach((mat) => {
        if (/cargo|pants/i.test(mat.name)) mat.color.copy(_tint)
      })
    })
  }, [clone, tint])

  useEffect(() => {
    const clip = exercise === 'run' ? actions.run : actions.idle
    clip?.reset().play()
    if (clip) clip.weight = 1
    if (exercise === 'run') clip!.timeScale = 1.15
    return () => { clip?.stop() }
  }, [actions, exercise])

  const area = useNearActive()
  useFrame((_, delta) => {
    const g = group.current
    if (!g || !area.active) return
    const dt = Math.min(delta, 0.05)
    phase.current += dt * speed

    // Someone has taken this station. Finish the rep in progress, then walk
    // off and wait. Teleporting out of the way would be quicker and would look
    // like a bug; a body that gets up and moves reads as a person.
    if (station && stepAside && yielded.has(station)) {
      const atRest = Math.abs(Math.sin(phase.current * 1.4)) < 0.12
      if (atRest || ceded.current) {
        ceded.current = true
        const [tx, tz] = stepAside
        const k = Math.min(1, dt * 1.6)
        g.position.x += (tx - g.position.x) * k
        g.position.z += (tz - g.position.z) * k
        g.position.y = ground
        g.rotation.set(0, rotation + Math.PI * 0.75, 0)
        mixer.update(dt)
        return
      }
    } else if (ceded.current) {
      ceded.current = false
    }

    if (exercise === 'idle' || exercise === 'coach' || exercise === 'run') {
      // clip-driven: the mixer owns the pose, we only place the body
      g.position.set(position[0], ground, position[1])
      g.rotation.set(0, rotation, 0)
      if (exercise === 'coach') {
        // weight shifts from foot to foot while he watches the set
        g.position.y = ground + Math.sin(phase.current * 1.1) * 0.012
      }
      // the stock clips hold a muscled body's arms out like a lat spread
      g.updateMatrixWorld(true)
      relaxPosture(bones, g, exercise === 'run' ? 0.35 : 1)
      if (lookAt) aimHead()
      reportHands()
      return
    }

    mixer.update(0)
    g.updateMatrixWorld(true)
    solveExercise({
      bones, group: g, exercise, position, rotation,
      ground, phase: phase.current, grip, barHeight,
    })

    if (lookAt) aimHead()
    reportHands()
  }, 1)

  function aimHead() {
    const head = bones.head
    head.updateWorldMatrix(true, false)
    const hp = _t.setFromMatrixPosition(head.matrixWorld)
    aimBone(head, head.children[0] ?? head, _dir.copy(lookAt!).sub(hp).normalize())
  }

  function reportHands() {
    if (!onHands) return
    bones.lHand.updateWorldMatrix(true, false)
    bones.rHand.updateWorldMatrix(true, false)
    onHands(
      _lh.setFromMatrixPosition(bones.lHand.matrixWorld),
      _rh.setFromMatrixPosition(bones.rHand.matrixWorld),
    )
  }

  const size: [number, number, number] = build
    ? [scale * build[0], scale * build[1], scale * build[0]]
    : [scale, scale, scale]

  return (
    <group ref={group} scale={size} position={[position[0], ground, position[1]]} rotation={[0, rotation, 0]}>
      <primitive object={clone} />
    </group>
  )
}
useGLTF.preload('/models/coach-npc.glb')
