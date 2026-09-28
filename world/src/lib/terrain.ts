import { createNoise2D } from 'simplex-noise'
import { CatmullRomCurve3, Vector3 } from 'three'
import { locations, pathPoints } from '../data/journey'

// ---------------------------------------------------------------- constants
export const WORLD_RADIUS = 196        // where the player is stopped
export const TERRAIN_SIZE = 480        // rendered ground plane
export const PATH_HALF_WIDTH = 2.6     // visible trail
const PATH_FLATTEN = 5.5               // corridor smoothed for walking

// ---------------------------------------------------------------- noise
function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
export const rand = mulberry32(20260917)
const noise2D = createNoise2D(mulberry32(7))

function fbm(x: number, z: number) {
  // ridged low frequency for valleys and shoulders, then detail on top
  const broad = noise2D(x / 150, z / 150)
  const ridge = 1 - Math.abs(noise2D(x / 74, z / 74))
  return (
    broad * 9.5 +
    ridge * ridge * 7 +
    noise2D(x / 37, z / 37) * 2.6 +
    noise2D(x / 13.5, z / 13.5) * 0.85 +
    noise2D(x / 5.5, z / 5.5) * 0.28
  )
}

// ---------------------------------------------------------------- the trail
export const pathCurve = new CatmullRomCurve3(
  pathPoints.map(([x, z]) => new Vector3(x, 0, z)),
  false,
  'catmullrom',
  0.5,
)
const PATH_SAMPLES = 700
export const pathSamples: { x: number; z: number; t: number }[] = []
{
  const v = new Vector3()
  for (let i = 0; i < PATH_SAMPLES; i++) {
    const t = i / (PATH_SAMPLES - 1)
    pathCurve.getPoint(t, v)
    pathSamples.push({ x: v.x, z: v.z, t })
  }
}

/** Distance to the trail, on a coarse grid so per-frame queries stay cheap. */
const DF_N = 200
const DF_EXTENT = 260
const DF_CELL = (DF_EXTENT * 2) / (DF_N - 1)
const distField = new Float32Array(DF_N * DF_N)
const tField = new Float32Array(DF_N * DF_N)
{
  for (let iz = 0; iz < DF_N; iz++) {
    const z = -DF_EXTENT + iz * DF_CELL
    for (let ix = 0; ix < DF_N; ix++) {
      const x = -DF_EXTENT + ix * DF_CELL
      let best = Infinity
      let bestT = 0
      for (let i = 0; i < PATH_SAMPLES; i++) {
        const s = pathSamples[i]
        const dx = x - s.x
        const dz = z - s.z
        const d = dx * dx + dz * dz
        if (d < best) {
          best = d
          bestT = s.t
        }
      }
      distField[iz * DF_N + ix] = Math.sqrt(best)
      tField[iz * DF_N + ix] = bestT
    }
  }
}

function sampleField(field: Float32Array, x: number, z: number) {
  const fx = (x + DF_EXTENT) / DF_CELL
  const fz = (z + DF_EXTENT) / DF_CELL
  const ix = Math.min(DF_N - 2, Math.max(0, Math.floor(fx)))
  const iz = Math.min(DF_N - 2, Math.max(0, Math.floor(fz)))
  const tx = Math.min(1, Math.max(0, fx - ix))
  const tz = Math.min(1, Math.max(0, fz - iz))
  const a = field[iz * DF_N + ix]
  const b = field[iz * DF_N + ix + 1]
  const c = field[(iz + 1) * DF_N + ix]
  const d = field[(iz + 1) * DF_N + ix + 1]
  return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz
}

export const pathDistance = (x: number, z: number) => sampleField(distField, x, z)
/** How far along the trail (0..1) the nearest point is — drives the day cycle. */
export const pathProgress = (x: number, z: number) => sampleField(tField, x, z)

// ---------------------------------------------------------------- the stream
const streamPoints: [number, number][] = [
  [-120, 52], [-84, 66], [-52, 76], [-24, 80], [6, 74], [42, 62], [90, 48],
]
const streamCurve = new CatmullRomCurve3(streamPoints.map(([x, z]) => new Vector3(x, 0, z)))
const streamSamples = Array.from({ length: 200 }, (_, i) => streamCurve.getPoint(i / 199))
export const STREAM_LEVEL_DROP = 1.5

const STREAM_BOUNDS = { minX: -128, maxX: 98, minZ: 40, maxZ: 92 }

