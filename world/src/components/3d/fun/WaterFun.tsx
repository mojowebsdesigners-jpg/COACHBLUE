import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import {
  BufferGeometry, DoubleSide, Group, InstancedMesh, Material, Mesh, MeshBasicMaterial, Object3D, Vector3,
} from 'three'
import {
  LAKE, POOL, addCollider, groundHeight, lakeEdgeDistance, lakeLevel, lakeRadius, poolDeckHeight, poolWaterLevel,
} from '../../../lib/terrain'
import { cue, gymSound, splash } from '../../../lib/audio'
import { dropOut, showResult, workout } from '../../../systems/Workout'
import { jettyFrame } from '../LakeScene'
import { onStation, stretch, useParkMaterials, useStation } from './common'

const _a = new Vector3()
const _b = new Vector3()
const _c = new Vector3()
const _o = new Object3D()
const rand = Math.random

// ---------------------------------------------------------------- splashes
/**
 * Water thrown up where something hits it: a ring spreading on the surface
 * and a crown of droplets falling back. Anything can ask for one.
 */
type Splash = { x: number; y: number; z: number; size: number; t: number; drops: Vector3[]; vel: Vector3[] }
const MAX = 6, DROPS = 26
const splashes: Splash[] = []
export function splashAt(x: number, y: number, z: number, size = 1) {
  if (splashes.length >= MAX) splashes.shift()
  const drops: Vector3[] = [], vel: Vector3[] = []
  for (let i = 0; i < DROPS; i++) {
    const a = rand() * Math.PI * 2, s = (0.4 + rand() * 1.2) * size
    drops.push(new Vector3(x, y, z))
    vel.push(new Vector3(Math.cos(a) * s, (1.5 + rand() * 3.2) * Math.sqrt(size), Math.sin(a) * s))
  }
  splashes.push({ x, y, z, size, t: 0, drops, vel })
  splash(Math.min(2, 0.35 + size * 0.6))
}

export function SplashFX() {
  const drops = useRef<InstancedMesh>(null)
  const rings = useRef<(Mesh | null)[]>([])
  const ringMat = useMemo(() => Array.from({ length: MAX }, () =>
    new MeshBasicMaterial({ color: '#f4fbff', transparent: true, opacity: 0, depthWrite: false, side: DoubleSide })), [])
  useFrame((_, delta) => {
    const dt = Math.min(delta, 1 / 30)
    const im = drops.current
    if (!im) return
    for (let i = splashes.length - 1; i >= 0; i--) {
      splashes[i].t += dt
      if (splashes[i].t > 2.2) splashes.splice(i, 1)
    }
    let n = 0
    for (let k = 0; k < MAX; k++) {
      const s = splashes[k], ring = rings.current[k]
      if (!ring) continue
      ring.visible = !!s
      if (!s) continue
      // two rings: the first quick and bright, spreading out and fading
      const r = 0.3 + s.t * 1.6 * Math.sqrt(s.size)
      ring.position.set(s.x, s.y + 0.02, s.z)
      ring.scale.setScalar(r)
      ringMat[k].opacity = Math.max(0, 0.55 * (1 - s.t / 2.2))
      for (let i = 0; i < DROPS; i++) {
        const p = s.drops[i], v = s.vel[i]
        if (p.y < s.y - 0.05 && v.y < 0) continue
        v.y -= 9.8 * dt
        p.addScaledVector(v, dt)
        _o.position.copy(p)
        _o.scale.setScalar(0.035 + s.size * 0.02)
        _o.updateMatrix()
        im.setMatrixAt(n++, _o.matrix)
      }
    }
    im.count = n
    im.instanceMatrix.needsUpdate = true
  })
  return (
    <group userData={{ noCollide: true }}>
      <instancedMesh ref={drops} args={[undefined, undefined, MAX * DROPS]} frustumCulled={false}>
        <sphereGeometry args={[1, 6, 4]} />
        <meshStandardMaterial color="#eaf6ff" roughness={0.1} transparent opacity={0.85} />
      </instancedMesh>
      {ringMat.map((m, k) => (
        <mesh key={k} ref={(el) => { rings.current[k] = el }} rotation={[-Math.PI / 2, 0, 0]} material={m} visible={false} renderOrder={3}>
          <ringGeometry args={[0.82, 1, 40]} />
        </mesh>
      ))}
    </group>
  )
}

