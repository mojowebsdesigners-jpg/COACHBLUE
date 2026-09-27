import { useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Text } from '@react-three/drei'
import { MathUtils, Mesh, MeshStandardMaterial, Vector3 } from 'three'
import { secrets, type Secret } from '../../data/secrets'
import { addCollider, groundHeight } from '../../lib/terrain'
import { player, useStore } from '../../state/store'
import { registerInteractable } from './InteractionSystem'
import { BODY_FONT, DISPLAY_FONT, GlowRing, MINT, Near, PhotoFrame, PullUpBar } from './Props'
import { Athlete } from './Athlete'

const at = (x: number, z: number) => groundHeight(x, z)

/** One hidden find. Nothing marks it from a distance except a faint glimmer. */
function SecretSite({ secret }: { secret: Secret }) {
  const [x, z] = secret.pos
  const y = at(x, z)
  const findSecret = useStore((s) => s.findSecret)
  const found = useStore((s) => s.secrets.some((f) => f.id === secret.id))
  const openPanel = useStore((s) => s.openPanel)
  const glow = useRef<Mesh>(null)

  useEffect(() => {
    addCollider({ x, z, r: 0.6 })
    return registerInteractable({
      id: `secret-${secret.id}`,
      label: secret.kind === 'notebook' ? 'OPEN THE NOTEBOOK'
        : secret.kind === 'photo' ? 'VIEW THE PHOTOGRAPH'
        : secret.kind === 'viewpoint' ? 'TAKE IT IN'
        : secret.kind === 'training' ? 'INSPECT' : 'READ',
      verb: secret.kind === 'notebook' ? 'OPEN' : secret.kind === 'photo' ? 'VIEW'
        : secret.kind === 'training' ? 'INSPECT' : 'READ',
      position: new Vector3(x, y + 1.2, z),
      radius: 4.2,
      panel: { kind: 'secret', id: secret.id },
      focus: { dist: 4.4, height: 1.9 },
    })
  }, [x, z, y, secret])

  useFrame(() => {
    const d = Math.hypot(player.pos.x - x, player.pos.z - z)
    if (d < 9) findSecret(secret.id, secret.name)
    if (glow.current) {
      const m = glow.current.material as MeshStandardMaterial
      m.emissiveIntensity = MathUtils.lerp(m.emissiveIntensity, d < 14 ? 1.8 : 0.4, 0.05)
    }
  })

  return (
    <group position={[x, y, z]}>
      {secret.kind === 'notebook' && (
        <>
          <mesh castShadow receiveShadow position={[0, 0.42, 0]}>
            <cylinderGeometry args={[0.55, 0.62, 0.84, 12]} />
            <meshStandardMaterial color="#4a3a28" roughness={0.95} />
          </mesh>
          <mesh ref={glow} castShadow position={[0, 0.88, 0]} rotation={[-Math.PI / 2 + 0.2, 0.4, 0]}>
            <boxGeometry args={[0.42, 0.56, 0.07]} />
            <meshStandardMaterial color="#2b2118" emissive={MINT} emissiveIntensity={0.4} roughness={0.7} />
          </mesh>
        </>
      )}

      {secret.kind === 'quote' && (
        <mesh ref={glow} castShadow receiveShadow position={[0, 1.5, 0]} rotation={[0, 0.4, 0.05]}>
          <boxGeometry args={[1.1, 3, 0.4]} />
          <meshStandardMaterial color="#3d4245" emissive={MINT} emissiveIntensity={0.4} roughness={0.9} />
        </mesh>
      )}

      {secret.kind === 'photo' && (
        <>
          <PhotoFrame
            src={secret.image!}
            position={[x, z]}
            index={0}
            height={2.2}
            lift={1.8}
            rotation={0.6}
            register={false}
            onOpen={() => openPanel({ kind: 'secret', id: secret.id })}
          />
          <mesh ref={glow} position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[1.3, 1.5, 24]} />
            <meshStandardMaterial color={MINT} emissive={MINT} emissiveIntensity={0.4} transparent opacity={0.25} />
          </mesh>
        </>
      )}

      {secret.kind === 'viewpoint' && (
        <>
          <mesh castShadow receiveShadow position={[0, 0.25, 0]}>
            <boxGeometry args={[3.4, 0.5, 1.4]} />
            <meshStandardMaterial color="#54585a" roughness={0.95} />
          </mesh>
          <mesh ref={glow} castShadow position={[0, 0.78, -0.45]}>
            <boxGeometry args={[2.2, 0.12, 0.5]} />
            <meshStandardMaterial color="#5d4a33" emissive={MINT} emissiveIntensity={0.4} roughness={0.9} />
          </mesh>
          <Text font={BODY_FONT} position={[0, 1.5, 0]} fontSize={0.2} color="#dfe7e3"
            anchorX="center" maxWidth={4} textAlign="center" fillOpacity={0.6}>
            {found ? 'THE OVERLOOK' : ''}
          </Text>
        </>
      )}

      {secret.kind === 'training' && (
        <>
          <PullUpBar position={[x, z]} rotation={0.6} height={2.4} width={1.7} />
          {/* someone already out here, training alone: this is where the
              regulars come when the camp is busy */}
          <Athlete position={[x, z]} rotation={0.6 + Math.PI} exercise="pullup" barHeight={2.4} speed={0.9}
            model="/models/client-b.glb" />
          <mesh ref={glow} position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[2.2, 2.4, 32]} />
            <meshStandardMaterial color={MINT} emissive={MINT} emissiveIntensity={0.4} transparent opacity={0.22} />
          </mesh>
        </>
      )}

      {found && (
        <Text font={DISPLAY_FONT} position={[0, 2.9, 0]} fontSize={0.26} color="#e8f6f1"
          anchorX="center" letterSpacing={0.12} fillOpacity={0.4}>
          {secret.name.toUpperCase()}
        </Text>
      )}
      <GlowRing position={[0, 0.05, 0]} radius={0.9} />
    </group>
  )
}

export function Secrets() {
  return (
    <>
      {secrets.map((s) => (
        <Near key={s.id} pos={s.pos} dist={60}>
          <SecretSite secret={s} />
        </Near>
      ))}
    </>
  )
}
