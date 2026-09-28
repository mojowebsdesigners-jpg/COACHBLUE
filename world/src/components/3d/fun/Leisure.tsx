import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Color, Group, InstancedMesh, Mesh, MeshBasicMaterial, Object3D } from 'three'
import { gymSound } from '../../../lib/audio'
import { addPlatform } from '../../../lib/terrain'
import { SWING_LEN, repRate } from '../../../systems/ExercisePose'
import { workout, showResult, type Station } from '../../../systems/Workout'
import { ph, pw, onStation, useStation, type ParkMats } from './common'

const TAU = Math.PI * 2

// ---------------------------------------------------------------- swing
/**
 * A playground swing, pumped for real: tap Space as the swing reaches the
 * back of its arc and it goes higher; leave it and it slowly dies away.
 */
export function SwingSet({ m }: { m: ParkMats }) {
  const LX = -10, LZ = -16
  const sw = useRef({ th: 0, w: 0, peak: 0, count: 0 })
  const station = useStation({
    id: 'fp-swing', def: 'swing_set', lx: LX, lz: LZ, yaw: 0, label: 'HAVE A SWING',
    extra: {
      custom: { a: 0, b: 0 },
      stepCustom: (dt, taps) => {
        const s = sw.current
        const g = 9.8 / SWING_LEN
        // a push at the back of the arc (swinging slow, behind) adds to it
        if (taps > 0 && s.th < -0.05 && Math.abs(s.w) < 1.2) s.w += 0.75
        else if (taps > 0 && Math.abs(s.th) < 0.1) s.w += Math.sign(s.w || 1) * 0.25
        s.w += (-g * Math.sin(s.th) - s.w * 0.06) * dt
        const was = s.th
        s.th = Math.max(-1.15, Math.min(1.15, s.th + s.w * dt))
        station.custom!.a = s.th
        s.peak = Math.max(s.peak, Math.abs(s.th))
        // a rep each time it swings through the bottom going forward
        if (was < 0 && s.th >= 0 && s.w > 0) {
          s.count++
          if (s.peak > 1.0 && s.count % 3 === 0) showResult('SKY HIGH!', 0)
          s.peak = 0
          return 1
        }
        return 0
      },
    },
  })
  const seat = useRef<Group>(null)
  const [x, z] = pw(LX, LZ)
  const y = ph(LX, LZ)
  const top = SWING_LEN + 0.45
  useFrame((_, dt) => {
    const s = sw.current
    if (!onStation('fp-swing')) {
      // empty, it swings itself to a stop
      s.w += (-9.8 / SWING_LEN * Math.sin(s.th) - s.w * 0.5) * dt
      s.th += s.w * dt
      station.custom!.a = s.th
    }
    if (seat.current) seat.current.rotation.x = -s.th
  })
  return (
    <group position={[x, y, z]}>
      {/* the frame: two A-legs and a top bar, across the swing's arc */}
      {[-1, 1].map((sd) => (
        <group key={sd}>
          <mesh position={[sd * 1.2, top / 2, -0.6]} rotation={[0.28, 0, 0]} material={m.blue} castShadow><cylinderGeometry args={[0.05, 0.05, top + 0.2, 10]} /></mesh>
          <mesh position={[sd * 1.2, top / 2, 0.6]} rotation={[-0.28, 0, 0]} material={m.blue} castShadow><cylinderGeometry args={[0.05, 0.05, top + 0.2, 10]} /></mesh>
        </group>
      ))}
      <mesh position={[0, top, 0]} rotation={[0, 0, Math.PI / 2]} material={m.blue} castShadow><cylinderGeometry args={[0.055, 0.055, 2.5, 10]} /></mesh>
      {/* chains and seat, hanging from the bar, turning with the swing */}
      <group ref={seat} position={[0, top, 0]} userData={{ noCollide: true }}>
        {[-1, 1].map((sd) => (
          <mesh key={sd} position={[sd * 0.24, -SWING_LEN / 2, 0]} material={m.chrome}><cylinderGeometry args={[0.008, 0.008, SWING_LEN, 5]} /></mesh>
        ))}
        <mesh position={[0, -SWING_LEN - 0.02, 0]} material={m.black} castShadow><boxGeometry args={[0.55, 0.04, 0.22]} /></mesh>
      </group>
    </group>
  )
}

// ---------------------------------------------------------------- trampoline
/**
 * A round trampoline. He bounces by himself; tap Space just before he lands
 * and he goes higher. High enough, and he tucks into a backflip.
 */