/** Distance to the stream's centre line, cached per metre (see the height grid). */
const SD_CELL = 1
const SD_MINX = STREAM_BOUNDS.minX - 14, SD_MINZ = STREAM_BOUNDS.minZ - 14
const SD_NX = Math.ceil((STREAM_BOUNDS.maxX - STREAM_BOUNDS.minX + 28) / SD_CELL) + 1
const SD_NZ = Math.ceil((STREAM_BOUNDS.maxZ - STREAM_BOUNDS.minZ + 28) / SD_CELL) + 1
const sdGrid = new Float32Array(SD_NX * SD_NZ).fill(NaN)
function sdAt(i: number, j: number) {
  const k = j * SD_NX + i
  let v = sdGrid[k]
  if (v !== v) { v = streamDistanceExact(SD_MINX + i * SD_CELL, SD_MINZ + j * SD_CELL); sdGrid[k] = v }
  return v
}
function streamDistance(x: number, z: number) {
  const fx = (x - SD_MINX) / SD_CELL, fz = (z - SD_MINZ) / SD_CELL
  if (fx < 0 || fz < 0 || fx >= SD_NX - 1 || fz >= SD_NZ - 1) return 999
  const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j
  const a = sdAt(i, j), bb = sdAt(i + 1, j), c = sdAt(i, j + 1), d = sdAt(i + 1, j + 1)
  return (a + (bb - a) * tx) + ((c + (d - c) * tx) - (a + (bb - a) * tx)) * tz
}

function streamDistanceExact(x: number, z: number) {
  // cheap reject: the stream only runs across one band of the map
  if (x < STREAM_BOUNDS.minX - 12 || x > STREAM_BOUNDS.maxX + 12 ||
      z < STREAM_BOUNDS.minZ - 12 || z > STREAM_BOUNDS.maxZ + 12) return 999
  let best = Infinity
  for (const s of streamSamples) {
    const d = (x - s.x) ** 2 + (z - s.z) ** 2
    if (d < best) best = d
  }
  return Math.sqrt(best)
}

/**
 * The road bridge, put where the road actually crosses the stream (it used
 * to stand ten metres off to one side, so the road dipped into the channel
 * and the stream ran over the tarmac). Squared to the road, wide enough for
 * the carriageway and long enough to clear the carved banks.
 */
export const bridge = (() => {
  let best = 0, bd = Infinity
  for (let i = 0; i < pathSamples.length; i++) {
    const d = streamDistanceExact(pathSamples[i].x, pathSamples[i].z)
    if (d < bd) { bd = d; best = i }
  }
  const a = pathSamples[Math.max(0, best - 3)], b = pathSamples[Math.min(pathSamples.length - 1, best + 3)]
  const p = pathSamples[best]
  return { x: p.x, z: p.z, width: (PATH_HALF_WIDTH + 1.4) * 2 + 1.6, length: 22, angle: Math.atan2(b.x - a.x, b.z - a.z) }
})()

/** Bridge-local coordinates (x across it, z along it) of a world point. */
export function bridgeLocal(x: number, z: number) {
  const dx = x - bridge.x, dz = z - bridge.z
  const c = Math.cos(bridge.angle), s = Math.sin(bridge.angle)
  return { lx: dx * c - dz * s, lz: dx * s + dz * c }
}
export function onBridge(x: number, z: number, margin = 0) {
  const b = bridgeLocal(x, z)
  return Math.abs(b.lx) < bridge.width / 2 + margin && Math.abs(b.lz) < bridge.length / 2 + margin
}

// ---------------------------------------------------------------- woodland
/**
 * Where the woods are thick. The trees use it to cluster, the ground uses it
 * to lay leaf litter and moss under the canopy instead of mown lawn, and the
 * undergrowth uses it to grow ferns where there is shade. One map, so the
 * three always agree.
 */
export const forestNoise = createNoise2D(() => 0.77)
export function forestDensity(x: number, z: number) {
  const n = (forestNoise(x / 52, z / 52) + 1) / 2
  // the woods thin out toward the road, where the verges are kept
  const pd = pathDistance(x, z)
  return n * Math.min(1, Math.max(0, (pd - 8) / 14))
}

// ---------------------------------------------------------------- the lake
/**
 * A lake in the open ground between the road and the question cave. Its
 * shoreline wanders (a few harmonics on the radius), the bank shelves in over
 * a few metres, and the middle is about three metres deep — deep enough to
 * swim anywhere past the shallows.
 */
