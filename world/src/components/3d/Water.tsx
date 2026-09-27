import { useEffect, useMemo } from 'react'
import { registerSeat } from './Seats'
import { useFrame } from '@react-three/fiber'
import {
  BufferGeometry, Color, DoubleSide, Float32BufferAttribute, MeshStandardMaterial, Shape,
  ShapeGeometry, Vector2,
} from 'three'
import {
  LAKE, POOL, lakeLevel, lakeRadius, poolDeckHeight, poolFloorAt, poolWaterLevel,
} from '../../lib/terrain'
import { scanned, scannedTexture } from '../../lib/materials'

/**
 * Open water, shared by the lake and the pool.
 *
 * A standard material with two scrolling ripple layers written straight into
 * the normal, a Fresnel lift so it goes silvery at grazing angles and clear
 * looking down, and a tint that deepens with the water under it. No render
 * targets and no extra passes: it costs about what a textured floor does.
 */
function useWaterMaterial(tint: string, deep: string, opacity: number, rippleScale: number) {
  const mat = useMemo(() => {
    const m = new MeshStandardMaterial({
      color: tint, roughness: 0.04, metalness: 0.1, transparent: true, opacity,
      side: DoubleSide, envMapIntensity: 1.8, depthWrite: false,
    })
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = { value: 0 }
      shader.uniforms.uDeep = { value: new Color(deep) }
      m.userData.shader = shader
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;')
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform float uTime;
          uniform vec3 uDeep;
          varying vec3 vWPos;
          vec2 ripple(vec2 p, float t) {
            // a few crossing wave trains: cheap, and never visibly repeats
            vec2 g = vec2(0.0);
            g += vec2(cos(p.x * 1.7 + t * 1.3), cos(p.y * 1.3 - t * 1.1)) * 0.5;
            g += vec2(cos((p.x + p.y) * 2.9 + t * 1.9), cos((p.x - p.y) * 3.3 - t * 1.7)) * 0.3;
            g += vec2(cos(p.x * 7.1 - t * 2.6), cos(p.y * 6.3 + t * 2.4)) * 0.12;
            return g;
          }`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          vec2 rp = ripple(vWPos.xz * ${rippleScale.toFixed(3)}, uTime);
          vec3 rn = normalize(vec3(-rp.x * 0.16, 1.0, -rp.y * 0.16));
          normal = normalize((viewMatrix * vec4(rn, 0.0)).xyz);`)
        .replace('#include <opaque_fragment>', `
          float fres = pow(1.0 - clamp(dot(normalize(vViewPosition), normal) * -1.0 + 1.0, 0.0, 1.0), 3.0);
          float grazing = 1.0 - abs(dot(normalize(-vViewPosition), normal));
          outgoingLight = mix(outgoingLight, outgoingLight * uDeep * 2.2, 0.35);
          diffuseColor.a = clamp(diffuseColor.a + pow(grazing, 3.0) * 0.45, 0.0, 0.97);
          #include <opaque_fragment>`)
    }
    m.customProgramCacheKey = () => `water-${rippleScale}`
    return m
  }, [tint, deep, opacity, rippleScale])
  useFrame((_, dt) => {
    const sh = mat.userData.shader
    if (sh) sh.uniforms.uTime.value += dt
  })
  return mat
}

// ---------------------------------------------------------------- lake
export function Lake() {
  const geometry = useMemo(() => {
    const shape = new Shape()
    const n = 96
    for (let k = 0; k <= n; k++) {
      const a = (k / n) * Math.PI * 2
      // a little past the shoreline: the rising bank hides the edge
      const r = lakeRadius(a) + 1.2
      const x = Math.cos(a) * r, z = Math.sin(a) * r
      if (k === 0) shape.moveTo(x, z)
      else shape.lineTo(x, z)
    }
    const g = new ShapeGeometry(shape, 24)
    g.rotateX(Math.PI / 2)
    return g
  }, [])
  const mat = useWaterMaterial('#3d6b73', '#16323a', 0.8, 0.55)
  return (
    <mesh geometry={geometry} material={mat} position={[LAKE.x, lakeLevel(), LAKE.z]} renderOrder={2} />
  )
}

// ---------------------------------------------------------------- pool
function box(w: number, h: number, d: number) {
  return { args: [w, h, d] as [number, number, number] }
}

/** The basin floor, sloping from the shallow end to the deep end. */
function basinFloor() {
  const g = new BufferGeometry()
  const segs = 24
  const v: number[] = [], uv: number[] = [], idx: number[] = []
  for (let i = 0; i <= segs; i++) {
    const lx = -POOL.hx + (i / segs) * POOL.hx * 2
    const y = poolFloorAt(lx) - poolWaterLevel()
    for (const lz of [-POOL.hz, POOL.hz]) {
      v.push(lx, y, lz)
      uv.push(lx, lz)
    }
    if (i > 0) {
      const a = (i - 1) * 2
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3)
    }
  }
  g.setAttribute('position', new Float32BufferAttribute(v, 3))
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

