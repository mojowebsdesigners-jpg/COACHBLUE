import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import {
  AdditiveBlending, BufferGeometry, Color, CylinderGeometry, DirectionalLight, DoubleSide,
  Float32BufferAttribute, HemisphereLight,
  FogExp2, Group, InstancedBufferAttribute, InstancedMesh, Mesh, MeshBasicMaterial, MeshStandardMaterial,
  Object3D, PlaneGeometry, ShaderMaterial, Shape, ShapeGeometry, SphereGeometry, Vector3,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { LAKE, lakeEdgeDistance, lakeLevel, terrainHeight, waterSurfaceAt } from '../../lib/terrain'
import { player } from '../../state/store'
import { setUnderwater } from '../../lib/audio'

/**
 * Under the lake.
 *
 * The lake is eight metres deep in the middle, and down there it is a place:
 * sunlight rippling over the bed in caustic webs, shafts of light slanting
 * down from the surface, kelp swaying, coral and starfish on the rocks,
 * schools of fish that turn together and scatter when you swim at them, a
 * sea turtle cruising the edge, jellyfish drifting, a ray gliding over the
 * sand. With the camera under the surface the world turns blue-green and
 * close, and the sound goes dull.
 *
 * All of it is instanced or small, and none of it animates unless you are
 * near the lake.
 */
const SURF = () => lakeLevel()
/** Nothing down there moves unless you are close enough to see it. */
const nearLake = () => Math.hypot(player.pos.x - LAKE.x, player.pos.z - LAKE.z) < LAKE.r + 45
const _v = new Vector3()
const _teal = new Color('#5fd0d8')
const _deep = new Color('#0a2a30')
const rnd = (() => { let s = 91; return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646 })()

/** A random point on the lake bed at least `deep` metres under the surface. */
function bedPoint(deep: number, tries = 40) {
  for (let i = 0; i < tries; i++) {
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * LAKE.r
    const x = LAKE.x + Math.cos(a) * r, z = LAKE.z + Math.sin(a) * r
    if (lakeEdgeDistance(x, z) > -1) continue
    const y = terrainHeight(x, z)
    if (SURF() - y >= deep) return new Vector3(x, y, z)
  }
  return new Vector3(LAKE.x, terrainHeight(LAKE.x, LAKE.z), LAKE.z)
}

// ---------------------------------------------------------------- the look
/**
 * With the camera under water: thick blue-green fog (visibility of a few
 * metres, like a real lake), a vignette over the screen, and muffled sound.
 */
export function UnderwaterFX() {
  const { scene, camera } = useThree()
  const was = useRef(false)
  const fog = useMemo(() => new FogExp2('#0d3f47', 0.085), [])
  const saved = useRef<typeof scene.fog>(null)
  const lights = useRef<{ l: DirectionalLight | HemisphereLight; color: Color; ground: Color | null }[]>([])
  useFrame(() => {
    const s = waterSurfaceAt(camera.position.x, camera.position.z)
    const under = s !== null && camera.position.y < s - 0.05
    if (under !== was.current) {
      was.current = under
      document.body.classList.toggle('underwater', under)
      setUnderwater(under)
      if (under) {
        saved.current = scene.fog
        scene.fog = fog
        // remember the colours Lighting does not reset every frame
        lights.current = []
        scene.traverse((o) => {
          const l = o as DirectionalLight | HemisphereLight
          if ((l as DirectionalLight).isDirectionalLight || (l as HemisphereLight).isHemisphereLight) {
            lights.current.push({ l, color: l.color.clone(), ground: (l as HemisphereLight).groundColor?.clone() ?? null })
          }
        })
      } else {
        if (saved.current) scene.fog = saved.current
        for (const e of lights.current) {
          e.l.color.copy(e.color)
          if (e.ground) (e.l as HemisphereLight).groundColor.copy(e.ground)
        }
      }
    }
    if (under) {
      // deeper is darker and bluer
      const depth = Math.max(0, (s as number) - camera.position.y)
      fog.color.setRGB(0.04 - depth * 0.003, 0.2 - depth * 0.012, 0.24 - depth * 0.01)
      fog.density = 0.07 + depth * 0.006
      // Water eats light: red first, then most of the rest. Lighting sets the
      // sun and sky every frame; under the surface they are taken down after
      // it, by depth, and the sky light turns blue-green — otherwise the bed
      // eight metres down is lit like a beach.
      const keep = Math.exp(-depth * 0.16) * 0.55
      for (const e of lights.current) {
        if ((e.l as DirectionalLight).isDirectionalLight) {
          e.l.intensity *= keep
          e.l.color.copy(e.color).lerp(_teal, 0.6)
        } else {
          e.l.intensity *= 0.7
          e.l.color.copy(e.color).lerp(_teal, 0.7)
          if (e.ground) (e.l as HemisphereLight).groundColor.copy(e.ground).lerp(_deep, 0.8)
        }
      }
    }
  }, 3)
  useEffect(() => () => { document.body.classList.remove('underwater'); setUnderwater(false) }, [])
  return null
}

// ---------------------------------------------------------------- caustics
const CAUSTIC_VERT = `
  varying vec3 vW;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`
const CAUSTIC_FRAG = `
  uniform float uTime;
  uniform float uLevel;
  varying vec3 vW;
  // two layers of warped cells: the bright web sunlight makes through ripples
  float cells(vec2 p, float t) {
    p += vec2(sin(p.y * 1.3 + t), cos(p.x * 1.1 - t * 0.8)) * 0.6;
    vec2 i = floor(p), f = fract(p);
    float d = 1.0;
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 o = 0.5 + 0.45 * sin(t * 0.9 + 6.2831 * fract(sin(dot(i + g, vec2(127.1, 311.7))) * 43758.5453) + vec2(0.0, 1.7));
      d = min(d, length(g + o - f));
    }
    return d;
  }
  void main() {
    float depth = uLevel - vW.y;
    if (depth < 0.2) discard;
    float c = pow(1.0 - cells(vW.xz * 0.55, uTime), 7.0) + pow(1.0 - cells(vW.xz * 0.9 + 3.1, uTime * 1.3), 7.0) * 0.6;
    // strong in the shallows, fading with depth
    float k = c * 0.42 * exp(-depth * 0.2);
    gl_FragColor = vec4(vec3(0.75, 0.95, 1.0) * k, 1.0);
  }`

function Caustics() {
  const geo = useMemo(() => {
    const R = LAKE.r * 1.25, N = 72
    const g = new PlaneGeometry(R * 2, R * 2, N, N)
    g.rotateX(-Math.PI / 2)
    const p = g.attributes.position
    for (let i = 0; i < p.count; i++) {
      const x = LAKE.x + p.getX(i), z = LAKE.z + p.getZ(i)
      p.setXYZ(i, x, terrainHeight(x, z) + 0.05, z)
    }
    g.computeVertexNormals()
    return g
  }, [])
  const mat = useMemo(() => new ShaderMaterial({
    vertexShader: CAUSTIC_VERT, fragmentShader: CAUSTIC_FRAG,
    uniforms: { uTime: { value: 0 }, uLevel: { value: SURF() } },
    transparent: true, blending: AdditiveBlending, depthWrite: false,
  }), [])
  useFrame((_, dt) => { if (nearLake()) mat.uniforms.uTime.value += dt })
  return <mesh geometry={geo} material={mat} frustumCulled={false} renderOrder={1} />
}

// ---------------------------------------------------------------- light shafts
function LightShafts() {
  const ref = useRef<Group>(null)
  const { camera } = useThree()
  const mat = useMemo(() => new MeshBasicMaterial({
    color: '#bff3ff', transparent: true, opacity: 0.05, blending: AdditiveBlending,
    depthWrite: false, side: DoubleSide,
  }), [])
  const shafts = useMemo(() => Array.from({ length: 9 }, () => {
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * LAKE.r * 0.7
    return { x: LAKE.x + Math.cos(a) * r, z: LAKE.z + Math.sin(a) * r, w: 0.6 + rnd() * 1.4, tilt: 0.2 + rnd() * 0.15, ph: rnd() * 6 }
  }), [])
  useFrame(({ clock }) => {
    const g = ref.current
    if (!g) return
    // shafts are only seen from under the surface
    g.visible = document.body.classList.contains('underwater')
    if (!g.visible) return
    const t = clock.elapsedTime
    g.children.forEach((c, i) => {
      const s = shafts[i]
      ;((c as Mesh).material as MeshBasicMaterial).opacity = 0.035 + Math.sin(t * 0.6 + s.ph) * 0.02
      c.lookAt(camera.position.x, c.position.y, camera.position.z)
    })
  })
  return (
    <group ref={ref}>
      {shafts.map((s, i) => (
        <mesh key={i} position={[s.x, SURF() - 4, s.z]} rotation={[0, 0, s.tilt]} material={mat.clone()}>
          <planeGeometry args={[s.w, 9]} />
        </mesh>
      ))}
    </group>
  )
}

// ---------------------------------------------------------------- the bed
function tintGeo(g: BufferGeometry, a: string, b: string) {
  const ca = new Color(a), cb = new Color(b)
  const p = g.attributes.position
  const col = new Float32Array(p.count * 3)
  g.computeBoundingBox()
  const bb = g.boundingBox!
  for (let i = 0; i < p.count; i++) {
    const k = (p.getY(i) - bb.min.y) / (bb.max.y - bb.min.y || 1)
    const c = ca.clone().lerp(cb, k)
    col.set([c.r, c.g, c.b], i * 3)
  }
  g.setAttribute('color', new Float32BufferAttribute(col, 3))
  return g
}

/** A frond of kelp: a tall ribbon, segmented so it can sway along its length. */
function kelpGeometry() {
  const g = new PlaneGeometry(0.22, 3.2, 1, 12)
  g.translate(0, 1.6, 0)
  return tintGeo(g, '#2f3d12', '#7a8f2a')
}

/** A branching coral head. */
function coralGeometry() {
  const parts: BufferGeometry[] = []
  for (let i = 0; i < 7; i++) {
    const h = 0.25 + rnd() * 0.35
    const c = new CylinderGeometry(0.02, 0.045, h, 5)
    c.translate(0, h / 2, 0)
    c.rotateZ((rnd() - 0.5) * 0.9)
    c.rotateY(rnd() * Math.PI * 2)
    parts.push(c)
    const tip = new SphereGeometry(0.04, 6, 4)
    tip.translate(0, h, 0)
    tip.rotateZ((rnd() - 0.5) * 0.9)
    parts.push(tip)
  }
  const g = mergeGeometries(parts.map((p) => p.toNonIndexed()), false)!
  return tintGeo(g, '#ffffff', '#ffffff')
}

function starGeometry() {
  const sh = new Shape()
  for (let i = 0; i <= 10; i++) {
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2
    const r = i % 2 ? 0.05 : 0.14
    if (i === 0) sh.moveTo(Math.cos(a) * r, Math.sin(a) * r)
    else sh.lineTo(Math.cos(a) * r, Math.sin(a) * r)
  }
  const g = new ShapeGeometry(sh)
  g.rotateX(-Math.PI / 2)
  g.translate(0, 0.02, 0)
  return g
}

function useSway(strength: number) {
  return useMemo(() => {
    const m = new MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: DoubleSide })
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = { value: 0 }
      m.userData.sh = sh
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vec4 ip = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          float ph = ip.x * 0.7 + ip.z * 0.5;
          float k = position.y * position.y * ${strength.toFixed(3)};
          transformed.x += sin(uTime * 1.1 + ph) * k;
          transformed.z += cos(uTime * 0.8 + ph * 1.3) * k * 0.6;`)
    }
    m.customProgramCacheKey = () => `sway-${strength}`
    return m
  }, [strength])
}

function Bed() {
  const kelpRef = useRef<InstancedMesh>(null)
  const coralRef = useRef<InstancedMesh>(null)
  const starRef = useRef<InstancedMesh>(null)
  const kelp = useMemo(kelpGeometry, [])
  const coral = useMemo(coralGeometry, [])
  const star = useMemo(starGeometry, [])
  const sway = useSway(0.05)
  const coralMat = useMemo(() => new MeshStandardMaterial({ vertexColors: true, roughness: 0.7 }), [])
  const starMat = useMemo(() => new MeshStandardMaterial({ color: '#e8743a', roughness: 0.8 }), [])
  const N = { kelp: 70, coral: 34, star: 18 }
  useEffect(() => {
    const d = new Object3D()
    const coralColors = ['#e3566b', '#f08a3e', '#b565d6', '#f2c14e', '#e9e0d0'].map((c) => new Color(c))
    for (let i = 0; i < N.kelp; i++) {
      const p = bedPoint(2.2)
      d.position.copy(p)
      d.rotation.set(0, rnd() * Math.PI, 0)
      // fronds reach most of the way to the light
      const h = Math.min(1.8, (SURF() - p.y - 0.6) / 3.2)
      d.scale.set(1, Math.max(0.35, h * (0.6 + rnd() * 0.4)), 1)
      d.updateMatrix()
      kelpRef.current!.setMatrixAt(i, d.matrix)
    }
    for (let i = 0; i < N.coral; i++) {
      const p = bedPoint(1.5)
      d.position.copy(p)
      d.rotation.set(0, rnd() * Math.PI * 2, 0)
      d.scale.setScalar(0.7 + rnd() * 1.4)
      d.updateMatrix()
      coralRef.current!.setMatrixAt(i, d.matrix)
      coralRef.current!.setColorAt(i, coralColors[i % coralColors.length])
    }
    for (let i = 0; i < N.star; i++) {
      const p = bedPoint(1.2)
      d.position.copy(p)
      d.rotation.set(0, rnd() * Math.PI * 2, 0)
      d.scale.setScalar(0.8 + rnd() * 0.6)
      d.updateMatrix()
      starRef.current!.setMatrixAt(i, d.matrix)
    }
    for (const m of [kelpRef.current, coralRef.current, starRef.current]) {
      m!.instanceMatrix.needsUpdate = true
      if (m!.instanceColor) m!.instanceColor.needsUpdate = true
      m!.computeBoundingSphere()
    }
  }, [N.coral, N.kelp, N.star])
  useFrame((_, dt) => { const sh = sway.userData.sh; if (sh && nearLake()) sh.uniforms.uTime.value += dt })
  return (
    <group>
      <instancedMesh ref={kelpRef} args={[kelp, sway, N.kelp]} />
      <instancedMesh ref={coralRef} args={[coral, coralMat, N.coral]} castShadow />
      <instancedMesh ref={starRef} args={[star, starMat, N.star]} />
    </group>
  )
}

// ---------------------------------------------------------------- fish
/** The modelled creatures (tools/sealife/build.py). */
function useSealife() {
  return useGLTF('/models/sealife.glb').scene
}

/** One of the modelled fish, as a plain geometry for instancing. */
function useFishGeometry(name: string) {
  const scene = useSealife()
  return useMemo(() => {
    const m = scene.getObjectByName(name) as Mesh
    const g = m.geometry.clone()
    return g
  }, [scene, name])
}

type School = { n: number; scale: number; model: string; depth: number; speed: number; radius: number; phase: number }
const SCHOOLS: School[] = [
  { n: 30, scale: 0.26, model: 'Fish_Silver', depth: 2.5, speed: 0.18, radius: 0.55, phase: 0 },   // silver shoal
  { n: 16, scale: 0.3, model: 'Fish_Tang', depth: 4.2, speed: 0.13, radius: 0.45, phase: 2.1 },     // blue tangs
  { n: 12, scale: 0.16, model: 'Fish_Clown', depth: 3.2, speed: 0.15, radius: 0.35, phase: 4.2 },   // clownfish
]

function Fish({ school }: { school: School }) {
  const ref = useRef<InstancedMesh>(null)
  const geo = useFishGeometry(school.model)
  const mat = useMemo(() => {
    const m = new MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.15 })
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = { value: 0 }
      m.userData.sh = sh
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;\nattribute float aPhase;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          // the tail beats; the body follows it in a wave
          float behind = clamp(0.35 - position.z, 0.0, 1.0);
          transformed.x += sin(uTime * 9.0 + aPhase - position.z * 3.0) * behind * behind * 0.16;`)
    }
    m.customProgramCacheKey = () => 'fish'
    return m
  }, [])
  const fish = useMemo(() => Array.from({ length: school.n }, () => ({
    off: new Vector3((rnd() - 0.5) * 3.2, (rnd() - 0.5) * 1.2, (rnd() - 0.5) * 3.2),
    wob: rnd() * 6,
    s: school.scale * (0.8 + rnd() * 0.4),
  })), [school])
  const state = useRef({ t: school.phase * 10, centre: new Vector3(), flee: new Vector3(), yaw: 0 })
  const d = useMemo(() => new Object3D(), [])
  useEffect(() => {
    const ph = new Float32Array(school.n)
    for (let i = 0; i < school.n; i++) ph[i] = rnd() * 6
    ref.current!.geometry.setAttribute('aPhase', new InstancedBufferAttribute(ph, 1))
  }, [school.n])
  useFrame((_, delta) => {
    const m = ref.current
    if (!m || !nearLake()) return
    const sh = mat.userData.sh
    if (sh) sh.uniforms.uTime.value += delta
    const st = state.current
    const dt = Math.min(delta, 0.05)
    st.t += dt * school.speed
    // the school wanders the lake on a slow looping path at its depth
    const r = LAKE.r * school.radius
    const cx = LAKE.x + Math.cos(st.t) * r + Math.sin(st.t * 2.3) * r * 0.3
    const cz = LAKE.z + Math.sin(st.t * 1.3) * r
    const cy = SURF() - school.depth + Math.sin(st.t * 3.1) * 0.6
    const prev = _v.copy(st.centre)
    st.centre.set(cx, cy, cz)
    // swim at them and they scatter, then drift back together
    _v.set(player.pos.x - cx, player.pos.y - cy, player.pos.z - cz)
    const close = _v.length()
    if (close < 4.5) st.flee.addScaledVector(_v.normalize(), -(4.5 - close) * dt * 3)
    st.flee.multiplyScalar(1 - Math.min(1, dt * 0.6))
    st.centre.add(st.flee)
    // keep it in the water and off the bed
    const bed = terrainHeight(st.centre.x, st.centre.z)
    st.centre.y = Math.min(SURF() - 0.8, Math.max(bed + 0.8, st.centre.y))
    const vx = st.centre.x - prev.x, vz = st.centre.z - prev.z
    if (vx * vx + vz * vz > 1e-8) {
      const want = Math.atan2(vx, vz)
      st.yaw += Math.atan2(Math.sin(want - st.yaw), Math.cos(want - st.yaw)) * Math.min(1, dt * 3)
    }
    const spread = 1 + Math.min(1.5, st.flee.length() * 2)
    fish.forEach((f, i) => {
      const w = st.t * 30 + f.wob
      d.position.set(
        st.centre.x + f.off.x * spread + Math.sin(w) * 0.2,
        st.centre.y + f.off.y * spread + Math.sin(w * 1.3) * 0.12,
        st.centre.z + f.off.z * spread + Math.cos(w * 0.9) * 0.2,
      )
      d.rotation.set(0, st.yaw + Math.sin(w * 0.7) * 0.25, 0)
      d.scale.setScalar(f.s)
      d.updateMatrix()
      m.setMatrixAt(i, d.matrix)
    })
    m.instanceMatrix.needsUpdate = true
  })
  return <instancedMesh ref={ref} args={[geo, mat, school.n]} frustumCulled={false} />
}