export function Trampoline({ m }: { m: ParkMats }) {
  const LX = -3, LZ = -16, BED = 0.75
  const tr = useRef({ h: 0.3, v: 0, flip: 0, flipping: false, primed: 0, best: 0 })
  const bed = useRef<Mesh>(null)
  const station = useStation({
    id: 'fp-tramp', def: 'trampoline', lx: LX, lz: LZ, yaw: 0, label: 'JUMP ON THE TRAMPOLINE', radius: 2.6,
    extra: {
      custom: { a: 0, b: 0 },
      stepCustom: (dt, taps) => {
        const s = tr.current
        if (taps > 0) s.primed = 0.3                  // a tap counts for a moment
        s.primed = Math.max(0, s.primed - dt)
        s.v -= 9.8 * dt
        s.h += s.v * dt
        let rep = 0
        if (s.h <= 0) {
          // the bed catches him: a well-timed push adds, otherwise it fades
          s.h = 0
          const speed = Math.abs(s.v)
          s.v = s.primed > 0 ? Math.min(9.5, speed * 1.08 + 1.3) : Math.max(3.2, speed * 0.82)
          s.primed = 0
          gymSound('drop', 0.4)
          if (s.flipping) { s.flipping = false; s.flip = 0; rep = 1; showResult('BACKFLIP!', 20) }
          // decide in the air: high enough, and he flips
          const apex = (s.v * s.v) / 19.6
          if (apex > 2.4) s.flipping = true
          if (apex > s.best + 0.3) s.best = apex
          if (apex > 1) rep = Math.max(rep, 1)
        }
        if (s.flipping) {
          const T = (2 * s.v) / 9.8
          s.flip = Math.min(TAU, s.flip + (TAU / Math.max(0.6, T)) * dt * 1.05)
        }
        station.custom!.a = BED + s.h - 0.02
        station.custom!.b = s.flipping ? s.flip : 0
        return rep
      },
    },
  })
  const [x, z] = pw(LX, LZ)
  const y = ph(LX, LZ)
  useFrame(() => {
    // the bed dips under him on landing
    const s = tr.current
    if (bed.current) bed.current.position.y = BED - (onStation('fp-tramp') && s.h < 0.15 ? (0.15 - s.h) * 0.9 : 0)
    if (!onStation('fp-tramp')) { s.h = 0.3; s.v = 0; s.flipping = false; s.flip = 0 }
  })
  // the pose reads its height as the station's ground offset
  station.ground = y
  return (
    <group position={[x, y, z]}>
      <mesh position={[0, BED, 0]} rotation={[Math.PI / 2, 0, 0]} material={m.blue} castShadow><torusGeometry args={[1.8, 0.07, 10, 48]} /></mesh>
      <mesh ref={bed} position={[0, BED, 0]} rotation={[-Math.PI / 2, 0, 0]} material={m.black} receiveShadow><circleGeometry args={[1.65, 40]} /></mesh>
      {Array.from({ length: 6 }, (_, i) => {
        const a = (i / 6) * TAU
        return <mesh key={i} position={[Math.cos(a) * 1.75, BED / 2, Math.sin(a) * 1.75]} material={m.steel} castShadow><cylinderGeometry args={[0.035, 0.035, BED, 8]} /></mesh>
      })}
    </group>
  )
}

// ---------------------------------------------------------------- dance floor
/** A lit dance floor: the tiles pulse with the beat, and flare when you hit it. */
export function DanceFloor({ m }: { m: ParkMats }) {
  const LX = 4, LZ = -15, N = 5, S = 0.9
  useStation({ id: 'fp-dance', def: 'dance_floor', lx: LX, lz: LZ, yaw: 0, label: 'HIT THE DANCE FLOOR', radius: 3,
    extra: { ground: ph(LX, LZ) + 0.08 } })
  useEffect(() => {
    const [cx, cz] = pw(LX, LZ)
    return addPlatform({ x: cx, z: cz, hx: (N * S + 0.2) / 2, hz: (N * S + 0.2) / 2, angle: 0, top: ph(LX, LZ) + 0.08 })
  }, [])
  const tiles = useRef<InstancedMesh>(null)
  const col = useMemo(() => new Color(), [])
  const palette = useMemo(() => ['#1de9b6', '#2f6fd6', '#8650de', '#e8742a', '#e3566b'].map((c) => new Color(c)), [])
  // lit from inside: each tile is its own colour, whatever the sun is doing
  const mat = useMemo(() => new MeshBasicMaterial({ color: '#ffffff' }), [])
  const [x, z] = pw(LX, LZ)
  const y = ph(LX, LZ)
  useEffect(() => {
    const t = tiles.current
    if (!t) return
    const d = new Object3D()
    for (let i = 0; i < N * N; i++) {
      d.position.set(((i % N) - (N - 1) / 2) * S, 0.06, (Math.floor(i / N) - (N - 1) / 2) * S)
      d.updateMatrix()
      t.setMatrixAt(i, d.matrix)
    }
    t.instanceMatrix.needsUpdate = true
  }, [])
  useFrame(() => {
    const t = tiles.current
    if (!t) return
    const on = onStation('fp-dance')
    const beat = on ? (workout.phase * repRate('dance')) / TAU : performance.now() / 1000 * 1.2
    const hit = on && workout.grade === 'perfect' && performance.now() - workout.gradeStamp < 400
    for (let i = 0; i < N * N; i++) {
      const gx = i % N, gz = Math.floor(i / N)
      const wave = Math.sin(beat * Math.PI * 2 - (gx + gz) * 0.8) * 0.5 + 0.5
      col.copy(palette[(gx + gz + Math.floor(beat)) % palette.length]).multiplyScalar((hit ? 1.4 : 0.25) + wave * 0.6)
      t.setColorAt(i, col)
    }
    if (t.instanceColor) t.instanceColor.needsUpdate = true
  })
  return (
    <group position={[x, y, z]}>
      <mesh position={[0, 0.03, 0]} material={m.black} receiveShadow><boxGeometry args={[N * S + 0.2, 0.06, N * S + 0.2]} /></mesh>
      <instancedMesh ref={tiles} args={[undefined as never, mat, N * N]} userData={{ noCollide: true }}>
        <boxGeometry args={[S - 0.05, 0.02, S - 0.05]} />
      </instancedMesh>
      {/* two speaker stacks */}
      {[-1, 1].map((sd) => (
        <group key={sd} position={[sd * (N * S / 2 + 0.6), 0, -N * S / 2]}>
          <mesh position={[0, 0.6, 0]} material={m.black} castShadow><boxGeometry args={[0.55, 1.2, 0.45]} /></mesh>
          <mesh position={[0, 0.8, 0.23]} rotation={[Math.PI / 2, 0, 0]} material={m.steel}><cylinderGeometry args={[0.16, 0.16, 0.02, 20]} /></mesh>
          <mesh position={[0, 0.35, 0.23]} rotation={[Math.PI / 2, 0, 0]} material={m.steel}><cylinderGeometry args={[0.1, 0.1, 0.02, 16]} /></mesh>
        </group>
      ))}
    </group>
  )
}

