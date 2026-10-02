import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  CatmullRomCurve3, Group, Mesh, TubeGeometry, Vector3,
} from 'three'
import { player } from '../../../state/store'
import { gymSound } from '../../../lib/audio'
import { repRate, TYRE_FLIP_STEP, kickupsBall } from '../../../systems/ExercisePose'
import { workout, showResult } from '../../../systems/Workout'
import { ph, pw, onStation, useStation, type ParkMats } from './common'

const TAU = Math.PI * 2
const fr = (x: number) => x - Math.floor(x)
const sm = (a: number, b: number, t: number) => { const k = Math.min(1, Math.max(0, (t - a) / (b - a))); return k * k * (3 - 2 * k) }
const _a = new Vector3(), _b = new Vector3(), _c = new Vector3()

/** A tube along a set of points, rebuilt in place (ropes). */
function useTube(radius: number, segs = 32) {
  const ref = useRef<Mesh>(null)
  const set = (pts: Vector3[]) => {
    const m = ref.current
    if (!m) return
    const g = new TubeGeometry(new CatmullRomCurve3(pts), segs, radius, 5, false)
    // same segment count every time, so after the first build the new shape
    // is copied into the buffers already on the GPU instead of replacing them
    const old = m.geometry
    const pos = old.attributes.position
    if (pos && pos.count === g.attributes.position.count) {
      ;(pos.array as Float32Array).set(g.attributes.position.array as Float32Array)
      ;(old.attributes.normal.array as Float32Array).set(g.attributes.normal.array as Float32Array)
      pos.needsUpdate = true
      old.attributes.normal.needsUpdate = true
      old.computeBoundingSphere()
      g.dispose()
      return
    }
    old.dispose()
    m.geometry = g
  }
  return { ref, set }
}

// ---------------------------------------------------------------- heavy bag
export function HeavyBag({ m }: { m: ParkMats }) {
  const LX = -12, LZ = -8
  useStation({ id: 'fp-bag', def: 'punch_bag', lx: LX, lz: LZ, yaw: 0, label: 'HIT THE HEAVY BAG' })
  const [x, z] = pw(LX, LZ + 0.78)
  const y = ph(LX, LZ)
  const bag = useRef<Group>(null)
  const swing = useRef({ a: 0, v: 0, last: 0 })
  useFrame((_, dt) => {
    const s = swing.current
    if (onStation('fp-bag')) {
      // the punch lands at the top of its extension: the bag takes it
      const cyc = (workout.phase * repRate('punch')) / TAU
      const t = fr(cyc)
      const ext = t < 0.35 ? sm(0, 0.35, t) : 1 - sm(0.35, 1, t)
      if (ext > 0.92 && s.last <= 0.92) { s.v += 1.1; gymSound('drop', 0.8) }
      s.last = ext
    }
    s.v += (-s.a * 9.8 / 1.4 - s.v * 1.2) * dt
    s.a += s.v * dt
    if (bag.current) bag.current.rotation.x = s.a
  })
  return (
    <group position={[x, y, z]}>
      {/* the A-frame and its beam */}
      {[-1, 1].map((sd) => (
        <group key={sd}>
          <mesh position={[sd * 0.9, 1.3, -0.35]} rotation={[0.25, 0, 0]} material={m.steel} castShadow><boxGeometry args={[0.07, 2.7, 0.07]} /></mesh>
          <mesh position={[sd * 0.9, 1.3, 0.35]} rotation={[-0.25, 0, 0]} material={m.steel} castShadow><boxGeometry args={[0.07, 2.7, 0.07]} /></mesh>
        </group>
      ))}
      <mesh position={[0, 2.62, 0]} material={m.steel} castShadow><boxGeometry args={[1.9, 0.08, 0.08]} /></mesh>
      <group ref={bag} position={[0, 2.58, 0]} userData={{ noCollide: true }}>
        <mesh position={[0, -0.25, 0]} material={m.chrome}><cylinderGeometry args={[0.008, 0.008, 0.5, 5]} /></mesh>
        <mesh position={[0, -1.05, 0]} material={m.leather} castShadow><cylinderGeometry args={[0.19, 0.19, 1.1, 20]} /></mesh>
        <mesh position={[0, -0.5, 0]} material={m.leather}><sphereGeometry args={[0.19, 20, 8, 0, TAU, 0, Math.PI / 2]} /></mesh>
        <mesh position={[0, -1.6, 0]} rotation={[Math.PI, 0, 0]} material={m.leather}><sphereGeometry args={[0.19, 20, 8, 0, TAU, 0, Math.PI / 2]} /></mesh>
        <mesh position={[0, -1.05, 0]} material={m.red}><cylinderGeometry args={[0.192, 0.192, 0.12, 20]} /></mesh>
      </group>
    </group>
  )
}

