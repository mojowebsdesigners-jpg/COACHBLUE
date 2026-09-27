import { Suspense, useEffect, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Billboard, Text, useTexture } from '@react-three/drei'
import {
  Group, Mesh, MeshStandardMaterial, Vector3, VideoTexture, SRGBColorSpace,
  DoubleSide, MathUtils,
} from 'three'
import { registerLamp } from './LightPool'
import { groundHeight, addCollider } from '../../lib/terrain'
import { player, useStore, type Panel } from '../../state/store'
import { registerInteractable } from './InteractionSystem'

export const DISPLAY_FONT = '/fonts/BarlowCondensed-Bold.ttf'
export const BODY_FONT = '/fonts/Inter-Variable.ttf'
export const MINT = '#1DE9B6'

/** Mounts children only once the player is close, and unmounts them again. */
export function Near({
  pos, dist = 70, children,
}: { pos: [number, number]; dist?: number; children: React.ReactNode }) {
  const [on, setOn] = useState(false)
  const radiusScale = useStore((s) => s.preset.streamLoadRadius)
  const t = useRef(0)
  useFrame((_, dt) => {
    t.current += dt
    if (t.current < 0.5) return
    t.current = 0
    const d = Math.hypot(player.pos.x - pos[0], player.pos.z - pos[1])
    // hysteresis so a location doesn't flicker on the boundary
    const limit = dist * radiusScale
    const should = d < (on ? limit + 12 : limit)
    if (should !== on) setOn(should)
  })
  return <Suspense fallback={null}>{on ? children : null}</Suspense>
}

/** Soft mint ring on the ground that marks something you can interact with. */
export function GlowRing({ position, radius = 1.2 }: { position: [number, number, number]; radius?: number }) {
  const ref = useRef<Mesh>(null)
  useFrame(({ clock }) => {
    const m = ref.current
    if (!m) return
    const t = clock.elapsedTime
    const s = 1 + Math.sin(t * 1.6) * 0.06
    m.scale.set(s, s, s)
    ;(m.material as MeshStandardMaterial).opacity = 0.32 + Math.sin(t * 1.6) * 0.1
  })
  return (
    <mesh ref={ref} position={position} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[radius * 0.82, radius, 48]} />
      <meshStandardMaterial
        color={MINT}
        emissive={MINT}
        emissiveIntensity={2.2}
        transparent
        opacity={0.35}
        depthWrite={false}
        side={DoubleSide}
      />
    </mesh>
  )
}

/** A word standing in the landscape. */
export function WorldWord({
  text, position, size = 2.4, color = '#ffffff', opacity = 0.5, billboard = true,
}: {
  text: string; position: [number, number, number]; size?: number; color?: string
  opacity?: number; billboard?: boolean
}) {
  const content = (
    <Text
      font={DISPLAY_FONT}
      fontSize={size}
      color={color}
      anchorX="center"
      anchorY="middle"
      letterSpacing={0.08}
      outlineWidth={0.012}
      outlineColor="#0b0f0d"
      fillOpacity={opacity}
    >
      {text}
    </Text>
  )
  return billboard ? (
    <Billboard position={position} follow>{content}</Billboard>
  ) : (
    <group position={position}>{content}</group>
  )
}

/** Wooden signpost with an arrow, used to point the way. */
export function SignPost({
  position, rotation = 0, label, sub,
}: { position: [number, number]; rotation?: number; label: string; sub?: string }) {
  const y = groundHeight(position[0], position[1])
  useEffect(() => {
    addCollider({ x: position[0], z: position[1], r: 0.35 })
  }, [position])
  return (
    <group position={[position[0], y, position[1]]} rotation={[0, rotation, 0]}>
      <mesh castShadow position={[0, 1.1, 0]}>
        <cylinderGeometry args={[0.07, 0.09, 2.2, 8]} />
        <meshStandardMaterial color="#5a4630" roughness={0.95} />
      </mesh>
      <mesh castShadow position={[0.45, 1.85, 0]}>
        <boxGeometry args={[1.5, 0.34, 0.07]} />
        <meshStandardMaterial color="#6b543a" roughness={0.9} />
      </mesh>
      <Text
        font={DISPLAY_FONT}
        position={[0.45, 1.85, 0.05]}
        fontSize={0.19}
        color="#f3ece0"
        anchorX="center"
        anchorY="middle"
        letterSpacing={0.06}
      >
        {label}
      </Text>
      {sub && (
        <Text
          font={BODY_FONT}
          position={[0, 0.55, 0.06]}
          fontSize={0.1}
          color="#cbbfa8"
          anchorX="center"
          maxWidth={1.4}
        >
          {sub}
        </Text>
      )}
    </group>
  )
}

