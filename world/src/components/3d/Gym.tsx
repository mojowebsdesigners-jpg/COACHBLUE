import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import {
  Group, Mesh, MeshStandardMaterial, SRGBColorSpace,
  CanvasTexture, Vector3, Box3 } from 'three'
import {
  GYM, GYM_LIFT, GYM_SLAB_D, GYM_SLAB_W, addBoxFor, addCollider, gymFloorY,
} from '../../lib/terrain'
import {
  CalisthenicsRig, ChestPress, ChipBorder, CurveTreadmill, LatPulldown, LegPress, PicnicTable, RIG, useKitMaterials,
} from './OutdoorKit'
import { GymAmbience } from './GymAmbience'
import { Frozen } from './Frozen'
import { setGymFloor } from '../../systems/PlayerController'
import { transformations } from '../../data/transformations'
import { useDay } from './Lighting'
import { registerLamp } from './LightPool'
import { Athlete } from './Athlete'
import { TrainingMirror } from './Mirror'
import { PhotoFrame, VideoScreen } from './Props'
import { registerInteractable } from './InteractionSystem'
import { exerciseById } from '../../data/exercises'
import {
  onWorkoutChange, startWorkout, workout, yielded, type Station,
} from '../../systems/Workout'
import { useStore as useGlobalStore } from '../../state/store'

/**
 * The outdoor training compound: a rubber sports floor carrying the modelled
 * kit at its real dimensions, with Coach Blue and three clients working on it.
 * Every grip height here is the one the equipment was built to, so the IK in
 * `Athlete` puts hands on the actual bar rather than near it.
 */

// slab dimensions and how it sits relative to the location centre
const SLAB_W = GYM_SLAB_W
const SLAB_D = GYM_SLAB_D
export const LIFT = GYM_LIFT

// grip heights straight from tools/gym_kit.py
const BENCH_PAD = 0.50       // top of the pad, not its centre
const TREADMILL_BELT = 0.255 // top of the belt

// ------------------------------------------------------------------ helpers
/**
 * The floor: a soft, deep-red gym carpet over the whole slab.
 *
 * Drawn once into a canvas the size of the floor (a texel every 2.5 cm), so
 * it never tiles and has no fine repeating grain to shimmer into lines at a
 * distance, which is what the old rubber texture did. Soft low-contrast
 * fibre, a lighter lane down the middle where people walk, and a mint
 * border inset from the edge.
 */
function useCarpet() {
  return useMemo(() => {
    const PX = 40                                    // texels per metre
    const W = Math.round(SLAB_W * PX / 2), H = Math.round(SLAB_D * PX / 2)   // half-res, filtered up
    const c = document.createElement('canvas')
    c.width = W; c.height = H
    const g = c.getContext('2d')!
    g.fillStyle = '#8c1d2a'
    g.fillRect(0, 0, W, H)
    // fibre: many faint soft blotches, darker and lighter reds
    let seed = 5
    const r = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
    for (let i = 0; i < 9000; i++) {
      const x = r() * W, y = r() * H, rad = 0.6 + r() * 2.2
      g.fillStyle = r() < 0.5 ? `rgba(60,8,16,${0.05 + r() * 0.07})` : `rgba(190,60,72,${0.04 + r() * 0.06})`
      g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill()
    }
    // a lighter walkway down the middle, and a mint border line
    const m = PX / 2
    g.fillStyle = 'rgba(200,70,82,0.18)'
    g.fillRect(W * 0.5 - 1.2 * m, 0, 2.4 * m, H)
    g.strokeStyle = 'rgba(29,233,182,0.75)'
    g.lineWidth = 0.08 * m
    g.strokeRect(0.35 * m, 0.35 * m, W - 0.7 * m, H - 0.7 * m)
    const t = new CanvasTexture(c)
    t.colorSpace = SRGBColorSpace
    t.anisotropy = 8
    return new MeshStandardMaterial({ map: t, roughness: 0.96, metalness: 0, color: '#ffffff' })
  }, [])
}

