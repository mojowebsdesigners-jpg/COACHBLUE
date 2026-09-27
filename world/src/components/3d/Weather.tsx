import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  AdditiveBlending, BufferAttribute, BufferGeometry, DoubleSide, DynamicDrawUsage,
  Group, Mesh, MeshBasicMaterial, Points, PointsMaterial, Vector3,
} from 'three'
import { rand, terrainHeight } from '../../lib/terrain'
import { player, useStore } from '../../state/store'
import { windTime } from './Forest'

/** Leaves tumbling down through the canopy around the player. */
export function FallingLeaves() {
  const count = useStore((s) => s.preset.leaves)
  const reduced = useStore((s) => s.settings.reducedMotion)
  const ref = useRef<Points>(null)

  const { geometry, material, seeds } = useMemo(() => {
    const g = new BufferGeometry()
    const arr = new Float32Array(Math.max(1, count) * 3)
    const seeds = new Float32Array(Math.max(1, count))
    for (let i = 0; i < count; i++) {
      arr[i * 3] = (rand() - 0.5) * 46
      arr[i * 3 + 1] = rand() * 14
      arr[i * 3 + 2] = (rand() - 0.5) * 46
      seeds[i] = rand() * Math.PI * 2
    }
    const attr = new BufferAttribute(arr, 3)
    attr.setUsage(DynamicDrawUsage)
    g.setAttribute('position', attr)
    const m = new PointsMaterial({
      color: '#b08a4a', size: 0.14, transparent: true, opacity: 0.75, depthWrite: false,
    })
    return { geometry: g, material: m, seeds }
  }, [count])

  useFrame((_, dt) => {
    const pts = ref.current
    if (!pts || count === 0) return
    pts.position.set(player.pos.x, player.pos.y, player.pos.z)
    if (reduced) return
    const attr = geometry.attributes.position as BufferAttribute
    for (let i = 0; i < count; i++) {
      let y = attr.getY(i) - dt * (0.5 + (i % 5) * 0.12)
      let x = attr.getX(i) + Math.sin(windTime.value * 0.8 + seeds[i]) * dt * 0.7
      const z = attr.getZ(i) + Math.cos(windTime.value * 0.6 + seeds[i]) * dt * 0.4
      if (y < -2) {
        y = 12 + rand() * 4
        x = (rand() - 0.5) * 46
      }
      attr.setXYZ(i, x, y, z)
    }
    attr.needsUpdate = true
  })

  if (count === 0) return null
  return <points key={count} ref={ref} args={[geometry, material]} frustumCulled={false} />
}

/** A few birds circling far off, and butterflies near the ground. */
export function Wildlife() {
  const on = useStore((s) => s.preset.birds)
  const reduced = useStore((s) => s.settings.reducedMotion)
  const birds = useRef<Group>(null)
  const flutter = useRef<Group>(null)

  const flock = useMemo(
    () => Array.from({ length: 7 }, () => ({
      r: 60 + rand() * 90,
      h: 26 + rand() * 22,
      speed: 0.05 + rand() * 0.05,
      phase: rand() * Math.PI * 2,
      size: 0.5 + rand() * 0.5,
    })),
    [],
  )
  const bugs = useMemo(
    () => Array.from({ length: 10 }, () => ({
      offset: new Vector3((rand() - 0.5) * 16, 0, (rand() - 0.5) * 16),
      speed: 0.4 + rand() * 0.5,
      phase: rand() * Math.PI * 2,
    })),
    [],
  )

  useFrame(({ clock }) => {
    const t = reduced ? 0 : clock.elapsedTime
    if (birds.current) {
      birds.current.position.set(player.pos.x, 0, player.pos.z)
      birds.current.children.forEach((child, i) => {
        const b = flock[i]
        const a = t * b.speed + b.phase
        child.position.set(Math.cos(a) * b.r, b.h + Math.sin(a * 2) * 2.5, Math.sin(a) * b.r)
        child.rotation.y = -a + Math.PI / 2
        // wing flap
        const flap = Math.sin(t * 7 + b.phase) * 0.5
        child.children.forEach((wing, w) => {
          wing.rotation.z = w === 0 ? flap : -flap
        })
      })
    }
    if (flutter.current) {
      flutter.current.children.forEach((child, i) => {
        const b = bugs[i]
        const a = t * b.speed + b.phase
        const x = player.pos.x + b.offset.x + Math.sin(a) * 2.2
        const z = player.pos.z + b.offset.z + Math.cos(a * 0.8) * 2.2
        child.position.set(x, terrainHeight(x, z) + 0.7 + Math.sin(a * 2.3) * 0.35, z)
        child.rotation.y = a
        child.scale.setScalar(0.6 + Math.sin(t * 9 + b.phase) * 0.15)
      })
    }
  })

  if (!on) return null

  return (
    <>
      <group ref={birds}>
        {flock.map((b, i) => (
          <group key={i} scale={b.size}>
            {[0, 1].map((w) => (
              <mesh key={w} position={[w === 0 ? -0.5 : 0.5, 0, 0]}>
                <planeGeometry args={[1, 0.22]} />
                <meshBasicMaterial color="#2c3230" side={DoubleSide} transparent opacity={0.75} fog />
              </mesh>
            ))}
          </group>
        ))}
      </group>
      <group ref={flutter}>
        {bugs.map((_, i) => (
          <mesh key={i}>
            <planeGeometry args={[0.13, 0.1]} />
            <meshBasicMaterial color="#ffe9a8" side={DoubleSide} transparent opacity={0.8} />
          </mesh>
        ))}
      </group>
    </>
  )
}

