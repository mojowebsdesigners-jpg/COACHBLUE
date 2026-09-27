import { useEffect, useMemo } from 'react'
import { Vector3, MeshStandardMaterial, Color } from 'three'
import {
  LAKE, addCollider, groundHeight, pathCurve, pathDistance, streamDistanceAt, terrainNormalY,
} from '../../lib/terrain'
import { scannedTexture } from '../../lib/materials'
import { exerciseById } from '../../data/exercises'
import { locations } from '../../data/journey'
import { startWorkout, type Station } from '../../systems/Workout'
import { registerInteractable } from './InteractionSystem'

/**
 * Somewhere to sit.
 *
 * A seat is a station like any piece of gym kit: pressing E walks him to it,
 * turns him round and lowers him onto its actual surface (the same enter and
 * leave blend the lifts use), and E again stands him up where he came from.
 * `at` is where the hips go, `yaw` the way he faces once sat, `height` the
 * top of the seat above `ground`.
 */
export function registerSeat(opts: {
  id: string
  at: [number, number]
  ground: number
  yaw: number
  height: number
  kind?: 'sit' | 'lounge'
  label?: string
}) {
  const def = exerciseById[opts.kind ?? 'sit']
  const station: Station = {
    id: opts.id, def, spot: opts.at, yaw: opts.yaw, ground: opts.ground,
    grip: { height: opts.height },
  }
  // the prompt stands in front of the seat, where you would walk up to it
  const fx = Math.sin(opts.yaw), fz = Math.cos(opts.yaw)
  return registerInteractable({
    id: opts.id,
    label: opts.label ?? (opts.kind === 'lounge' ? 'LIE BACK' : 'SIT DOWN'),
    verb: 'LOOK',
    position: new Vector3(opts.at[0] + fx * 0.6, opts.ground + 0.9, opts.at[1] + fz * 0.6),
    radius: 1.7,
    panel: null,
    action: () => startWorkout(station),
  })
}

// ---------------------------------------------------------------- the bench
const SEAT_H = 0.45
const LEN = 1.8

function useBenchMaterials() {
  return useMemo(() => {
    const wood = new MeshStandardMaterial({
      map: scannedTexture('timber_diff', 1, true), normalMap: scannedTexture('timber_nor', 1),
      roughness: 0.82, color: new Color('#b48a60'),
    })
    const iron = new MeshStandardMaterial({ color: '#23262a', roughness: 0.55, metalness: 0.6 })
    return { wood, iron }
  }, [])
}

/**
 * A park bench: five hardwood slats on two cast-iron frames, three more on
 * the backrest, bolted down. Built at real size — a 45 cm seat, a slight
 * rake to the back — so the sitting pose lands on it rather than near it.
 */