/** Stone slab for the Discipline Path; lights up when the player is close. */
export function Monolith({
  position, rotation = 0, word, index, panel, height = 4.4,
}: {
  position: [number, number]; rotation?: number; word: string; index: number
  panel: Panel; height?: number
}) {
  const y = groundHeight(position[0], position[1])
  const glow = useRef<Mesh>(null)
  const [active, setActive] = useState(false)

  useEffect(() => {
    addCollider({ x: position[0], z: position[1], r: 1.1 })
    return registerInteractable({
      id: `pillar-${index}`,
      label: `READ ${word.toUpperCase()}`,
      position: new Vector3(position[0], y + 1.4, position[1]),
      radius: 5,
      panel,
      focus: { dist: 6.5, height: 3 },
    })
  }, [position, word, index, panel, y])

  useFrame(() => {
    const d = Math.hypot(player.pos.x - position[0], player.pos.z - position[1])
    const on = d < 12
    if (on !== active) setActive(on)
    if (glow.current) {
      const m = glow.current.material as MeshStandardMaterial
      m.emissiveIntensity = MathUtils.lerp(m.emissiveIntensity, on ? 2.6 : 0.25, 0.05)
    }
  })

  return (
    <group position={[position[0], y, position[1]]} rotation={[0, rotation, 0]}>
      <mesh castShadow receiveShadow position={[0, height / 2, 0]}>
        <boxGeometry args={[1.5, height, 0.62]} />
        <meshStandardMaterial color="#3b3f42" roughness={0.85} metalness={0.05} />
      </mesh>
      <mesh ref={glow} position={[0, height / 2, 0.33]}>
        <planeGeometry args={[1.1, height * 0.78]} />
        <meshStandardMaterial color="#0b1a16" emissive={MINT} emissiveIntensity={0.25} roughness={0.4} />
      </mesh>
      <Text
        font={DISPLAY_FONT}
        position={[0, height / 2 + 0.2, 0.35]}
        rotation={[0, 0, Math.PI / 2]}
        fontSize={0.62}
        color={active ? '#eafff8' : '#9fb3ad'}
        anchorX="center"
        anchorY="middle"
        letterSpacing={0.16}
      >
        {word.toUpperCase()}
      </Text>
      <Text
        font={BODY_FONT}
        position={[0, 0.5, 0.35]}
        fontSize={0.16}
        color={MINT}
        anchorX="center"
        anchorY="middle"
      >
        {String(index + 1).padStart(2, '0')}
      </Text>
      <GlowRing position={[0, 0.04, 1.2]} radius={1.1} />
    </group>
  )
}