/** One piece of kit, dropped on the slab at its modelled scale. */
function Kit({
  file, at, yaw = 0, y, collider,
}: { file: string; at: [number, number]; yaw?: number; y: number; collider?: number }) {
  const { scene } = useGLTF(`/models/${file}.glb`)
  const model = useMemo(() => {
    const c = scene.clone(true)
    c.traverse((o) => {
      const m = o as Mesh
      if (!m.isMesh) return
      m.castShadow = true
      m.receiveShadow = true
      const mat = m.material as MeshStandardMaterial
      if (mat) mat.envMapIntensity = 1.15
    })
    return c
  }, [scene])
  useEffect(() => {
    // fitted to the machine's own footprint, so you walk round its corners
    if (collider) addBoxFor(new Box3().setFromObject(scene), { x: at[0], z: at[1] }, yaw)
  }, [at, collider, scene, yaw])
  return <primitive object={model} position={[at[0], y, at[1]]} rotation={[0, yaw, 0]} />
}

/** A loose barbell that rides wherever the athlete's hands are. */
type HandPair = [Vector3, Vector3]
export type Hands = { current: HandPair } | HandPair
const pair = (h: Hands): HandPair => (Array.isArray(h) ? h : h.current)

const _shaft = new Vector3()
const _ref = new Vector3()
const _xAxis = new Vector3(1, 0, 0)

export function HeldBarbell({ hands, yaw, station }: { hands: Hands; yaw: number; station?: string }) {
  const { scene } = useGLTF('/models/gym_barbell.glb')
  const model = useMemo(() => {
    const c = scene.clone(true)
    c.traverse((o) => {
      const m = o as Mesh
      if (m.isMesh) { m.castShadow = true; m.receiveShadow = true }
    })
    return c
  }, [scene])
  const ref = useRef<Group>(null)
  useFrame(() => {
    const g = ref.current
    if (!g) return
    // an NPC's bar goes with its station: once they have stepped aside for
    // the player it is the player's bar (drawn in their hands), not a copy
    // left hanging where the NPC let go
    g.visible = !station || !yielded.has(station)
    if (!g.visible) return
    const [l, r] = pair(hands)
    g.position.set((l.x + r.x) / 2, (l.y + r.y) / 2 + 0.03, (l.z + r.z) / 2)
    // the shaft runs along the model's local X: point it from one hand to the
    // other, so the bar sits in both grips whatever angle the lift is at
    _shaft.set(r.x - l.x, r.y - l.y, r.z - l.z)
    if (_shaft.lengthSq() > 1e-6) {
      _shaft.normalize()
      if (_shaft.dot(_ref.set(Math.cos(yaw), 0, -Math.sin(yaw))) < 0) _shaft.negate()
      g.quaternion.setFromUnitVectors(_xAxis, _shaft)
    }
  })
  return <group ref={ref} userData={{ noCollide: true }}><primitive object={model} /></group>
}

/** A single hex dumbbell, built here because the modelled asset is a full rack. */
export function HeldDumbbell({ hand, side, yaw = 0, station }: { hand: Hands; side: 0 | 1; yaw?: number; station?: string }) {
  const ref = useRef<Group>(null)
  useFrame(() => {
    const g = ref.current
    if (!g) return
    g.visible = !station || !yielded.has(station)
    if (!g.visible) return
    const p = pair(hand)[side]
    g.position.copy(p)
    // the handle lies across the palm, left to right for the lifter
    g.rotation.set(0, yaw, 0)
  })
  return (
    <group ref={ref} userData={{ noCollide: true }}>
      <mesh castShadow rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.019, 0.019, 0.2, 10]} />
        <meshStandardMaterial color="#8b8d90" roughness={0.3} metalness={1} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} castShadow position={[s * 0.115, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.072, 0.072, 0.11, 6]} />
          <meshStandardMaterial color="#141416" roughness={0.88} metalness={0} />
        </mesh>
      ))}
    </group>
  )
}