// ---------------------------------------------------------------- fishing
/**
 * Off the end of the jetty. Cast, wait for the float to go under, strike,
 * then play the fish: reel while it tires, ease off when it runs, or the
 * line parts. Kenyan lake fish, weighed when you land them.
 */
type FishState = 'ready' | 'cast' | 'wait' | 'bite' | 'fight' | 'landed' | 'reelin'
const CATCH = [
  { upTo: 0.9, name: 'PERCH' }, { upTo: 2.4, name: 'TILAPIA' }, { upTo: 4.2, name: 'CATFISH' }, { upTo: 99, name: 'NILE PERCH' },
]

function useFishModel() {
  const scene = useGLTF('/models/sealife.glb').scene
  return useMemo(() => {
    const src = scene.getObjectByName('Fish_Silver') as Mesh
    // stood on its nose-to-tail axis, so it can hang from the line
    const g = (src.geometry as BufferGeometry).clone()
    g.computeBoundingBox()
    const b = g.boundingBox!
    const ext = [b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z]
    g.center()
    if (ext[0] >= ext[1] && ext[0] >= ext[2]) g.rotateZ(Math.PI / 2)
    else if (ext[2] >= ext[1]) g.rotateX(Math.PI / 2)
    g.computeBoundingBox()
    const len = g.boundingBox!.max.y - g.boundingBox!.min.y
    g.scale(1 / len, 1 / len, 1 / len)
    return { geometry: g, material: src.material as Material }
  }, [scene])
}

