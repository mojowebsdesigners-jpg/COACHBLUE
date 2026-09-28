import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  BufferGeometry, Color, CylinderGeometry, DoubleSide, Float32BufferAttribute, InstancedMesh,
  MeshStandardMaterial, Object3D, ShaderMaterial,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import {
  LAKE, addCollider, addPlatform, addGrassClear, lakeEdgeDistance, lakeLevel, lakeRadius, terrainHeight,
} from '../../lib/terrain'
import { scannedTexture } from '../../lib/materials'
import { registerSeat } from './Seats'
import { day } from './Lighting'

/**
 * The lake, done the way the best stylised worlds do water: you read the
 * depth from the colour. Bright turquoise over the shallows, clear enough to
 * see the sand; deepening through teal to a rich blue over the drop-off; a
 * soft white line of foam at the water's edge with thin bands washing in and
 * out; small ripples catching the sun. Round it: a pale sand beach, reeds
 * and lily pads, and a timber jetty to sit on the end of — or dive from.
 */
const LEVEL = () => lakeLevel()

// ---------------------------------------------------------------- the water
const WATER_VERT = `
  attribute float aDepth;
  attribute float aEdge;
  varying float vDepth;
  varying float vEdge;
  varying vec3 vW;
  varying vec3 vView;
  void main() {
    vDepth = aDepth;
    vEdge = aEdge;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    vView = cameraPosition - w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`

const WATER_FRAG = `
  uniform float uTime;
  uniform vec3 uShallow;
  uniform vec3 uMid;
  uniform vec3 uDeep;
  uniform vec3 uSky;
  uniform vec3 uSun;
  uniform vec3 uSunDir;
  uniform float uNight;
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  varying float vDepth;
  varying float vEdge;
  varying vec3 vW;
  varying vec3 vView;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  void main() {
    // colour by depth: sand-clear turquoise, teal, deep blue
    float d = max(vDepth, 0.0);
    vec3 col = mix(uShallow, uMid, smoothstep(0.1, 2.2, d));
    col = mix(col, uDeep, smoothstep(2.0, 7.0, d));
    // small ripples: a normal from two drifting noise layers
    vec2 p = vW.xz * 0.9;
    float t = uTime;
    float h1 = noise(p + vec2(t * 0.35, t * 0.2));
    float h2 = noise(p * 2.3 - vec2(t * 0.25, -t * 0.4));
    vec3 n = normalize(vec3((h1 - 0.5) * 0.16 + (h2 - 0.5) * 0.08, 1.0, (h2 - 0.5) * 0.16 - (h1 - 0.5) * 0.06));
    vec3 v = normalize(vView);
    // the sky in it at grazing angles, the sun's glints on the ripples
    float fres = pow(1.0 - max(dot(n, v), 0.0), 4.0);
    col = mix(col, uSky, fres * 0.45);
    vec3 hlf = normalize(uSunDir + v);
    float spec = pow(max(dot(n, hlf), 0.0), 180.0);
    col += uSun * spec * 1.6;
    // foam at the edge, and thin bands washing up the shallows
    // the water ends at the shoreline, and the foam lies along it
    if (vEdge > 0.35) discard;
    float lap = 0.12 * sin(t * 1.3 + vW.x * 0.6 + vW.z * 0.4);
    float edge = max(1.0 - smoothstep(0.05, 0.5 + lap, d), smoothstep(-0.9 + lap, 0.0, vEdge));
    float bands = smoothstep(0.92, 1.0, fract(d * 1.6 - t * 0.22)) * (1.0 - smoothstep(0.2, 1.1, d));
    float foam = clamp(edge + bands * 0.6, 0.0, 1.0) * (0.75 + 0.25 * noise(vW.xz * 3.0 + t * 0.4));
    col = mix(col, vec3(0.96, 0.98, 0.97), foam);
    // night: the colours go under, the moonlit sheen stays
    col *= mix(1.0, 0.22, uNight);
    // clear over the sand, near-opaque over the deep
    float a = mix(0.55, 0.93, smoothstep(0.0, 3.5, d));
    a = max(a, foam) * (1.0 - smoothstep(0.1, 0.35, vEdge));
    // the world's fog, so the far shore sits in the same air as the hills
    float fogD = length(vView);
    float fog = 1.0 - exp(-uFogDensity * uFogDensity * fogD * fogD);
    col = mix(col, uFogColor, fog);
    gl_FragColor = vec4(col, a);
  }`

