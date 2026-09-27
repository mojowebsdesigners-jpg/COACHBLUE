import { useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Text } from '@react-three/drei'
import { MathUtils, Mesh, MeshStandardMaterial, Vector3 } from 'three'
import { pathCurve, addCollider, groundHeight } from '../../lib/terrain'
import { player } from '../../state/store'
import { registerInteractable } from './InteractionSystem'
import { BODY_FONT, DISPLAY_FONT, MINT } from './Props'

// The coaching journey as physical markers you walk past, between the gallery
// and the hub. Wording follows the process described on coach-blue.com.
export const timelineSteps = [
  { word: 'START', body: 'Start by filling out the inquiry form so we can setup our call.' },
  { word: 'PLAN', body: 'Building you the perfect plan that is customized completely to YOU!' },
  { word: 'DISCIPLINE', body: 'A rigorous approach rooted in military discipline.' },
  { word: 'CONSISTENCY', body: 'Our no-nonsense approach ensures you stay consistent, motivated, and accountable.' },
  { word: 'CHECK-IN', body: 'Weekly check-ins allow for continual adjustments to keep you progressing.' },
  { word: 'PROGRESS', body: 'Yes all in my App, where I also monitor and track your progress along with you.' },
  { word: 'RESULT', body: 'Experience ultimate motivation and lasting results with Coach Blue’s expert guidance.' },
]

function Marker({
  index, position, rotation,
}: { index: number; position: [number, number]; rotation: number }) {
  const step = timelineSteps[index]
  const [x, z] = position
  const y = groundHeight(x, z)
  const bar = useRef<Mesh>(null)

  useEffect(() => {
    addCollider({ x, z, r: 0.45 })
    return registerInteractable({
      id: `timeline-${index}`,
      label: `INSPECT ${step.word}`,
      verb: 'INSPECT',
      position: new Vector3(x, y + 1.3, z),
      radius: 3.6,
      panel: { kind: 'timeline', index },
      focus: { dist: 4, height: 1.9 },
    })
  }, [x, z, y, index, step.word])

  useFrame(() => {
    const d = Math.hypot(player.pos.x - x, player.pos.z - z)
    if (!bar.current) return
    const m = bar.current.material as MeshStandardMaterial
    // the line lights up as you walk it, like progress filling in
    m.emissiveIntensity = MathUtils.lerp(m.emissiveIntensity, d < 9 ? 2.4 : 0.3, 0.06)
  })

  return (
    <group position={[x, y, z]} rotation={[0, rotation, 0]}>
      <mesh castShadow receiveShadow position={[0, 0.9, 0]}>
        <boxGeometry args={[0.22, 1.8, 0.22]} />
        <meshStandardMaterial color="#3b3f42" roughness={0.85} />
      </mesh>
      <mesh ref={bar} position={[0, 1.55, 0.13]}>
        <planeGeometry args={[0.9, 0.34]} />
        <meshStandardMaterial color="#0d1a17" emissive={MINT} emissiveIntensity={0.3} roughness={0.4} />
      </mesh>
      <Text font={DISPLAY_FONT} position={[0, 1.55, 0.15]} fontSize={0.15} color="#eafff8"
        anchorX="center" anchorY="middle" letterSpacing={0.1} maxWidth={0.85}>
        {step.word}
      </Text>
      <Text font={BODY_FONT} position={[0, 1.18, 0.14]} fontSize={0.09} color={MINT} anchorX="center">
        {`0${index + 1}`}
      </Text>
    </group>
  )
}

/** Laid along the trail between the gallery and the coaching hub. */
export function TransformationTimeline() {
  const spots = timelineSteps.map((_, i) => {
    const t = 0.73 + i * 0.011
    const p = pathCurve.getPoint(t)
    const tan = pathCurve.getTangent(t)
    const side = i % 2 === 0 ? 1 : -1
    const nx = -tan.z * side * 3.4
    const nz = tan.x * side * 3.4
    return { pos: [p.x + nx, p.z + nz] as [number, number], rot: Math.atan2(-nx, -nz) }
  })

  return (
    <>
      {timelineSteps.map((s, i) => (
        <Marker key={s.word} index={i} position={spots[i].pos} rotation={spots[i].rot} />
      ))}
    </>
  )
}
