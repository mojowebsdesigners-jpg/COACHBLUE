import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { CanvasTexture, DoubleSide, Group, Mesh, MeshStandardMaterial, RepeatWrapping, SRGBColorSpace, Vector3 } from 'three'
import { addCollider, groundHeight } from '../../../lib/terrain'
import { input } from '../../../lib/input'
import { cue, gymSound } from '../../../lib/audio'
import { addBody, makeBall, wake, type Body } from '../../../systems/Physics'
import { workout, showResult } from '../../../systems/Workout'
import { ph, pw, onStation, useStation, type ParkMats } from './common'

const TAU = Math.PI * 2
const _v = new Vector3()
const _y = new Vector3(0, 1, 0)
const rand = Math.random

/** A physics ball that returns to its tee after a shot, drawn as a mesh. */
function useBall(r: number, mass: number, bounce: number, home: () => Vector3) {
  const body = useMemo<Body>(() => {
    const b = makeBall(r, mass, bounce)
    b.p.copy(home())
    return b
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => addBody(body), [body])
  const mesh = useRef<Mesh>(null)
  useFrame(() => {
    const m = mesh.current
    if (!m) return
    m.position.copy(body.p)
    m.quaternion.copy(body.q)
  })
  const reset = () => { body.p.copy(home()); body.v.set(0, 0, 0); body.w.set(0, 0, 0); body.awake = false }
  return { body, mesh, reset }
}

// ---------------------------------------------------------------- basketball
/** Free throws at a real hoop: 3.05 m, 4.2 m out. The arc is the one a shooter uses. */
export function Basketball({ m }: { m: ParkMats }) {
  const LX = -12, LZ = 9
  const hoopZ = LZ + 4.6
  const [hx, hz] = pw(LX, hoopZ)
  const hy = ph(LX, LZ) + 3.05
  const rim = useMemo(() => new Vector3(hx, hy, hz), [hx, hy, hz])
  const shot = useRef({ live: false, t: 0, above: true, scored: false })
  const ball = useBall(0.12, 0.6, 0.72, () => {
    const [x, z] = pw(LX + 0.5, LZ + 0.4)
    return new Vector3(x, ph(LX, LZ) + 0.12, z)
  })
  useStation({
    id: 'fp-hoop', def: 'basketball', lx: LX, lz: LZ, yaw: 0, label: 'SHOOT FREE THROWS',
    extra: {
      sweet: [0.55, 0.67],
      onRelease: (power) => {
        const b = ball.body
        const [l, r] = workout.hands
        b.p.addVectors(l, r).multiplyScalar(0.5).y += 0.15
        // the speed that drops it through the rim at a 52-degree launch, then
        // scaled by the timing: the meter's green is dead on
        const d = Math.hypot(rim.x - b.p.x, rim.z - b.p.z), dy = rim.y - b.p.y
        const ang = 0.9
        const v0 = Math.sqrt((9.8 * d * d) / (2 * Math.cos(ang) ** 2 * (d * Math.tan(ang) - dy)))
        const k = 1 + (power - 0.61) * 0.3
        const dir = _v.set(rim.x - b.p.x, 0, rim.z - b.p.z).normalize()
        b.v.set(dir.x * v0 * Math.cos(ang) * k, v0 * Math.sin(ang) * k, dir.z * v0 * Math.cos(ang) * k)
        b.w.set(-8, 0, 0)
        wake(b)
        shot.current = { live: true, t: 0, above: true, scored: false }
        cue('interact')
      },
    },
  })
  useFrame((_, dt) => {
    const s = shot.current
    if (!s.live) return
    s.t += dt
    const b = ball.body
    const dx = b.p.x - rim.x, dz = b.p.z - rim.z, rd = Math.hypot(dx, dz)
    // down through the ring: a basket
    if (s.above && b.p.y < rim.y && b.v.y < 0) {
      s.above = false
      if (rd < 0.2) { s.scored = true; gymSound('chain', 0.8); showResult(rd < 0.1 ? 'SWISH!' : 'SCORES!', rd < 0.1 ? 30 : 20) }
      else if (rd < 0.34) {
        // off the rim
        b.v.y = Math.abs(b.v.y) * 0.45
        b.v.x += (dx / rd) * 1.6; b.v.z += (dz / rd) * 1.6
        gymSound('clank', 0.7)
        s.above = true
      }
    }
    // the backboard
    if (b.p.z > rim.z + 0.28 && b.p.y > rim.y - 0.1 && b.p.y < rim.y + 1.1 && Math.abs(b.p.x - rim.x) < 0.9 && b.v.z > 0) {
      b.v.z = -b.v.z * 0.6
      gymSound('drop', 0.5)
    }
    if (s.t > 3.2) {
      if (!s.scored) showResult(rd < 1 ? 'SO CLOSE' : 'MISS', 0)
      s.live = false
      ball.reset()
    }
  })
  return (
    <group>
      <group position={[hx, ph(LX, LZ), hz + 0.55]}>
        <mesh position={[0, 1.6, 0.45]} material={m.steel} castShadow><cylinderGeometry args={[0.07, 0.08, 3.4, 12]} /></mesh>
        <mesh position={[0, 3.2, 0.2]} rotation={[0.5, 0, 0]} material={m.steel}><boxGeometry args={[0.08, 0.08, 0.6]} /></mesh>
        <mesh position={[0, 3.4, -0.22]} material={m.white} castShadow><boxGeometry args={[1.8, 1.05, 0.04]} /></mesh>
        <mesh position={[0, 3.3, -0.245]} material={m.red}><boxGeometry args={[0.6, 0.45, 0.005]} /></mesh>
        <mesh position={[0, 3.3, -0.24]} material={m.white}><boxGeometry args={[0.54, 0.39, 0.006]} /></mesh>
      </group>
      <mesh position={[rim.x, rim.y, rim.z]} rotation={[Math.PI / 2, 0, 0]} material={m.orange} castShadow><torusGeometry args={[0.23, 0.012, 8, 32]} /></mesh>
      {/* the net: tapering strings */}
      {Array.from({ length: 12 }, (_, i) => {
        const a = (i / 12) * TAU
        return (
          <mesh key={i} position={[rim.x + Math.cos(a) * 0.19, rim.y - 0.2, rim.z + Math.sin(a) * 0.19]} rotation={[Math.sin(a) * 0.2, 0, -Math.cos(a) * 0.2]} material={m.net}>
            <cylinderGeometry args={[0.004, 0.004, 0.4, 3]} />
          </mesh>
        )
      })}
      {/* the free-throw line */}
      <mesh position={[pw(LX, LZ + 0.35)[0], ph(LX, LZ) + 0.015, pw(LX, LZ + 0.35)[1]]} rotation={[-Math.PI / 2, 0, 0]} material={m.white}><planeGeometry args={[3.6, 0.06]} /></mesh>
      <mesh ref={ball.mesh} material={m.orange} castShadow userData={{ noCollide: true }}><sphereGeometry args={[0.12, 20, 14]} /></mesh>
    </group>
  )
}

/** Netting: a see-through mesh of white cord, drawn as a tiled texture. */
function useNetMaterial() {
  return useMemo(() => {
    const c = document.createElement('canvas')
    c.width = c.height = 64
    const x = c.getContext('2d')!
    x.strokeStyle = '#f4f4f0'
    x.lineWidth = 3
    x.strokeRect(0, 0, 64, 64)
    const t = new CanvasTexture(c)
    t.wrapS = t.wrapT = RepeatWrapping
    t.repeat.set(24, 12)
    t.colorSpace = SRGBColorSpace
    return new MeshStandardMaterial({ map: t, transparent: true, alphaTest: 0.4, side: DoubleSide, roughness: 0.9 })
  }, [])
}

// ---------------------------------------------------------------- football
/** A penalty at a mini goal: aim with A / D, strike on the meter. */
export function Penalty({ m }: { m: ParkMats }) {
  const LX = -3, LZ = 9.5, GOAL_Z = LZ + 8, W = 3.6, H = 1.9
  const aim = useRef(0)
  const shot = useRef({ live: false, t: 0, done: false })
  const ball = useBall(0.11, 0.43, 0.55, () => {
    const [x, z] = pw(LX, LZ)
    return new Vector3(x, ph(LX, LZ) + 0.11, z)
  })
  const [gx, gz] = pw(LX, GOAL_Z)
  const gy = ph(LX, GOAL_Z)
  const net = useNetMaterial()
  useEffect(() => {
    // posts and the net behind are solid
    const offs = [addCollider({ x: gx - W / 2, z: gz, r: 0.08 }), addCollider({ x: gx + W / 2, z: gz, r: 0.08 }),
      addCollider({ x: gx, z: gz + 1.1, hx: W / 2, hz: 0.05, angle: 0 })]
    return () => offs.forEach((o) => o())
  }, [gx, gz])
  useStation({
    id: 'fp-penalty', def: 'penalty', lx: LX - 0.3, lz: LZ, yaw: 0, label: 'TAKE A PENALTY', radius: 2.6,
    extra: {
      sweet: [0.7, 0.86],
      onRelease: (power) => {
        const b = ball.body
        ball.reset()
        // too little and it dribbles; too much and it flies over the bar
        const speed = 9 + power * 16
        const lift = 0.05 + power * power * 0.32
        const ang = aim.current * 0.2
        _v.set(Math.sin(ang), 0, Math.cos(ang))
        b.v.set(_v.x * speed, speed * lift, _v.z * speed)
        b.w.set(speed * 3, 0, 0)
        wake(b)
        gymSound('drop', 0.9)
        shot.current = { live: true, t: 0, done: false }
      },
    },
  })
  const arrow = useRef<Mesh>(null)
  useFrame((_, dt) => {
    const on = onStation('fp-penalty')
    if (on && workout.action < 0) aim.current = Math.max(-1, Math.min(1, aim.current + input.strafe * dt * 1.6))
    if (arrow.current) {
      arrow.current.visible = on && workout.action < 0
      const [x, z] = pw(LX, LZ + 1.2)
      arrow.current.position.set(x + aim.current * 0.45, ph(LX, LZ) + 0.03, z)
      arrow.current.rotation.set(-Math.PI / 2, 0, -aim.current * 0.2)
    }
    const s = shot.current
    if (!s.live) return
    s.t += dt
    const b = ball.body
    if (!s.done && b.p.z >= gz) {
      s.done = true
      const inside = Math.abs(b.p.x - gx) < W / 2 - 0.1 && b.p.y < gy + H - 0.1
      if (inside) { b.v.multiplyScalar(0.15); showResult(Math.abs(b.p.x - gx) > 1.2 || b.p.y > gy + 1.4 ? 'TOP CORNER! GOAL!' : 'GOAL!', 25); cue('discover') }
      else showResult(b.p.y > gy + H ? 'OVER THE BAR' : 'WIDE', 0)
    }
    if (s.t > 3.5) { if (!s.done) showResult('SAVED BY THE GRASS', 0); s.live = false; ball.reset() }
  })
  return (
    <group>
      <group position={[gx, gy, gz]}>
        {[-1, 1].map((sd) => <mesh key={sd} position={[sd * W / 2, H / 2, 0]} material={m.white} castShadow><cylinderGeometry args={[0.05, 0.05, H, 10]} /></mesh>)}
        <mesh position={[0, H, 0]} rotation={[0, 0, Math.PI / 2]} material={m.white} castShadow><cylinderGeometry args={[0.05, 0.05, W, 10]} /></mesh>
        <mesh position={[0, H / 2, 1.1]} material={net}><planeGeometry args={[W, H]} /></mesh>
        <mesh position={[0, H, 0.55]} rotation={[Math.PI / 2, 0, 0]} material={net}><planeGeometry args={[W, 1.1]} /></mesh>
        {[-1, 1].map((sd) => <mesh key={sd} position={[sd * W / 2, H / 2, 0.55]} rotation={[0, Math.PI / 2, 0]} material={net}><planeGeometry args={[1.1, H]} /></mesh>)}
      </group>
      <mesh ref={ball.mesh} castShadow userData={{ noCollide: true }}>
        <icosahedronGeometry args={[0.11, 2]} />
        <meshStandardMaterial color="#f4f4f0" roughness={0.5} flatShading />
      </mesh>
      <mesh ref={arrow} material={m.mint}><circleGeometry args={[0.18, 3]} /></mesh>
    </group>
  )
}

// ---------------------------------------------------------------- mini golf
/** A putting green: the ball rolls off to his left on a smooth green. */
export function MiniGolf({ m }: { m: ParkMats }) {
  const LX = 4, LZ = 10, HOLE = 7
  const [cx, cz] = pw(LX + HOLE, LZ)
  const shot = useRef({ live: false, t: 0 })
  const ball = useBall(0.021, 0.046, 0.3, () => {
    const [x, z] = pw(LX + 0.35, LZ + 0.3)
    return new Vector3(x, ph(LX, LZ) + 0.04, z)
  })
  ball.body.friction = 0.52
  useStation({
    id: 'fp-golf', def: 'mini_golf', lx: LX + 0.35, lz: LZ + 0.05, yaw: Math.PI, label: 'PLAY MINI GOLF',
    extra: {
      sweet: [0.8, 0.92],
      onRelease: (power) => {
        const b = ball.body
        ball.reset()
        // the green's grain pulls every putt a touch off line
        const dir = _v.set(cx - b.p.x, 0, cz - b.p.z).normalize().applyAxisAngle(_y, (rand() - 0.5) * 0.012)
        const speed = power * 10
        b.v.set(dir.x * speed, 0, dir.z * speed)
        wake(b)
        gymSound('chain', 0.4)
        shot.current = { live: true, t: 0 }
      },
    },
  })
  useFrame((_, dt) => {
    const s = shot.current
    if (!s.live) return
    s.t += dt
    const b = ball.body
    const d = Math.hypot(b.p.x - cx, b.p.z - cz)
    if (d < 0.07 && b.v.length() < 1.3) {
      b.awake = false
      b.p.set(cx, b.p.y - 0.08, cz)
      showResult(s.t < 3 ? 'HOLE IN ONE!' : 'IN THE CUP', 40)
      cue('discover')
      s.live = false
      window.setTimeout(() => ball.reset(), 1800)
      return
    }
    if (s.t > 2 && !b.awake) {
      const dd = Math.hypot(b.p.x - cx, b.p.z - cz)
      showResult(dd < 0.5 ? `SO CLOSE · ${Math.round(dd * 100)} CM` : dd < 2 ? `${dd.toFixed(1)} M SHORT` : 'TRY GENTLER', dd < 0.5 ? 10 : 0)
      s.live = false
      window.setTimeout(() => ball.reset(), 1500)
    }
  })
  const [gx, gz] = pw(LX + HOLE / 2, LZ)
  const gy = ph(LX, LZ)
  return (
    <group>
      <mesh position={[gx, gy + 0.018, gz]} rotation={[-Math.PI / 2, 0, 0]} material={m.grass} receiveShadow><planeGeometry args={[HOLE + 2.2, 2.2]} /></mesh>
      <mesh position={[cx, gy + 0.021, cz]} rotation={[-Math.PI / 2, 0, 0]}><circleGeometry args={[0.055, 20]} /><meshBasicMaterial color="#050505" /></mesh>
      <mesh position={[cx, gy + 0.65, cz]} material={m.white}><cylinderGeometry args={[0.008, 0.008, 1.3, 5]} /></mesh>
      <mesh position={[cx + 0.14, gy + 1.18, cz]} material={m.red}><boxGeometry args={[0.28, 0.18, 0.005]} /></mesh>
      <mesh ref={ball.mesh} material={m.white} castShadow userData={{ noCollide: true }}><sphereGeometry args={[0.021, 14, 10]} /></mesh>
      {/* a putter in his hands while he plays */}
      <Putter m={m} />
    </group>
  )
}
function Putter({ m }: { m: ParkMats }) {
  const g = useRef<Group>(null)
  useFrame(() => {
    const p = g.current
    if (!p) return
    p.visible = onStation('fp-golf')
    if (!p.visible) return
    const [l, r] = workout.hands
    p.position.addVectors(l, r).multiplyScalar(0.5)
    const y = groundHeight(p.position.x, p.position.z)
    _v.set(0, y + 0.03 - p.position.y, 0)
    p.quaternion.setFromUnitVectors(new Vector3(0, -1, 0), _v.clone().normalize())
  })
  return (
    <group ref={g} userData={{ noCollide: true }}>
      <mesh position={[0, -0.42, 0]} material={m.chrome}><cylinderGeometry args={[0.007, 0.007, 0.84, 6]} /></mesh>
      <mesh position={[0, -0.85, 0.03]} material={m.steel}><boxGeometry args={[0.1, 0.03, 0.03]} /></mesh>
    </group>
  )
}

// ---------------------------------------------------------------- darts
const SEGMENTS = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5]
export function Darts({ m }: { m: ParkMats }) {
  const LX = 15, LZ = 5
  const [bx, bz] = pw(LX, LZ + 2.37)
  const by = ph(LX, LZ) + 1.73
  const darts = useRef<(Group | null)[]>([])
  const fly = useRef<{ i: number; t: number; to: Vector3; from: Vector3 } | null>(null)
  const next = useRef(0)
  useStation({
    id: 'fp-darts', def: 'darts', lx: LX, lz: LZ, yaw: 0, label: 'THROW DARTS',
    extra: {
      sweet: [0.46, 0.54],
      onRelease: (power) => {
        // the meter's middle is the bull: early drops low, late flies high
        const err = power - 0.5
        const to = new Vector3(bx + (Math.random() - 0.5) * 0.05 + err * 0.08, by + err * 0.62 + (Math.random() - 0.5) * 0.03, bz - 0.03)
        const i = next.current++ % 3
        fly.current = { i, t: 0, to, from: workout.hands[1].clone() }
      },
    },
  })
  useFrame((_, dt) => {
    const f = fly.current
    if (!f) return
    f.t = Math.min(1, f.t + dt / 0.28)
    const d = darts.current[f.i]
    if (!d) return
    d.visible = true
    d.position.lerpVectors(f.from, f.to, f.t)
    d.position.y += Math.sin(f.t * Math.PI) * 0.12
    if (f.t >= 1) {
      fly.current = null
      gymSound('chain', 0.3)
      // score it the way a real board does
      const dx = f.to.x - bx, dy = f.to.y - by
      const r = Math.hypot(dx, dy)
      let score = 0, label = 'MISSED THE BOARD'
      if (r < 0.0127) { score = 50; label = 'BULLSEYE! 50' }
      else if (r < 0.032) { score = 25; label = 'OUTER BULL · 25' }
      else if (r < 0.17) {
        const ang = Math.atan2(dx, dy)
        const seg = SEGMENTS[((Math.round((ang / TAU) * 20) % 20) + 20) % 20]
        const mult = r > 0.099 && r < 0.107 ? 3 : r > 0.162 ? 2 : 1
        score = seg * mult
        label = mult === 3 ? `TREBLE ${seg} · ${score}` : mult === 2 ? `DOUBLE ${seg} · ${score}` : `${seg}`
      }
      showResult(label, score)
    }
  })
  return (
    <group>
      <group position={[bx, by, bz]}>
        <mesh rotation={[Math.PI / 2, 0, 0]} material={m.black} castShadow><cylinderGeometry args={[0.225, 0.225, 0.04, 40]} /></mesh>
        {/* rings: double, treble and the bull, in the board's colours */}
        {[[0.17, 0.162, m.red], [0.107, 0.099, m.matGreen], [0.032, 0.0127, m.matGreen], [0.0127, 0, m.red]].map(([ro, ri, mat], i) => (
          <mesh key={i} position={[0, 0, -0.021]} rotation={[0, Math.PI, 0]} material={mat as never}><ringGeometry args={[ri as number, ro as number, 40]} /></mesh>
        ))}
        {SEGMENTS.map((_, i) => (
          <mesh key={i} position={[0, 0, -0.0215]} rotation={[0, Math.PI, (i / 20) * TAU + Math.PI / 20]} material={m.white}>
            <planeGeometry args={[0.002, 0.34]} />
          </mesh>
        ))}
      </group>
      <mesh position={[bx, by / 2 + 0.2, bz + 0.1]} material={m.timber} castShadow><boxGeometry args={[0.12, by, 0.1]} /></mesh>
      {[0, 1, 2].map((i) => (
        <group key={i} ref={(el) => { darts.current[i] = el }} visible={false} userData={{ noCollide: true }}>
          <mesh rotation={[Math.PI / 2, 0, 0]} material={m.steel}><cylinderGeometry args={[0.004, 0.002, 0.14, 5]} /></mesh>
          <mesh position={[0, 0, 0.07]} rotation={[0, 0, Math.PI / 4]} material={m.red}><boxGeometry args={[0.03, 0.001, 0.04]} /></mesh>
        </group>
      ))}
      {/* the oche */}
      <mesh position={[pw(LX, LZ + 0.25)[0], ph(LX, LZ) + 0.015, pw(LX, LZ + 0.25)[1]]} rotation={[-Math.PI / 2, 0, 0]} material={m.red}><planeGeometry args={[0.8, 0.05]} /></mesh>
    </group>
  )
}