/** Floodlight mast: dead at noon, the reason you can train here after dark. */
function Floodlight({ at, y, aim }: { at: [number, number]; y: number; aim: [number, number] }) {
  const day = useDay()
  // the lamp face is JSX, so it needs the reactive flag rather than the
  // frame-mutated day object, which never re-renders anything
  const lightsOn = useGlobalStore((s) => s.lightsOn)
  useEffect(() => {
    addCollider({ x: at[0], z: at[1], r: 0.35 })
  }, [at])
  // The light itself comes from the shared pool (LightPool): a real light per
  // mast would recompile every material in the world the moment the gym
  // streamed in. Hung a little out over the slab, towards where it aims.
  useEffect(() => {
    const dx = aim[0] - at[0], dz = aim[1] - at[1]
    const len = Math.hypot(dx, dz) || 1
    return registerLamp({
      position: new Vector3(at[0] + (dx / len) * 1.2, y + 4.9, at[1] + (dz / len) * 1.2),
      color: '#eaf1ff',
      intensity: () => (day.lightsOn ? 150 : 0),
      distance: 30,
      decay: 1.4,
    })
  }, [at, aim, y, day])
  return (
    <group position={[at[0], y, at[1]]}>
      <mesh castShadow position={[0, 2.6, 0]}>
        <cylinderGeometry args={[0.07, 0.11, 5.2, 8]} />
        <meshStandardMaterial color="#2e3134" roughness={0.6} metalness={0.5} />
      </mesh>
      <mesh castShadow position={[0, 0.1, 0]}>
        <cylinderGeometry args={[0.36, 0.42, 0.2, 10]} />
        <meshStandardMaterial color="#1e2022" roughness={0.9} />
      </mesh>
      <mesh castShadow position={[0, 5.15, 0]} rotation={[0.5, 0, 0]}>
        <boxGeometry args={[0.72, 0.42, 0.16]} />
        <meshStandardMaterial color="#232628" roughness={0.5} metalness={0.4} />
      </mesh>
      {lightsOn && (
        <mesh position={[0, 5.05, 0.16]} rotation={[0.5, 0, 0]}>
          <planeGeometry args={[0.62, 0.34]} />
          <meshBasicMaterial color="#f6f9ff" />
        </mesh>
      )}
    </group>
  )
}

// ------------------------------------------------------------------ the gym
/**
 * Where the compound actually stands. The camp sits on the trail, so a slab
 * centred on it gets a road drawn across its middle. Step it off to one side
 * and square it to the road instead: the trail then runs past the front of it,
 * the way it would past somewhere that was actually built here.
 */
export function gymPlacement(_centre?: [number, number]) {
  return { cx: GYM.cx, cz: GYM.cz, angle: GYM.angle }
}

/** The belt: the player's pace when they are on it, the client's jog when she is. */
const treadSpeed = () =>
  workout.station?.id === 'gym-tread' ? workout.belt : yielded.has('gym-tread') ? 0 : 3.4

/** Radius nothing else should grow or stand inside. */
export const GYM_CLEAR = Math.hypot(SLAB_W, SLAB_D) / 2 + 0.6

const GOFF = new Set((typeof location !== 'undefined' ? new URLSearchParams(location.search).get('off') ?? '' : '').split(','))