function lakeSurface() {
  // rings out from the middle to just past the shore, so every vertex can
  // carry the depth of the water under it
  const rings = 40, segs = 128
  const pos: number[] = [], depth: number[] = [], edge: number[] = [], idx: number[] = []
  const lvl = LEVEL()
  pos.push(0, 0, 0)
  depth.push(lvl - terrainHeight(LAKE.x, LAKE.z))
  edge.push(lakeEdgeDistance(LAKE.x, LAKE.z))
  for (let r = 1; r <= rings; r++) {
    for (let s = 0; s < segs; s++) {
      const a = (s / segs) * Math.PI * 2
      const rad = (lakeRadius(a) + 1.4) * Math.pow(r / rings, 0.8)
      const x = Math.cos(a) * rad, z = Math.sin(a) * rad
      pos.push(x, 0, z)
      depth.push(lvl - terrainHeight(LAKE.x + x, LAKE.z + z))
      edge.push(lakeEdgeDistance(LAKE.x + x, LAKE.z + z))
    }
  }
  for (let s = 0; s < segs; s++) idx.push(0, 1 + ((s + 1) % segs), 1 + s)
  for (let r = 1; r < rings; r++) {
    const a0 = 1 + (r - 1) * segs, a1 = 1 + r * segs
    for (let s = 0; s < segs; s++) {
      const s1 = (s + 1) % segs
      idx.push(a0 + s, a0 + s1, a1 + s, a0 + s1, a1 + s1, a1 + s)
    }
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(pos, 3))
  g.setAttribute('aDepth', new Float32BufferAttribute(depth, 1))
  g.setAttribute('aEdge', new Float32BufferAttribute(edge, 1))
  g.setIndex(idx)
  return g
}

export function LakeWater() {
  const geo = useMemo(lakeSurface, [])
  const mat = useMemo(() => new ShaderMaterial({
    vertexShader: WATER_VERT, fragmentShader: WATER_FRAG,
    transparent: true, depthWrite: false, side: DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uShallow: { value: new Color('#7eead9') },
      uMid: { value: new Color('#2fb6c8') },
      uDeep: { value: new Color('#1a74b0') },
      uSky: { value: new Color('#bcd8ef') },
      uSun: { value: new Color('#fff2dc') },
      uSunDir: { value: day.sun.clone() },
      uNight: { value: 0 },
      uFogColor: { value: new Color() },
      uFogDensity: { value: 0.002 },
    },
  }), [])
  useFrame((_, dt) => {
    const u = mat.uniforms
    u.uTime.value += dt
    u.uSun.value.copy(day.sunColor)
    u.uSunDir.value.copy(day.sun)
    u.uNight.value = day.night
    u.uFogColor.value.copy(day.fog)
    u.uFogDensity.value = day.fogDensity
    u.uSky.value.copy(day.fog).lerp(day.zenith, 0.35)
  })
  return <mesh geometry={geo} material={mat} position={[LAKE.x, LEVEL(), LAKE.z]} renderOrder={2} />
}

// ---------------------------------------------------------------- the beach
/** A ring of pale sand from under the shallows out onto the bank, fading into the grass. */
function Beach() {
  const geo = useMemo(() => {
    const segs = 160, rings = 6
    const pos: number[] = [], col: number[] = [], uv: number[] = [], idx: number[] = []
    for (let r = 0; r <= rings; r++) {
      const k = r / rings
      for (let s = 0; s < segs; s++) {
        const a = (s / segs) * Math.PI * 2
        const wob = Math.sin(a * 5 + 1.3) * 0.8 + Math.sin(a * 11) * 0.4
        const rad = lakeRadius(a) - 2.2 + k * (6 + wob)
        const x = LAKE.x + Math.cos(a) * rad, z = LAKE.z + Math.sin(a) * rad
        pos.push(x, terrainHeight(x, z) + 0.04, z)
        uv.push(x * 0.25, z * 0.25)
        const fade = 1 - Math.max(0, (k - 0.55) / 0.45)
        col.push(fade, fade, fade)
      }
    }
    for (let r = 0; r < rings; r++) for (let s = 0; s < segs; s++) {
      const a0 = r * segs + s, a1 = r * segs + ((s + 1) % segs), b0 = a0 + segs, b1 = a1 + segs
      idx.push(a0, a1, b0, a1, b1, b0)      // wound to face up
    }
    const g = new BufferGeometry()
    g.setAttribute('position', new Float32BufferAttribute(pos, 3))
    g.setAttribute('uv', new Float32BufferAttribute(uv, 2))
    g.setAttribute('color', new Float32BufferAttribute(col, 3))
    g.setIndex(idx)
    g.computeVertexNormals()
    return g
  }, [])
  const mat = useMemo(() => {
    const m = new MeshStandardMaterial({
      color: '#e9d6ad', roughness: 0.95, normalMap: scannedTexture('dirt_nor', 1),
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
    })
    // the vertex colour carries the fade into the grass, as alpha
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec3 color;\nvarying float vFade;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFade = color.r;')
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vFade;')
        .replace('#include <opaque_fragment>', 'diffuseColor.a *= smoothstep(0.0, 1.0, vFade);\n#include <opaque_fragment>')
    }
    m.customProgramCacheKey = () => 'beach'
    return m
  }, [])
  return <mesh geometry={geo} material={mat} receiveShadow renderOrder={1} />
}

