import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  BufferAttribute, BufferGeometry, Color, DoubleSide, Float32BufferAttribute,
  InstancedMesh, MeshStandardMaterial, Object3D, PlaneGeometry, Vector3,
} from 'three'
import { foliage, scanned, scannedTexture } from '../../lib/materials'
import { detail } from '../../lib/detail'
import {
  PATH_HALF_WIDTH, TERRAIN_SIZE, pathDistance, pathSamples, roadBase, streamDistanceAt,
  terrainHeight, terrainNormalY, POOL, poolFloorAt, poolLocal, forestDensity, isGrassCleared, lakeEdgeDistance,
} from '../../lib/terrain'
import { locationById } from '../../data/journey'
import { GYM_CLEAR, gymPlacement } from './Gym'
import { trackPress } from './TireTracks'
import { player, useStore } from '../../state/store'
import { applyWind } from './Forest'

/**
 * The ground is a single displaced mesh textured with three photoscanned
 * surfaces — grass, forest floor and rock — blended per pixel by a weight
 * baked into the vertex colours (r = grass, g = dirt, b = rock). That gives a
 * continuous, natural carpet instead of a flat painted plane.
 */
const GROUND_BLEND = /* glsl */`
  uniform sampler2D uGrass;
  uniform sampler2D uDirt;
  uniform sampler2D uRock;
  varying vec2 vGroundUv;
  varying vec3 vBlend;
`

export function Ground() {
  const uniforms = useMemo(
    () => ({
      uGrass: { value: scannedTexture('lawn_diff', 1, true) },
      uDirt: { value: scannedTexture('forest_diff', 70, true) },
      uRock: { value: scannedTexture('rock_diff', 60, true) },
    }),
    [],
  )

  const geometry = useMemo(() => {
    const seg = 320
    const g = new PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, seg, seg)
    g.rotateX(-Math.PI / 2)
    const pos = g.attributes.position as BufferAttribute
    const blend = new Float32Array(pos.count * 3)
    const uv2 = new Float32Array(pos.count * 2)

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i)
      const z = pos.getZ(i)
      let h = terrainHeight(x, z)
      // under the pool deck and basin the ground drops away out of sight, so
      // the grass can never show through the water or poke up past the deck
      const pl = poolLocal(x, z)
      if (Math.abs(pl.lx) < POOL.hx + POOL.deck - 0.4 && Math.abs(pl.lz) < POOL.hz + POOL.deck - 0.4) {
        h = poolFloorAt(pl.lx) - 0.6
      }
      const pd = pathDistance(x, z)
      // under the tarmac the ground steps down out of sight: the road is laid
      // over it, and ground that stays level with the road will z-fight or
      // poke through it somewhere along a 700-sample ribbon
      if (pd < ROAD_HALF - 0.35) h -= 0.25 * Math.min(1, (ROAD_HALF - 0.35 - pd) / 0.4)
      pos.setY(i, h)

      const { slope } = terrainNormalY(x, z)
      const sd = streamDistanceAt(x, z)

      // grass by default; dirt in hollows, under canopy noise and near water;
      // rock on anything steep or high
      let rock = Math.min(1, Math.max(0, (slope - 0.45) / 0.5))
      rock = Math.max(rock, Math.min(1, Math.max(0, (h - 32) / 14)))
      const patch = (Math.sin(x * 0.035) + Math.cos(z * 0.041) + Math.sin((x + z) * 0.017)) / 3
      let dirt = Math.min(1, Math.max(0, patch * 0.55 - 0.05))
      if (sd < 7) dirt = Math.max(dirt, 1 - sd / 7)
      // under the canopy the floor is leaf litter and moss, not lawn
      const fd = forestDensity(x, z)
      dirt = Math.max(dirt, Math.min(1, Math.max(0, (fd - 0.42) / 0.22)))
      // the road meets the lawn at a clean edge, not a wide dirt verge
      if (pd < PATH_HALF_WIDTH + 1.9) dirt = Math.max(dirt, (1 - (pd - PATH_HALF_WIDTH - 1.4) / 0.5) * 0.35)
      const grass = Math.max(0, 1 - rock - dirt * 0.6)

      const sum = grass + dirt + rock || 1
      blend[i * 3] = grass / sum
      blend[i * 3 + 1] = dirt / sum
      blend[i * 3 + 2] = rock / sum
      uv2[i * 2] = x
      uv2[i * 2 + 1] = z
    }
    g.setAttribute('blendWeights', new BufferAttribute(blend, 3))
    g.setAttribute('groundUv', new BufferAttribute(uv2, 2))
    g.computeVertexNormals()
    return g
  }, [])

  const material = useMemo(() => {
    // a real normal map has to be present for three to build the tangent frame;
    // the grass normal carries the fine detail and the colour blend does the rest
    const m = new MeshStandardMaterial({
      roughness: 1,
      metalness: 0,
      envMapIntensity: 0.55,
      normalMap: scannedTexture('lawn_nor', 1),
      roughnessMap: scannedTexture('lawn_rough', 1),
    })
    for (const t of [m.normalMap, m.roughnessMap]) t?.repeat.set(TERRAIN_SIZE / 1.25, TERRAIN_SIZE / 1.25)
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms)
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          attribute vec2 groundUv;
          attribute vec3 blendWeights;
          varying vec2 vGroundUv;
          varying vec3 vBlend;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vGroundUv = groundUv;
          vBlend = blendWeights;`)
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${GROUND_BLEND}`)
        .replace('#include <map_fragment>', `
          vec3 w = normalize(max(vBlend, vec3(0.0001)));
          w /= (w.x + w.y + w.z);
          // a dense mown lawn: the blade tile at its real ~1.25 m scale, a
          // much larger copy over it so the repeat never lines up, and the
          // mower's stripes — alternate passes lay the blades toward and away
          // from the light, which is what makes a lawn look like a carpet
          vec3 g1 = texture2D(uGrass, vGroundUv * 0.8).rgb;
          vec3 g2 = texture2D(uGrass, vGroundUv * 0.07).rgb;
          vec3 grassCol = mix(g1, g2, 0.28);
          // a softer, sage-leaning lawn: less of the electric green
          float gl = dot(grassCol, vec3(0.299, 0.587, 0.114));
          grassCol = mix(grassCol, vec3(gl), 0.3) * vec3(1.04, 0.98, 0.9);
          float pass = fract(dot(vGroundUv, vec2(0.866, 0.5)) / 7.0);
          float stripe = smoothstep(0.46, 0.54, pass) - smoothstep(0.96, 1.0, pass);
          grassCol *= mix(0.86, 1.1, stripe);
          // broad living variation, a little yellower in the sun-baked patches
          float broad = sin(vGroundUv.x * 0.043) * cos(vGroundUv.y * 0.037);
          grassCol *= vec3(1.0 + broad * 0.06, 1.0 + broad * 0.03, 1.0 - broad * 0.05);
          vec3 dirtCol = mix(texture2D(uDirt, vGroundUv * 0.33).rgb, texture2D(uDirt, vGroundUv * 0.07).rgb, 0.4);
          vec3 rockCol = mix(texture2D(uRock, vGroundUv * 0.22).rgb, texture2D(uRock, vGroundUv * 0.05).rgb, 0.4);
          // a living woodland floor: moss and leaf litter in shade, darker and greener than the scan
          dirtCol *= vec3(0.6, 0.76, 0.46);
          vec3 blended = grassCol * w.x + dirtCol * w.y + rockCol * w.z;
          diffuseColor.rgb *= blended * 1.02;
        `)
    }
    m.customProgramCacheKey = () => 'ground-lawn'
    return m
  }, [uniforms])

  return <mesh geometry={geometry} material={material} receiveShadow />
}