export function Gym({ centre }: { centre: [number, number] }) {
  const kit = useKitMaterials()
  const { cx, cz, angle } = useMemo(() => gymPlacement(centre), [centre])

  const floorY = gymFloorY()
  const rubber = useCarpet()

  // local → world, so everything shares one floor grid
  const place = useMemo(() => {
    const c = Math.cos(angle)
    const s = Math.sin(angle)
    return (lx: number, lz: number): [number, number] => [cx + lx * c + lz * s, cz - lx * s + lz * c]
  }, [cx, cz, angle])

  const benchHands = useRef<[Vector3, Vector3]>([new Vector3(), new Vector3()])
  const curlHands = useRef<[Vector3, Vector3]>([new Vector3(), new Vector3()])
  const squatHands = useRef<[Vector3, Vector3]>([new Vector3(), new Vector3()])

  // Fixed positions, in slab-local metres. These are memoised because every
  // one of them is a dependency of an effect that registers a collider, and a
  // fresh array each render would register the same collider over and over.
  const spots = useMemo(() => ({
    rack: place(-6.5, 3.6),
    bench: place(-1.2, 4.0),
    dbRack: place(6.4, 5.0),
    cable: place(8.6, 0.4),
    tread: place(-8.4, -0.6),
    plates: place(-3.8, 5.4),
    kb: place(3.2, 5.2),
    mat: place(2.4, -3.2),
    bottle: place(0.6, 3.0),
    coach: place(-6.5, 2.6),          // walked out of the rack, facing the floor
    benchLie: place(-1.2, 4.0),
    curl: place(5.4, 3.2),
    // the treadmill is turned side-on, so its belt runs along local x and the
    // runner stands behind the console rather than off the side of the belt
    // on the belt, just behind its middle (the belt runs along the slab's z,
    // console towards the back wall, so behind is +z)
    treadRun: place(-8.4, -0.45),
    mirror: place(9.4, -4.6),
    wall: place(0, -6.9),
    flood: [place(-9.8, -6.6), place(9.8, -6.6), place(-9.8, 6.6), place(9.8, 6.6)] as [number, number][],
  }), [place])

  // Everything the player can actually train on. Each spot is the place the
  // athlete stands and the grip the equipment was modelled to offer, so the
  // player's hands land on the same bar the coach's do. The exercise itself
  // comes from the data table, not from here.
  const stations = useMemo<Station[]>(() => {
    const st = (
      id: string, exerciseId: string,
      spot: [number, number], yaw: number, extra: Partial<Station> = {},
    ): Station => ({
      id, def: exerciseById[exerciseId], spot, yaw, ground: floorY, ...extra,
    })
    return [
      // legs — the rack, with its own lifting platform
      st('gym-squat', 'back_squat', place(-6.5, 2.45), angle + Math.PI,
         { grip: { spread: 0.5 }, occupiedBy: 'coach' }),
      // back — the pull-up bar on the front of the same rack
      st('gym-pullup', 'pull_up', place(-6.5, 2.1), angle,
         { barHeight: 2.25, grip: { spread: 0.33 }, displaces: 'gym-squat' }),
      // and the high bar on the outdoor rig
      st('gym-rig-pullup', 'pull_up', place(RIG.lx, RIG.lz - RIG.d / 2), angle,
         { barHeight: RIG.barHigh }),
      // chest
      st('gym-bench', 'bench_press', place(-1.2, 4.0), angle + Math.PI,
         { grip: { height: BENCH_PAD, spread: 0.42 }, occupiedBy: 'client-b' }),
      st('gym-pushup', 'push_up', place(2.4, -3.2), angle),
      // arms
      st('gym-curl', 'dumbbell_curl', place(6.4, 3.4), angle, { occupiedBy: 'client-c' }),
      // functional
      st('gym-kb', 'kettlebell_swing', place(3.2, 3.6), angle),
      st('gym-airsquat', 'air_squat', place(5.2, -2.4), angle - 0.4),
      // cardio
      st('gym-tread', 'treadmill_run', place(-8.4, -0.45), angle + Math.PI,
         { ground: floorY + TREADMILL_BELT, occupiedBy: 'client-a' }),
    ]
  }, [place, floorY, angle])

  useEffect(() => {
    const offs = stations.map((station) => registerInteractable({
      id: station.id,
      label: `WORK OUT · ${station.def.name.toUpperCase()}`,
      verb: 'TRAIN',
      position: new Vector3(station.spot[0], floorY + 1.2, station.spot[1]),
      radius: station.def.reach,
      panel: null,
      action: () => startWorkout(station),
      focus: { dist: 5, height: 1.9 },
    }))
    return () => offs.forEach((o) => o())
  }, [stations, floorY])

  // tell the footstep system where the rubber is
  useEffect(() => {
    setGymFloor(cx, cz, Math.min(SLAB_W, SLAB_D) / 2)
  }, [cx, cz])

  useEffect(() => {
    // the slab itself blocks nothing, but the walls and kit do
    const offs = [
      registerInteractable({
        id: 'gym-floor',
        label: 'THE TRAINING FLOOR',
        verb: 'LOOK',
        position: new Vector3(cx, floorY + 1.4, cz),
        radius: 7,
        panel: { kind: 'camp-item', index: 0 },
        focus: { dist: 9, height: 3.4 },
      }),
    ]
    return () => offs.forEach((o) => o())
  }, [cx, cz, floorY])


  return (
    <group>
      {/* ---------------------------------------------------------- floor */}
      <group position={[cx, floorY, cz]} rotation={[0, angle, 0]}>
        {/* the carpet, a hair above the slab's own top so the two never fight */}
        <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.006, 0]} material={rubber}>
          <planeGeometry args={[SLAB_W, SLAB_D]} />
        </mesh>
        {/* poured edge, so the slab has thickness from a standing eye height */}
        <mesh position={[0, -LIFT / 2 - 0.004, 0]} receiveShadow castShadow>
          <boxGeometry args={[SLAB_W + 0.24, LIFT, SLAB_D + 0.24]} />
          <meshStandardMaterial color="#1a1c1e" roughness={0.95} />
        </mesh>
        {/* lifting platform under the rack: rubber is no good under a dropped bar */}
        <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[-6.5, 0.012, 3.0]}>
          <planeGeometry args={[2.8, 3.2]} />
          <meshStandardMaterial color="#3a2f24" roughness={0.85} />
        </mesh>
      </group>

      {/* ---------------------------------------------------------- kit */}
      <Frozen>
      <Kit file="gym_rack" at={spots.rack} yaw={angle + Math.PI} y={floorY} collider={1.1} />
      <Kit file="gym_bench" at={spots.bench} yaw={angle + Math.PI} y={floorY} collider={0.8} />
      <Kit file="gym_dumbbells" at={spots.dbRack} yaw={angle + Math.PI} y={floorY} collider={1.0} />
      <Kit file="gym_cable" at={spots.cable} yaw={angle - Math.PI / 2} y={floorY} collider={1.0} />
      <CurveTreadmill at={spots.tread} yaw={angle + Math.PI / 2} y={floorY} belt={TREADMILL_BELT} m={kit}
        speed={treadSpeed} />

      {/* the outdoor park round the floor */}
      <CalisthenicsRig place={place} angle={angle} y={floorY} m={kit} />
      <LegPress place={place} angle={angle} y={floorY} m={kit} />
      <ChestPress place={place} angle={angle} y={floorY} m={kit} />
      <LatPulldown place={place} angle={angle} y={floorY} m={kit} />
      <ChipBorder cx={cx} cz={cz} angle={angle} y={floorY} w={SLAB_W} d={SLAB_D} />
      <PicnicTable place={place} angle={angle} m={kit} />
      </Frozen>
      <GymAmbience at={[cx, cz]} tread={spots.tread} />
      <Kit file="gym_plates" at={spots.plates} yaw={angle + Math.PI} y={floorY} collider={0.6} />
      <Kit file="gym_kettlebells" at={spots.kb} yaw={angle + Math.PI} y={floorY} collider={0.6} />
      <Kit file="gym_mat" at={spots.mat} yaw={angle} y={floorY} />

      {/* ---------------------------------------------------------- people */}
      {!GOFF.has('people') && <>
      {/* Coach Blue under the bar: hands on the shaft, bar across the traps */}
      <Athlete
        station="gym-squat"
        stepAside={place(-8.4, 2.0)}
        position={spots.coach}
        rotation={angle + Math.PI}
        exercise="rackSquat"
        y={floorY}
        speed={0.85}
        grip={{ spread: 0.5 }}
        onHands={(l, r) => { squatHands.current[0].copy(l); squatHands.current[1].copy(r) }}
      />
      <HeldBarbell hands={squatHands} yaw={angle + Math.PI} station="gym-squat" />

      {/* The three clients are separate MakeHuman bodies — different sex, height
          and build — not the coach rescaled. Their heights are baked into the
          models, so nothing here scales them.

          Each is tied to a station id. Take that station and they finish the
          rep they are on, stand up and step aside — the equipment is shared,
          not reserved. */}
      {/* client on the bench, pressing */}
      <Athlete
        position={spots.benchLie}
        rotation={angle + Math.PI}
        exercise="bench"
        y={floorY}
        speed={0.75}
        offset={1.1}
        model="/models/client-b.glb"
        station="gym-bench"
        stepAside={place(0.9, 4.6)}
        grip={{ height: BENCH_PAD, spread: 0.42 }}
        onHands={(l, r) => { benchHands.current[0].copy(l); benchHands.current[1].copy(r) }}
      />
      <HeldBarbell hands={benchHands} yaw={angle + Math.PI} station="gym-bench" />

      {/* client curling, dumbbells locked to the hands */}
      <Athlete
        position={spots.curl}
        rotation={angle + Math.PI * 0.85}
        exercise="curl"
        y={floorY}
        speed={1.05}
        offset={2.4}
        model="/models/client-c.glb"
        station="gym-curl"
        stepAside={place(8.1, 4.2)}
        onHands={(l, r) => { curlHands.current[0].copy(l); curlHands.current[1].copy(r) }}
      />
      <HeldDumbbell hand={curlHands} side={0} yaw={angle + Math.PI * 0.85} station="gym-curl" />
      <HeldDumbbell hand={curlHands} side={1} yaw={angle + Math.PI * 0.85} station="gym-curl" />

      {/* client running the treadmill, feet on the belt */}
      <Athlete
        position={spots.treadRun}
        rotation={angle + Math.PI}
        exercise="run"
        y={floorY + TREADMILL_BELT}
        speed={1}
        offset={0.4}
        model="/models/client-a.glb"
        station="gym-tread"
        stepAside={place(-8.9, -3.4)}
      />

      </>}
      {/* pull-up station on the rack's front bar, kept free for the player */}

      {/* whatever the player is lifting, locked to their hands */}
      <PlayerWeights />

      {/* ---------------------------------------------------------- media wall */}
      {!GOFF.has('wall') && <MediaWall at={spots.wall} yaw={angle} y={floorY} place={place} />}

      {/* ---------------------------------------------------------- lockers */}
      <ChangingCorner place={place} yaw={angle} y={floorY} />

      {/* ---------------------------------------------------------- mirror */}
      <TrainingMirror position={spots.mirror} rotation={angle - 1.12} />

      {/* ---------------------------------------------------------- light */}
      {spots.flood.map((at, i) => (
        !GOFF.has('flood') && <Floodlight key={i} at={at} y={floorY} aim={[cx, cz]} />
      ))}
    </group>
  )
}