// ---------------------------------------------------------------- the jetty
const JETTY_A = 2.6       // the direction from the lake's middle it runs out along

/** Where the jetty is: its shore end, the way it points, its deck and size. */
export function jettyFrame() {
  const len = 9, w = 1.6
  const a = JETTY_A
  const shore = lakeRadius(a) + 2.5
  // from the bank out over the water
  const x0 = LAKE.x + Math.cos(a) * shore, z0 = LAKE.z + Math.sin(a) * shore
  const yaw = Math.atan2(-Math.cos(a), -Math.sin(a))          // pointing out into the lake
  const deck = Math.max(LEVEL() + 0.55, terrainHeight(x0, z0) + 0.25)
  /** a point `along` metres out and `side` metres across */
  const at = (along: number, side = 0): [number, number] =>
    [x0 + Math.sin(yaw) * along + Math.cos(yaw) * side, z0 + Math.cos(yaw) * along - Math.sin(yaw) * side]
  return { len, w, x0, z0, yaw, deck, at }
}

function Jetty() {
  const { len, w, x0, z0, yaw, deck } = jettyFrame()
  const mats = useMemo(() => ({
    plank: new MeshStandardMaterial({
      map: scannedTexture('deck_diff', 1, true), normalMap: scannedTexture('deck_nor', 1),
      color: new Color('#c9a27a'), roughness: 0.85,
    }),
    post: new MeshStandardMaterial({ color: '#5c4531', roughness: 0.9 }),
  }), [])
  useEffect(() => {
    // you walk out along it on its planks, and can sit at the end with your
    // legs over the water
    const offDeck = addPlatform({
      x: x0 + Math.sin(yaw) * (len / 2 + 0.2), z: z0 + Math.cos(yaw) * (len / 2 + 0.2),
      hx: w / 2, hz: len / 2, angle: yaw, top: deck + 0.03,
    })
    const ex = x0 + Math.sin(yaw) * (len - 0.3), ez = z0 + Math.cos(yaw) * (len - 0.3)
    addGrassClear(x0, z0, 1.5)
    const off = registerSeat({ id: 'jetty', at: [ex, ez], ground: deck - 0.45, yaw, height: 0.45, label: 'SIT ON THE JETTY' })
    for (const s of [-1, 1]) {
      addCollider({ x: x0 + Math.cos(yaw) * s * (w / 2 + 0.1), z: z0 - Math.sin(yaw) * s * (w / 2 + 0.1), r: 0.12 })
    }
    return () => { off(); offDeck() }
  }, [deck, x0, z0, yaw])
  return (
    <group position={[x0, deck, z0]} rotation={[0, yaw, 0]}>
      {Array.from({ length: 22 }, (_, i) => (
        <mesh key={i} position={[0, 0, i * (len / 22) + 0.2]} material={mats.plank} castShadow receiveShadow>
          <boxGeometry args={[w, 0.06, len / 22 - 0.03]} />
        </mesh>
      ))}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * (w / 2 - 0.08), -0.08, len / 2]} material={mats.post}>
          <boxGeometry args={[0.1, 0.1, len]} />
        </mesh>
      ))}
      {[0.4, 3, 5.6, 8.4].flatMap((z) => [-1, 1].map((s) => (
        <mesh key={`${z}${s}`} position={[s * (w / 2 - 0.05), -1.4, z]} material={mats.post} castShadow>
          <cylinderGeometry args={[0.08, 0.09, 2.9, 8]} />
        </mesh>
      )))}
    </group>
  )
}

