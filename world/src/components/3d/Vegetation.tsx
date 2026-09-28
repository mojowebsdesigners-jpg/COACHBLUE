import { useEffect, useMemo, useRef } from 'react'
import { registerInstanceCull } from '../../lib/instanceCull'
import { useGLTF } from '@react-three/drei'
import {
  BufferAttribute, BufferGeometry, Color, CylinderGeometry, DoubleSide,
  IcosahedronGeometry, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, Object3D,
  PlaneGeometry, SphereGeometry,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { createNoise2D } from 'simplex-noise'
import { locations } from '../../data/journey'
import {
  addCollider, pathDistance, rand, streamDistanceAt, terrainHeight, terrainNormalY, gymOutside } from '../../lib/terrain'
import { useStore } from '../../state/store'
import { applyWind } from './Forest'

// ---------------------------------------------------------------- helpers
function tint(g: BufferGeometry, bottom: string, top: string, jitter = 0.08) {
  const p = g.attributes.position as BufferAttribute
  const colors = new Float32Array(p.count * 3)
  const a = new Color(bottom)
  const b = new Color(top)
  const c = new Color()
  let min = Infinity
  let max = -Infinity
  for (let i = 0; i < p.count; i++) {
    min = Math.min(min, p.getY(i))
    max = Math.max(max, p.getY(i))
  }
  for (let i = 0; i < p.count; i++) {
    const t = max > min ? (p.getY(i) - min) / (max - min) : 0.5
    c.copy(a).lerp(b, t)
    const j = 1 + (rand() - 0.5) * jitter
    colors[i * 3] = c.r * j
    colors[i * 3 + 1] = c.g * j
    colors[i * 3 + 2] = c.b * j
  }
  g.setAttribute('color', new BufferAttribute(colors, 3))
  return g
}

function roughen(g: BufferGeometry, amount: number) {
  const p = g.attributes.position as BufferAttribute
  for (let i = 0; i < p.count; i++) {
    p.setXYZ(
      i,
      p.getX(i) * (1 + (rand() - 0.5) * amount),
      p.getY(i) * (1 + (rand() - 0.5) * amount * 0.4),
      p.getZ(i) * (1 + (rand() - 0.5) * amount),
    )
  }
  g.computeVertexNormals()
  return g
}

// ---------------------------------------------------------------- species
function bushGeometry() {
  const parts: BufferGeometry[] = []
  for (let i = 0; i < 5; i++) {
    const r = 0.35 + rand() * 0.45
    const blob = new SphereGeometry(r, 7, 5)
    roughen(blob, 0.4)
    blob.translate((rand() - 0.5) * 0.7, r * 0.75, (rand() - 0.5) * 0.7)
    parts.push(tint(blob, '#24391f', '#46632e', 0.22))
  }
  return mergeGeometries(parts, false)!
}

function fernGeometry() {
  const parts: BufferGeometry[] = []
  for (let i = 0; i < 6; i++) {
    const frond = new PlaneGeometry(0.16, 0.95, 1, 4)
    const p = frond.attributes.position as BufferAttribute
    for (let v = 0; v < p.count; v++) {
      const t = (p.getY(v) + 0.475) / 0.95
      p.setZ(v, -t * t * 0.42)                 // arc the frond over
      p.setX(v, p.getX(v) * (1 - t * 0.75))    // and taper it
    }
    frond.rotateY((i / 6) * Math.PI * 2 + rand() * 0.4)
    frond.translate(0, 0.42, 0)
    frond.computeVertexNormals()
    parts.push(tint(frond, '#2c4520', '#517a34', 0.18))
  }
  return mergeGeometries(parts, false)!
}

function logGeometry() {
  const g = new CylinderGeometry(0.28, 0.34, 3.4, 9)
  roughen(g, 0.12)
  g.rotateZ(Math.PI / 2)
  g.translate(0, 0.3, 0)
  return tint(g, '#463526', '#6a5943', 0.16)
}

function rockGeometry(seed: number) {
  const g = new IcosahedronGeometry(1, seed % 2 === 0 ? 1 : 2)
  roughen(g, 0.55)
  g.scale(1, 0.62 + rand() * 0.5, 0.9 + rand() * 0.3)
  return tint(g, '#4a4a46', '#7d7d75', 0.14)
}

function flowerGeometry() {
  const parts: BufferGeometry[] = []
  for (let i = 0; i < 3; i++) {
    const stem = new CylinderGeometry(0.008, 0.012, 0.3, 4)
    stem.translate((rand() - 0.5) * 0.12, 0.15, (rand() - 0.5) * 0.12)
    parts.push(tint(stem, '#3c5a2a', '#4d6f33', 0.1))
    const head = new SphereGeometry(0.045, 6, 5)
    head.translate((rand() - 0.5) * 0.12, 0.31, (rand() - 0.5) * 0.12)
    parts.push(tint(head, '#d9d2b4', '#f0e9cd', 0.25))
  }
  return mergeGeometries(parts, false)!
}

export function mushroomGeometry() {
  const stem = new CylinderGeometry(0.018, 0.025, 0.11, 5)
  stem.translate(0, 0.055, 0)
  const cap = new SphereGeometry(0.06, 7, 5, 0, Math.PI * 2, 0, Math.PI / 2)
  cap.scale(1, 0.62, 1)
  cap.translate(0, 0.11, 0)
  return mergeGeometries([tint(stem, '#cfc6ac', '#e6dcc2'), tint(cap, '#6d3f2a', '#8d5334', 0.2)], false)!
}

// ---------------------------------------------------------------- placement
const clusterNoise = createNoise2D(() => 0.77)

type Spot = { x: number; z: number; y: number; s: number; rot: number; slope: number }

/**
 * Clustered scatter: denser where the cluster field is high, so the forest has
 * thickets and clearings instead of an even carpet.
 */
function scatterClustered(count: number, opts: {
  minPath: number; maxSlope: number; maxHeight?: number; clusterBias?: number
}) {
  const out: Spot[] = []
  let guard = 0
  while (out.length < count && guard < count * 80) {
    guard++
    const a = rand() * Math.PI * 2
    const r = Math.sqrt(rand()) * 235
    const x = Math.cos(a) * r
    const z = Math.sin(a) * r
    if (pathDistance(x, z) < opts.minPath) continue
    if (streamDistanceAt(x, z) < 4.5) continue
    if (locations.some((l) => Math.hypot(x - l.pos[0], z - l.pos[1]) < l.pad + 4)) continue
    if (gymOutside(x, z) < 3) continue
    const { slope } = terrainNormalY(x, z)
    if (slope > opts.maxSlope) continue
    const y = terrainHeight(x, z)
    if (y > (opts.maxHeight ?? 42)) continue
    const cluster = (clusterNoise(x / 55, z / 55) + 1) / 2
    if (rand() > cluster * (opts.clusterBias ?? 1.15)) continue
    out.push({ x, z, y, s: 0.72 + rand() * 0.9, rot: rand() * Math.PI * 2, slope })
  }
  return out
}

/**
 * The mushrooms on the woodland floor, which can be picked (see Forage): their
 * spots, the mesh drawing them, and which have been taken.
 */
export const mushrooms = {
  spots: [] as Spot[],
  mesh: null as InstancedMesh | null,
  picked: new Set<number>(),
}

function InstancedField({
  geometry, spots, scaleY = 1, sink = 0, collider, castShadow = true, wind, onMesh,
}: {
  geometry: BufferGeometry
  spots: Spot[]
  scaleY?: number
  sink?: number
  collider?: (s: Spot) => number | undefined
  castShadow?: boolean
  wind?: { strength: number; height: number }
  onMesh?: (mesh: InstancedMesh) => void
}) {
  const ref = useRef<InstancedMesh>(null)
  const material = useMemo(() => {
    const m = new MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: DoubleSide })
    return wind ? applyWind(m, wind.strength, wind.height) : m
  }, [wind])

  useEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    const dummy = new Object3D()
    spots.forEach((s, i) => {
      dummy.position.set(s.x, s.y - sink * s.s, s.z)
      dummy.rotation.set(0, s.rot, 0)
      dummy.scale.set(s.s, s.s * scaleY, s.s)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
      const r = collider?.(s)
      if (r) addCollider({ x: s.x, z: s.z, r })
    })
    mesh.count = spots.length
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
    onMesh?.(mesh)
    return registerInstanceCull(mesh, 30)
  }, [spots, scaleY, sink, collider, onMesh])

  if (spots.length === 0) return null
  return (
    <instancedMesh
      ref={ref}
      args={[geometry, material, Math.max(1, spots.length)]}
      castShadow={castShadow}
      receiveShadow
      frustumCulled={false}
    />
  )
}