// deep enough to dive: eight metres at the middle, shelving from the shore
export const LAKE = { x: 22, z: 28, r: 15, depth: 8 }
export function lakeRadius(a: number) {
  return LAKE.r * (1 + 0.1 * Math.sin(a * 2 + 0.6) + 0.06 * Math.sin(a * 3 - 1.1) + 0.04 * Math.sin(a * 5 + 2.2))
}
/** Signed distance to the shoreline: negative in the water. */
export function lakeEdgeDistance(x: number, z: number) {
  const dx = x - LAKE.x, dz = z - LAKE.z
  return Math.hypot(dx, dz) - lakeRadius(Math.atan2(dz, dx))
}
let _lakeLevel: number | null = null
/** The water surface: a little under the natural ground at the shore. */
export function lakeLevel() {
  if (_lakeLevel === null) {
    let lo = Infinity
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2
      const r = lakeRadius(a) + 1
      lo = Math.min(lo, rawHeight(LAKE.x + Math.cos(a) * r, LAKE.z + Math.sin(a) * r))
    }
    _lakeLevel = lo - 0.35
  }
  return _lakeLevel
}

// ---------------------------------------------------------------- the pool
/**
 * An outdoor lap pool by the training camp: 16 x 7 m of water in a tiled
 * basin, a stone deck all round, shallow at one end (1.1 m) and deep at the
 * other (2.2 m). `angle` turns it to sit square to the road.
 */
export const POOL = { x: -1, z: 32, hx: 8, hz: 3.5, deck: 2.2, angle: 0.55, shallow: 1.1, deep: 2.2 }
export function poolLocal(x: number, z: number) {
  const dx = x - POOL.x, dz = z - POOL.z
  const c = Math.cos(POOL.angle), s = Math.sin(POOL.angle)
  return { lx: dx * c - dz * s, lz: dx * s + dz * c }
}
let _poolDeck: number | null = null
export function poolDeckHeight() {
  if (_poolDeck === null) {
    let hi = -Infinity
    for (const ux of [-1, 0, 1]) for (const uz of [-1, 0, 1]) {
      const c = Math.cos(-POOL.angle), s = Math.sin(-POOL.angle)
      const lx = ux * (POOL.hx + POOL.deck), lz = uz * (POOL.hz + POOL.deck)
      hi = Math.max(hi, rawHeight(POOL.x + lx * c - lz * s, POOL.z + lx * s + lz * c))
    }
    _poolDeck = hi + 0.18
  }
  return _poolDeck
}
/** Where the pool's water surface sits: just below the coping. */
export const poolWaterLevel = () => poolDeckHeight() - 0.12
/** Floor of the basin at a local position (sloping from shallow to deep). */
export function poolFloorAt(lx: number) {
  const t = Math.min(1, Math.max(0, (lx + POOL.hx) / (POOL.hx * 2)))
  const depth = POOL.shallow + (POOL.deep - POOL.shallow) * t * t * (3 - 2 * t)
  return poolWaterLevel() - depth
}

// ---------------------------------------------------------------- height
const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

function rawHeight(x: number, z: number) {
  const r = Math.hypot(x, z)
  let h = fbm(x, z)
  // the mountain the summit sits on, with a secondary shoulder so it reads as
  // a range rather than a cone
  const dm = Math.hypot(x, z + 205)
  h += 62 * Math.exp(-((dm / 62) ** 2))
  const shoulder = Math.hypot(x + 70, z + 150)
  h += 30 * Math.exp(-((shoulder / 48) ** 2))
  const shoulder2 = Math.hypot(x - 84, z + 168)
  h += 26 * Math.exp(-((shoulder2 / 44) ** 2))
  // a bowl of hills closing the world in
  if (r > 150) h += ((r - 150) / 46) ** 2 * 34
  return h
}

// ---------------------------------------------------------------- the gym slab
/**
 * Where the training compound's slab stands: stepped off the trail beside the
 * camp and squared to the road, pushed back until every corner is well clear
 * of the tarmac (the road curves, and a fixed setback let it run across one
 * corner of the floor). The ground under it is levelled, and the slab's top
 * is what anyone standing on it stands on.
 */
