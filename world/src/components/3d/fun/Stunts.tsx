import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Text } from '@react-three/drei'
import {
  BufferGeometry, Float32BufferAttribute, LatheGeometry, Mesh, MeshStandardMaterial, Vector2, Vector3,
} from 'three'
import { addPlatform, baseGround, groundHeight } from '../../../lib/terrain'
import { locationById } from '../../../data/journey'
import { useStore } from '../../../state/store'
import { cue } from '../../../lib/audio'
import { onCarLanding, vehicle } from '../../../systems/VehicleController'
import { addBody, makeBox, type Body } from '../../../systems/Physics'
import { DISPLAY_FONT } from '../Props'
import { useParkMaterials } from './common'

/**
 * The Stunt Yard: a levelled lot off the road for the car. A kicker ramp for
 * air (distance and hang time, best kept), a painted ring with cones for
 * handbrake donuts, ten giant bowling pins, and a stack of crates to drive
 * straight through. Everything that gets hit is a real body in Physics.
 */
const YARD = locationById.stunts.pos
const yw = (lx: number, lz: number): [number, number] => [YARD[0] + lx, YARD[1] + lz]
const toast = (t: string, s?: string) => useStore.getState().showToast(t, s)

// the kicker: launches towards +x, lip at local x = RAMP.x + RAMP.len / 2
const RAMP = { x: -9, z: -4, len: 6.4, w: 3.6, rise: 1.35 }
const RING = { x: 9, z: 9, r: 6 }
const LANE = { x: 9, z: -9 }            // pins stand here, the car comes from -x
const CRATES = { x: -8, z: 11 }

function wedgeGeometry(w: number, len: number, rise: number) {
  // a solid wedge: low at -z, the lip at +z
  const hw = w / 2, hl = len / 2
  const v = [
    [-hw, 0, -hl], [hw, 0, -hl], [hw, 0, hl], [-hw, 0, hl],     // base
    [-hw, rise, hl], [hw, rise, hl],                             // lip
  ]
  const tri = [
    [0, 4, 3], [0, 3, 2], [0, 2, 1],        // (the base, never seen)
    [0, 1, 5], [0, 5, 4],                   // the driving surface
    [3, 4, 5], [3, 5, 2],                   // the face under the lip
    [0, 3, 4], [1, 5, 2],                   // the sides
  ]
  const pos: number[] = [], uv: number[] = []
  for (const t of tri) for (const i of t) { pos.push(...v[i]); uv.push(v[i][0] / w + 0.5, v[i][2] / len + 0.5) }
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2))
  g.computeVertexNormals()
  return g
}

function pinGeometry() {
  // a tenpin's profile, scaled up to 1.1 m
  const P = [[0, 0], [0.11, 0], [0.15, 0.1], [0.19, 0.28], [0.18, 0.42], [0.12, 0.6], [0.075, 0.72], [0.08, 0.84], [0.1, 0.95], [0.085, 1.05], [0.04, 1.1], [0, 1.11]]
  return new LatheGeometry(P.map(([r, y]) => new Vector2(r, y)), 20)
}

type Prop = { body: Body; home: Vector3; mesh: Mesh | null }