/** Everything below knee height: bushes, ferns, logs, flowers, mushrooms. */
export function Understory() {
  const total = useStore((s) => s.preset.trees)

  const species = useMemo(
    () => ({
      bush: bushGeometry(),
      fern: fernGeometry(),
      log: logGeometry(),
      flowers: flowerGeometry(),
      mushroom: mushroomGeometry(),
    }),
    [],
  )

  const spots = useMemo(() => {
    return {
      bushes: scatterClustered(Math.round(total * 0.55), { minPath: 3.4, maxSlope: 1.1, clusterBias: 1.4 }),
      ferns: scatterClustered(Math.round(total * 0.8), { minPath: 2.6, maxSlope: 1.0, clusterBias: 1.5 }),
      logs: scatterClustered(Math.round(total * 0.05), { minPath: 5, maxSlope: 0.5 }),
      flowers: scatterClustered(Math.round(total * 0.5), { minPath: 2.2, maxSlope: 0.7, clusterBias: 1.6 }),
      mushrooms: scatterClustered(Math.round(total * 0.25), { minPath: 3, maxSlope: 0.8, clusterBias: 1.7 }),
    }
  }, [total])

  // publish the mushrooms, so they can be found and picked
  mushrooms.spots = spots.mushrooms
  const onMushrooms = useMemo(() => (mesh: InstancedMesh) => {
    mushrooms.mesh = mesh
    mushrooms.picked.clear()
  }, [])

  return (
    <group>
      <InstancedField geometry={species.bush} spots={spots.bushes} wind={{ strength: 0.08, height: 1.2 }} sink={0.15} />
      <InstancedField geometry={species.fern} spots={spots.ferns} wind={{ strength: 0.12, height: 1 }}
        castShadow={false} sink={0.05} />
      <InstancedField geometry={species.log} spots={spots.logs} collider={() => 0.55} sink={0.12} />
      <InstancedField geometry={species.flowers} spots={spots.flowers} wind={{ strength: 0.18, height: 0.4 }}
        castShadow={false} />
      <InstancedField geometry={species.mushroom} spots={spots.mushrooms} castShadow={false}
        onMesh={onMushrooms} />
    </group>
  )
}