export const GYM_SLAB_W = 21
export const GYM_SLAB_D = 15
export const GYM_LIFT = 0.17
export const GYM = (() => {
  const camp = locations.find((l) => l.id === 'camp')!
  const [px, pz] = camp.pos
  let best = 0, bd = Infinity
  for (let k = 0; k < pathSamples.length; k++) {
    const d = (pathSamples[k].x - px) ** 2 + (pathSamples[k].z - pz) ** 2
    if (d < bd) { bd = d; best = k }
  }
  const a = pathSamples[Math.max(0, best - 2)], b = pathSamples[Math.min(pathSamples.length - 1, best + 2)]
  const len = Math.hypot(b.x - a.x, b.z - a.z) || 1
  const tx = (b.x - a.x) / len, tz = (b.z - a.z) / len
  const angle = Math.atan2(-tz, -tx)
  const c = Math.cos(angle), s = Math.sin(angle)
  const clear = PATH_HALF_WIDTH + 1.4 + 1.8
  // Try places near the original spot (13 m back from the trail, opposite the
  // camp): further back, or slid along the road, and keep the one closest to
  // the original that is clear of the road, the pool and the lake, and flat.
  let pick = { cx: px - tz * 13, cz: pz + tx * 13, score: Infinity, setback: 13 }
  for (let setback = 13; setback <= 20; setback += 1) {
    for (let slide = -14; slide <= 14; slide += 1) {
      const cx = px - tz * setback + tx * slide, cz = pz + tx * setback + tz * slide
      let ok = true
      let lo = Infinity, hi = -Infinity
      for (let i = 0; i <= 8 && ok; i++) for (let j = 0; j <= 6 && ok; j++) {
        const lx = -GYM_SLAB_W / 2 + (i / 8) * GYM_SLAB_W, lz = -GYM_SLAB_D / 2 + (j / 6) * GYM_SLAB_D
        const x = cx + lx * c + lz * s, z = cz - lx * s + lz * c
        if (distTo(x, z) < clear) ok = false
        const pl = poolLocal(x, z)
        if (Math.abs(pl.lx) < POOL.hx + POOL.deck + 4 && Math.abs(pl.lz) < POOL.hz + POOL.deck + 4) ok = false
        if (Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r * 1.25 + 6) ok = false
        const h = rawHeight(x, z)
        lo = Math.min(lo, h); hi = Math.max(hi, h)
      }
      if (!ok) continue
      const score = Math.abs(slide) * 0.6 + (setback - 13) * 1.0 + (hi - lo) * 2.5
      if (score < pick.score) pick = { cx, cz, score, setback }
    }
  }
  const { cx, cz, setback } = pick
  return { cx, cz, angle, setback }
})()
function distTo(x: number, z: number) {
  let best = Infinity
  for (let k = 0; k < pathSamples.length; k += 2) {
    const d = (pathSamples[k].x - x) ** 2 + (pathSamples[k].z - z) ** 2
    if (d < best) best = d
  }
  return Math.sqrt(best)
}
/** Slab-local coordinates (x along the front, z towards the road) of a world point. */
export function gymLocal(x: number, z: number) {
  const dx = x - GYM.cx, dz = z - GYM.cz
  const c = Math.cos(GYM.angle), s = Math.sin(GYM.angle)
  return { lx: dx * c - dz * s, lz: dx * s + dz * c }
}
/** How far outside the slab a point is (negative inside). */
export function gymOutside(x: number, z: number) {
  const { lx, lz } = gymLocal(x, z)
  const ox = Math.abs(lx) - GYM_SLAB_W / 2, oz = Math.abs(lz) - GYM_SLAB_D / 2
  return ox > 0 || oz > 0 ? Math.hypot(Math.max(ox, 0), Math.max(oz, 0)) : Math.max(ox, oz)
}
let _gymBase: number | null = null
/** The levelled ground under the slab. */
export function gymBase() {
  if (_gymBase === null) _gymBase = rawHeight(GYM.cx, GYM.cz)
  return _gymBase
}
/** The top of the slab: where feet go. */
export const gymFloorY = () => gymBase() + GYM_LIFT

// Location pads are levelled to the terrain height at their centre.
const padHeights = new Map<string, number>()
for (const l of locations) padHeights.set(l.id, rawHeight(l.pos[0], l.pos[1]))

/**
 * Heights are cached on a grid that lines up with the ground mesh's own
 * vertices (TERRAIN_SIZE / HGRID_N apart), filled in lazily and read back with
 * bilinear filtering. Building the world asks for the ground height millions
 * of times — every tree, tuft, rock, collider and road vertex, several times
 * each for slopes — and the exact height is a stack of noise octaves and
 * carving passes. Computing each grid point once is what keeps the load short.
 */