// ---------------------------------------------------------------- skipping
export function SkipRope({ m }: { m: ParkMats }) {
  const LX = -8, LZ = -8
  useStation({ id: 'fp-skip', def: 'skip_rope', lx: LX, lz: LZ, yaw: 0, label: 'SKIPPING ROPE' })
  const tube = useTube(0.008, 36)
  const [x, z] = pw(LX, LZ)
  const y = ph(LX, LZ)
  useFrame(() => {
    const mesh = tube.ref.current
    if (!mesh) return
    const on = onStation('fp-skip')
    mesh.visible = on
    if (!on) return
    const [l, r] = workout.hands
    const a = fr((workout.phase * repRate('skip')) / TAU) * TAU
    // the rope's loop turns round him: over the head, under the feet
    _a.addVectors(l, r).multiplyScalar(0.5)
    const cx = x, cz = z
    const R = 1.05
    const f = Math.sin(workout.station!.yaw), fz = Math.cos(workout.station!.yaw)
    const apex = (off: number) => {
      const ang = a + off
      return new Vector3(cx + f * Math.sin(ang) * 0.55, y + 0.95 + Math.cos(ang) * R, cz + fz * Math.sin(ang) * 0.55)
    }
    _b.subVectors(r, l)
    const p1 = apex(-0.35).addScaledVector(_b, -0.25)
    const p2 = apex(0.35).addScaledVector(_b, 0.25)
    tube.set([l.clone(), p1, apex(0), p2, r.clone()])
  })
  return (
    <group>
      <mesh position={[x, y + 0.01, z]} rotation={[-Math.PI / 2, 0, 0]} material={m.rubber} receiveShadow><planeGeometry args={[1.6, 1.6]} /></mesh>
      <mesh ref={tube.ref} material={m.black} userData={{ noCollide: true }}><bufferGeometry /></mesh>
    </group>
  )
}

// ---------------------------------------------------------------- mats
function Mat({ lx, lz, w, d, mat, yaw = 0 }: { lx: number; lz: number; w: number; d: number; mat: ParkMats[keyof ParkMats]; yaw?: number }) {
  const [x, z] = pw(lx, lz)
  return (
    <mesh position={[x, ph(lx, lz) + 0.012, z]} rotation={[0, yaw, 0]} material={mat} receiveShadow>
      <boxGeometry args={[w, 0.02, d]} />
    </mesh>
  )
}

export function FloorWork({ m }: { m: ParkMats }) {
  useStation({ id: 'fp-jacks', def: 'jumping_jacks', lx: -4, lz: -8, yaw: 0, label: 'JUMPING JACKS' })
  useStation({ id: 'fp-burpee', def: 'burpees', lx: 0, lz: -8.6, yaw: 0, label: 'BURPEES' })
  useStation({ id: 'fp-situp', def: 'sit_ups', lx: 4, lz: -8.6, yaw: 0, label: 'SIT-UPS' })
  useStation({ id: 'fp-plank', def: 'plank_hold', lx: 8, lz: -8.2, yaw: 0, label: 'HOLD A PLANK' })
  return (
    <group>
      <Mat lx={-4} lz={-8} w={1.4} d={1.4} mat={m.matBlue} />
      <Mat lx={0} lz={-8} w={1.0} d={2.4} mat={m.matGreen} />
      <Mat lx={4} lz={-8} w={0.9} d={2.0} mat={m.matPurple} />
      <Mat lx={8} lz={-8} w={0.9} d={2.2} mat={m.matBlue} />
    </group>
  )
}

// ---------------------------------------------------------------- box jumps
export function PlyoBox({ m }: { m: ParkMats }) {
  const LX = 12, LZ = -8.7
  useStation({ id: 'fp-box', def: 'box_jump', lx: LX, lz: LZ, yaw: 0, label: 'BOX JUMPS' })
  const [x, z] = pw(LX, LZ + 0.7 + 0.25)
  const y = ph(LX, LZ)
  return (
    <group position={[x, y, z]} userData={{ noCollide: true }}>
      <mesh position={[0, 0.275, 0]} material={m.timber} castShadow receiveShadow><boxGeometry args={[0.75, 0.55, 0.5]} /></mesh>
      <mesh position={[0, 0.552, 0]} material={m.rubber}><boxGeometry args={[0.72, 0.006, 0.47]} /></mesh>
    </group>
  )
}