/** A photograph presented as a physical object; reacts as the player approaches. */
export function PhotoFrame({
  src, position, rotation = 0, height = 2.6, index, label = 'VIEW TRANSFORMATION',
  tilt = 0, lift = 1.7, onOpen, register = true,
}: {
  src: string; position: [number, number]; rotation?: number; height?: number
  index: number; label?: string; tilt?: number; lift?: number
  /** what clicking does; defaults to the transformation lightbox */
  onOpen?: () => void
  /** set false when the surrounding scene registers its own prompt */
  register?: boolean
}) {
  const texture = useTexture(src)
  texture.colorSpace = SRGBColorSpace
  texture.anisotropy = 8
  const group = useRef<Group>(null)
  const sweep = useRef<Mesh>(null)
  const y = groundHeight(position[0], position[1])
  const img = texture.image as { width: number; height: number } | undefined
  const aspect = img && img.height ? img.width / img.height : 1
  const w = height * aspect

  useEffect(() => {
    addCollider({ x: position[0], z: position[1], r: 0.5 })
    if (!register) return
    return registerInteractable({
      id: `photo-${index}`,
      verb: 'VIEW',
      label,
      position: new Vector3(position[0], y + lift, position[1]),
      radius: 4.6,
      panel: null,
      focus: { dist: Math.max(3.4, w * 1.3), height: lift + 0.4 },
    })
  }, [position, index, label, y, w, lift, register])

  useFrame(({ clock }) => {
    const g = group.current
    if (!g) return
    const d = Math.hypot(player.pos.x - position[0], player.pos.z - position[1])
    const near = MathUtils.clamp(1 - (d - 3) / 6, 0, 1)
    const s = 1 + near * 0.06
    g.scale.setScalar(MathUtils.lerp(g.scale.x, s, 0.08))
    g.position.y = MathUtils.lerp(g.position.y, y + lift + near * 0.12 + Math.sin(clock.elapsedTime * 0.6 + index) * 0.02, 0.08)
    // subtle turn towards the viewer
    const toPlayer = Math.atan2(player.pos.x - position[0], player.pos.z - position[1])
    let diff = toPlayer - rotation
    while (diff > Math.PI) diff -= Math.PI * 2
    while (diff < -Math.PI) diff += Math.PI * 2
    g.rotation.y = MathUtils.lerp(g.rotation.y, rotation + MathUtils.clamp(diff, -0.35, 0.35) * near, 0.05)
    if (sweep.current) {
      const m = sweep.current.material as MeshStandardMaterial
      m.opacity = near * 0.14
      sweep.current.position.x = ((clock.elapsedTime * 0.5 + index) % 2 - 1) * w * 0.6
    }
  })

  const openPhoto = useStore((s) => s.openPhoto)

  return (
    <group ref={group} position={[position[0], y + lift, position[1]]} rotation={[0, rotation, 0]}>
      <group rotation={[tilt, 0, 0]} onClick={() => (onOpen ? onOpen() : openPhoto(index))}>
        <mesh castShadow>
          <boxGeometry args={[w + 0.16, height + 0.16, 0.08]} />
          <meshStandardMaterial color="#14181a" roughness={0.45} metalness={0.35} />
        </mesh>
        <mesh position={[0, 0, 0.05]}>
          <planeGeometry args={[w, height]} />
          <meshStandardMaterial map={texture} roughness={0.55} toneMapped={false} />
        </mesh>
        <mesh ref={sweep} position={[0, 0, 0.07]}>
          <planeGeometry args={[w * 0.22, height]} />
          <meshStandardMaterial color="#ffffff" transparent opacity={0} depthWrite={false} />
        </mesh>
      </group>
      <mesh position={[0, -lift / 2 - 0.1, 0]}>
        <cylinderGeometry args={[0.05, 0.07, lift, 6]} />
        <meshStandardMaterial color="#1a1d1f" roughness={0.6} metalness={0.4} />
      </mesh>
    </group>
  )
}