/** Low mist that hangs in the hollows; thickest early and at dusk. */
export function Mist() {
  const post = useStore((s) => s.preset.post)
  const ref = useRef<Group>(null)
  const sheets = useMemo(
    () => Array.from({ length: 7 }, () => ({
      offset: new Vector3((rand() - 0.5) * 70, 0, (rand() - 0.5) * 70),
      scale: 22 + rand() * 26,
      speed: 0.01 + rand() * 0.02,
      phase: rand() * Math.PI * 2,
    })),
    [],
  )

  useFrame(({ clock }) => {
    const g = ref.current
    if (!g) return
    g.children.forEach((child, i) => {
      const s = sheets[i]
      const t = clock.elapsedTime * s.speed + s.phase
      const x = player.pos.x + s.offset.x + Math.sin(t) * 12
      const z = player.pos.z + s.offset.z + Math.cos(t * 0.8) * 12
      child.position.set(x, terrainHeight(x, z) + 1.1, z)
      ;(child as Mesh).rotation.x = -Math.PI / 2
      ;((child as Mesh).material as MeshBasicMaterial).opacity = 0.05 + Math.sin(t * 1.3) * 0.02
    })
  })

  if (!post) return null
  return (
    <group ref={ref}>
      {sheets.map((s, i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[s.scale, s.scale]} />
          <meshBasicMaterial color="#dfe9ea" transparent opacity={0.06} depthWrite={false} />
        </mesh>
      ))}
    </group>
  )
}

/** Smoke rising off the campfire. */
export function Smoke({ position }: { position: [number, number, number] }) {
  const reduced = useStore((s) => s.settings.reducedMotion)
  const count = 26
  const ref = useRef<Points>(null)
  const geometry = useMemo(() => {
    const g = new BufferGeometry()
    const arr = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      arr[i * 3] = (rand() - 0.5) * 0.3
      arr[i * 3 + 1] = rand() * 4
      arr[i * 3 + 2] = (rand() - 0.5) * 0.3
    }
    const attr = new BufferAttribute(arr, 3)
    attr.setUsage(DynamicDrawUsage)
    g.setAttribute('position', attr)
    return g
  }, [])

  useFrame((_, dt) => {
    if (reduced || !ref.current) return
    const attr = geometry.attributes.position as BufferAttribute
    for (let i = 0; i < count; i++) {
      let y = attr.getY(i) + dt * (0.5 + (i % 4) * 0.12)
      let x = attr.getX(i) + Math.sin(windTime.value * 0.9 + i) * dt * 0.25
      if (y > 4.5) {
        y = 0
        x = (rand() - 0.5) * 0.3
      }
      attr.setXYZ(i, x, y, attr.getZ(i))
    }
    attr.needsUpdate = true
  })

  const material = useMemo(
    () => new PointsMaterial({
      color: '#9aa0a2', size: 0.5, transparent: true, opacity: 0.16, depthWrite: false,
      blending: AdditiveBlending,
    }),
    [],
  )

  return <points ref={ref} position={position} args={[geometry, material]} frustumCulled={false} />
}