/**
 * The road: fresh dark tarmac laid over the terrain, with a double yellow
 * centre line and white edge lines, like a well-kept country road.
 *
 * The asphalt is tiled in true metres along and across the road (a 3 m
 * square), so its aggregate is the same size everywhere instead of smeared
 * across the width. The paint is its own thin strips a few millimetres proud
 * of the surface: crisp at any distance, and slightly glossier than the
 * tarmac, as road paint is.
 */
const ROAD_HALF = PATH_HALF_WIDTH + 1.4      // wide enough for a vehicle
const TILE = 3

/**
 * A strip laid along the road, `cols` vertices across. The tarmac used to be
 * two vertices wide — eight metres of flat chord — and wherever the hill
 * crowned across it the grass rose through the middle, which read as cracked
 * road. Now every metre across follows the ground (and the ground itself is
 * stepped down under the tarmac, in Ground), so terrain can never peek over.
 * The surface stays exactly where groundHeight() says it is: feet and tyres
 * are placed from that, and a road drawn higher than it swallows them.
 */
function ribbonAlong(offsets: [number, number][], lift: number, withUv: boolean, cols = 1) {
  const g = new BufferGeometry()
  const verts: number[] = []
  const uvs: number[] = []
  const idx: number[] = []
  const up = new Vector3(0, 1, 0)
  const dir = new Vector3()
  const side = new Vector3()
  let along = 0
  let base = 0
  const per = cols + 1
  for (const [inner, outer] of offsets) {
    along = 0
    for (let i = 0; i < pathSamples.length; i++) {
      const s = pathSamples[i]
      const n = pathSamples[Math.min(pathSamples.length - 1, i + 1)]
      const p = pathSamples[Math.max(0, i - 1)]
      if (i > 0) along += Math.hypot(s.x - pathSamples[i - 1].x, s.z - pathSamples[i - 1].z)
      dir.set(n.x - p.x, 0, n.z - p.z).normalize()
      side.crossVectors(up, dir).normalize()
      for (let c = 0; c <= cols; c++) {
        const off = inner + ((outer - inner) * c) / cols
        const x = s.x + side.x * off, z = s.z + side.z * off
        verts.push(x, roadBase(x, z) + lift, z)
        if (withUv) uvs.push((off + ROAD_HALF) / TILE, along / TILE)
      }
      if (i > 0) {
        const a = base + (i - 1) * per
        const b = base + i * per
        for (let c = 0; c < cols; c++) idx.push(a + c, a + c + 1, b + c, a + c + 1, b + c + 1, b + c)
      }
    }
    base += pathSamples.length * per
  }
  g.setAttribute('position', new Float32BufferAttribute(verts, 3))
  if (withUv) g.setAttribute('uv', new Float32BufferAttribute(uvs, 2))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

export function Road() {
  const geometry = useMemo(() => ribbonAlong([[-ROAD_HALF, ROAD_HALF]], 0.12, true, 8), [])
  const yellow = useMemo(() => ribbonAlong([[-0.2, -0.08], [0.08, 0.2]], 0.128, false), [])
  const white = useMemo(
    () => ribbonAlong([[-ROAD_HALF + 0.2, -ROAD_HALF + 0.34], [ROAD_HALF - 0.34, ROAD_HALF - 0.2]], 0.128, false),
    [],
  )

  const material = useMemo(() => {
    const m = scanned('asphalt', 1, {
      roughness: 0.9,
      envMapIntensity: 0.55,
      side: DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    })
    // tiled by the UVs (in metres / TILE), not by repeat
    for (const t of [m.map, m.normalMap, m.roughnessMap]) t?.repeat.set(1, 1)
    return m
  }, [])
  const paint = useMemo(() => ({
    yellow: new MeshStandardMaterial({
      color: '#e0a712', roughness: 0.55, metalness: 0, envMapIntensity: 0.7, side: DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6,
    }),
    white: new MeshStandardMaterial({
      color: '#ecece6', roughness: 0.55, metalness: 0, envMapIntensity: 0.7, side: DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6,
    }),
  }), [])

  return (
    <group>
      <mesh geometry={geometry} material={material} receiveShadow />
      <mesh geometry={yellow} material={paint.yellow} receiveShadow />
      <mesh geometry={white} material={paint.white} receiveShadow />
    </group>
  )
}

/** Grass tufts as alpha cards, kept in a ring that follows the player. */
/** The training compound's slab, which grass does not grow through. */
const GYM = gymPlacement(locationById.camp.pos)

/** Tufts rebuilt per frame. Enough to finish a sweep in well under a second. */
const SLICE = 900

/**
 * Ask the lawn to re-lay itself around where it is now, without moving. Tyre
 * tracks call this as they go down so the grass they crossed lies flat.
 */
const grassRefresh = { wanted: false }
export function requestGrassRefresh() {
  grassRefresh.wanted = true
}

export function GrassCover() {
  const count = useStore((s) => s.preset.grass)
  const radius = useStore((s) => s.preset.grassRadius)
  const ref = useRef<InstancedMesh>(null)
  const centre = useRef(new Vector3(9999, 0, 9999))
  const cursor = useRef(0)
  const scratch = useRef({ dummy: new Object3D(), tint: new Color() })

  const geometry = useMemo(() => {
    // two crossed quads per tuft
    // a mown lawn, not a meadow: short, dense tufts a hand high
    const a = new PlaneGeometry(0.2, 0.085)
    a.translate(0, 0.0425, 0)
    const b = a.clone()
    b.rotateY(Math.PI / 2)
    const merged = new BufferGeometry()
    const pos: number[] = []
    const uv: number[] = []
    const index: number[] = []
    let offset = 0
    for (const g of [a, b]) {
      const p = g.attributes.position as BufferAttribute
      const t = g.attributes.uv as BufferAttribute
      for (let i = 0; i < p.count; i++) {
        pos.push(p.getX(i), p.getY(i), p.getZ(i))
        uv.push(t.getX(i), t.getY(i))
      }
      for (const i of Array.from(g.index!.array)) index.push(i + offset)
      offset += p.count
    }
    merged.setAttribute('position', new Float32BufferAttribute(pos, 3))
    merged.setAttribute('uv', new Float32BufferAttribute(uv, 2))
    merged.setIndex(index)
    merged.computeVertexNormals()
    return merged
  }, [])

  const material = useMemo(
    () => applyWind(foliage('grass_card', { side: DoubleSide, alphaTest: 0.38 }), 0.22, 0.45),
    [],
  )

  /**
   * Deterministic per-slot randomness. The field is rebuilt a slice at a time
   * rather than all at once, so a slot's position cannot depend on how many
   * slots were processed before it — a shared sequential generator would make
   * every tuft jump whenever a slice boundary moved.
   */
  const slotRand = (i: number, k: number) => {
    let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(k + 1, 0xc2b2ae35)
    h = Math.imul(h ^ (h >>> 13), 0x27d4eb2d)
    return ((h ^ (h >>> 15)) >>> 0) / 4294967296
  }

  /**
   * Fill slots [from, to) around a centre. Rejected spots — road, gym slab,
   * cliff — get a zero-scale matrix rather than being skipped, so slot index
   * and instance index stay the same and slices remain independent.
   */
  const placeSlice = (cx: number, cz: number, from: number, to: number) => {
    const mesh = ref.current
    if (!mesh) return
    const dummy = scratch.current.dummy
    const tint = scratch.current.tint
    for (let i = from; i < to; i++) {
      const a = slotRand(i, 0) * Math.PI * 2
      const r = Math.sqrt(slotRand(i, 1)) * radius
      const x = cx + Math.cos(a) * r
      const z = cz + Math.sin(a) * r
      const blocked =
        pathDistance(x, z) < PATH_HALF_WIDTH + 1.6 ||
        Math.hypot(x - GYM.cx, z - GYM.cz) < GYM_CLEAR ||
        // no grass on the water, the pool deck or the lake bed
        streamDistanceAt(x, z) < 0.6 ||
        isGrassCleared(x, z) ||
        lakeEdgeDistance(x, z) < 3.4 ||
        terrainNormalY(x, z).slope > 0.9
      if (blocked) {
        dummy.position.set(x, -9999, z)
        dummy.rotation.set(0, 0, 0)
        dummy.scale.set(0, 0, 0)
      } else {
        dummy.position.set(x, terrainHeight(x, z) - 0.03, z)
        dummy.rotation.set((slotRand(i, 2) - 0.5) * 0.1, slotRand(i, 3) * Math.PI, (slotRand(i, 4) - 0.5) * 0.12)
        const sc = 0.7 + slotRand(i, 5) * 0.5
        // where a tyre has rolled, the grass lies flattened along the track
        const flat = 1 - trackPress(x, z) * 0.85
        dummy.scale.set(sc, sc * (0.75 + slotRand(i, 6) * 0.5) * flat, sc)
      }
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
      const v = 0.82 + slotRand(i, 7) * 0.33
      mesh.setColorAt(i, tint.setRGB(v * 0.93, v * 0.9, v * 0.74))
    }
    // upload only the slice just laid, not the whole field every frame
    mesh.instanceMatrix.addUpdateRange(from * 16, (to - from) * 16)
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) {
      mesh.instanceColor.addUpdateRange(from * 3, (to - from) * 3)
      mesh.instanceColor.needsUpdate = true
    }
  }

  useEffect(() => {
    cursor.current = 0
    centre.current.set(player.pos.x, 0, player.pos.z)
  }, [count, radius])

  useFrame(() => {
    const mesh = ref.current
    if (!mesh) return

    // A lighter detail level draws a share of the tufts. Placement is
    // random, so the first N are an even thinning; only those N are laid at
    // all, and if the level rises again the sweep simply carries on to the
    // new N round the same centre.
    const active = Math.max(1, Math.round(count * detail.grass))

    // start a fresh sweep once the player has walked far enough, or when
    // something (a tyre) has pressed the grass down
    if (cursor.current >= active && (player.pos.distanceTo(centre.current) > radius * 0.3 || grassRefresh.wanted)) {
      grassRefresh.wanted = false
      centre.current.set(player.pos.x, 0, player.pos.z)
      cursor.current = 0
    }
    // Rebuilding thirty thousand tufts in one frame stalls for hundreds of
    // milliseconds every few metres walked. A slice per frame spreads the same
    // work over a fraction of a second, which reads as tufts settling in
    // rather than as the world stopping.
    if (cursor.current < active) {
      const next = Math.min(active, cursor.current + SLICE)
      placeSlice(centre.current.x, centre.current.z, cursor.current, next)
      cursor.current = next
    }
    mesh.count = active
  })

  return (
    <instancedMesh key={count} ref={ref} args={[geometry, material, Math.max(1, count)]}
      frustumCulled={false} castShadow receiveShadow />
  )
}