// ---------------------------------------------------------------- reeds & lily pads
const rnd = (() => { let s = 7; return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646 })()

function reedGeometry() {
  const parts: BufferGeometry[] = []
  for (let i = 0; i < 6; i++) {
    const h = 0.9 + rnd() * 0.8
    const c = new CylinderGeometry(0.006, 0.012, h, 4)
    c.translate((rnd() - 0.5) * 0.25, h / 2, (rnd() - 0.5) * 0.25)
    c.rotateZ((rnd() - 0.5) * 0.25)
    parts.push(c.toNonIndexed())
    if (i % 2 === 0) {
      const head = new CylinderGeometry(0.025, 0.025, 0.16, 6)
      head.translate(0, h - 0.12, 0)
      head.rotateZ((rnd() - 0.5) * 0.25)
      parts.push(head.toNonIndexed())
    }
  }
  return mergeGeometries(parts, false)!
}

function ShoreLife() {
  const reeds = useRef<InstancedMesh>(null)
  const pads = useRef<InstancedMesh>(null)
  const reedGeo = useMemo(reedGeometry, [])
  const padGeo = useMemo(() => {
    const g = new CylinderGeometry(0.28, 0.28, 0.01, 14, 1, false, 0.35, Math.PI * 2 - 0.35)
    return g
  }, [])
  const reedMat = useMemo(() => {
    const m = new MeshStandardMaterial({ color: '#6f8a3c', roughness: 0.8 })
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = { value: 0 }
      m.userData.sh = sh
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vec4 ip = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          transformed.x += sin(uTime * 1.4 + ip.x * 0.8) * position.y * position.y * 0.06;`)
    }
    m.customProgramCacheKey = () => 'reeds'
    return m
  }, [])
  const padMat = useMemo(() => new MeshStandardMaterial({ color: '#4f7d33', roughness: 0.6, side: DoubleSide }), [])
  const N = { reeds: 90, pads: 40 }
  useEffect(() => {
    const d = new Object3D()
    let n = 0
    for (let i = 0; i < 400 && n < N.reeds; i++) {
      const a = rnd() * Math.PI * 2
      if (Math.abs(Math.atan2(Math.sin(a - JETTY_A), Math.cos(a - JETTY_A))) < 0.25) continue
      const r = lakeRadius(a) + (rnd() - 0.6) * 1.8
      const x = LAKE.x + Math.cos(a) * r, z = LAKE.z + Math.sin(a) * r
      const y = terrainHeight(x, z)
      if (LEVEL() - y > 0.6) continue            // reeds stand in the shallows only
      d.position.set(x, y, z)
      d.rotation.set(0, rnd() * 6, 0)
      d.scale.setScalar(0.8 + rnd() * 0.6)
      d.updateMatrix()
      reeds.current!.setMatrixAt(n++, d.matrix)
    }
    reeds.current!.count = n
    let m = 0
    for (let i = 0; i < 400 && m < N.pads; i++) {
      const a = rnd() * Math.PI * 2
      const r = lakeRadius(a) - 1.5 - rnd() * 3.5
      const x = LAKE.x + Math.cos(a) * r, z = LAKE.z + Math.sin(a) * r
      if (lakeEdgeDistance(x, z) > -1) continue
      d.position.set(x, LEVEL() + 0.012, z)
      d.rotation.set(0, rnd() * 6, 0)
      d.scale.setScalar(0.7 + rnd() * 0.7)
      d.updateMatrix()
      pads.current!.setMatrixAt(m++, d.matrix)
    }
    pads.current!.count = m
    for (const x of [reeds.current!, pads.current!]) { x.instanceMatrix.needsUpdate = true; x.computeBoundingSphere() }
  }, [N.pads, N.reeds])
  useFrame((_, dt) => { const sh = reedMat.userData.sh; if (sh) sh.uniforms.uTime.value += dt })
  return (
    <group>
      <instancedMesh ref={reeds} args={[reedGeo, reedMat, N.reeds]} castShadow />
      <instancedMesh ref={pads} args={[padGeo, padMat, N.pads]} receiveShadow />
    </group>
  )
}

export function LakeScene() {
  return (
    <group>
      <LakeWater />
      <Beach />
      <Jetty />
      <ShoreLife />
    </group>
  )
}