const HGRID_N = 320
const HGRID_CELL = TERRAIN_SIZE / HGRID_N
const HGRID_HALF = TERRAIN_SIZE / 2
const hgrid = new Float32Array((HGRID_N + 1) * (HGRID_N + 1)).fill(NaN)
function gridHeight(i: number, j: number) {
  const k = j * (HGRID_N + 1) + i
  let v = hgrid[k]
  if (v !== v) {
    v = terrainHeightExact(-HGRID_HALF + i * HGRID_CELL, -HGRID_HALF + j * HGRID_CELL)
    hgrid[k] = v
  }
  return v
}

export function terrainHeight(x: number, z: number): number {
  const fx = (x + HGRID_HALF) / HGRID_CELL
  const fz = (z + HGRID_HALF) / HGRID_CELL
  if (fx < 0 || fz < 0 || fx >= HGRID_N || fz >= HGRID_N) return terrainHeightExact(x, z)
  const i = Math.floor(fx), j = Math.floor(fz)
  const tx = fx - i, tz = fz - j
  const a = gridHeight(i, j), b = gridHeight(i + 1, j)
  const c = gridHeight(i, j + 1), d = gridHeight(i + 1, j + 1)
  return (a + (b - a) * tx) + ((c + (d - c) * tx) - (a + (b - a) * tx)) * tz
}

function terrainHeightExact(x: number, z: number): number {
  let h = rawHeight(x, z)

  // flatten the walking corridor towards its low-frequency shape
  const pd = pathDistance(x, z)
  if (pd < PATH_FLATTEN + 6) {
    const smooth = noise2D(x / 150, z / 150) * 9.5 +
      62 * Math.exp(-((Math.hypot(x, z + 205) / 62) ** 2)) +
      30 * Math.exp(-((Math.hypot(x + 70, z + 150) / 48) ** 2)) +
      26 * Math.exp(-((Math.hypot(x - 84, z + 168) / 44) ** 2)) +
      (Math.hypot(x, z) > 150 ? ((Math.hypot(x, z) - 150) / 46) ** 2 * 34 : 0)
    h += (smooth - h) * (1 - smoothstep(PATH_FLATTEN, PATH_FLATTEN + 6, pd))
  }

  // level the location pads
  for (const l of locations) {
    const d = Math.hypot(x - l.pos[0], z - l.pos[1])
    if (d < l.pad + 9) {
      const w = 1 - smoothstep(l.pad, l.pad + 9, d)
      h += (padHeights.get(l.id)! - h) * w
    }
  }

  // level the ground under the gym slab and a margin round it
  const go = gymOutside(x, z)
  if (go < 7) {
    const w = 1 - smoothstep(1.2, 7, go)
    h += (gymBase() - h) * w
  }

  // carve the stream (not where the bridge crosses); the channel itself is
  // scoured deeper, so the middle of the stream is over your head
  const sd = streamDistance(x, z)
  if (sd < 9) {
    const carve = (1 - smoothstep(3.2, 9, sd)) * STREAM_LEVEL_DROP
    h -= carve + (1 - smoothstep(0.6, 2.6, sd)) * 1.35
  }

  // the lake basin: bring the ground to the lake's level round the shore,
  // then shelve down to its depth
  const le = lakeEdgeDistance(x, z)
  if (le < 10) {
    const level = lakeLevel() + 0.35
    const bank = 1 - smoothstep(0, 10, le)
    h += (level - h) * bank * 0.85
    if (le < 0) h = level - 0.35 - LAKE.depth * smoothstep(0.5, 10, -le) - 0.25 * smoothstep(-1.5, 0, le)
    // and the bank beyond the shoreline always stands clear of the water,
    // so the lake never spills over low ground round its edge
    else h = Math.max(h, level - 0.2 + le * 0.08)
  }

  // the pool deck is level ground, raised a touch over the slope
  const pl = poolLocal(x, z)
  const ox = Math.abs(pl.lx) - (POOL.hx + POOL.deck), oz = Math.abs(pl.lz) - (POOL.hz + POOL.deck)
  const out = Math.hypot(Math.max(ox, 0), Math.max(oz, 0))
  if (out < 6) {
    const w = 1 - smoothstep(0, 6, out)
    h += (poolDeckHeight() - 0.04 - h) * w
  }
  return h
}