export function Fishing() {
  const m = useParkMaterials()
  const J = useMemo(() => jettyFrame(), [])
  const spot = J.at(J.len - 1.6)
  const level = lakeLevel()
  const f = useRef({
    s: 'ready' as FishState, t: 0, wait: 0, released: false, w: 1, name: 'PERCH',
    dist: 8, tension: 0, run: 0, runT: 0, reeling: false, side: 0, splashT: 0,
    target: new Vector3(), float: new Vector3(), from: new Vector3(), landedAt: new Vector3(),
  })
  const station = useStation({
    id: 'fp-fish', def: 'fishing', lx: 0, lz: 0, world: spot, ground: J.deck + 0.03, yaw: J.yaw, label: 'GO FISHING', radius: 2,
    extra: {
      hud: { label: 'SPACE TO CAST', value: 0 },
      custom: { a: 0, b: 0 },
      stepCustom: (dt, taps, heldKey) => {
        const F = f.current
        const hud = station.hud!
        const held = taps > 0 || heldKey
        F.t += dt
        switch (F.s) {
          case 'ready':
            workout.action = -1
            hud.text = 'SPACE TO CAST'; hud.value = 0
            if (taps > 0) {
              F.s = 'cast'; F.t = 0; F.released = false
              // out over the water, a little either side
              const out = 7 + rand() * 3, side = (rand() - 0.5) * 4
              F.target.set(spot[0] + Math.sin(J.yaw) * out + Math.cos(J.yaw) * side, level, spot[1] + Math.cos(J.yaw) * out - Math.sin(J.yaw) * side)
              gymSound('exhale', 0.3)
            }
            break
          case 'cast':
            workout.action = Math.min(0.999, F.t / 1.2)
            if (F.t >= 1.5) {
              workout.action = -1
              F.s = 'wait'; F.t = 0; F.wait = 3 + rand() * 6
              splashAt(F.target.x, level, F.target.z, 0.12)
            }
            break
          case 'wait':
            hud.text = 'WAIT FOR THE FLOAT TO GO UNDER…'
            if (taps > 0) { showResult('TOO EARLY — NOTHING ON', 0); F.s = 'reelin'; F.t = 0; break }
            if (F.t > F.wait) { F.s = 'bite'; F.t = 0; splashAt(F.target.x, level, F.target.z, 0.25); showResult('BITE! STRIKE NOW!', 0) }
            break
          case 'bite':
            hud.text = 'STRIKE! SPACE!'
            if (taps > 0) {
              const r = rand()
              F.w = 0.3 + r * r * r * 6.5
              F.name = CATCH.find((c) => F.w <= c.upTo)!.name
              F.s = 'fight'; F.t = 0; F.tension = 0.35; F.run = 0.8; F.runT = 1
              F.dist = Math.hypot(F.target.x - spot[0], F.target.z - spot[1])
              gymSound('chain', 0.5)
            } else if (F.t > 1.1) { showResult('IT GOT AWAY', 0); F.s = 'reelin'; F.t = 0 }
            break
          case 'fight': {
            F.runT -= dt
            if (F.runT < 0) {
              // bursts of running, then tiring
              F.run = F.run > 0.1 ? 0 : 0.5 + rand() * 0.5 * Math.min(1.5, 0.5 + F.w / 3)
              F.runT = F.run > 0 ? 0.6 + rand() * 1.4 : 0.9 + rand() * 1.8
              F.side = (rand() - 0.5) * 2
            }
            F.reeling = held
            const pull = F.run * (0.6 + F.w * 0.12)
            if (held) {
              F.dist -= dt * Math.max(0.2, 1.6 - pull * 1.2)
              F.tension += dt * (pull * 1.1 - 0.3)
            } else {
              F.dist += dt * pull * 1.2
              F.tension -= dt * 0.55
            }
            F.tension = Math.max(0.05, F.tension)
            hud.value = F.tension
            hud.warn = 0.75
            hud.text = F.run > 0 ? 'IT’S RUNNING — EASE OFF!' : 'HOLD SPACE TO REEL IN'
            if (F.tension > 1) { showResult('LINE SNAPPED!', 0); F.s = 'reelin'; F.t = 0; gymSound('clank', 0.5) }
            else if (F.dist > 15) { showResult('IT TOOK ALL YOUR LINE', 0); F.s = 'reelin'; F.t = 0 }
            else if (F.dist < 1.3) {
              F.s = 'landed'; F.t = 0; F.reeling = false
              hud.value = 0
              splashAt(F.float.x, level, F.float.z, 0.4)
              showResult(`${F.name} · ${F.w.toFixed(1)} KG`, Math.round(10 + F.w * 12))
              cue('discover')
              station.custom!.b = 0
              return 1
            }
            station.custom!.b = F.reeling ? 1 : 0
            break
          }
          case 'landed':
            hud.text = 'WHAT A CATCH'
            if (F.t > 3) { F.s = 'ready'; F.t = 0 }
            break
          case 'reelin':
            station.custom!.b = 1
            hud.value = 0
            if (F.t > 0.9) { F.s = 'ready'; F.t = 0; station.custom!.b = 0 }
            break
        }
        return 0
      },
    },
  })
  useEffect(() => { f.current.float.set(spot[0], level, spot[1]) }, [spot, level])

  const fish = useFishModel()
  const rod = useRef<(Mesh | null)[]>([])
  const line = useRef<Mesh>(null)
  const bob = useRef<Group>(null)
  const caught = useRef<Mesh>(null)
  const tip = useMemo(() => new Vector3(), [])
  useFrame((_, dt) => {
    const on = onStation('fp-fish') || (workout.station?.id === 'fp-fish')
    const F = f.current
    rod.current.forEach((r) => { if (r) r.visible = on })
    if (line.current) line.current.visible = on
    if (bob.current) bob.current.visible = on && F.s !== 'ready'
    if (caught.current) caught.current.visible = on && F.s === 'landed'
    if (!on) return
    const [l, r] = workout.hands
    // the rod: butt just below the left hand, through the right, curving
    // down at the tip under the fish's weight
    _a.subVectors(r, l).normalize()
    const butt = _b.copy(l).addScaledVector(_a, -0.2)
    const bend = F.s === 'fight' ? 0.25 + F.tension * 0.55 : F.s === 'bite' ? 0.3 : 0.05
    const pts: Vector3[] = []
    for (let i = 0; i <= 4; i++) {
      const k = i / 4
      pts.push(new Vector3().copy(butt).addScaledVector(_a, k * 2.4).add(_c.set(0, -bend * k * k, 0)))
    }
    for (let i = 0; i < 4; i++) { const seg = rod.current[i]; if (seg) stretch(seg, pts[i], pts[i + 1]) }
    tip.copy(pts[4])
    // the float: out on its arc, bobbing, dipping, dragged about by the fish
    const level2 = level + Math.sin(performance.now() / 600) * 0.012
    if (F.s === 'cast') {
      if (F.t < 0.62) F.float.copy(tip).y -= 0.4
      else {
        if (!F.released) { F.released = true; F.from.copy(tip) }
        const k = Math.min(1, (F.t - 0.62) / 0.88)
        F.float.lerpVectors(F.from, F.target, k)
        F.float.y += Math.sin(k * Math.PI) * 2.2
      }
    } else if (F.s === 'wait') {
      F.float.copy(F.target)
      // the odd nibble before the real thing
      const nib = Math.max(0, Math.sin(F.t * 7) * Math.sin(F.t * 1.3)) * 0.04
      F.float.y = level2 - nib
    } else if (F.s === 'bite') {
      F.float.copy(F.target)
      F.float.y = level - 0.12 - Math.abs(Math.sin(F.t * 18)) * 0.05
    } else if (F.s === 'fight') {
      // along the line out from the jetty, zig-zagging when it runs
      const dx = F.target.x - spot[0], dz = F.target.z - spot[1], dl = Math.hypot(dx, dz)
      const ux = dx / dl, uz = dz / dl
      const wig = Math.sin(F.t * 2.3) * F.side * Math.min(2, F.dist * 0.3)
      F.float.set(spot[0] + ux * F.dist - uz * wig, level - 0.08, spot[1] + uz * F.dist + ux * wig)
      F.splashT -= dt
      if (F.run > 0 && F.splashT < 0) { F.splashT = 0.35 + rand() * 0.4; splashAt(F.float.x, level, F.float.z, 0.18 + F.w * 0.04) }
    } else if (F.s === 'reelin') {
      F.float.lerp(_c.copy(tip).setY(level), Math.min(1, dt * 3))
    } else if (F.s === 'landed') {
      // swung up out of the water into his hand
      const k = Math.min(1, F.t / 0.6)
      _c.copy(r).add(_a.set(0, -0.12, 0))
      F.float.lerp(_c, k)
    }
    if (bob.current) bob.current.position.copy(F.float)
    if (line.current) stretch(line.current, tip, F.float)
    if (caught.current && F.s === 'landed') {
      const len = 0.22 + F.w * 0.09
      caught.current.scale.setScalar(len)
      caught.current.position.copy(F.float).y -= len / 2
      // flapping
      caught.current.rotation.set(Math.sin(F.t * 14) * 0.35 * Math.max(0, 1 - F.t / 3), J.yaw + Math.PI / 2, 0)
    }
  })
  return (
    <group userData={{ noCollide: true }}>
      {[0, 1, 2, 3].map((i) => (
        <mesh key={i} ref={(el) => { rod.current[i] = el }} material={i === 0 ? m.black : m.steel} visible={false}>
          <cylinderGeometry args={[0.006 + (3 - i) * 0.003, 0.009 + (3 - i) * 0.003, 1, 6]} />
        </mesh>
      ))}
      <mesh ref={line} visible={false}><cylinderGeometry args={[0.0015, 0.0015, 1, 3]} /><meshBasicMaterial color="#e8eef0" transparent opacity={0.7} /></mesh>
      <group ref={bob} visible={false}>
        <mesh position={[0, 0.03, 0]} material={m.red}><sphereGeometry args={[0.035, 10, 8]} /></mesh>
        <mesh position={[0, -0.01, 0]} material={m.white}><sphereGeometry args={[0.034, 10, 8]} /></mesh>
        <mesh position={[0, 0.08, 0]} material={m.yellow}><cylinderGeometry args={[0.004, 0.004, 0.07, 4]} /></mesh>
      </group>
      <mesh ref={caught} geometry={fish.geometry} material={fish.material} visible={false} castShadow />
      {/* a bucket and a tackle box on the planks */}
      <group position={[J.at(J.len - 2.6, 0.55)[0], J.deck + 0.03, J.at(J.len - 2.6, 0.55)[1]]}>
        <mesh position={[0, 0.16, 0]} material={m.blue} castShadow><cylinderGeometry args={[0.15, 0.12, 0.32, 16, 1, true]} /></mesh>
        <mesh position={[0, 0.005, 0]} material={m.blue}><cylinderGeometry args={[0.12, 0.12, 0.01, 16]} /></mesh>
        <mesh position={[0.35, 0.07, 0.1]} material={m.mint} castShadow><boxGeometry args={[0.36, 0.14, 0.2]} /></mesh>
      </group>
    </group>
  )
}