function useProps(spots: { x: number; z: number; y?: number }[], half: [number, number, number], mass: number) {
  const props = useMemo<Prop[]>(() => spots.map(({ x, z, y }) => {
    const body = makeBox(half[0], half[1], half[2], mass)
    const home = new Vector3(x, y ?? groundHeight(x, z), z)
    body.p.copy(home)
    return { body, home, mesh: null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [])
  useEffect(() => {
    const offs = props.map((p) => addBody(p.body))
    return () => offs.forEach((o) => o())
  }, [props])
  useFrame(() => {
    for (const p of props) {
      if (!p.mesh) continue
      p.mesh.position.copy(p.body.p)
      p.mesh.quaternion.copy(p.body.q)
    }
  })
  const reset = () => props.forEach((p) => {
    p.body.p.copy(p.home); p.body.q.identity(); p.body.v.set(0, 0, 0); p.body.w.set(0, 0, 0); p.body.awake = false
  })
  return { props, reset }
}
const _up = new Vector3()
const toppled = (b: Body, home: Vector3) =>
  _up.set(0, 1, 0).applyQuaternion(b.q).y < 0.75 || Math.hypot(b.p.x - home.x, b.p.z - home.z) > 0.5

// ---------------------------------------------------------------- the kicker
function Kicker() {
  const m = useParkMaterials()
  const [x, z] = yw(RAMP.x, RAMP.z)
  const g = baseGround(x, z)
  const geo = useMemo(() => wedgeGeometry(RAMP.w, RAMP.len, RAMP.rise), [])
  useEffect(() => addPlatform({ x, z, hx: RAMP.w / 2, hz: RAMP.len / 2, angle: Math.PI / 2, top: g, rise: RAMP.rise }), [x, z, g])
  // the jump, measured from where the wheels leave to where they land
  const launch = useRef<{ x: number; z: number; t: number } | null>(null)
  const best = useRef(0)
  useFrame(() => {
    if (vehicle.air && !launch.current) launch.current = { x: vehicle.pos.x, z: vehicle.pos.z, t: performance.now() }
  })
  useEffect(() => onCarLanding((l) => {
    const L = launch.current
    launch.current = null
    if (!L || Math.hypot(L.x - YARD[0], L.z - YARD[1]) > 40) return
    const d = Math.hypot(l.x - L.x, l.z - L.z)
    if (d < 4) return
    const rec = d > best.current
    if (rec) best.current = d
    toast(rec && best.current > 8 ? `NEW RECORD · ${d.toFixed(1)} M` : `STUNT JUMP · ${d.toFixed(1)} M`,
      `${l.airTime.toFixed(2)} s of air${l.impact > 7 ? ' · hard landing!' : ''}`)
    if (rec) cue('discover')
  }), [])
  return (
    // a platform you drive up, not a wall: the collider scan leaves it alone
    <group position={[x, g, z]} rotation={[0, Math.PI / 2, 0]} userData={{ noCollide: true }}>
      <mesh geometry={geo} material={m.timber} castShadow receiveShadow />
      {/* hazard chevrons on the lip, and steel edging */}
      {[-1.2, -0.4, 0.4, 1.2].map((cx, i) => (
        <mesh key={cx} position={[cx, RAMP.rise + 0.005, RAMP.len / 2 - 0.25]} rotation={[-Math.PI / 2 + Math.atan2(RAMP.rise, RAMP.len), 0, 0]} material={i % 2 ? m.black : m.yellow}>
          <planeGeometry args={[0.8, 0.4]} />
        </mesh>
      ))}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * (RAMP.w / 2 - 0.04), RAMP.rise / 2 - 0.02, 0]} rotation={[Math.atan2(RAMP.rise, RAMP.len), 0, 0]} material={m.steel}>
          <boxGeometry args={[0.08, 0.06, Math.hypot(RAMP.len, RAMP.rise)]} />
        </mesh>
      ))}
    </group>
  )
}

