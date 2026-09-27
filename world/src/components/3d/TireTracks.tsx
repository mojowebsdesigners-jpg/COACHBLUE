import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { BufferAttribute, BufferGeometry, DynamicDrawUsage, MeshStandardMaterial } from 'three'
import { CAR, vehicle, surfaceAt } from '../../systems/VehicleController'
import { groundHeight, terrainNormalY, waterSurfaceAt } from '../../lib/terrain'
import { requestGrassRefresh } from './Ground'

/**
 * Tyre tracks off the tarmac.
 *
 * Every tyre lays a strip of short quads behind it while the car rolls over
 * grass or dirt: pressed-down grass is a darker, flattened green, dirt a deep
 * brown rut. All of it lives in one ring buffer — a single draw call however
 * far you drive — and the oldest quads are recycled as new ones go down, after
 * fading out over the last part of their life. Nothing is laid on the road.
 */
const SEGMENTS = 2400
const SEG_LEN = 0.55          // metres of travel per quad
const LIFE = 45               // seconds before a track has gone
const FADE = 15               // the last seconds of that, it fades
const HALF_W = 0.14           // half a tyre's width

const COLORS = {
  1: [0.075, 0.07, 0.035],    // pressed grass: crushed, with soil showing
  2: [0.06, 0.04, 0.025],     // churned dirt
} as const

/** A coarse record of where tyres have pressed, for anything that wants to know. */
const pressed = new Map<number, number>()
const cell = (x: number, z: number) => (Math.floor(x / 0.6) + 4096) * 8192 + (Math.floor(z / 0.6) + 4096)
/** 0..1: how freshly a tyre has pressed the ground here. */
export function trackPress(x: number, z: number) {
  const t = pressed.get(cell(x, z))
  if (t === undefined) return 0
  const age = performance.now() / 1000 - t
  return age > LIFE ? 0 : 1 - Math.max(0, age - (LIFE - FADE)) / FADE
}

export function TireTracks() {
  const geo = useMemo(() => {
    const g = new BufferGeometry()
    const pos = new BufferAttribute(new Float32Array(SEGMENTS * 4 * 3), 3)
    const col = new BufferAttribute(new Float32Array(SEGMENTS * 4 * 4), 4)
    pos.setUsage(DynamicDrawUsage)
    col.setUsage(DynamicDrawUsage)
    g.setAttribute('position', pos)
    g.setAttribute('color', col)
    const idx = new Uint32Array(SEGMENTS * 6)
    for (let i = 0; i < SEGMENTS; i++) {
      const v = i * 4
      idx.set([v, v + 2, v + 1, v + 1, v + 2, v + 3], i * 6)
    }
    g.setIndex(new BufferAttribute(idx, 1))
    g.setDrawRange(0, 0)
    return g
  }, [])

  const mat = useMemo(() => new MeshStandardMaterial({
    vertexColors: true, transparent: true, depthWrite: false, roughness: 1,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
  }), [])

  const state = useRef({
    next: 0,
    used: 0,
    birth: new Float32Array(SEGMENTS),
    alpha: new Float32Array(SEGMENTS),
    surf: new Uint8Array(SEGMENTS),
    // the last point laid by each wheel, and whether it is mid-strip
    last: [0, 1, 2, 3].map(() => ({ x: 0, z: 0, lx: 0, lz: 0, on: false })),
    fadeClock: 0,
    grassClock: 0,
  })

  useFrame((_, delta) => {
    const s = state.current
    const now = performance.now() / 1000
    const pos = geo.attributes.position as BufferAttribute
    const col = geo.attributes.color as BufferAttribute
    let touched = false

    if (vehicle.occupied && Math.abs(vehicle.speed) > 0.4) {
      const c = Math.cos(vehicle.yaw), sn = Math.sin(vehicle.yaw)
      for (let w = 0; w < 4; w++) {
        const lx = (w % 2 === 0 ? 1 : -1) * CAR.track / 2
        const lz = (w < 2 ? 1 : -1) * CAR.wheelBase / 2
        const x = vehicle.pos.x + lx * c + lz * sn
        const z = vehicle.pos.z - lx * sn + lz * c
        const surf = surfaceAt(x, z)
        const L = s.last[w]
        if (surf === 0 || waterSurfaceAt(x, z) !== null) {
          L.on = false
          continue
        }
        if (!L.on) {
          L.x = x; L.z = z; L.on = true
          L.lx = c; L.lz = -sn            // across the tyre
          continue
        }
        const dx = x - L.x, dz = z - L.z
        const d = Math.hypot(dx, dz)
        if (d < SEG_LEN) continue
        // across-vector for this end of the quad
        const ax = dz / d, az = -dx / d
        const i = s.next
        const v = i * 4
        const put = (k: number, px: number, pz: number) => {
          const { hx, hz } = terrainNormalY(px, pz)
          // sit on the ground, lifted a hair more on steep ground
          pos.setXYZ(v + k, px, groundHeight(px, pz) + 0.025 + Math.hypot(hx, hz) * 0.02, pz)
        }
        put(0, L.x - L.lx * HALF_W, L.z - L.lz * HALF_W)
        put(1, L.x + L.lx * HALF_W, L.z + L.lz * HALF_W)
        put(2, x - ax * HALF_W, z - az * HALF_W)
        put(3, x + ax * HALF_W, z + az * HALF_W)
        s.birth[i] = now
        s.surf[i] = surf
        s.alpha[i] = -1
        L.x = x; L.z = z; L.lx = ax; L.lz = az
        pressed.set(cell(x, z), now)
        s.next = (s.next + 1) % SEGMENTS
        s.used = Math.min(SEGMENTS, s.used + 1)
        touched = true
      }
    } else {
      for (const L of s.last) L.on = false
    }

    // fade on a slow clock: a few thousand vertices four times a second
    s.fadeClock += delta
    if (touched || s.fadeClock > 0.25) {
      s.fadeClock = 0
      for (let i = 0; i < s.used; i++) {
        const age = now - s.birth[i]
        const a = age > LIFE ? 0 : Math.min(1, (LIFE - age) / FADE)
        const target = a * (s.surf[i] === 2 ? 0.9 : 0.82)
        if (Math.abs(target - s.alpha[i]) < 0.01) continue
        s.alpha[i] = target
        const [r, g, b] = COLORS[s.surf[i] as 1 | 2]
        for (let k = 0; k < 4; k++) col.setXYZW(i * 4 + k, r, g, b, target)
      }
      col.needsUpdate = true
    }
    // flatten the lawn along fresh grass tracks, a sweep at a time
    s.grassClock += delta
    if (touched && s.grassClock > 1.2) {
      s.grassClock = 0
      requestGrassRefresh()
    }
    if (touched) {
      pos.needsUpdate = true
      geo.setDrawRange(0, s.used * 6)
    }
  })

  // noCull: the buffer's bounds are meaningless (it is a ring spread over the
  // whole valley), so the distance culler must leave it alone
  return <mesh geometry={geo} material={mat} frustumCulled={false} receiveShadow renderOrder={1}
    userData={{ noCull: true }} />
}