// ---------------------------------------------------------------- hula hoop
export function HulaHoop({ m }: { m: ParkMats }) {
  const LX = 16, LZ = -5
  useStation({ id: 'fp-hula', def: 'hula_hoop', lx: LX, lz: LZ, yaw: 0, label: 'HULA HOOP' })
  const hoop = useRef<Mesh>(null)
  const drop = useRef(0)
  const [x, z] = pw(LX, LZ)
  const y = ph(LX, LZ)
  useFrame((_, dt) => {
    const h = hoop.current
    if (!h) return
    const on = onStation('fp-hula')
    const spin = on ? workout.belt : 0
    // spinning, it rides the hips; let it slow and it slides down the legs
    drop.current += ((spin > 0.4 ? 0 : 1) - drop.current) * Math.min(1, dt * (spin > 0.4 ? 4 : 1.5))
    const a = workout.phase * repRate('hula')
    const hipY = y + 1.0
    h.position.set(x + Math.cos(a) * 0.12 * spin, (on ? hipY : y + 0.05) - drop.current * (on ? 0.95 : 0), z + Math.sin(a) * 0.12 * spin)
    h.rotation.set(Math.PI / 2 + Math.sin(a) * 0.12 * spin, 0, Math.cos(a) * 0.12 * spin)
  })
  return <mesh ref={hoop} material={m.orange} castShadow userData={{ noCollide: true }}><torusGeometry args={[0.45, 0.018, 8, 40]} /></mesh>
}

// ---------------------------------------------------------------- yoga & meditation
export function YogaDeck({ m }: { m: ParkMats }) {
  const LX = 11, LZ = -14
  const deck = ph(LX, LZ) + 0.12
  useStation({ id: 'fp-yoga', def: 'yoga_flow', lx: LX, lz: LZ, yaw: -0.4, label: 'YOGA FLOW', extra: { ground: deck + 0.01 } })
  useStation({ id: 'fp-zen', def: 'meditation', lx: LX + 3.2, lz: LZ + 1.2, yaw: -0.4, label: 'MEDITATE', extra: { ground: deck + 0.1 } })
  const [x, z] = pw(LX + 1.5, LZ + 0.6)
  const y = ph(LX, LZ)
  useEffect(() => addPlatform({ x, z, hx: 2.7, hz: 1.6, angle: -0.4, top: deck }), [x, z, deck])
  const [cx, cz] = pw(LX + 3.2, LZ + 1.2)
  return (
    <group>
      <mesh position={[x, y + 0.06, z]} rotation={[0, -0.4, 0]} material={m.timber} receiveShadow castShadow><boxGeometry args={[5.4, 0.12, 3.2]} /></mesh>
      <mesh position={[pw(LX, LZ)[0], y + 0.13, pw(LX, LZ)[1]]} rotation={[0, -0.4, 0]} material={m.matPurple} receiveShadow><boxGeometry args={[0.7, 0.01, 1.9]} /></mesh>
      <mesh position={[cx, y + 0.17, cz]} material={m.cushion} castShadow><cylinderGeometry args={[0.28, 0.3, 0.1, 20]} /></mesh>
    </group>
  )
}

// silence helpers kept for balance
export type { Station }