// ---------------------------------------------------------------- turtle
function Turtle() {
  const scene = useSealife()
  const ref = useRef<Group>(null)
  const model = useMemo(() => {
    const t = (scene.getObjectByName('Turtle') as Object3D).clone(true)
    t.position.set(0, 0, 0)
    t.traverse((o) => {
      const m = o as Mesh
      if (m.isMesh) { m.material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.55 }); m.castShadow = true }
    })
    return t
  }, [scene])
  const flippers = useMemo(() => ['FL', 'FR', 'BL', 'BR'].map((k) => model.getObjectByName(`Flipper_${k}`)), [model])
  useFrame(({ clock }) => {
    const g = ref.current
    if (!g || !nearLake()) return
    const t = clock.elapsedTime * 0.07
    const r = LAKE.r * 0.62
    const x = LAKE.x + Math.cos(t) * r, z = LAKE.z + Math.sin(t) * r
    const y = Math.max(terrainHeight(x, z) + 1.2, SURF() - 3 + Math.sin(t * 5) * 0.5)
    g.position.set(x, y, z)
    g.rotation.set(0, Math.atan2(-Math.sin(t), Math.cos(t)) + Math.PI, 0)
    // the front flippers beat like wings, the back ones trim
    const f = Math.sin(clock.elapsedTime * 1.6)
    flippers.forEach((m, i) => {
      if (!m) return
      const side = i % 2 ? -1 : 1
      m.rotation.z = side * (i < 2 ? 0.15 + f * 0.55 : 0.05 + f * 0.12)
      m.rotation.y = side * (i < 2 ? f * 0.25 : 0)
    })
  })
  return <group ref={ref} scale={1.2}><primitive object={model} /></group>
}