export function terrainNormalY(x: number, z: number) {
  const e = 1.2
  const hx = terrainHeight(x + e, z) - terrainHeight(x - e, z)
  const hz = terrainHeight(x, z + e) - terrainHeight(x, z - e)
  return { slope: Math.hypot(hx, hz) / (2 * e), hx, hz }
}

/** Ground the player walks on: terrain, or the bridge deck when over the stream. */
export function groundHeight(x: number, z: number) {
  if (onBridge(x, z)) return bridgeDeckAt(x, z) + ROAD_LIFT
  // on the gym slab, stand on its top, not the ground under it
  if (gymOutside(x, z) < 0) return gymFloorY()
  const pl = poolLocal(x, z)
  if (Math.abs(pl.lx) < POOL.hx && Math.abs(pl.lz) < POOL.hz) return poolFloorAt(pl.lx)
  if (Math.abs(pl.lx) < POOL.hx + POOL.deck && Math.abs(pl.lz) < POOL.hz + POOL.deck) return poolDeckHeight()
  // the road's tarmac is laid ROAD_LIFT proud of the ground; stand on it, not in it
  const pd = pathDistance(x, z)
  const road = PATH_HALF_WIDTH + 1.4
  if (pd < road + 0.3) return terrainHeight(x, z) + ROAD_LIFT * Math.min(1, (road + 0.3 - pd) / 0.3)
  return terrainHeight(x, z)
}

/** How far the road surface sits above the terrain (Ground.tsx lays it here). */
export const ROAD_LIFT = 0.12

/**
 * The water surface at a point, or null where there is no water. The lake,
 * the pool and the stream all answer here, so swimming, splashes and
 * footsteps treat them the same way.
 */
export function waterSurfaceAt(x: number, z: number): number | null {
  const pl = poolLocal(x, z)
  if (Math.abs(pl.lx) < POOL.hx && Math.abs(pl.lz) < POOL.hz) return poolWaterLevel()
  if (lakeEdgeDistance(x, z) < 0.5) return lakeLevel()
  if (streamDistance(x, z) < 2.6) return waterLevelAt(x, z) - 0.25
  return null
}

/** How deep the water is over the bottom at a point (0 when dry). */
export function waterDepthAt(x: number, z: number) {
  const w = waterSurfaceAt(x, z)
  if (w === null) return 0
  return Math.max(0, w - groundHeight(x, z))
}

/** Road height at each end of the bridge (back = -z end, front = +z end). */
let _ends: { back: number; front: number } | null = null
export function bridgeEnds() {
  if (!_ends) {
    const e = bridge.length / 2 + 0.5
    const sx = Math.sin(bridge.angle), sz = Math.cos(bridge.angle)
    _ends = {
      front: terrainHeight(bridge.x + sx * e, bridge.z + sz * e),
      back: terrainHeight(bridge.x - sx * e, bridge.z - sz * e),
    }
  }
  return _ends
}
/** The deck at the middle of the bridge; it ramps evenly between the banks. */
export function bridgeDeckHeight() {
  const e = bridgeEnds()
  return (e.back + e.front) / 2
}
/** The deck surface under a point on the bridge. */
export function bridgeDeckAt(x: number, z: number) {
  const e = bridgeEnds()
  const k = Math.min(1, Math.max(0, bridgeLocal(x, z).lz / bridge.length + 0.5))
  return e.back + (e.front - e.back) * k
}
/** The road's own surface under a point (before its lift): terrain, or the deck. */
export function roadBase(x: number, z: number) {
  return onBridge(x, z) ? bridgeDeckAt(x, z) : terrainHeight(x, z)
}

export const streamSurface = () => terrainHeight(bridge.x, bridge.z) - 0.25

export const waterLevelAt = (x: number, z: number) => rawHeight(x, z) - STREAM_LEVEL_DROP + 0.35
/** Distance to the nearest water edge: the stream, the lake or the pool. */
export function streamDistanceAt(x: number, z: number) {
  const pl = poolLocal(x, z)
  const po = Math.hypot(Math.max(Math.abs(pl.lx) - POOL.hx - POOL.deck, 0), Math.max(Math.abs(pl.lz) - POOL.hz - POOL.deck, 0))
  return Math.min(streamDistance(x, z), Math.max(0, lakeEdgeDistance(x, z)), po)
}
export { streamSamples }