// ---------------------------------------------------------------- battle ropes
export function BattleRopes({ m }: { m: ParkMats }) {
  const LX = -14, LZ = 0
  const yaw = -Math.PI / 2
  useStation({ id: 'fp-ropes', def: 'battle_ropes', lx: LX, lz: LZ, yaw, label: 'BATTLE ROPES' })
  const [ax, az] = pw(LX - 6.5, LZ)
  const ay = ph(LX - 6.5, LZ)
  const left = useTube(0.022, 40), right = useTube(0.022, 40)
  const rest = useMemo(() => {
    const [x, z] = pw(LX - 0.45, LZ)
    return [new Vector3(x, ph(LX, LZ) + 0.1, z - 0.22), new Vector3(x, ph(LX, LZ) + 0.1, z + 0.22)]
  }, [])
  const atRest = useRef(false)
  useFrame(() => {
    const on = onStation('fp-ropes')
    // lying still on the ground, the ropes only need building once
    if (!on && atRest.current) return
    atRest.current = !on && !!left.ref.current && !!right.ref.current
    const t = workout.phase * repRate('ropes')
    for (const [side, tube] of [[0, left], [1, right]] as const) {
      const hand = on ? workout.hands[side] : rest[side]
      const pts: Vector3[] = []
      for (let i = 0; i <= 10; i++) {
        const k = i / 10
        const p = new Vector3(ax, ay + 0.35, az + (side ? 0.12 : -0.12)).lerp(hand, 1 - k)
        // waves run down the rope from the hands, dying away
        const wave = on ? Math.sin(t + (side ? Math.PI : 0) - k * 9) * 0.22 * (1 - k) : 0
        p.y += wave - Math.sin(k * Math.PI) * 0.1
        p.y = Math.max(p.y, ph(LX - 6.5 * k, LZ) + 0.03)
        pts.push(p)
      }
      tube.set(pts)
    }
  })
  return (
    <group>
      <mesh position={[ax, ay + 0.35, az]} material={m.steel} castShadow><cylinderGeometry args={[0.09, 0.11, 0.7, 12]} /></mesh>
      <mesh ref={left.ref} material={m.black} castShadow userData={{ noCollide: true }}><bufferGeometry /></mesh>
      <mesh ref={right.ref} material={m.black} castShadow userData={{ noCollide: true }}><bufferGeometry /></mesh>
    </group>
  )
}

// ---------------------------------------------------------------- tyre flip
/** A tractor tyre: a fat torus with blocky tread. */
function TractorTyre({ m, r = 0.7, tube = 0.24 }: { m: ParkMats; r?: number; tube?: number }) {
  return (
    <group>
      <mesh rotation={[Math.PI / 2, 0, 0]} material={m.rubber} castShadow receiveShadow scale={[1, 1, 0.72]}>
        <torusGeometry args={[r, tube, 14, 36]} />
      </mesh>
      {Array.from({ length: 18 }, (_, i) => {
        const a = (i / 18) * TAU
        return (
          <mesh key={i} position={[Math.cos(a) * (r + tube * 0.85), 0, Math.sin(a) * (r + tube * 0.85)]} rotation={[0, -a, 0]} material={m.black}>
            <boxGeometry args={[0.08, tube * 1.15, 0.2]} />
          </mesh>
        )
      })}
    </group>
  )
}

