import { useEffect, useMemo, useRef } from 'react'
import { registerInstanceCull } from '../../lib/instanceCull'
import { useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import {
  BufferAttribute, BufferGeometry, Color, ConeGeometry, CylinderGeometry,
  DoubleSide, DynamicDrawUsage, Float32BufferAttribute, InstancedMesh,
  Mesh, MeshStandardMaterial, Object3D, Points, PointsMaterial, Vector3,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { locations } from '../../data/journey'
import {
  addCollider, pathDistance, rand, streamDistanceAt, terrainHeight, terrainNormalY, gymOutside } from '../../lib/terrain'
import { player, useStore } from '../../state/store'

export const windTime = { value: 0 }

/** Adds a wind sway to any material, strongest at the top of the geometry. */
export function applyWind(mat: MeshStandardMaterial, strength = 0.05, height = 8) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = windTime
    shader.uniforms.uStrength = { value: strength }
    shader.uniforms.uHeight = { value: height }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uStrength;\nuniform float uHeight;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         #ifdef USE_INSTANCING
           float phase = instanceMatrix[3][0] * 0.6 + instanceMatrix[3][2] * 0.85;
         #else
           float phase = 0.0;
         #endif
         float amp = smoothstep(0.0, uHeight, transformed.y) * uStrength;
         float sway = sin(uTime * 1.15 + phase) + sin(uTime * 2.37 + phase * 1.6) * 0.45;
         transformed.x += sway * amp * transformed.y;
         transformed.z += sway * 0.55 * amp * transformed.y;`,
      )
  }
  mat.needsUpdate = true
  return mat
}

/** Drives every wind shader. Reduced motion slows it to a near standstill. */
export function WindClock() {
  const reduced = useStore((s) => s.settings.reducedMotion)
  useFrame((_, dt) => {
    windTime.value += dt * (reduced ? 0.12 : 1)
  })
  return null
}

// ---------------------------------------------------------------- trees
function pineGeometry() {
  const parts: BufferGeometry[] = []
  const trunk = new CylinderGeometry(0.16, 0.34, 3.4, 7)
  trunk.translate(0, 1.7, 0)
  paint(trunk, '#463525', '#3a2c1f')
  parts.push(trunk)

  let y = 1.9
  let radius = 2.5
  let h = 2.6
  for (let i = 0; i < 6; i++) {
    const cone = new ConeGeometry(radius, h, 9, 1, true)
    // rough up the silhouette so it doesn't read as a stack of perfect cones
    const p = cone.attributes.position as BufferAttribute
    for (let v = 0; v < p.count; v++) {
      p.setX(v, p.getX(v) * (0.82 + rand() * 0.36))
      p.setZ(v, p.getZ(v) * (0.82 + rand() * 0.36))
    }
    cone.translate(0, y + h / 2, 0)
    paint(cone, i < 2 ? '#2b4227' : '#35512f', '#1f3520')
    parts.push(cone)
    y += h * 0.52
    radius *= 0.78
    h *= 0.88
  }
  const g = mergeGeometries(parts, false)!
  g.computeVertexNormals()
  return g
}

function paint(g: BufferGeometry, top: string, bottom: string) {
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
    c.copy(a).lerp(b, t * 0.8 + 0.2)
    colors[i * 3] = c.r
    colors[i * 3 + 1] = c.g
    colors[i * 3 + 2] = c.b
  }
  g.setAttribute('color', new BufferAttribute(colors, 3))
}

export function scatter(count: number, opts: { minPath: number; maxSlope: number; minR?: number; maxR?: number }) {
  const out: { x: number; z: number; y: number; s: number; rot: number }[] = []
  let guard = 0
  while (out.length < count && guard < count * 60) {
    guard++
    const a = rand() * Math.PI * 2
    const r = Math.sqrt(rand()) * (opts.maxR ?? 190)
    if (r < (opts.minR ?? 0)) continue
    const x = Math.cos(a) * r
    const z = Math.sin(a) * r
    if (pathDistance(x, z) < opts.minPath) continue
    if (streamDistanceAt(x, z) < 5) continue
    if (locations.some((l) => Math.hypot(x - l.pos[0], z - l.pos[1]) < l.pad + 5)) continue
    if (gymOutside(x, z) < 3) continue
    const { slope } = terrainNormalY(x, z)
    if (slope > opts.maxSlope) continue
    const y = terrainHeight(x, z)
    if (y > 40) continue
    out.push({ x, z, y, s: 0.7 + rand() * 0.95, rot: rand() * Math.PI * 2 })
  }
  return out
}

export function Trees() {
  const count = useStore((s) => s.preset.trees)
  const shadows = useStore((s) => s.preset.shadows)
  const ref = useRef<InstancedMesh>(null)
  const geometry = useMemo(() => pineGeometry(), [])
  const material = useMemo(
    () => applyWind(new MeshStandardMaterial({ vertexColors: true, roughness: 0.92, side: DoubleSide }), 0.02, 12),
    [],
  )

  useEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    const dummy = new Object3D()
    const spots = scatter(count, { minPath: 7.5, maxSlope: 0.75 })
    spots.forEach((s, i) => {
      dummy.position.set(s.x, s.y - 0.3, s.z)
      dummy.rotation.set(0, s.rot, 0)
      dummy.scale.setScalar(s.s)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
      addCollider({ x: s.x, z: s.z, r: 0.55 * s.s + 0.35 })
    })
    mesh.count = spots.length
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
    return registerInstanceCull(mesh)
  }, [count])

  return (
    <instancedMesh
      key={count}
      ref={ref}
      args={[geometry, material, count]}
      castShadow={shadows}
      receiveShadow={shadows}
      frustumCulled={false}
    />
  )
}

// ---------------------------------------------------------------- rocks
export function Rocks() {
  const { scene } = useGLTF('/models/boulder.glb')
  const count = useStore((s) => s.preset.rocks)
  const shadows = useStore((s) => s.preset.shadows)
  const ref = useRef<InstancedMesh>(null)

  const { geometry, material } = useMemo(() => {
    let g: BufferGeometry | null = null
    let m: MeshStandardMaterial | null = null
    scene.traverse((o) => {
      if (!g && (o as Mesh).isMesh) {
        const mesh = o as Mesh
        g = mesh.geometry.clone()
        g.applyMatrix4(mesh.matrixWorld)
        g.center()
        m = (mesh.material as MeshStandardMaterial).clone()
        // the generated moss is very saturated; knock it back into the forest palette
        m.color.multiplyScalar(0.68)
        m.roughness = 1
      }
    })
    return { geometry: g as unknown as BufferGeometry, material: m as unknown as MeshStandardMaterial }
  }, [scene])

  useEffect(() => {
    const mesh = ref.current
    if (!mesh || !geometry) return
    const dummy = new Object3D()
    const spots = scatter(count, { minPath: 5, maxSlope: 1.4 })
    spots.forEach((s, i) => {
      const scale = 0.5 + rand() * 1.5
      dummy.position.set(s.x, s.y - 0.35 * scale, s.z)
      dummy.rotation.set(rand() * 0.3, s.rot, rand() * 0.3)
      dummy.scale.set(scale, scale * (0.7 + rand() * 0.5), scale)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
      addCollider({ x: s.x, z: s.z, r: scale * 0.95 })
    })
    mesh.count = spots.length
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
    return registerInstanceCull(mesh)
  }, [count, geometry])

  if (!geometry) return null
  return (
    <instancedMesh
      key={count}
      ref={ref}
      args={[geometry, material, count]}
      castShadow={shadows}
      receiveShadow={shadows}
      frustumCulled={false}
    />
  )
}

// ---------------------------------------------------------------- grass
function bladeGeometry() {
  const g = new BufferGeometry()
  // a curved, tapered blade reads far better than a flat spike
  const h = 0.42
  const w = 0.042
  const pts: number[] = []
  const idx: number[] = []
  const segs = 4
  for (let i = 0; i <= segs; i++) {
    const t = i / segs
    const width = w * (1 - t * 0.85)
    const y = h * t
    const bend = t * t * 0.14
    pts.push(-width, y, bend, width, y, bend)
  }
  for (let i = 0; i < segs; i++) {
    const a = i * 2
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
  }
  g.setAttribute('position', new Float32BufferAttribute(pts, 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

export function Grass() {
  const count = useStore((s) => s.preset.grass)
  const radius = useStore((s) => s.preset.grassRadius)
  const ref = useRef<InstancedMesh>(null)
  const last = useRef(new Vector3(9999, 0, 9999))
  const geometry = useMemo(() => bladeGeometry(), [])
  const material = useMemo(
    () => applyWind(new MeshStandardMaterial({
        color: '#546d3a', roughness: 1, side: DoubleSide, envMapIntensity: 0.4,
      }), 0.3, 0.45),
    [],
  )

  const place = (cx: number, cz: number) => {
    const mesh = ref.current
    if (!mesh) return
    const dummy = new Object3D()
    let n = 0
    for (let i = 0; i < count; i++) {
      const a = rand() * Math.PI * 2
      const r = Math.sqrt(rand()) * radius
      const x = cx + Math.cos(a) * r
      const z = cz + Math.sin(a) * r
      if (pathDistance(x, z) < 1.9) continue
      const { slope } = terrainNormalY(x, z)
      if (slope > 0.85) continue
      dummy.position.set(x, terrainHeight(x, z) - 0.04, z)
      dummy.rotation.set((rand() - 0.5) * 0.18, rand() * Math.PI, (rand() - 0.5) * 0.22)
      dummy.scale.set(0.8 + rand() * 0.7, 0.6 + rand() * 0.95, 1)
      dummy.updateMatrix()
      mesh.setMatrixAt(n++, dummy.matrix)
    }
    mesh.count = n
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
  }

  useEffect(() => {
    last.current.set(9999, 0, 9999)
  }, [count, radius])

  useFrame(() => {
    if (player.pos.distanceTo(last.current) > radius * 0.35) {
      last.current.copy(player.pos)
      place(player.pos.x, player.pos.z)
    }
  })

  return (
    <instancedMesh key={count} ref={ref} args={[geometry, material, count]} frustumCulled={false} receiveShadow />
  )
}

// ---------------------------------------------------------------- backdrop
export function DistantMountains() {
  const geometry = useMemo(() => {
    const parts: BufferGeometry[] = []
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2 + rand() * 0.1
      const r = 300 + rand() * 190
      const h = 60 + rand() * 120
      const cone = new ConeGeometry(h * (0.75 + rand() * 0.7), h, 6, 1)
      const p = cone.attributes.position as BufferAttribute
      for (let v = 0; v < p.count; v++) {
        p.setX(v, p.getX(v) * (0.85 + rand() * 0.3))
        p.setZ(v, p.getZ(v) * (0.85 + rand() * 0.3))
      }
      cone.translate(Math.cos(a) * r, h / 2 - 20, Math.sin(a) * r)
      parts.push(cone)
    }
    const g = mergeGeometries(parts, false)!
    g.computeVertexNormals()
    return g
  }, [])

  return (
    <mesh geometry={geometry} frustumCulled={false}>
      <meshStandardMaterial color="#6d7a86" roughness={1} fog />
    </mesh>
  )
}

/** Dust and pollen drifting in the light around the player. */
export function Motes() {
  const count = useStore((s) => s.preset.motes)
  const reduced = useStore((s) => s.settings.reducedMotion)
  const ref = useRef<Points>(null)
  const geometry = useMemo(() => {
    const g = new BufferGeometry()
    const arr = new Float32Array(Math.max(1, count) * 3)
    for (let i = 0; i < count; i++) {
      arr[i * 3] = (rand() - 0.5) * 44
      arr[i * 3 + 1] = rand() * 9
      arr[i * 3 + 2] = (rand() - 0.5) * 44
    }
    const attr = new BufferAttribute(arr, 3)
    attr.setUsage(DynamicDrawUsage)
    g.setAttribute('position', attr)
    return g
  }, [count])

  useFrame((_, dt) => {
    const pts = ref.current
    if (!pts) return
    pts.position.set(player.pos.x, player.pos.y, player.pos.z)
    if (reduced) return
    const attr = geometry.attributes.position as BufferAttribute
    for (let i = 0; i < count; i++) {
      let y = attr.getY(i) + dt * (0.12 + (i % 7) * 0.03)
      if (y > 9) y = 0
      attr.setY(i, y)
      attr.setX(i, attr.getX(i) + Math.sin(windTime.value * 0.7 + i) * dt * 0.25)
    }
    attr.needsUpdate = true
  })

  const material = useMemo(
    () => new PointsMaterial({ color: '#ffe9c4', size: 0.075, transparent: true, opacity: 0.55, depthWrite: false }),
    [],
  )

  if (count === 0) return null
  return <points key={count} ref={ref} args={[geometry, material]} frustumCulled={false} />
}

useGLTF.preload('/models/boulder.glb')