// ---------------------------------------------------------------- colliders
/**
 * Solid things, in the ground plane. Circles for trunks, posts and people;
 * rotated boxes for anything with corners — walls, racks, benches, houses,
 * the car — because a circle big enough to cover a box's corners blocks a
 * wide ring of empty ground round its sides, and one that fits the sides lets
 * you walk through the corners.
 */
/**
 * Places the lawn must not grow through: mats, decks, anything laid flat on
 * the grass that is thinner than a tuft is tall.
 */
const grassClear: { x: number; z: number; r: number }[] = []
export function addGrassClear(x: number, z: number, r: number) {
  grassClear.push({ x, z, r })
}
export function isGrassCleared(x: number, z: number) {
  for (const c of grassClear) if ((x - c.x) ** 2 + (z - c.z) ** 2 < c.r * c.r) return true
  return false
}

export type Collider =
  | { x: number; z: number; r: number }
  | { x: number; z: number; hx: number; hz: number; angle: number }

type Box = { x: number; z: number; hx: number; hz: number; angle: number; c: number; s: number; r: number }
type Circle = { x: number; z: number; r: number }
type Solid = Circle | Box
const isBox = (c: Solid): c is Box => 'hx' in c

const CELL = 10
const grid = new Map<string, Solid[]>()
const key = (cx: number, cz: number) => `${cx},${cz}`

export function addCollider(c: Collider) {
  let solid: Solid
  if ('hx' in c) {
    solid = { ...c, c: Math.cos(c.angle), s: Math.sin(c.angle), r: Math.hypot(c.hx, c.hz) }
  } else {
    solid = c
  }
  const reach = solid.r
  const x0 = Math.floor((solid.x - reach) / CELL) - 1
  const x1 = Math.floor((solid.x + reach) / CELL) + 1
  const z0 = Math.floor((solid.z - reach) / CELL) - 1
  const z1 = Math.floor((solid.z + reach) / CELL) + 1
  for (let i = x0; i <= x1; i++) {
    for (let j = z0; j <= z1; j++) {
      const k = key(i, j)
      let list = grid.get(k)
      if (!list) grid.set(k, (list = []))
      list.push(solid)
    }
  }
}

/**
 * A box collider fitted to an object's own bounds, in its own frame, so a
 * rotated model gets a rotated box. `pad` grows it a little all round.
 */
export function addBoxFor(
  bounds: { min: { x: number; z: number }; max: { x: number; z: number } },
  at: { x: number; z: number }, yaw: number, scale = 1, pad = 0.05,
) {
  const cx = ((bounds.min.x + bounds.max.x) / 2) * scale
  const cz = ((bounds.min.z + bounds.max.z) / 2) * scale
  const c = Math.cos(yaw), s = Math.sin(yaw)
  // object space to world: three's rotation.y turns +x toward -z
  addCollider({
    x: at.x + cx * c + cz * s,
    z: at.z - cx * s + cz * c,
    hx: ((bounds.max.x - bounds.min.x) / 2) * scale + pad,
    hz: ((bounds.max.z - bounds.min.z) / 2) * scale + pad,
    angle: yaw,
  })
}

/** Things that move — the parked car, the people — checked every step. */
const dynamic = new Set<() => Collider | null>()
export function addDynamicCollider(get: () => Collider | null) {
  dynamic.add(get)
  return () => { dynamic.delete(get) }
}

export function clearColliders() {
  grid.clear()
}

/** Into a box's own frame: +x along its width, +z along its depth. */
function toLocal(b: Box, x: number, z: number) {
  const dx = x - b.x, dz = z - b.z
  return { lx: dx * b.c - dz * b.s, lz: dx * b.s + dz * b.c }
}
function toWorld(b: Box, lx: number, lz: number) {
  return { x: b.x + lx * b.c + lz * b.s, z: b.z - lx * b.s + lz * b.c }
}