const FLIP_LX = -9, FLIP_LZ = 0, FLIPS = 6
export function TyreFlip({ m }: { m: ParkMats }) {
  const yaw = Math.PI / 2           // along +x
  const done = useRef(0)            // flips completed in this lane
  const station = useStation({
    id: 'fp-flip', def: 'tyre_flip', lx: FLIP_LX, lz: FLIP_LZ, yaw, label: 'FLIP THE TYRE',
    extra: {
      onRep: () => {
        // step on to where the tyre now lies
        done.current++
        if (done.current >= FLIPS) {
          showResult(`${FLIPS} FLIPS · LANE DONE`, 0)
          done.current = 0
          const [x, z] = pw(FLIP_LX, FLIP_LZ)
          station.spot = [x, z]
        } else {
          station.spot = [station.spot[0] + TYRE_FLIP_STEP, station.spot[1]]
        }
        player.pos.set(station.spot[0], player.pos.y, station.spot[1])
      },
    },
  })
  const tyre = useRef<Group>(null)
  const R = 0.7 + 0.24 * 0.72     // outer radius lying flat
  useFrame(() => {
    const g = tyre.current
    if (!g) return
    let flip = 0
    if (onStation('fp-flip')) {
      const t = fr((workout.phase * repRate('tyreflip')) / TAU)
      flip = t < 0.28 ? 0 : t < 0.5 ? sm(0.28, 0.5, t) * 0.33 : t < 0.66 ? 0.33 + sm(0.5, 0.66, t) * 0.3 : t < 0.8 ? 0.63 + sm(0.66, 0.8, t) * 0.37 : 1
    }
    // flat in front of him, then turned over about its far edge
    const near = FLIP_LX + done.current * TYRE_FLIP_STEP + 0.45 + R
    const pivot = near + R
    const th = flip * Math.PI
    const [x0, z0] = pw(pivot, FLIP_LZ)
    const y = ph(near, FLIP_LZ) + 0.02
    // centre relative to the pivot: (-R, 0) rotated by th about the z axis
    g.position.set(x0 - R * Math.cos(th), y + R * Math.sin(th) + 0.17 * Math.cos(th), z0)
    g.rotation.set(0, 0, -th)
  })
  return (
    <group>
      <group ref={tyre} userData={{ noCollide: true }}><TractorTyre m={m} /></group>
      {/* the lane: two painted lines on the grass */}
      {[-1.2, 1.2].map((o) => {
        const [x, z] = pw(FLIP_LX + FLIPS * TYRE_FLIP_STEP / 2 + 0.9, FLIP_LZ + o)
        return (
          <mesh key={o} position={[x, ph(FLIP_LX, FLIP_LZ) + 0.015, z]} rotation={[-Math.PI / 2, 0, 0]} material={m.white}>
            <planeGeometry args={[FLIPS * TYRE_FLIP_STEP + 2, 0.08]} />
          </mesh>
        )
      })}
    </group>
  )
}

// ---------------------------------------------------------------- sledgehammer
/** A sledgehammer held in the player's hands (lead hand high on the handle). */
function Sledge({ m, id, visible }: { m: ParkMats; id: string; visible?: () => boolean }) {
  const ref = useRef<Group>(null)
  useFrame(() => {
    const g = ref.current
    if (!g) return
    const on = onStation(id)
    g.visible = on && (visible ? visible() : true)
    if (!g.visible) return
    const [l, r] = workout.hands
    // the handle runs from the left hand through the right and on to the head
    _a.subVectors(r, l)
    if (_a.lengthSq() < 1e-6) return
    _a.normalize()
    g.position.copy(l).addScaledVector(_a, -0.08)
    g.quaternion.setFromUnitVectors(_c.set(0, 1, 0), _a)
  })
  return (
    <group ref={ref} userData={{ noCollide: true }}>
      <mesh position={[0, 0.45, 0]} material={m.timber} castShadow><cylinderGeometry args={[0.018, 0.02, 0.9, 8]} /></mesh>
      <mesh position={[0, 0.92, 0]} rotation={[0, 0, Math.PI / 2]} material={m.steel} castShadow><boxGeometry args={[0.1, 0.24, 0.1]} /></mesh>
    </group>
  )
}

export function HammerTyre({ m }: { m: ParkMats }) {
  const LX = 4, LZ = 0
  useStation({ id: 'fp-hammer', def: 'sledgehammer', lx: LX, lz: LZ, yaw: 0, label: 'SLEDGEHAMMER' })
  const [x, z] = pw(LX, LZ + 1.25)
  const last = useRef(0)
  useFrame(() => {
    if (!onStation('fp-hammer')) return
    const t = fr((workout.phase * repRate('hammer')) / TAU)
    if (t > 0.58 && last.current <= 0.58) gymSound('drop', 1)
    last.current = t
  })
  return (
    <group>
      <group position={[x, ph(LX, LZ + 1.25) + 0.17, z]}><TractorTyre m={m} /></group>
      <Sledge m={m} id="fp-hammer" />
    </group>
  )
}