// ---------------------------------------------------------------- jellyfish
function Jellyfish({ seed }: { seed: number }) {
  const scene = useSealife()
  const ref = useRef<Group>(null)
  const home = useMemo(() => bedPoint(3.5), [])
  const model = useMemo(() => {
    const g = new Group()
    const bell = new MeshStandardMaterial({
      vertexColors: true, emissive: '#c46bb0', emissiveIntensity: 0.35, transparent: true, opacity: 0.6,
      roughness: 0.2, side: DoubleSide, depthWrite: false,
    })
    const soft = new MeshStandardMaterial({
      vertexColors: true, transparent: true, opacity: 0.45, side: DoubleSide, depthWrite: false, roughness: 0.4,
    })
    for (const n of ['Jelly_Bell', 'Jelly_Arms', 'Jelly_Tentacles']) {
      const src = scene.getObjectByName(n) as Mesh
      const m = new Mesh(src.geometry, n === 'Jelly_Bell' ? bell : soft)
      // modelled Z-up; the world is Y-up
      m.rotation.x = -Math.PI / 2
      g.add(m)
    }
    return g
  }, [scene])
  useFrame(({ clock }) => {
    const g = ref.current
    if (!g || !nearLake()) return
    const t = clock.elapsedTime + seed * 3
    const pulse = Math.max(0, Math.sin(t * 2.2))
    g.position.set(home.x + Math.sin(t * 0.13) * 1.5, SURF() - 2.2 + Math.sin(t * 0.3) * 0.8 + pulse * 0.05, home.z + Math.cos(t * 0.11) * 1.5)
    g.scale.set(1 + pulse * 0.1, 1 - pulse * 0.15, 1 + pulse * 0.1)
    g.rotation.y = t * 0.1
  })
  return <group ref={ref}><primitive object={model} /></group>
}

