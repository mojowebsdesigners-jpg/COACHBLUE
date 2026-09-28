import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  AdditiveBlending, BufferGeometry, DoubleSide, Float32BufferAttribute, Mesh,
  MeshStandardMaterial, ShaderMaterial, Vector3,
} from 'three'
import {
  PATH_HALF_WIDTH, bridge, bridgeDeckHeight, bridgeEnds, pathSamples, streamSamples,
  terrainHeight, waterLevelAt, addCollider,
} from '../../lib/terrain'
import { journeySteps, locationById } from '../../data/journey'
import { useStore } from '../../state/store'
import { Ground, GrassCover, Road } from './Ground'
import { DistantMountains, Motes, WindClock } from './Forest'
import { Rocks, Understory } from './Vegetation'
import { Trees, Undergrowth } from './Trees'
import { Locations } from './Locations'
import { FallingLeaves, Wildlife } from './Weather'
import { Rain } from './Rain'
import { Secrets } from './Secrets'
import { TransformationTimeline } from './Timeline'
import { Billboards, Residential, StreetLamps } from './Roadside'
import { Vehicle } from './Vehicle'
import { TireTracks } from './TireTracks'
import { Pool } from './Water'
import { LakeScene } from './LakeScene'
import { LakeLife, UnderwaterFX } from './Underwater'
import { Cross } from './Cross'
import { Frozen } from './Frozen'
import { Benches } from './Seats'
import { Pickups } from './Pickups'
import { NameLetters } from './NameLetters'
import { PhysicsWorld } from './fun/common'
import { Cannonball, Fishing, SplashFX, StoneSkim } from './fun/WaterFun'
import { Near } from './Props'
import { LAKE, POOL } from '../../lib/terrain'
import { Townsfolk } from './Townsfolk'
import { Lighting } from './Lighting'
import { LightPool } from './LightPool'

