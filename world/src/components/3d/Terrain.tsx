import { useMemo } from 'react'
import {
  BufferAttribute, BufferGeometry, Color, DoubleSide, Float32BufferAttribute,
  PlaneGeometry, Vector3,
} from 'three'
import {
  PATH_HALF_WIDTH, TERRAIN_SIZE, pathDistance, pathSamples, streamDistanceAt,
  terrainHeight, terrainNormalY,
} from '../../lib/terrain'

const GRASS_A = new Color('#33492a')     // shaded forest floor
const GRASS_B = new Color('#4f6a39')     // open grass
const GRASS_C = new Color('#5d7442')     // sunlit patches
const MOSS = new Color('#3c5a33')
const DIRT = new Color('#6a5942')
const ROCK = new Color('#6a6a64')
const ROCK_DARK = new Color('#4b4c49')
const SAND = new Color('#7e7159')
const SNOW = new Color('#cdd3d6')

/** The ground itself: displaced plane, colour by height, slope, trail and water. */
export function Ground() {
  const geometry = useMemo(() => {
    const seg = 300
    const g = new PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, seg, seg)
    g.rotateX(-Math.PI / 2)
    const pos = g.attributes.position as BufferAttribute
    const colors = new Float32Array(pos.count * 3)
    const c = new Color()
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i)
      const z = pos.getZ(i)
      const h = terrainHeight(x, z)
      pos.setY(i, h)

      const { slope } = terrainNormalY(x, z)
      const pd = pathDistance(x, z)
      const sd = streamDistanceAt(x, z)
      // three scales of variation so the ground never reads as one flat colour
      const broad = (Math.sin(x * 0.031) + Math.cos(z * 0.027)) * 0.5
      const mid = (Math.sin(x * 0.17 + 1.3) + Math.cos(z * 0.19)) * 0.5
      const fine = (Math.sin(x * 0.73) + Math.cos(z * 0.81)) * 0.5
      c.copy(GRASS_A).lerp(GRASS_B, 0.5 + broad * 0.5)
      c.lerp(GRASS_C, Math.max(0, mid) * 0.35)
      c.lerp(MOSS, Math.max(0, -broad) * 0.3)
      c.offsetHSL(0, 0, fine * 0.02)
      // worn dirt where the ground is trodden or steep-ish
      const wear = Math.max(0, mid * 0.5 + broad * 0.3)
      if (slope > 0.3) c.lerp(DIRT, Math.min(0.5, (slope - 0.3) * wear * 1.6))
      if (slope > 0.5) c.lerp(ROCK, Math.min(1, (slope - 0.5) / 0.45))
      if (slope > 0.9) c.lerp(ROCK_DARK, Math.min(0.8, (slope - 0.9) / 0.5))
      if (h > 30) c.lerp(ROCK, Math.min(1, (h - 30) / 12))
      if (h > 46) c.lerp(SNOW, Math.min(0.9, (h - 46) / 9))
      if (sd < 6) c.lerp(SAND, (1 - Math.min(1, sd / 6)) * 0.75)
      if (pd < PATH_HALF_WIDTH + 2.4) {
        c.lerp(DIRT, 1 - Math.min(1, Math.max(0, (pd - PATH_HALF_WIDTH * 0.7) / 2.4)))
      }
      colors[i * 3] = c.r
      colors[i * 3 + 1] = c.g
      colors[i * 3 + 2] = c.b
    }
    g.setAttribute('color', new BufferAttribute(colors, 3))
    g.computeVertexNormals()
    return g
  }, [])

  return (
    <mesh geometry={geometry} receiveShadow>
      <meshStandardMaterial vertexColors roughness={0.98} metalness={0} envMapIntensity={0.5} />
    </mesh>
  )
}

/** A worn dirt ribbon laid over the ground so the trail always reads clearly. */
export function TrailRibbon() {
  const geometry = useMemo(() => {
    const g = new BufferGeometry()
    const verts: number[] = []
    const uvs: number[] = []
    const idx: number[] = []
    const up = new Vector3(0, 1, 0)
    const dir = new Vector3()
    const side = new Vector3()

    for (let i = 0; i < pathSamples.length; i++) {
      const s = pathSamples[i]
      const n = pathSamples[Math.min(pathSamples.length - 1, i + 1)]
      const p = pathSamples[Math.max(0, i - 1)]
      dir.set(n.x - p.x, 0, n.z - p.z).normalize()
      side.crossVectors(up, dir).normalize().multiplyScalar(PATH_HALF_WIDTH)
      const lx = s.x - side.x
      const lz = s.z - side.z
      const rx = s.x + side.x
      const rz = s.z + side.z
      verts.push(lx, terrainHeight(lx, lz) + 0.06, lz, rx, terrainHeight(rx, rz) + 0.06, rz)
      uvs.push(0, s.t * 60, 1, s.t * 60)
      if (i > 0) {
        const a = (i - 1) * 2
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
      }
    }
    g.setAttribute('position', new Float32BufferAttribute(verts, 3))
    g.setAttribute('uv', new Float32BufferAttribute(uvs, 2))
    g.setIndex(idx)
    g.computeVertexNormals()
    return g
  }, [])

  return (
    <mesh geometry={geometry} receiveShadow>
      <meshStandardMaterial
        color="#7a674c"
        roughness={1}
        side={DoubleSide}
        polygonOffset
        polygonOffsetFactor={-2}
        polygonOffsetUnits={-2}
      />
    </mesh>
  )
}