// ---------------------------------------------------------------- ray
function Ray() {
  const scene = useSealife()
  const ref = useRef<Group>(null)
  const mat = useMemo(() => {
    const m = new MeshStandardMaterial({ vertexColors: true, roughness: 0.6, side: DoubleSide })
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = { value: 0 }
      m.userData.sh = sh
      // the wings ripple from the body out to the tips
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          float span = abs(position.x);
          transformed.y += sin(uTime * 1.3 - span * 2.2) * span * span * 0.28;`)
    }
    m.customProgramCacheKey = () => 'ray'
    return m
  }, [])
  const geo = useMemo(() => (scene.getObjectByName('Ray') as Mesh).geometry, [scene])
  useFrame(({ clock }, dt) => {
    const g = ref.current
    if (!g || !nearLake()) return
    const sh = mat.userData.sh
    if (sh) sh.uniforms.uTime.value += dt
    const t = clock.elapsedTime * 0.09 + 2
    const r = LAKE.r * 0.4
    const x = LAKE.x + Math.sin(t) * r, z = LAKE.z + Math.cos(t * 1.4) * r
    g.position.set(x, terrainHeight(x, z) + 0.9, z)
    const dx = Math.cos(t), dz = -Math.sin(t * 1.4) * 1.4
    g.rotation.set(0, Math.atan2(dx, dz), 0)
  })
  return <group ref={ref} scale={1.2}><mesh geometry={geo} material={mat} castShadow /></group>
}

// ---------------------------------------------------------------- all of it
export function LakeLife() {
  const ref = useRef<Group>(null)
  // only alive when you are near enough to see it
  useFrame(() => {
    const g = ref.current
    if (!g) return
    g.visible = nearLake()
  })
  return (
    <group ref={ref}>
      <Caustics />
      <LightShafts />
      <Bed />
      {SCHOOLS.map((s, i) => <Fish key={i} school={s} />)}
      <Turtle />
      {[0, 1, 2, 3].map((i) => <Jellyfish key={i} seed={i} />)}
      <Ray />
    </group>
  )
}

useGLTF.preload('/models/sealife.glb')