/** The bar or the dumbbells the player is holding, while they are holding them. */
function PlayerWeights() {
  // the workout lives outside React: re-render when a session starts or ends
  const [, force] = useState(0)
  useEffect(() => onWorkoutChange(() => force((n) => n + 1)), [])
  const holds = workout.station?.def.holds ?? null
  const yaw = workout.station?.yaw ?? 0
  if (holds === 'barbell') return <HeldBarbell hands={workout.hands} yaw={yaw} />
  if (holds === 'dumbbells') {
    return (
      <>
        <HeldDumbbell hand={workout.hands} side={0} />
        <HeldDumbbell hand={workout.hands} side={1} />
      </>
    )
  }
  if (holds === 'kettlebell') return <HeldKettlebell hands={workout.hands} />
  return null
}

const _kbMid = new Vector3()
const _kbDown = new Vector3()

/**
 * A cast-iron kettlebell held by its handle in both hands. The bell hangs
 * below the grip along the line of the arms, so it swings through the arc
 * with them rather than floating level.
 */
export function HeldKettlebell({ hands }: { hands: Hands }) {
  const ref = useRef<Group>(null)
  useFrame(() => {
    const g = ref.current
    if (!g) return
    const [l, r] = pair(hands)
    _kbMid.set((l.x + r.x) / 2, (l.y + r.y) / 2, (l.z + r.z) / 2)
    // the bell hangs away from the lifter's shoulders, down the arms' line
    _kbDown.set(0, -1, 0)
    g.position.copy(_kbMid).addScaledVector(_kbDown, 0.02)
    _shaft.set(r.x - l.x, 0, r.z - l.z)
    if (_shaft.lengthSq() > 1e-6) g.rotation.set(0, Math.atan2(-_shaft.z, _shaft.x), 0)
  })
  return (
    <group ref={ref} userData={{ noCollide: true }}>
      {/* the handle across both palms */}
      <mesh castShadow rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.017, 0.017, 0.15, 12]} />
        <meshStandardMaterial color="#1c1d20" roughness={0.45} metalness={0.7} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} castShadow position={[s * 0.075, -0.05, 0]} rotation={[0, 0, s * 0.3]}>
          <cylinderGeometry args={[0.017, 0.017, 0.1, 10]} />
          <meshStandardMaterial color="#1c1d20" roughness={0.45} metalness={0.7} />
        </mesh>
      ))}
      {/* the bell */}
      <mesh castShadow position={[0, -0.16, 0]}>
        <sphereGeometry args={[0.105, 20, 16]} />
        <meshStandardMaterial color="#17181b" roughness={0.6} metalness={0.5} />
      </mesh>
      <mesh position={[0, -0.255, 0]}>
        <cylinderGeometry args={[0.07, 0.07, 0.02, 20]} />
        <meshStandardMaterial color="#17181b" roughness={0.6} metalness={0.5} />
      </mesh>
    </group>
  )
}

