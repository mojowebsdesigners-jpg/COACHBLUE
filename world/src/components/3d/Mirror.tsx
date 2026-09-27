import { useEffect } from 'react'
import { MeshReflectorMaterial, Text } from '@react-three/drei'
import { Vector3 } from 'three'
import { addCollider, groundHeight } from '../../lib/terrain'
import { useStore } from '../../state/store'
import { registerInteractable } from './InteractionSystem'
import { DISPLAY_FONT, GlowRing, MINT } from './Props'

/**
 * A full-height training mirror. The reflection is real (planar), so the player
 * sees their own character in it — the cue for the line on the frame.
 */
export function TrainingMirror({
  position, rotation = 0,
}: { position: [number, number]; rotation?: number }) {
  const [x, z] = position
  const y = groundHeight(x, z)
  const quality = useStore((s) => s.preset.name)
  const cheap = quality === 'low' || quality === 'medium'

  useEffect(() => {
    addCollider({ x, z, r: 1.2 })
    return registerInteractable({
      id: 'mirror',
      label: 'LOOK',
      verb: 'LOOK',
      position: new Vector3(x, y + 1.4, z),
      radius: 4,
      panel: { kind: 'mirror' },
      focus: { dist: 3.2, height: 1.7 },
    })
  }, [x, z, y])

  return (
    <group position={[x, y, z]} rotation={[0, rotation, 0]}>
      <mesh castShadow receiveShadow position={[0, 1.55, -0.07]}>
        <boxGeometry args={[2.4, 3.1, 0.14]} />
        <meshStandardMaterial color="#26292b" roughness={0.5} metalness={0.4} />
      </mesh>
      <mesh position={[0, 1.55, 0.02]}>
        <planeGeometry args={[2.1, 2.8]} />
        {cheap ? (
          <meshStandardMaterial color="#cfe0e6" roughness={0.08} metalness={0.7} envMapIntensity={1.4} />
        ) : (
          <MeshReflectorMaterial
            resolution={512}
            mirror={0.85}
            mixBlur={0.4}
            mixStrength={1.1}
            blur={[100, 40]}
            depthScale={0.4}
            minDepthThreshold={0.3}
            metalness={0.65}
            roughness={0.28}
            color="#b9c7cc"
          />
        )}
      </mesh>
      <Text font={DISPLAY_FONT} position={[0, 3.24, 0.06]} fontSize={0.19} color={MINT}
        anchorX="center" anchorY="middle" letterSpacing={0.16}>
        LOOK AT THE WORK
      </Text>
      <GlowRing position={[0, 0.04, 1.1]} radius={1} />
    </group>
  )
}