/** Rocks: three procedural shapes plus the generated boulder, part-buried. */
export function Rocks() {
  const { scene } = useGLTF('/models/boulder.glb')
  const count = useStore((s) => s.preset.rocks)

  const boulder = useMemo(() => {
    let g: BufferGeometry | null = null
    scene.traverse((o) => {
      const m = o as Mesh
      if (!g && m.isMesh) {
        g = m.geometry.clone()
        g.applyMatrix4(new Matrix4().copy(m.matrixWorld))
        g.center()
        tint(g, '#4d4d47', '#6f6f66', 0.1)
      }
    })
    return g as unknown as BufferGeometry | null
  }, [scene])

  const variants = useMemo(() => [rockGeometry(0), rockGeometry(1), rockGeometry(2)], [])
  const spots = useMemo(
    () => scatterClustered(count, { minPath: 4, maxSlope: 1.6, maxHeight: 60, clusterBias: 1.3 }),
    [count],
  )

  const buckets = useMemo(() => {
    const out: Spot[][] = [[], [], [], []]
    spots.forEach((s, i) => out[i % (boulder ? 4 : 3)].push({ ...s, s: s.s * (0.8 + rand() * 1.5) }))
    return out
  }, [spots, boulder])

  return (
    <group>
      {variants.map((g, i) => (
        <InstancedField key={i} geometry={g} spots={buckets[i]} scaleY={0.8} sink={0.45}
          collider={(s) => s.s * 0.85} />
      ))}
      {boulder && (
        <InstancedField geometry={boulder} spots={buckets[3]} sink={0.4} collider={(s) => s.s * 0.9} />
      )}
    </group>
  )
}

useGLTF.preload('/models/boulder.glb')