/** One long side wall of the basin, following the floor's slope. */
function sideWall(lz: number) {
  const g = new BufferGeometry()
  const segs = 24
  const v: number[] = [], uv: number[] = [], idx: number[] = []
  for (let i = 0; i <= segs; i++) {
    const lx = -POOL.hx + (i / segs) * POOL.hx * 2
    const y = poolFloorAt(lx) - poolWaterLevel()
    v.push(lx, y, lz, lx, 0.1, lz)
    uv.push(lx, y, lx, 0.1)
    if (i > 0) {
      const a = (i - 1) * 2
      if (lz < 0) idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
      else idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3)
    }
  }
  g.setAttribute('position', new Float32BufferAttribute(v, 3))
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

export function Pool() {
  const water = useWaterMaterial('#5fc6dc', '#1a6f8a', 0.55, 1.1)
  // each lounger is somewhere to lie back: hips on the cushion just below
  // the raised backrest, looking down its length (the pool's local +x)
  useEffect(() => {
    const deck = poolDeckHeight() + 0.02
    const c = Math.cos(POOL.angle), s = Math.sin(POOL.angle)
    const lz = POOL.hz + POOL.deck * 0.55
    const offs = [-3, -0.2].map((lx0, i) => {
      const lx = lx0 - 0.32
      const x = POOL.x + lx * c + lz * s, z = POOL.z - lx * s + lz * c
      return registerSeat({
        id: `lounger-${i}`, at: [x, z], ground: deck, yaw: Math.atan2(c, -s), height: 0.41, kind: 'lounge',
      })
    })
    return () => offs.forEach((o) => o())
  }, [])
  const mats = useMemo(() => {
    const tile = new MeshStandardMaterial({
      map: scannedTexture('pooltile_diff', 1, true), normalMap: scannedTexture('pooltile_nor', 1),
      roughness: 0.25, metalness: 0, normalScale: new Vector2(0.6, 0.6), side: DoubleSide,
    })
    const deck = new MeshStandardMaterial({
      map: scannedTexture('deck_diff', 1, true), normalMap: scannedTexture('deck_nor', 1),
      roughness: 0.75, metalness: 0,
    })
    for (const t of [deck.map!, deck.normalMap!]) t.repeat.set(1, 1)
    const coping = new MeshStandardMaterial({ color: '#e9e4d8', roughness: 0.6 })
    const lane = new MeshStandardMaterial({ color: '#12384f', roughness: 0.3 })
    const chrome = new MeshStandardMaterial({ color: '#dfe3e8', roughness: 0.12, metalness: 1 })
    const frame = new MeshStandardMaterial({ color: '#f4f4f2', roughness: 0.45 })
    const cushion = new MeshStandardMaterial({ color: '#1e3a56', roughness: 0.85 })
    return { tile, deck, coping, lane, chrome, frame, cushion }
  }, [])
  // a stone kerb all round the outside of the deck, sitting into the grass
  const kerb = useMemo(() => scanned('concrete', 1, { roughness: 0.8 }), [])
  const floor = useMemo(basinFloor, [])
  const walls = useMemo(() => [sideWall(-POOL.hz), sideWall(POOL.hz)], [])
  const deckY = poolDeckHeight()
  const wl = poolWaterLevel()
  const W = POOL.hx * 2, D = POOL.hz * 2, T = POOL.deck
  const shallowDrop = POOL.shallow, deepDrop = POOL.deep

  // the deck tiles in true metres: scale UVs by setting repeat per slab
  const deckSlab = (w: number, d: number, x: number, z: number, key: string) => {
    const m = mats.deck.clone()
    m.map = mats.deck.map!.clone(); m.map.repeat.set(w / 2, d / 2); m.map.needsUpdate = true
    m.normalMap = mats.deck.normalMap!.clone(); m.normalMap.repeat.set(w / 2, d / 2); m.normalMap.needsUpdate = true
    return (
      <mesh key={key} position={[x, deckY - 0.3, z]} material={m} receiveShadow castShadow>
        <boxGeometry {...box(w, 0.6, d)} />
      </mesh>
    )
  }

  return (
    <group position={[POOL.x, 0, POOL.z]} rotation={[0, POOL.angle, 0]}>
      {/* deck: four slabs round the basin */}
      {deckSlab(W + T * 2, T, 0, -(POOL.hz + T / 2), 'n')}
      {deckSlab(W + T * 2, T, 0, POOL.hz + T / 2, 's')}
      {deckSlab(T, D, -(POOL.hx + T / 2), 0, 'w')}
      {deckSlab(T, D, POOL.hx + T / 2, 0, 'e')}
      {/* kerb */}
      {[[W + T * 2 + 0.3, 0.15, 0, -(POOL.hz + T + 0.075)], [W + T * 2 + 0.3, 0.15, 0, POOL.hz + T + 0.075],
        [0.15, D + T * 2, -(POOL.hx + T + 0.075), 0], [0.15, D + T * 2, POOL.hx + T + 0.075, 0]].map(([w, d, x, z], i) => (
        <mesh key={i} position={[x, deckY - 0.12, z]} material={kerb} receiveShadow>
          <boxGeometry {...box(w, 0.3, d)} />
        </mesh>
      ))}
      {/* bullnose coping round the water's edge */}
      {[[W + 0.5, 0.36, 0, -(POOL.hz + 0.18)], [W + 0.5, 0.36, 0, POOL.hz + 0.18],
        [0.36, D, -(POOL.hx + 0.18), 0], [0.36, D, POOL.hx + 0.18, 0]].map(([w, d, x, z], i) => (
        <mesh key={i} position={[x, deckY + 0.02, z]} material={mats.coping} castShadow receiveShadow>
          <boxGeometry {...box(w, 0.07, d)} />
        </mesh>
      ))}

      {/* the basin, in water-level space */}
      <group position={[0, wl, 0]}>
        <mesh geometry={floor} material={mats.tile} receiveShadow />
        {walls.map((g, i) => <mesh key={i} geometry={g} material={mats.tile} receiveShadow />)}
        <mesh position={[-POOL.hx, (0.1 - shallowDrop) / 2, 0]} rotation={[0, Math.PI / 2, 0]} material={mats.tile}>
          <planeGeometry args={[D, 0.1 + shallowDrop]} />
        </mesh>
        <mesh position={[POOL.hx, (0.1 - deepDrop) / 2, 0]} rotation={[0, -Math.PI / 2, 0]} material={mats.tile}>
          <planeGeometry args={[D, 0.1 + deepDrop]} />
        </mesh>
        {/* lane lines on the floor, with the T at each end */}
        {[-1.75, 0, 1.75].map((lz) => (
          <group key={lz}>
            {Array.from({ length: 12 }, (_, i) => {
              const lx = -POOL.hx + 1.2 + (i + 0.5) * ((W - 2.4) / 12)
              return (
                <mesh key={i} position={[lx, poolFloorAt(lx) - wl + 0.012, lz]} rotation={[-Math.PI / 2, 0, 0]} material={mats.lane}>
                  <planeGeometry args={[(W - 2.4) / 12 + 0.01, 0.25]} />
                </mesh>
              )
            })}
          </group>
        ))}
        {/* water */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} material={water} renderOrder={2}>
          <planeGeometry args={[W, D, 1, 1]} />
        </mesh>
      </group>

      {/* ladder at the deep end */}
      <group position={[POOL.hx - 1.2, deckY, -POOL.hz + 0.02]}>
        {[-0.28, 0.28].map((x) => (
          <group key={x}>
            <mesh position={[x, 0.45, 0.02]} material={mats.chrome}>
              <cylinderGeometry args={[0.022, 0.022, 0.9, 12]} />
            </mesh>
            <mesh position={[x, 0.9, 0.18]} rotation={[Math.PI / 2, 0, 0]} material={mats.chrome}>
              <torusGeometry args={[0.16, 0.022, 8, 16, Math.PI]} />
            </mesh>
            <mesh position={[x, -0.7, 0.34]} material={mats.chrome}>
              <cylinderGeometry args={[0.022, 0.022, 1.7, 12]} />
            </mesh>
          </group>
        ))}
        {[-0.3, -0.62, -0.94].map((y) => (
          <mesh key={y} position={[0, y, 0.34]} material={mats.chrome}>
            <boxGeometry args={[0.56, 0.03, 0.09]} />
          </mesh>
        ))}
      </group>

      {/* two loungers on the long side (each one somewhere to lie back) */}
      {[-3, -0.2].map((lx) => (
        <group key={lx} position={[lx, deckY + 0.02, POOL.hz + T * 0.55]} rotation={[0, 0, 0]}>
          <mesh position={[0, 0.3, 0]} material={mats.frame} castShadow>
            <boxGeometry args={[1.9, 0.06, 0.7]} />
          </mesh>
          <mesh position={[0.05, 0.37, 0]} material={mats.cushion} castShadow>
            <boxGeometry args={[1.35, 0.08, 0.64]} />
          </mesh>
          <mesh position={[-0.72, 0.55, 0]} rotation={[0, 0, -0.75]} material={mats.cushion} castShadow>
            <boxGeometry args={[0.6, 0.08, 0.64]} />
          </mesh>
          {[[-0.85, -0.3], [-0.85, 0.3], [0.85, -0.3], [0.85, 0.3]].map(([x, z], i) => (
            <mesh key={i} position={[x, 0.14, z]} material={mats.frame}>
              <boxGeometry args={[0.05, 0.28, 0.05]} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  )
}