// ---------------------------------------------------------------- donuts
function DonutRing() {
  const m = useParkMaterials()
  const [cx, cz] = yw(RING.x, RING.z)
  const g = groundHeight(cx, cz)
  const cones = useProps(Array.from({ length: 10 }, (_, i) => {
    const a = (i / 10) * Math.PI * 2
    return { x: cx + Math.cos(a) * (RING.r + 0.6), z: cz + Math.sin(a) * (RING.r + 0.6) }
  }), [0.17, 0.26, 0.17], 2)
  const spin = useRef({ acc: 0, n: 0, lastYaw: 0, idle: 0 })
  useFrame((_, dt) => {
    const S = spin.current
    const inRing = vehicle.occupied && Math.hypot(vehicle.pos.x - cx, vehicle.pos.z - cz) < RING.r + 1
    let d = vehicle.yaw - S.lastYaw
    S.lastYaw = vehicle.yaw
    d = Math.atan2(Math.sin(d), Math.cos(d))
    if (inRing && vehicle.handbrake && Math.abs(vehicle.speed) > 3) {
      S.acc += Math.abs(d)
      S.idle = 0
      if (S.acc >= Math.PI * 2) {
        S.acc -= Math.PI * 2
        S.n++
        toast(S.n === 1 ? 'DONUT!' : `DONUTS ×${S.n}`, S.n >= 5 ? 'The tyres are begging you to stop' : 'Keep the handbrake on (Space)')
      }
    } else {
      S.idle += dt
      if (S.idle > 2) { S.acc = 0; S.n = 0 }
    }
  })
  return (
    <group>
      <mesh position={[cx, g + 0.035, cz]} rotation={[-Math.PI / 2, 0, 0]} material={m.white}><ringGeometry args={[RING.r - 0.15, RING.r, 64]} /></mesh>
      <Text font={DISPLAY_FONT} fontSize={1.1} position={[cx, g + 0.04, cz]} rotation={[-Math.PI / 2, 0, 0]} color="#efefea" anchorX="center" anchorY="middle">DONUTS</Text>
      {cones.props.map((p, i) => (
        <mesh key={i} ref={(el) => { p.mesh = el }} castShadow userData={{ noCollide: true }}>
          <coneGeometry args={[0.17, 0.52, 14]} />
          <meshStandardMaterial color="#f2621f" roughness={0.6} />
        </mesh>
      ))}
    </group>
  )
}

// ---------------------------------------------------------------- car bowling
function Bowling() {
  const m = useParkMaterials()
  const [px, pz] = yw(LANE.x, LANE.z)
  const g = groundHeight(px, pz)
  // the classic triangle, the head pin towards the approaching car (-x)
  const spots = useMemo(() => {
    const out: { x: number; z: number }[] = []
    for (let row = 0; row < 4; row++) for (let k = 0; k <= row; k++) {
      out.push({ x: px + row * 0.9, z: pz + (k - row / 2) * 1.05 })
    }
    return out
  }, [px, pz])
  const pins = useProps(spots, [0.17, 0.55, 0.17], 4)
  const geo = useMemo(() => pinGeometry(), [])
  const frame = useRef({ hitAt: 0, scored: false })
  useFrame(() => {
    const F = frame.current
    const anyDown = pins.props.some((p) => p.body.awake || toppled(p.body, p.home))
    if (anyDown && !F.hitAt) F.hitAt = performance.now()
    if (!F.hitAt) return
    const t = (performance.now() - F.hitAt) / 1000
    if (t > 4 && !F.scored) {
      F.scored = true
      const down = pins.props.filter((p) => toppled(p.body, p.home)).length
      toast(down === 10 ? 'STRIKE!' : down >= 7 ? `${down} PINS` : down === 0 ? 'GUTTER BALL' : `${down} PIN${down > 1 ? 'S' : ''}`,
        down === 10 ? 'All ten, with a two-tonne ball' : 'They reset in a moment — go again')
      if (down === 10) cue('discover')
    }
    if (t > 8) {
      pins.reset()
      F.hitAt = 0
      F.scored = false
    }
  })
  const [lx, lz] = yw(LANE.x - 9, LANE.z)
  return (
    <group>
      {/* the lane: boards and gutters painted on the tarmac */}
      <mesh position={[lx + 2.5, g + 0.03, lz]} rotation={[-Math.PI / 2, 0, 0]} material={m.timber} receiveShadow><planeGeometry args={[23, 4.6]} /></mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[lx + 2.5, g + 0.035, lz + s * 2.45]} rotation={[-Math.PI / 2, 0, 0]} material={m.black}><planeGeometry args={[23, 0.3]} /></mesh>
      ))}
      {[-1.2, -0.6, 0, 0.6, 1.2].map((o) => (
        <mesh key={o} position={[lx - 3 + Math.abs(o) * 0.8, g + 0.036, lz + o]} rotation={[-Math.PI / 2, 0, Math.PI / 2]} material={m.red}><circleGeometry args={[0.18, 3]} /></mesh>
      ))}
      {pins.props.map((p, i) => (
        <group key={i} ref={(el) => { p.mesh = el as unknown as Mesh }} userData={{ noCollide: true }}>
          <mesh geometry={geo} material={m.white} castShadow />
          <mesh position={[0, 0.8, 0]} material={m.red}><cylinderGeometry args={[0.083, 0.078, 0.05, 20]} /></mesh>
          <mesh position={[0, 0.9, 0]} material={m.red}><cylinderGeometry args={[0.099, 0.097, 0.04, 20]} /></mesh>
        </group>
      ))}
    </group>
  )
}