// ---------------------------------------------------------------- stone skimming
/** From the lake's grassy bank: flat and fast skips furthest. */
const SKIM_A = 0.35
export function StoneSkim() {
  const m = useParkMaterials()
  const level = lakeLevel()
  const { spot, yaw } = useMemo(() => {
    const r = lakeRadius(SKIM_A) + 1.5
    const x = LAKE.x + Math.cos(SKIM_A) * r, z = LAKE.z + Math.sin(SKIM_A) * r
    return { spot: [x, z] as [number, number], yaw: Math.atan2(LAKE.x - x, LAKE.z - z) }
  }, [])
  const run = useRef<{ pts: Vector3[]; seg: number; k: number; speed: number; skips: number; across: boolean } | null>(null)
  useStation({
    id: 'fp-skim', def: 'stone_skim', lx: 0, lz: 0, world: spot, yaw, label: 'SKIM STONES',
    extra: {
      sweet: [0.72, 0.9],
      onRelease: (power) => {
        const hand = workout.hands[1].clone()
        const q = Math.max(0.1, 1 - Math.abs(power - 0.81) * 2.4)
        let n = power < 0.18 ? 0 : power > 0.95 ? 1 : Math.max(1, Math.round(q * 12 * (0.45 + power * 0.55)))
        const side = (rand() - 0.5) * 0.12
        const pts = [hand]
        let d = 1.5 + power * 4.5, hop = 1.4 + power * 3.2, across = false
        for (let i = 0; i <= n; i++) {
          const a = yaw + side * i
          const p = new Vector3(spot[0] + Math.sin(a) * d, level, spot[1] + Math.cos(a) * d)
          if (lakeEdgeDistance(p.x, p.z) > -0.3) { across = true; p.y = groundHeight(p.x, p.z) + 0.02; pts.push(p); n = i; break }
          pts.push(p)
          d += hop; hop *= 0.8
        }
        run.current = { pts, seg: 0, k: 0, speed: 9 + power * 9, skips: Math.max(0, pts.length - 2), across }
        gymSound('exhale', 0.4)
      },
    },
  })
  const stone = useRef<Mesh>(null)
  useFrame((_, dt) => {
    const R = run.current, s = stone.current
    if (!s) return
    s.visible = !!R
    if (!R) return
    const a = R.pts[R.seg], b = R.pts[R.seg + 1]
    if (!b) {
      run.current = null
      const n = R.skips
      showResult(R.across ? `ACROSS THE LAKE! ${n} SKIPS` : n <= 0 ? 'PLOP.' : n === 1 ? '1 SKIP' : `${n} SKIPS!`, R.across ? 60 : n * 4)
      if (R.across || n >= 8) cue('discover')
      return
    }
    const len = a.distanceTo(b)
    R.k += (dt * R.speed) / Math.max(0.2, len)
    if (R.k >= 1) {
      R.k = 0; R.seg++; R.speed *= 0.9
      // a touch on the water: a small ring and the tick of the skip
      const last = R.seg >= R.pts.length - 1
      if (!R.across || !last) splashAt(b.x, level, b.z, last ? 0.2 : 0.08)
      return
    }
    s.position.lerpVectors(a, b, R.k)
    s.position.y += Math.sin(R.k * Math.PI) * (R.seg === 0 ? 0.4 : len * 0.08)
    s.rotation.y += dt * 30
  })
  // a little heap of flat stones by his feet
  const heap = useMemo(() => Array.from({ length: 9 }, (_, i) => {
    const a = i * 2.4, r = 0.08 + (i % 3) * 0.06
    return [Math.cos(a) * r, 0.015 + Math.floor(i / 4) * 0.02, Math.sin(a) * r, a] as const
  }), [])
  const hx = spot[0] + Math.cos(yaw) * 0.7, hz = spot[1] - Math.sin(yaw) * 0.7
  return (
    <group>
      <mesh ref={stone} scale={[0.05, 0.014, 0.04]} visible={false} castShadow userData={{ noCollide: true }}>
        <sphereGeometry args={[1, 10, 6]} /><meshStandardMaterial color="#77736b" roughness={0.7} />
      </mesh>
      <group position={[hx, groundHeight(hx, hz), hz]}>
        {heap.map(([x, y, z, a], i) => (
          <mesh key={i} position={[x, y, z]} rotation={[0, a, 0]} scale={[0.05, 0.014, 0.04]} castShadow material={m.steel}>
            <sphereGeometry args={[1, 8, 5]} />
          </mesh>
        ))}
      </group>
    </group>
  )
}

