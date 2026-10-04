import { useEffect, useMemo, useRef } from 'react'
import { registerInstanceCull } from '../../lib/instanceCull'
import {
  BufferGeometry, Color, CylinderGeometry, DoubleSide, Float32BufferAttribute, InstancedMesh, Matrix4, Object3D,
  PlaneGeometry, Quaternion, Vector3, type BufferAttribute,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { createNoise2D } from 'simplex-noise'
import { locations } from '../../data/journey'
import { foliage, scanned } from '../../lib/materials'
import {
  addCollider, forestDensity, forestNoise, pathDistance, rand, streamDistanceAt, terrainHeight, terrainNormalY, gymOutside } from '../../lib/terrain'
import { useStore } from '../../state/store'
import { applyWind } from './Forest'

/**
 * Trees built the way real-time trees are built: a tapered, textured trunk with
 * branches, and alpha-cut leaf cards clustered on the branch ends. Two meshes
 * per species (wood, foliage) so bark and leaves can use their own materials.
 */
type Limb = { from: Vector3; to: Vector3; r0: number; r1: number; depth: number }

const up = new Vector3(0, 1, 0)

function limbGeometry(limbs: Limb[], radial = 7) {
  const parts: BufferGeometry[] = []
  const dir = new Vector3()
  const q = new Quaternion()
  for (const l of limbs) {
    dir.copy(l.to).sub(l.from)
    const len = dir.length()
    if (len < 0.01) continue
    const g = new CylinderGeometry(l.r1, l.r0, len, radial, 1, true)
    g.translate(0, len / 2, 0)
    q.setFromUnitVectors(up, dir.clone().normalize())
    g.applyMatrix4(new Matrix4().makeRotationFromQuaternion(q))
    g.translate(l.from.x, l.from.y, l.from.z)
    parts.push(g)
  }
  const merged = mergeGeometries(parts, false)!
  merged.computeVertexNormals()
  return merged
}

function cardGeometry(spots: { pos: Vector3; size: number }[], quads = 3, rnd: () => number = rand) {
  const parts: BufferGeometry[] = []
  for (const s of spots) {
    // each cluster its own shade and warmth; lower, inner clusters darker
    const shade = 0.78 + rnd() * 0.34
    const warm = (rnd() - 0.5) * 0.12
    // three crossed quads per cluster reads as volume from any angle
    for (let k = 0; k < quads; k++) {
      const g = new PlaneGeometry(s.size, s.size)
      g.rotateZ(rnd() * Math.PI * 2)
      g.rotateY((k / quads) * Math.PI + rnd() * 0.4)
      g.rotateX((rnd() - 0.5) * 0.9)
      g.translate(s.pos.x, s.pos.y, s.pos.z)
      const n = g.attributes.position.count
      const col = new Float32Array(n * 3)
      for (let i = 0; i < n; i++) {
        col[i * 3] = shade * (1 + warm)
        col[i * 3 + 1] = shade
        col[i * 3 + 2] = shade * (1 - warm * 1.5)
      }
      g.setAttribute('color', new Float32BufferAttribute(col, 3))
      parts.push(g)
    }
  }
  const merged = mergeGeometries(parts, false)!
  merged.computeVertexNormals()
  return merged
}

/** A small seeded generator for the stand-in trees' leaf cards. */
function lodRandom(seed: number) {
  let t = (seed * 2654435761) >>> 0
  return () => {
    t = (t + 0x6d2b79f5) >>> 0
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

/** Recursive branching: trunk splits into limbs, limbs into twigs. */
function growTree(opts: {
  height: number
  baseRadius: number
  splits: number
  spread: number
  leafSize: number
  leafPerTip: number
  droop: number
  crownStart: number
}) {
  const limbs: Limb[] = []
  const tips: { pos: Vector3; size: number }[] = []

  const grow = (from: Vector3, dir: Vector3, len: number, radius: number, depth: number) => {
    const to = from.clone().addScaledVector(dir, len)
    // bend the limb slightly so nothing is dead straight
    to.x += (rand() - 0.5) * len * 0.22
    to.z += (rand() - 0.5) * len * 0.22
    limbs.push({ from, to, r0: radius, r1: radius * 0.68, depth })

    if (depth >= opts.splits || len < 0.5) {
      tips.push({ pos: to, size: opts.leafSize * (0.75 + rand() * 0.6) })
      // clusters along the last limb too, not only at its tip
      for (let i = 0; i < 2; i++) {
        tips.push({ pos: from.clone().lerp(to, 0.45 + rand() * 0.4), size: opts.leafSize * (0.6 + rand() * 0.5) })
      }
      for (let i = 0; i < opts.leafPerTip - 1; i++) {
        tips.push({
          pos: to.clone().add(new Vector3(
            (rand() - 0.5) * len * 0.9,
            (rand() - 0.4) * len * 0.7,
            (rand() - 0.5) * len * 0.9,
          )),
          size: opts.leafSize * (0.6 + rand() * 0.7),
        })
      }
      return
    }

    const children = depth === 0 ? 3 + Math.floor(rand() * 2) : 2 + Math.floor(rand() * 2)
    for (let i = 0; i < children; i++) {
      const a = (i / children) * Math.PI * 2 + rand() * 1.2
      const tilt = opts.spread * (0.5 + rand() * 0.8)
      const child = new Vector3(
        Math.cos(a) * Math.sin(tilt),
        Math.cos(tilt) - opts.droop * depth * 0.12,
        Math.sin(a) * Math.sin(tilt),
      ).normalize()
      // blend toward the parent direction so branches follow the tree's flow
      child.lerp(dir, 0.35).normalize()
      grow(to.clone(), child, len * (0.62 + rand() * 0.16), radius * 0.62, depth + 1)
    }
  }

  // the trunk itself, in a few segments so it can lean
  let pos = new Vector3(0, 0, 0)
  let dir = new Vector3((rand() - 0.5) * 0.06, 1, (rand() - 0.5) * 0.06).normalize()
  const segs = 4
  const trunkLen = opts.height * opts.crownStart
  let radius = opts.baseRadius
  for (let i = 0; i < segs; i++) {
    const to = pos.clone().addScaledVector(dir, trunkLen / segs)
    limbs.push({ from: pos.clone(), to: to.clone(), r0: radius, r1: radius * 0.82, depth: -1 })
    radius *= 0.82
    pos = to
    dir = dir.clone().add(new Vector3((rand() - 0.5) * 0.12, 0, (rand() - 0.5) * 0.12)).normalize()
  }
  grow(pos, dir, opts.height * (1 - opts.crownStart) * 0.55, radius, 0)

  // The same tree for the middle distance: trunk and main limbs only, with a
  // third as many leaf clusters, larger, covering the same crown. A fraction
  // of the vertices, and past a few dozen metres the twigs it drops are
  // sub-pixel.
  const farTips = tips.filter((_, i) => i % 3 === 0).map((t) => ({ pos: t.pos, size: t.size * 1.7 }))
  const leaves = cardGeometry(tips)
  // and for far off, where the fog is already softening it: the trunk and a
  // few big clusters, about a twelfth of the full tree
  const farthest = tips.filter((_, i) => i % 8 === 0).map((t) => ({ pos: t.pos, size: t.size * 2.4 }))
  return {
    wood: limbGeometry(limbs),
    leaves: opts.leafSize > 0 ? leaves : null,
    woodLod: limbGeometry(limbs.filter((l) => l.depth <= 1), 4),
    // its own random stream: drawing from the world's would move every tree
    leavesLod: opts.leafSize > 0 ? cardGeometry(farTips, 3, lodRandom(tips.length)) : null,
    woodFar: limbGeometry(limbs.filter((l) => l.depth <= 0), 3),
    leavesFar: opts.leafSize > 0 ? cardGeometry(farthest, 2, lodRandom(tips.length + 7)) : null,
  }
}

const SPECIES = {
  // conifers only up on the heights
  pine: () => growTree({
    height: 14, baseRadius: 0.34, splits: 2, spread: 1.15, leafSize: 2.4,
    leafPerTip: 2, droop: 0.9, crownStart: 0.42,
  }),
  // the woodland: tall, clean trunks and a high, full crown (beech)
  broadleaf: () => growTree({
    height: 19, baseRadius: 0.36, splits: 3, spread: 0.8, leafSize: 2.6,
    leafPerTip: 5, droop: 0.35, crownStart: 0.55,
  }),
  // and broader, lower crowns in the open (oak)
  oak: () => growTree({
    height: 15, baseRadius: 0.5, splits: 3, spread: 1.1, leafSize: 2.8,
    leafPerTip: 5, droop: 0.5, crownStart: 0.36,
  }),
  young: () => growTree({
    height: 7, baseRadius: 0.13, splits: 2, spread: 0.9, leafSize: 1.6,
    leafPerTip: 4, droop: 0.4, crownStart: 0.45,
  }),
  dead: () => growTree({
    height: 10, baseRadius: 0.28, splits: 3, spread: 1.25, leafSize: 0,
    leafPerTip: 0, droop: 0.2, crownStart: 0.45,
  }),
}

const clusterNoise = forestNoise
const speciesNoise = createNoise2D(() => 0.42)

type Spot = { x: number; z: number; y: number; s: number; rot: number }

function scatter(count: number, opts: { minPath: number; maxSlope: number; bias?: number }) {
  const out: Spot[] = []
  let guard = 0
  while (out.length < count && guard < count * 70) {
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
    if (y > 44) continue
    const cluster = (clusterNoise(x / 52, z / 52) + 1) / 2
    if (rand() > cluster * (opts.bias ?? 1.2)) continue
    out.push({ x, z, y, s: 0.72 + rand() * 0.75, rot: rand() * Math.PI * 2 })
  }
  return out
}

type Variant = {
  wood: BufferGeometry; leaves: BufferGeometry | null; woodLod: BufferGeometry; leavesLod: BufferGeometry | null
  woodFar: BufferGeometry; leavesFar: BufferGeometry | null
}

function Species({ v, spots, collide }: { v: Variant; spots: Spot[]; collide: boolean }) {
  const { wood, woodLod } = v
  const leaves = v.leaves && v.leavesLod ? v.leaves : null
  const leavesLod = leaves ? v.leavesLod : null
  const leavesFar = leaves ? v.leavesFar : null
  const woodRef = useRef<InstancedMesh>(null)
  const leafRef = useRef<InstancedMesh>(null)
  const woodLodRef = useRef<InstancedMesh>(null)
  const leafLodRef = useRef<InstancedMesh>(null)
  const woodFarRef = useRef<InstancedMesh>(null)
  const leafFarRef = useRef<InstancedMesh>(null)
  const barkMat = useMemo(() => scanned('bark', 2, { roughness: 0.95 }), [])
  const leafMat = useMemo(
    () => applyWind(foliage('leafcluster', {
      side: DoubleSide, vertexColors: true,
      // light coming through the leaves: the canopy is never black underneath
      emissive: new Color('#20380f'), emissiveIntensity: 0.55,
    }), 0.02, 14),
    [],
  )

  useEffect(() => {
    const dummy = new Object3D()
    for (const mesh of [woodRef.current, leafRef.current]) {
      if (!mesh) continue
      spots.forEach((s, i) => {
        dummy.position.set(s.x, s.y - 0.15, s.z)
        dummy.rotation.set(0, s.rot, 0)
        dummy.scale.setScalar(s.s)
        dummy.updateMatrix()
        mesh.setMatrixAt(i, dummy.matrix)
      })
      mesh.count = spots.length
      mesh.instanceMatrix.needsUpdate = true
      mesh.computeBoundingSphere()
    }
    if (collide) spots.forEach((s) => addCollider({ x: s.x, z: s.z, r: 0.45 * s.s + 0.25 }))
    // draw only the trees that can be seen (or can shade what is seen), and
    // the simpler stand-in for those further off
    const lodFrom = useStore.getState().preset.treeLod
    const offs = ([
      [woodRef.current, woodLodRef.current, woodFarRef.current],
      [leafRef.current, leafLodRef.current, leafFarRef.current],
    ] as const)
      .filter(([m]) => m)
      .map(([m, lod, far]) => registerInstanceCull(
        m!, 45,
        lod ? { mesh: lod, from: lodFrom } : null,
        far ? { mesh: far, from: lodFrom * 2.2 } : null,
      ))
    return () => offs.forEach((o) => o())
  }, [spots, collide])

  if (spots.length === 0) return null
  return (
    <>
      <instancedMesh ref={woodRef} args={[wood, barkMat, spots.length]} castShadow receiveShadow frustumCulled={false} />
      {/* the far stand-ins cast no shadow: the sun's shadow only covers the
          few dozen metres round him, and without this every distant tree in
          view was drawn a second time for nothing */}
      <instancedMesh ref={woodLodRef} args={[woodLod, barkMat, spots.length]} count={0} receiveShadow frustumCulled={false} />
      {leaves && (
        <instancedMesh ref={leafRef} args={[leaves, leafMat, spots.length]} castShadow receiveShadow frustumCulled={false} />
      )}
      {leavesLod && (
        <instancedMesh ref={leafLodRef} args={[leavesLod, leafMat, spots.length]} count={0} receiveShadow frustumCulled={false} />
      )}
      <instancedMesh ref={woodFarRef} args={[v.woodFar, barkMat, spots.length]} count={0} frustumCulled={false} />
      {leavesFar && (
        <instancedMesh ref={leafFarRef} args={[leavesFar, leafMat, spots.length]} count={0} frustumCulled={false} />
      )}
    </>
  )
}

export function Trees() {
  const total = useStore((s) => s.preset.trees)

  // a handful of unique trees per species, so the forest never repeats obviously
  const variants = useMemo(() => ({
    pine: [SPECIES.pine(), SPECIES.pine(), SPECIES.pine()],
    broadleaf: [SPECIES.broadleaf(), SPECIES.broadleaf(), SPECIES.broadleaf(), SPECIES.broadleaf()],
    oak: [SPECIES.oak(), SPECIES.oak()],
    young: [SPECIES.young(), SPECIES.young()],
    dead: [SPECIES.dead()],
  }), [])

  const spots = useMemo(() => {
    const all = scatter(total, { minPath: 6.5, maxSlope: 0.85 })
    const groups = { pine: [] as Spot[][], broadleaf: [] as Spot[][], oak: [] as Spot[][], young: [] as Spot[][], dead: [] as Spot[][] }
    groups.pine = variants.pine.map(() => [])
    groups.broadleaf = variants.broadleaf.map(() => [])
    groups.oak = variants.oak.map(() => [])
    groups.young = variants.young.map(() => [])
    groups.dead = variants.dead.map(() => [])
    all.forEach((s, i) => {
      const n = speciesNoise(s.x / 85, s.z / 85)
      const dense = forestDensity(s.x, s.z)
      if (rand() < 0.02) groups.dead[i % groups.dead.length].push(s)
      else if (rand() < 0.16) groups.young[i % groups.young.length].push(s)
      else if (s.y > 26 || (n > 0.55 && s.y > 16)) groups.pine[i % groups.pine.length].push(s)
      else if (dense < 0.45) groups.oak[i % groups.oak.length].push(s)
      else groups.broadleaf[i % groups.broadleaf.length].push(s)
    })
    return groups
  }, [total, variants])

  return (
    <group>
      {variants.pine.map((v, i) => (
        <Species key={`p${i}`} v={v} spots={spots.pine[i]} collide />
      ))}
      {variants.broadleaf.map((v, i) => (
        <Species key={`b${i}`} v={v} spots={spots.broadleaf[i]} collide />
      ))}
      {variants.oak.map((v, i) => (
        <Species key={`o${i}`} v={v} spots={spots.oak[i]} collide />
      ))}
      {variants.young.map((v, i) => (
        <Species key={`y${i}`} v={v} spots={spots.young[i]} collide={false} />
      ))}
      {variants.dead.map((v, i) => (
        <Species key={`d${i}`} v={v} spots={spots.dead[i]} collide />
      ))}
    </group>
  )
}

export const _attr = (g: BufferGeometry) => g.attributes.position as BufferAttribute

/**
 * The woodland floor: ferns in the shade and low bushes between the trunks,
 * wherever the forest is thick. Static and instanced — one draw for all the
 * ferns, one for all the bushes — so it costs next to nothing per frame.
 */
export function Undergrowth() {
  const trees = useStore((s) => s.preset.trees)
  const fernRef = useRef<InstancedMesh>(null)
  const bushRef = useRef<InstancedMesh>(null)
  const nFern = Math.round(trees * 1.6)
  const nBush = Math.round(trees * 0.35)

  const { fernGeo, bushGeo, fernMat, bushMat } = useMemo(() => {
    const parts: BufferGeometry[] = []
    for (let k = 0; k < 3; k++) {
      const g = new PlaneGeometry(1.2, 1.2)
      g.translate(0, 0.6, 0)
      g.rotateX(-0.18)
      g.rotateY((k / 3) * Math.PI)
      parts.push(g)
    }
    const fernGeo = mergeGeometries(parts, false)!
    const bush: { pos: Vector3; size: number }[] = []
    for (let i = 0; i < 7; i++) {
      const a = rand() * Math.PI * 2, r = rand() * 0.5
      bush.push({ pos: new Vector3(Math.cos(a) * r, 0.45 + rand() * 0.5, Math.sin(a) * r), size: 1.1 + rand() * 0.5 })
    }
    return {
      fernGeo,
      bushGeo: cardGeometry(bush),
      fernMat: applyWind(foliage('fern', { side: DoubleSide, alphaTest: 0.4 }), 0.05, 1.2),
      bushMat: applyWind(foliage('leafcluster', {
        side: DoubleSide, vertexColors: true, emissive: new Color('#132408'), emissiveIntensity: 0.18, color: new Color('#b9c9a8'),
      }), 0.03, 1.6),
    }
  }, [])

  useEffect(() => {
    const dummy = new Object3D()
    const place = (mesh: InstancedMesh | null, count: number, minDensity: number, scale: [number, number]) => {
      if (!mesh) return
      let n = 0, guard = 0
      while (n < count && guard < count * 40) {
        guard++
        const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * 230
        const x = Math.cos(a) * r, z = Math.sin(a) * r
        if (forestDensity(x, z) < minDensity + rand() * 0.2) continue
        if (pathDistance(x, z) < 6 || streamDistanceAt(x, z) < 3) continue
        if (locations.some((l) => Math.hypot(x - l.pos[0], z - l.pos[1]) < l.pad + 2)) continue
        if (gymOutside(x, z) < 3) continue
        if (terrainNormalY(x, z).slope > 0.8) continue
        dummy.position.set(x, terrainHeight(x, z) - 0.05, z)
        dummy.rotation.set(0, rand() * Math.PI * 2, 0)
        dummy.scale.setScalar(scale[0] + rand() * (scale[1] - scale[0]))
        dummy.updateMatrix()
        mesh.setMatrixAt(n++, dummy.matrix)
      }
      mesh.count = n
      mesh.instanceMatrix.needsUpdate = true
      mesh.computeBoundingSphere()
    }
    place(fernRef.current, nFern, 0.28, [0.7, 1.35])
    place(bushRef.current, nBush, 0.3, [0.7, 1.5])
    const offs = [fernRef.current, bushRef.current].filter(Boolean).map((m) => registerInstanceCull(m!, 25))
    return () => offs.forEach((o) => o())
  }, [nFern, nBush])

  return (
    <>
      <instancedMesh ref={fernRef} args={[fernGeo, fernMat, nFern]} receiveShadow frustumCulled={false} />
      <instancedMesh ref={bushRef} args={[bushGeo, bushMat, nBush]} castShadow receiveShadow frustumCulled={false} />
    </>
  )
}