// ---------------------------------------------------------------- crates
function CrateStack() {
  const m = useParkMaterials()
  const [cx, cz] = yw(CRATES.x, CRATES.z)
  const g = groundHeight(cx, cz)
  const S = 0.62
  const spots = useMemo(() => {
    const out: { x: number; z: number; y: number }[] = []
    // a pyramid wall across the car's path (it comes up the yard along z): 5, 4, 3, 2, 1
    for (let row = 0; row < 5; row++) for (let k = 0; k < 5 - row; k++) {
      out.push({ x: cx + (k - (4 - row) / 2) * (S + 0.02), z: cz, y: g + row * S })
    }
    return out
  }, [cx, cz, g])
  const crates = useProps(spots, [S / 2, S / 2, S / 2], 14)
  const since = useRef(0)
  useFrame((_, dt) => {
    // once it has been knocked down and everything has settled, restack it
    const scattered = crates.props.some((p) => Math.hypot(p.body.p.x - p.home.x, p.body.p.z - p.home.z) > 0.4)
    const settled = !crates.props.some((p) => p.body.awake)
    const far = Math.hypot(vehicle.pos.x - cx, vehicle.pos.z - cz) > 14
    since.current = scattered && settled && far ? since.current + dt : 0
    if (since.current > 10) { crates.reset(); since.current = 0 }
  })
  return (
    <group>
      {crates.props.map((p, i) => (
        <group key={i} ref={(el) => { p.mesh = el as unknown as Mesh }} userData={{ noCollide: true }}>
          <mesh position={[0, S / 2, 0]} material={m.timber} castShadow receiveShadow><boxGeometry args={[S, S, S]} /></mesh>
          {/* the slats' dark gaps and a stencil */}
          <mesh position={[0, S / 2, 0]} material={m.leather}><boxGeometry args={[S * 1.004, 0.03, S * 1.004]} /></mesh>
        </group>
      ))}
    </group>
  )
}

// ---------------------------------------------------------------- the yard
export function StuntYard() {
  const m = useParkMaterials()
  const g = groundHeight(YARD[0], YARD[1])
  const tarmac = useMemo(() => new MeshStandardMaterial({ color: '#2a2c2e', roughness: 0.92, polygonOffset: true, polygonOffsetFactor: -2 }), [])
  const [sx, sz] = yw(-17, -15)
  return (
    <group>
      <mesh position={[YARD[0], g + 0.025, YARD[1]]} rotation={[-Math.PI / 2, 0, 0]} material={tarmac} receiveShadow>
        <circleGeometry args={[21, 64]} />
      </mesh>
      <Kicker />
      <DonutRing />
      <Bowling />
      <CrateStack />
      {/* the sign */}
      <group position={[sx, groundHeight(sx, sz), sz]} rotation={[0, Math.PI / 4, 0]}>
        {[-1.6, 1.6].map((x) => <mesh key={x} position={[x, 1.6, 0]} material={m.steel} castShadow><cylinderGeometry args={[0.07, 0.07, 3.2, 8]} /></mesh>)}
        <mesh position={[0, 3.1, 0]} material={m.black} castShadow><boxGeometry args={[4.2, 1.3, 0.1]} /></mesh>
        <Text font={DISPLAY_FONT} fontSize={0.72} position={[0, 3.18, 0.06]} color="#f2c14e" anchorX="center" anchorY="middle">STUNT YARD</Text>
        <Text font={DISPLAY_FONT} fontSize={0.24} position={[0, 2.68, 0.06]} color="#efefea" anchorX="center" anchorY="middle">RAMP · DONUTS · CAR BOWLING · CRATES</Text>
      </group>
    </group>
  )
}