/** Portrait video on a wooden frame; only loads and plays when you're close. */
export function VideoScreen({
  src, position, rotation = 0, height = 3.4, poster = '/img/hero-poster.webp',
}: { src: string; position: [number, number]; rotation?: number; height?: number; poster?: string }) {
  const y = groundHeight(position[0], position[1])
  const [texture, setTexture] = useState<VideoTexture | null>(null)
  const [failed, setFailed] = useState(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const sound = useStore((s) => s.settings.sound)

  useEffect(() => {
    // the screen's frame and legs are solid
    addCollider({ x: position[0], z: position[1], hx: height * 0.9, hz: 0.3, angle: rotation })
  }, [position, rotation, height])

  useEffect(() => {
    const v = document.createElement('video')
    v.src = src
    v.loop = true
    v.muted = true
    v.playsInline = true
    v.crossOrigin = 'anonymous'
    v.addEventListener('error', () => setFailed(true))
    v.play().catch(() => {})
    const t = new VideoTexture(v)
    t.colorSpace = SRGBColorSpace
    videoRef.current = v
    setTexture(t)
    return () => {
      v.pause()
      v.src = ''
      t.dispose()
    }
  }, [src])

  useFrame(() => {
    const v = videoRef.current
    if (!v) return
    const d = Math.hypot(player.pos.x - position[0], player.pos.z - position[1])
    if (d > 45 && !v.paused) v.pause()
    if (d <= 45 && v.paused) v.play().catch(() => {})
    v.muted = !sound || d > 14
    v.volume = MathUtils.clamp(1 - d / 14, 0, 1) * 0.5
  })

  const w = height * (478 / 850)
  return (
    <group position={[position[0], y, position[1]]} rotation={[0, rotation, 0]}>
      <mesh position={[0, height / 2 + 0.6, 0]} castShadow>
        <boxGeometry args={[w + 0.2, height + 0.2, 0.14]} />
        <meshStandardMaterial color="#202426" roughness={0.6} metalness={0.3} />
      </mesh>
      {texture && !failed && (
        <mesh position={[0, height / 2 + 0.6, 0.08]}>
          <planeGeometry args={[w, height]} />
          <meshBasicMaterial map={texture} toneMapped={false} />
        </mesh>
      )}
      {failed && <StillFallback src={poster} width={w} height={height} y={height / 2 + 0.6} />}
      <mesh position={[0, 0.3, 0]} castShadow>
        <boxGeometry args={[0.22, 0.6, 0.22]} />
        <meshStandardMaterial color="#3a3025" roughness={0.9} />
      </mesh>
    </group>
  )
}

/** Shown in place of a video that refuses to play. */
function StillFallback({ src, width, height, y }: { src: string; width: number; height: number; y: number }) {
  const tex = useTexture(src)
  tex.colorSpace = SRGBColorSpace
  return (
    <mesh position={[0, y, 0.08]}>
      <planeGeometry args={[width, height]} />
      <meshBasicMaterial map={tex} toneMapped={false} />
    </mesh>
  )
}

/** Pull-up bar. Built in code so the bar sits exactly where the IK grips it. */
export function PullUpBar({
  position, rotation = 0, height = 2.45, width = 1.9,
}: { position: [number, number]; rotation?: number; height?: number; width?: number }) {
  const y = groundHeight(position[0], position[1])
  useEffect(() => {
    const c = Math.cos(rotation)
    const s = Math.sin(rotation)
    addCollider({ x: position[0] - c * width / 2, z: position[1] + s * width / 2, r: 0.28 })
    addCollider({ x: position[0] + c * width / 2, z: position[1] - s * width / 2, r: 0.28 })
  }, [position, rotation, width])

  return (
    <group position={[position[0], y, position[1]]} rotation={[0, rotation, 0]}>
      {[-1, 1].map((s) => (
        <group key={s}>
          <mesh castShadow receiveShadow position={[(s * width) / 2, height / 2, 0]}>
            <cylinderGeometry args={[0.075, 0.095, height, 8]} />
            <meshStandardMaterial color="#4d4f52" roughness={0.55} metalness={0.55} />
          </mesh>
          <mesh castShadow position={[(s * width) / 2, 0.08, 0]}>
            <boxGeometry args={[0.5, 0.16, 0.9]} />
            <meshStandardMaterial color="#3b3d40" roughness={0.7} metalness={0.4} />
          </mesh>
        </group>
      ))}
      <mesh castShadow position={[0, height, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.032, 0.032, width, 10]} />
        <meshStandardMaterial color="#26282a" roughness={0.45} metalness={0.7} />
      </mesh>
    </group>
  )
}

/** Fire: emissive cone plus a warm point light that flickers. */
export function Fire({ position, scale = 1 }: { position: [number, number, number]; scale?: number }) {
  const flame = useRef<Group>(null)
  // its light comes from the shared pool (LightPool), flickering with the flame
  useEffect(() => registerLamp({
    position: new Vector3(position[0], position[1] + 0.5, position[2]),
    color: '#ff9a3c',
    intensity: () => {
      const t = performance.now() / 1000
      return 12 * scale * (1 + Math.sin(t * 9) * 0.08 + Math.sin(t * 13.7) * 0.05)
    },
    distance: 16,
  }), [position, scale])
  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    const f = 1 + Math.sin(t * 9) * 0.08 + Math.sin(t * 13.7) * 0.05
    if (flame.current) {
      flame.current.scale.set(f * scale, (0.9 + Math.sin(t * 7) * 0.15) * scale, f * scale)
      flame.current.rotation.y = t * 0.8
    }
  })
  return (
    <group position={position}>
      <group ref={flame}>
        <mesh position={[0, 0.34, 0]}>
          <coneGeometry args={[0.28, 0.9, 7]} />
          <meshStandardMaterial color="#ff8a2b" emissive="#ff6a00" emissiveIntensity={3} transparent opacity={0.85} />
        </mesh>
        <mesh position={[0, 0.2, 0]}>
          <coneGeometry args={[0.16, 0.5, 6]} />
          <meshStandardMaterial color="#ffd27a" emissive="#ffcf6b" emissiveIntensity={4} transparent opacity={0.9} />
        </mesh>
      </group>
    </group>
  )
}