export function ParkBench({ id, x, z, yaw }: { id: string; x: number; z: number; yaw: number }) {
  const m = useBenchMaterials()
  const y = groundHeight(x, z)
  useEffect(() => {
    addCollider({ x, z, hx: LEN / 2, hz: 0.32, angle: yaw })
    // hips back against the backrest, on the left half of the bench (the
    // right half is where someone else may already be sitting)
    const hx = x - Math.sin(yaw) * 0.06 - Math.cos(yaw) * 0.42
    const hz = z - Math.cos(yaw) * 0.06 + Math.sin(yaw) * 0.42
    return registerSeat({ id, at: [hx, hz], ground: y, yaw, height: SEAT_H })
  }, [id, x, z, y, yaw])
  return (
    <group position={[x, y, z]} rotation={[0, yaw, 0]}>
      {/* seat slats, front to back */}
      {[0.19, 0.095, 0, -0.095, -0.19].map((pz) => (
        <mesh key={pz} position={[0, SEAT_H - 0.02, pz]} material={m.wood} castShadow receiveShadow>
          <boxGeometry args={[LEN, 0.035, 0.08]} />
        </mesh>
      ))}
      {/* backrest, raked back */}
      <group position={[0, SEAT_H + 0.05, -0.25]} rotation={[-0.2, 0, 0]}>
        {[0.1, 0.22, 0.34].map((py) => (
          <mesh key={py} position={[0, py, 0]} material={m.wood} castShadow receiveShadow>
            <boxGeometry args={[LEN, 0.09, 0.03]} />
          </mesh>
        ))}
      </group>
      {/* two cast-iron side frames: leg, seat bearer, arm */}
      {[-LEN / 2 + 0.12, LEN / 2 - 0.12].map((px) => (
        <group key={px} position={[px, 0, 0]}>
          <mesh position={[0, SEAT_H / 2, 0.17]} material={m.iron} castShadow>
            <boxGeometry args={[0.05, SEAT_H, 0.05]} />
          </mesh>
          <mesh position={[0, (SEAT_H + 0.45) / 2, -0.24]} rotation={[-0.12, 0, 0]} material={m.iron} castShadow>
            <boxGeometry args={[0.05, SEAT_H + 0.45, 0.05]} />
          </mesh>
          <mesh position={[0, SEAT_H - 0.05, -0.02]} material={m.iron} castShadow>
            <boxGeometry args={[0.05, 0.05, 0.46]} />
          </mesh>
          <mesh position={[0, SEAT_H + 0.2, 0.02]} material={m.iron} castShadow>
            <boxGeometry args={[0.06, 0.04, 0.42]} />
          </mesh>
          <mesh position={[0, SEAT_H + 0.09, 0.2]} material={m.iron}>
            <boxGeometry args={[0.04, 0.2, 0.04]} />
          </mesh>
          {/* the feet, bolted to a pad so it reads as fixed, not dropped */}
          <mesh position={[0, 0.01, -0.03]} material={m.iron} receiveShadow>
            <boxGeometry args={[0.12, 0.02, 0.56]} />
          </mesh>
        </group>
      ))}
    </group>
  )
}

// ---------------------------------------------------------------- where
/** A place beside the road at path parameter t, facing back towards it. */
function beside(t: number, offset: number) {
  const p = pathCurve.getPoint(t)
  const tan = pathCurve.getTangent(t)
  const nx = -tan.z * offset
  const nz = tan.x * offset
  return { x: p.x + nx, z: p.z + nz, facing: Math.atan2(-nx, -nz) }
}

function clearSpot(x: number, z: number) {
  if (streamDistanceAt(x, z) < 5) return false
  if (terrainNormalY(x, z).slope > 0.22) return false
  if (locations.some((l) => Math.hypot(x - l.pos[0], z - l.pos[1]) < l.pad + 3)) return false
  return true
}

/**
 * Benches along the road, every so often, facing it — the places a walker
 * or a runner stops — and two on the lake shore, facing the water.
 */
let cachedSpots: { x: number; z: number; yaw: number }[] | null = null
/** Where the benches stand (computed once; people are seated on some). */
export function benchSpots() {
  if (cachedSpots) return cachedSpots
  cachedSpots = computeBenchSpots()
  return cachedSpots
}

export function Benches() {
  const spots = benchSpots()
  return (
    <group>
      {spots.map((s, i) => <ParkBench key={i} id={`bench-${i}`} x={s.x} z={s.z} yaw={s.yaw} />)}
    </group>
  )
}

function computeBenchSpots() {
  {
    const out: { x: number; z: number; yaw: number }[] = []
    const ts = [0.07, 0.16, 0.26, 0.37, 0.5, 0.63, 0.74, 0.86]
    ts.forEach((t, i) => {
      for (const off of [i % 2 ? 9.2 : -9.2, i % 2 ? -9.2 : 9.2]) {
        const b = beside(t, off)
        if (clearSpot(b.x, b.z) && pathDistance(b.x, b.z) > 7.5) {
          out.push({ x: b.x, z: b.z, yaw: b.facing })
          break
        }
      }
    })
    // the lake shore: find two level spots looking out over the water
    for (const a of [2.2, 3.4, 4.6, 5.8, 1.0]) {
      if (out.length >= ts.length + 2) break
      const r = LAKE.r + 4.5
      const x = LAKE.x + Math.cos(a) * r, z = LAKE.z + Math.sin(a) * r
      if (!clearSpot(x, z) || pathDistance(x, z) < 6) continue
      out.push({ x, z, yaw: Math.atan2(LAKE.x - x, LAKE.z - z) })
    }
    return out
  }
}