function pushOut(solid: Solid, x: number, z: number, radius: number) {
  if (!isBox(solid)) {
    const dx = x - solid.x
    const dz = z - solid.z
    const d = Math.hypot(dx, dz)
    const min = solid.r + radius
    if (d < min && d > 1e-4) {
      const push = (min - d) / d
      return { x: x + dx * push, z: z + dz * push }
    }
    return null
  }
  const { lx, lz } = toLocal(solid, x, z)
  const qx = Math.max(-solid.hx, Math.min(solid.hx, lx))
  const qz = Math.max(-solid.hz, Math.min(solid.hz, lz))
  const inside = qx === lx && qz === lz
  if (inside) {
    // inside the box: leave by the nearest face
    const ex = solid.hx - Math.abs(lx), ez = solid.hz - Math.abs(lz)
    const nl = ex < ez
      ? { lx: Math.sign(lx || 1) * (solid.hx + radius), lz }
      : { lx, lz: Math.sign(lz || 1) * (solid.hz + radius) }
    return toWorld(solid, nl.lx, nl.lz)
  }
  const dx = lx - qx, dz = lz - qz
  const d = Math.hypot(dx, dz)
  if (d >= radius || d < 1e-5) return null
  const k = radius / d
  return toWorld(solid, qx + dx * k, qz + dz * k)
}

function toSolid(c: Collider): Solid {
  return 'hx' in c ? { ...c, c: Math.cos(c.angle), s: Math.sin(c.angle), r: Math.hypot(c.hx, c.hz) } : c
}

/** Ray against a solid in the ground plane; distance to the first hit or Infinity. */
function rayHit(solid: Solid, ox: number, oz: number, dx: number, dz: number, radius: number) {
  if (!isBox(solid)) {
    const px = ox - solid.x, pz = oz - solid.z
    const a = dx * dx + dz * dz
    if (a < 1e-6) return Infinity
    const b = 2 * (px * dx + pz * dz)
    const r = solid.r + radius
    const cc = px * px + pz * pz - r * r
    const disc = b * b - 4 * a * cc
    if (disc < 0) return Infinity
    const hit = (-b - Math.sqrt(disc)) / (2 * a)
    return hit > 0 ? hit : Infinity
  }
  // slab test in the box's frame, the box grown by the sweep radius
  const o = toLocal(solid, ox, oz)
  const ldx = dx * solid.c - dz * solid.s
  const ldz = dx * solid.s + dz * solid.c
  let t0 = -Infinity, t1 = Infinity
  for (const [p, d, h] of [[o.lx, ldx, solid.hx + radius], [o.lz, ldz, solid.hz + radius]] as const) {
    if (Math.abs(d) < 1e-8) {
      if (Math.abs(p) > h) return Infinity
      continue
    }
    let a = (-h - p) / d, b = (h - p) / d
    if (a > b) [a, b] = [b, a]
    t0 = Math.max(t0, a)
    t1 = Math.min(t1, b)
    if (t0 > t1) return Infinity
  }
  return t0 > 0 ? t0 : Infinity
}

/**
 * How far a sphere of `radius` can travel from `from` along `dir` before it hits
 * a collider, up to `maxDist`. Used to keep the camera out of trees and walls.
 */
export function sweepColliders(
  from: { x: number; y: number; z: number },
  dir: { x: number; y: number; z: number },
  maxDist: number,
  radius: number,
) {
  let nearest = maxDist
  const steps = Math.max(2, Math.ceil(maxDist / CELL))
  const seen = new Set<Solid>()
  for (let s = 0; s <= steps; s++) {
    const k = (s / steps) * maxDist
    const px = from.x + dir.x * k
    const pz = from.z + dir.z * k
    const list = grid.get(key(Math.floor(px / CELL), Math.floor(pz / CELL)))
    if (!list) continue
    for (const c of list) {
      if (seen.has(c)) continue
      seen.add(c)
      const hit = rayHit(c, from.x, from.z, dir.x, dir.z, radius)
      if (hit < nearest) nearest = hit
    }
  }
  return nearest
}

/** Push a circle of `radius` out of anything it overlaps. Returns the corrected spot. */
export function resolveCollisions(x: number, z: number, radius: number, ignore?: () => Collider | null) {
  const list = grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL)))
  const moving: Solid[] = []
  for (const get of dynamic) {
    if (get === ignore) continue
    const c = get()
    if (c) moving.push(toSolid(c))
  }
  for (let pass = 0; pass < 3; pass++) {
    let moved = false
    for (const c of list ?? []) {
      const p = pushOut(c, x, z, radius)
      if (p) { x = p.x; z = p.z; moved = true }
    }
    for (const c of moving) {
      const p = pushOut(c, x, z, radius)
      if (p) { x = p.x; z = p.z; moved = true }
    }
    if (!moved) break
  }
  const r = Math.hypot(x, z)
  if (r > WORLD_RADIUS) {
    x = (x / r) * WORLD_RADIUS
    z = (z / r) * WORLD_RADIUS
  }
  return { x, z }
}