/**
 * The changing corner against the back wall: a row of steel lockers with
 * vents and handles, a bench in front of them with towels folded on it, and
 * a gym bag on the floor. The lockers are where he changes: shirt on, or off.
 */
function ChangingCorner({ place, yaw, y }: {
  place: (lx: number, lz: number) => [number, number]; yaw: number; y: number
}) {
  const mats = useMemo(() => ({
    steel: new MeshStandardMaterial({ color: '#39424c', roughness: 0.45, metalness: 0.7 }),
    dark: new MeshStandardMaterial({ color: '#15181b', roughness: 0.6, metalness: 0.4 }),
    handle: new MeshStandardMaterial({ color: '#b9c0c7', roughness: 0.25, metalness: 1 }),
    wood: new MeshStandardMaterial({ color: '#8a6a4a', roughness: 0.8 }),
    towelA: new MeshStandardMaterial({ color: '#1de9b6', roughness: 1 }),
    towelB: new MeshStandardMaterial({ color: '#e9ecef', roughness: 1 }),
    bag: new MeshStandardMaterial({ color: '#141619', roughness: 0.75 }),
  }), [])
  const { at, bench, bag } = useMemo(() => ({
    at: place(-7.6, -6.55), bench: place(-7.6, -5.55), bag: place(-6.2, -5.9),
  }), [place])
  useEffect(() => {
    addCollider({ x: at[0], z: at[1], hx: 0.85, hz: 0.28, angle: yaw })
    addCollider({ x: bench[0], z: bench[1], hx: 0.7, hz: 0.2, angle: yaw })
    const [px, pz] = place(-7.6, -4.9)
    return registerInteractable({
      id: 'lockers', label: 'CHANGE OUTFIT', verb: 'OPEN',
      position: new Vector3(px, y + 1.1, pz), radius: 1.8, panel: null,
      action: () => {
        const s = useGlobalStore.getState()
        const next = s.outfit === 'shirt' ? 'shirtless' : 'shirt'
        s.setOutfit(next)
        s.showToast(next === 'shirt' ? 'COACH BLUE SHIRT' : 'SHIRT OFF', next === 'shirt' ? 'Team colours on' : 'Training in the sun')
      },
    })
  }, [at, bench, place, y, yaw])
  return (
    <group>
      <group position={[at[0], y, at[1]]} rotation={[0, yaw, 0]}>
        {[-0.6, -0.2, 0.2, 0.6].map((lx) => (
          <group key={lx} position={[lx, 0, 0]}>
            <mesh position={[0, 0.95, 0]} material={mats.steel} castShadow receiveShadow>
              <boxGeometry args={[0.39, 1.9, 0.5]} />
            </mesh>
            {/* door vents and handle, on the room side */}
            {[1.55, 1.62, 1.69].map((vy) => (
              <mesh key={vy} position={[0, vy, 0.252]} material={mats.dark}>
                <boxGeometry args={[0.24, 0.025, 0.005]} />
              </mesh>
            ))}
            <mesh position={[0.13, 1.0, 0.262]} material={mats.handle}>
              <boxGeometry args={[0.025, 0.14, 0.02]} />
            </mesh>
          </group>
        ))}
        <mesh position={[0, 1.93, 0]} material={mats.dark}>
          <boxGeometry args={[1.62, 0.06, 0.52]} />
        </mesh>
      </group>
      <group position={[bench[0], y, bench[1]]} rotation={[0, yaw, 0]}>
        <mesh position={[0, 0.44, 0]} material={mats.wood} castShadow receiveShadow>
          <boxGeometry args={[1.4, 0.05, 0.36]} />
        </mesh>
        {[-0.6, 0.6].map((lx) => (
          <mesh key={lx} position={[lx, 0.21, 0]} material={mats.dark} castShadow>
            <boxGeometry args={[0.05, 0.42, 0.32]} />
          </mesh>
        ))}
        {/* folded towels */}
        <mesh position={[-0.35, 0.5, 0]} material={mats.towelA} castShadow>
          <boxGeometry args={[0.34, 0.07, 0.24]} />
        </mesh>
        <mesh position={[-0.33, 0.565, 0.01]} material={mats.towelB} castShadow>
          <boxGeometry args={[0.32, 0.06, 0.22]} />
        </mesh>
        <mesh position={[0.4, 0.49, 0.02]} rotation={[0, 0.3, 0]} material={mats.towelB} castShadow>
          <boxGeometry args={[0.3, 0.05, 0.22]} />
        </mesh>
      </group>
      {/* a holdall on the floor, zip along the top */}
      <group position={[bag[0], y, bag[1]]} rotation={[0, yaw + 0.4, 0]}>
        <mesh position={[0, 0.16, 0]} rotation={[0, 0, Math.PI / 2]} material={mats.bag} castShadow receiveShadow>
          <capsuleGeometry args={[0.15, 0.42, 6, 14]} />
        </mesh>
        <mesh position={[0, 0.31, 0]} material={mats.towelA}>
          <boxGeometry args={[0.5, 0.012, 0.02]} />
        </mesh>
      </group>
    </group>
  )
}