// ---------------------------------------------------------------- stream
function ribbon(points: { x: number; z: number }[], halfWidth: number, y: (x: number, z: number) => number) {
  const g = new BufferGeometry()
  const verts: number[] = []
  const uvs: number[] = []
  const idx: number[] = []
  for (let i = 0; i < points.length; i++) {
    const s = points[i]
    const n = points[Math.min(points.length - 1, i + 1)]
    const p = points[Math.max(0, i - 1)]
    const dx = n.x - p.x
    const dz = n.z - p.z
    const len = Math.hypot(dx, dz) || 1
    const sx = (-dz / len) * halfWidth
    const sz = (dx / len) * halfWidth
    const t = i / (points.length - 1)
    verts.push(s.x - sx, y(s.x - sx, s.z - sz), s.z - sz, s.x + sx, y(s.x + sx, s.z + sz), s.z + sz)
    uvs.push(0, t, 1, t)
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
}

function Stream() {
  const geometry = useMemo(
    () => ribbon(streamSamples.map((p) => ({ x: p.x, z: p.z })), 2.5, (x, z) => waterLevelAt(x, z) - 0.25),
    [],
  )
  const mat = useMemo(() => {
    const m = new MeshStandardMaterial({
      color: '#35525c', roughness: 0.08, metalness: 0.2, transparent: true, opacity: 0.66,
      side: DoubleSide, envMapIntensity: 1.6,
    })
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = { value: 0 }
      ;(m as any).userData.shader = shader
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           transformed.y += sin(position.x * 1.6 + uTime * 2.0) * 0.045
                          + sin(position.z * 2.1 - uTime * 1.4) * 0.03;`,
        )
    }
    return m
  }, [])

  useFrame((_, dt) => {
    const shader = (mat as any).userData.shader
    if (shader) shader.uniforms.uTime.value += dt
  })

  return <mesh geometry={geometry} material={mat} receiveShadow />
}

/**
 * The road bridge over the stream: a deck of heavy timbers ramping evenly
 * from bank to bank (the tarmac is laid over it by the road), on two steel
 * girders, with timber rails and posts either side.
 */
function Bridge() {
  const ends = bridgeEnds()
  const deck = bridgeDeckHeight()
  const pitch = -Math.atan2(ends.front - ends.back, bridge.length)
  const planks = 14
  useMemo(() => {
    // rails the whole length, so you can't walk (or drive) off the side
    const c = Math.cos(bridge.angle), sn = Math.sin(bridge.angle)
    for (const side of [-1, 1]) {
      for (let k = -2; k <= 2; k++) {
        const lx = side * (bridge.width / 2 + 0.1), lz = (k / 2) * (bridge.length / 2 - 0.5)
        addCollider({ x: bridge.x + lx * c + lz * sn, z: bridge.z - lx * sn + lz * c, r: 0.45 })
      }
    }
  }, [])

  return (
    <group position={[bridge.x, deck, bridge.z]} rotation={[pitch, bridge.angle, 0, 'YXZ']}>
      <mesh receiveShadow castShadow position={[0, -0.12, 0]}>
        <boxGeometry args={[bridge.width, 0.2, bridge.length]} />
        <meshStandardMaterial color="#5e4a33" roughness={0.95} />
      </mesh>
      {Array.from({ length: planks }, (_, i) => (
        <mesh key={i} receiveShadow position={[0, 0.0, -bridge.length / 2 + (i + 0.5) * (bridge.length / planks)]}>
          <boxGeometry args={[bridge.width + 0.3, 0.08, bridge.length / planks - 0.08]} />
          <meshStandardMaterial color="#6f5a3e" roughness={0.9} />
        </mesh>
      ))}
      {/* steel girders under the deck */}
      {[-1, 1].map((s) => (
        <mesh key={`g${s}`} castShadow position={[s * (bridge.width / 2 - 0.6), -0.55, 0]}>
          <boxGeometry args={[0.28, 0.7, bridge.length + 0.4]} />
          <meshStandardMaterial color="#3b3f44" roughness={0.6} metalness={0.5} />
        </mesh>
      ))}
      {[-1, 1].map((s) => (
        <group key={s}>
          <mesh castShadow position={[(s * bridge.width) / 2 + s * 0.1, 0.75, 0]}>
            <boxGeometry args={[0.16, 0.16, bridge.length]} />
            <meshStandardMaterial color="#5b4a34" roughness={0.9} />
          </mesh>
          <mesh castShadow position={[(s * bridge.width) / 2 + s * 0.1, 0.4, 0]}>
            <boxGeometry args={[0.1, 0.1, bridge.length]} />
            <meshStandardMaterial color="#5b4a34" roughness={0.9} />
          </mesh>
          {[-2, -1, 0, 1, 2].map((k) => (
            <mesh key={k} castShadow position={[(s * bridge.width) / 2 + s * 0.1, 0.38, (k * bridge.length) / 4.4]}>
              <boxGeometry args={[0.18, 0.84, 0.18]} />
              <meshStandardMaterial color="#5b4a34" roughness={0.9} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  )
}

// ---------------------------------------------------------------- guided path
const GUIDED_VERT = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
  }
`
const GUIDED_FRAG = `
  uniform float uTime;
  uniform float uFrom;
  uniform float uTo;
  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec2 vUv;
  void main() {
    float inRange = step(min(uFrom, uTo), vUv.y) * step(vUv.y, max(uFrom, uTo));
    float edge = smoothstep(0.0, 0.12, vUv.x) * smoothstep(1.0, 0.88, vUv.x);
    float stripes = 0.25 + 0.4 * sin(vUv.y * 190.0 - uTime * 3.4);
    float fade = smoothstep(0.0, 0.05, abs(vUv.y - min(uFrom, uTo)))
               * smoothstep(0.0, 0.05, abs(max(uFrom, uTo) - vUv.y));
    float a = inRange * edge * stripes * fade * uOpacity;
    if (a < 0.01) discard;
    gl_FragColor = vec4(uColor, a);
  }
`

function nearestT(x: number, z: number) {
  let best = Infinity
  let t = 0
  for (const s of pathSamples) {
    const d = (s.x - x) ** 2 + (s.z - z) ** 2
    if (d < best) {
      best = d
      t = s.t
    }
  }
  return t
}

function GuidedPath() {
  const mode = useStore((s) => s.mode)
  const index = useStore((s) => s.journeyIndex)
  const offPathHint = useStore((s) => s.offPathHint)
  const ref = useRef<Mesh>(null)

  const geometry = useMemo(
    () => ribbon(pathSamples, PATH_HALF_WIDTH * 0.8, (x, z) => terrainHeight(x, z) + 0.1),
    [],
  )
  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: GUIDED_VERT,
        fragmentShader: GUIDED_FRAG,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
        uniforms: {
          uTime: { value: 0 },
          uFrom: { value: 0 },
          uTo: { value: 0.1 },
          uColor: { value: new Vector3(0.11, 0.91, 0.71) },
          uOpacity: { value: 0.3 },
        },
      }),
    [],
  )

  const stepTs = useMemo(
    () => journeySteps.map((s) => nearestT(locationById[s.id].pos[0], locationById[s.id].pos[1])),
    [],
  )

  useFrame((_, dt) => {
    material.uniforms.uTime.value += dt
    const from = index === 0 ? 0 : stepTs[index - 1]
    material.uniforms.uFrom.value = from
    material.uniforms.uTo.value = stepTs[index]
    const want = mode === 'guided' ? (offPathHint ? 0.55 : 0.3) : 0
    material.uniforms.uOpacity.value += (want - material.uniforms.uOpacity.value) * Math.min(1, dt * 2)
  })

  return <mesh ref={ref} geometry={geometry} material={material} renderOrder={2} />
}

// ---------------------------------------------------------------- world
export function World() {
  // ?lite=1 drops the newest systems — used to isolate rendering problems
  const lite = typeof location !== 'undefined' && new URLSearchParams(location.search).has('lite')
  // ?off=trees,grass,... switches single systems off, for profiling
  const off = new Set((typeof location !== 'undefined' ? new URLSearchParams(location.search).get('off') ?? '' : '').split(','))
  const on = (k: string) => !off.has(k)
  return (
    <>
      <Lighting />
      <LightPool />
      <WindClock />
      {on('ground') && <Ground />}
      {on('road') && <Road />}
      <GuidedPath />
      {on('stream') && <Stream />}
      {on('lake') && <LakeScene />}
      <UnderwaterFX />
      {!lite && on('lakelife') && <LakeLife />}
      <Cross />
      <Frozen>
        {on('pool') && <Pool />}
        <Bridge />
      </Frozen>
      {on('trees') && <Trees />}
      {on('undergrowth') && <Undergrowth />}
      {on('understory') && <Understory />}
      {on('rocks') && <Rocks />}
      {on('grass') && <GrassCover />}
      {on('motes') && <Motes />}
      {!lite && <FallingLeaves />}
      {!lite && <Wildlife />}
      {!lite && <Rain />}
      {on('mountains') && <DistantMountains />}
      {!lite && on('locations') && <Locations />}
      {!lite && (
        <Frozen>
          {on('timeline') && <TransformationTimeline />}
          {on('secrets') && <Secrets />}
          {on('lamps') && <StreetLamps />}
          {on('billboards') && <Billboards />}
          {on('houses') && <Residential />}
          {on('benches') && <Benches />}
        </Frozen>
      )}
      {!lite && on('pickups') && <Pickups />}
      {!lite && on('letters') && <NameLetters />}
      {!lite && on('fun') && (
        <>
          <PhysicsWorld />
          <SplashFX />
          <Near pos={[LAKE.x, LAKE.z]} dist={75}><Fishing /><StoneSkim /></Near>
          <Near pos={[POOL.x, POOL.z]} dist={60}><Cannonball /></Near>
        </>
      )}
      {!lite && on('people') && <Townsfolk />}
      {!lite && on('vehicle') && <Vehicle />}
      {!lite && on('vehicle') && on('tracks') && <TireTracks />}
    </>
  )
}