// ---------------------------------------------------------------- high striker
export function HighStriker({ m }: { m: ParkMats }) {
  const LX = 9, LZ = 0, H = 5
  const puck = useRef<Mesh>(null)
  const bell = useRef<Group>(null)
  const state = useRef({ h: 0, v: 0, ring: 0, peak: 0 })
  useStation({
    id: 'fp-striker', def: 'high_striker', lx: LX, lz: LZ, yaw: 0, label: 'HIGH STRIKER',
    extra: {
      sweet: [0.86, 0.98],
      onRelease: (power) => {
        // a hard, well-timed blow sends the puck up the tower
        const hit = Math.max(0, 1 - Math.abs(power - 0.92) * 2.2)
        state.current.v = 3 + hit * 8.4
        state.current.peak = 0
        gymSound('drop', 1)
        window.setTimeout(() => {
          const top = state.current.peak
          if (top > H - 0.35) { state.current.ring = 1.5; showResult('DING! STRONGMAN', 50) }
          else showResult(`${Math.round((top / H) * 100)}% · SWING HARDER`, Math.round(top * 4))
        }, 1100)
      },
    },
  })
  const [x, z] = pw(LX, LZ + 0.95)
  const y = ph(LX, LZ)
  useFrame((_, dt) => {
    const s = state.current
    s.v -= 9.8 * dt
    s.h = Math.max(0, Math.min(H - 0.3, s.h + s.v * dt))
    s.peak = Math.max(s.peak, s.h)
    if (s.h <= 0 && s.v < 0) s.v = 0
    if (s.h >= H - 0.3 && s.v > 0) s.v = -s.v * 0.2
    if (puck.current) puck.current.position.y = 0.4 + s.h
    s.ring = Math.max(0, s.ring - dt)
    if (bell.current) bell.current.rotation.z = Math.sin(s.ring * 30) * 0.3 * s.ring
  })
  return (
    <group>
      <group position={[x, y, z]}>
        <mesh position={[0, H / 2, -0.12]} material={m.red} castShadow><boxGeometry args={[0.3, H, 0.08]} /></mesh>
        {Array.from({ length: 10 }, (_, i) => (
          <mesh key={i} position={[0, 0.5 + i * 0.45, -0.075]} material={i % 2 ? m.yellow : m.white}><boxGeometry args={[0.28, 0.04, 0.01]} /></mesh>
        ))}
        <mesh position={[0.1, H / 2, 0]} material={m.chrome}><cylinderGeometry args={[0.012, 0.012, H, 6]} /></mesh>
        <mesh ref={puck} position={[0.1, 0.4, 0]} material={m.mint}><cylinderGeometry args={[0.06, 0.06, 0.1, 12]} /></mesh>
        <group ref={bell} position={[0, H + 0.05, 0]}>
          <mesh material={m.yellow} castShadow><sphereGeometry args={[0.16, 16, 8, 0, TAU, 0, Math.PI / 2]} /></mesh>
        </group>
        {/* the strike pad at the foot */}
        <mesh position={[0, 0.12, 0.25]} material={m.black} castShadow><boxGeometry args={[0.45, 0.24, 0.35]} /></mesh>
        <mesh position={[0, 0.245, 0.25]} material={m.red}><cylinderGeometry args={[0.14, 0.14, 0.02, 16]} /></mesh>
      </group>
      <Sledge m={m} id="fp-striker" />
    </group>
  )
}

// ---------------------------------------------------------------- keepy-uppy
export function KeepyUppy({ m }: { m: ParkMats }) {
  const LX = 14, LZ = 0
  const station = useStation({ id: 'fp-keepy', def: 'keepy_uppy', lx: LX, lz: LZ, yaw: 0, label: 'KEEPY-UPPY' })
  const ball = useRef<Mesh>(null)
  const [x, z] = pw(LX, LZ)
  const y = ph(LX, LZ)
  useFrame(() => {
    const b = ball.current
    if (!b) return
    if (!onStation('fp-keepy')) {
      b.position.set(x + 0.4, y + 0.11, z + 0.3)
      return
    }
    const k = kickupsBall(workout.phase)
    const f = Math.sin(station.yaw), fz = Math.cos(station.yaw)
    b.position.set(x + f * 0.32 + fz * k.side * 0.12, y + k.h * 0.8 + 0.11, z + fz * 0.32 - f * k.side * 0.12)
    b.rotation.x += 0.2
  })
  return <mesh ref={ball} material={m.white} castShadow userData={{ noCollide: true }}><sphereGeometry args={[0.11, 18, 12]} /></mesh>
}

// silence "unused" on helpers kept for later props