/**
 * The back wall: his own training footage playing between the before/after
 * photographs the site publishes. Both are the real files, not stand-ins.
 */
function MediaWall({
  at, yaw, y, place,
}: {
  at: [number, number]; yaw: number; y: number
  place: (lx: number, lz: number) => [number, number]
}) {
  useEffect(() => {
    // one solid box along the whole wall: a row of circles leaves gaps you
    // can walk through
    const p = place(0, -7.0)
    addCollider({ x: p[0], z: p[1], hx: 10.4, hz: 0.25, angle: yaw })
  }, [place, yaw])

  const photos = transformations.slice(0, 4)

  return (
    <group>
      {/* corrugated steel back wall */}
      <mesh position={[at[0], y + 2.4, at[1]]} rotation={[0, yaw, 0]} receiveShadow castShadow>
        <boxGeometry args={[20.6, 4.8, 0.22]} />
        <meshStandardMaterial color="#20252a" roughness={0.68} metalness={0.35} />
      </mesh>
      {/* uprights, to break the slab up */}
      {[-9, -4.5, 0, 4.5, 9].map((lx) => {
        const p = place(lx, -7.05)
        return (
          <mesh key={lx} position={[p[0], y + 2.5, p[1]]} rotation={[0, yaw, 0]} castShadow>
            <boxGeometry args={[0.18, 5, 0.32]} />
            <meshStandardMaterial color="#2b3137" roughness={0.6} metalness={0.4} />
          </mesh>
        )
      })}

      <VideoScreen src="/video/training.mp4" position={place(-4.6, -6.7)} rotation={yaw} height={2.9} />
      <VideoScreen src="/video/coach-talk.mp4" position={place(4.6, -6.7)} rotation={yaw} height={2.9} />

      {photos.map((t, i) => (
        <PhotoFrame
          key={t.src}
          src={t.src}
          index={i}
          position={place(-1.65 + (i % 2) * 3.3, -6.72)}
          rotation={yaw}
          height={1.5}
          lift={i < 2 ? 3.3 : 1.55}
        />
      ))}
    </group>
  )
}

useGLTF.preload('/models/gym_rack.glb')
useGLTF.preload('/models/gym_bench.glb')
useGLTF.preload('/models/gym_barbell.glb')
useGLTF.preload('/models/gym_dumbbells.glb')
useGLTF.preload('/models/gym_cable.glb')
useGLTF.preload('/models/client-a.glb')
useGLTF.preload('/models/client-b.glb')
useGLTF.preload('/models/client-c.glb')