// ---------------------------------------------------------------- cannonball
/**
 * A springboard at the pool's deep end. Bounce, leap, tuck: the harder the
 * bounce the bigger the splash, and the judges score it.
 */
export function Cannonball() {
  const m = useParkMaterials()
  const c = Math.cos(POOL.angle), s = Math.sin(POOL.angle)
  const world = (lx: number, lz: number): [number, number] => [POOL.x + lx * c + lz * s, POOL.z - lx * s + lz * c]
  const deck = poolDeckHeight()
  const top = deck + 0.62
  const tipLx = POOL.hx - 0.9, baseLx = POOL.hx + 1.8
  const yaw = Math.atan2(-c, s)              // facing down the pool (-lx)
  const spot = world(tipLx + 0.45, 0.6)
  const leap = useRef({ power: 0.5 })
  const station = useStation({
    id: 'fp-cannon', def: 'cannonball', lx: 0, lz: 0, world: spot, ground: top, yaw, label: 'CANNONBALL!', radius: 2.4,
    extra: {
      sweet: [0.86, 1],
      custom: { a: 2.4, b: top - poolWaterLevel() + 0.6 },
      onRelease: (power) => {
        leap.current.power = power
        station.custom!.a = 1.3 + power * 1.6
        gymSound('clank', 0.35)
      },
      onActionEnd: () => {
        const p = leap.current.power
        const reach = station.custom!.a
        const x = spot[0] + Math.sin(yaw) * reach, z = spot[1] + Math.cos(yaw) * reach
        const size = 0.8 + p * 1.8
        splashAt(x, poolWaterLevel(), z, size)
        const score = Math.min(10, 4.5 + p * 5.2 + (rand() - 0.5) * 0.8)
        showResult(score > 9.3 ? `MASSIVE! ${score.toFixed(1)} / 10` : `SPLASH ${score.toFixed(1)} / 10`, Math.round(score * 4))
        if (score > 9) cue('discover')
        // he is in the pool now, not back on the board
        dropOut(x, poolWaterLevel() - 0.4, z)
      },
    },
  })
  useEffect(() => {
    // the board's stand is solid on the deck
    const [x, z] = world(POOL.hx + 1.3, 0.6)
    return addCollider({ x, z, hx: 0.55, hz: 0.35, angle: POOL.angle })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const board = useRef<Group>(null)
  useFrame(() => {
    // the springboard flexes under the bounce
    const g = board.current
    if (!g) return
    const t = workout.station?.id === 'fp-cannon' && workout.action >= 0 ? workout.action : -1
    const flex = t >= 0 && t < 0.34 ? Math.sin((t / 0.34) * Math.PI) * 0.09 : t >= 0.34 && t < 0.6 ? Math.sin(((t - 0.34) / 0.26) * Math.PI * 3) * 0.03 * (1 - (t - 0.34) / 0.26) : 0
    g.rotation.z = flex
  })
  const [bx, bz] = world(baseLx, 0.6)
  const L = baseLx - tipLx
  return (
    <group position={[bx, deck, bz]} rotation={[0, POOL.angle, 0]}>
      {/* the stand */}
      <mesh position={[-0.5, 0.3, 0]} material={m.chrome} castShadow><boxGeometry args={[0.9, 0.6, 0.5]} /></mesh>
      <mesh position={[-0.5, 0.05, 0]} material={m.steel}><boxGeometry args={[1.2, 0.1, 0.7]} /></mesh>
      {/* the board, hinged at the back */}
      <group ref={board} position={[0, top - deck - 0.03, 0]}>
        <mesh position={[-L / 2, 0, 0]} material={m.white} castShadow receiveShadow><boxGeometry args={[L, 0.06, 0.5]} /></mesh>
        <mesh position={[-L / 2 - 0.4, 0.032, 0]} material={m.sand}><boxGeometry args={[L - 0.9, 0.005, 0.46]} /></mesh>
      </group>
      {/* the ladder up to it */}
      {[-0.22, 0.22].map((z) => (
        <mesh key={z} position={[0.25, 0.3, z]} material={m.chrome}><cylinderGeometry args={[0.02, 0.02, 0.62, 8]} /></mesh>
      ))}
    </group>
  )
}

