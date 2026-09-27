import { useEffect, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Text } from '@react-three/drei'
import { Group, MathUtils, Vector3 } from 'three'
import { locationById } from '../../data/journey'
import { addCollider, groundHeight } from '../../lib/terrain'
import { player, useStore } from '../../state/store'
import { registerInteractable } from './InteractionSystem'
import { DISPLAY_FONT, GlowRing, MINT, WorldWord } from './Props'
import { Athlete } from './Athlete'

/**
 * The summit. Coach Blue is waiting, and the CTA is a structure you walk into:
 * the doors open as you approach and the form is inside, rather than a banner
 * dropped over the world.
 */
export function Summit() {
  const l = locationById.summit
  const [x, z] = l.pos
  const y = groundHeight(x, z)
  const setFinale = useStore((s) => s.setFinale)
  const setBooking = useStore((s) => s.setBooking)
  const playCinematic = useStore((s) => s.playCinematic)
  const fired = useRef(false)
  const doorL = useRef<Group>(null)
  const doorR = useRef<Group>(null)
  const [open, setOpen] = useState(false)

  const gate: [number, number] = [x, z + 9]

  useEffect(() => {
    addCollider({ x: x - 3.4, z: z + 9, r: 1 })
    addCollider({ x: x + 3.4, z: z + 9, r: 1 })
    return registerInteractable({
      id: 'summit-booking',
      label: 'START COACHING',
      verb: 'START',
      position: new Vector3(gate[0], y + 1.5, gate[1]),
      radius: 6,
      panel: null,
      action: () => setBooking(true),
      focus: { dist: 6, height: 2.4 },
    })
  }, [x, z, y, setBooking])

  useEffect(() => registerInteractable({
    id: 'summit',
    label: 'TALK TO COACH BLUE',
    verb: 'TALK',
    position: new Vector3(x, y + 1.5, z - 3),
    radius: 5,
    panel: { kind: 'summit' },
    focus: { dist: 4.4, height: 1.8 },
  }), [x, z, y])

  useFrame((_, dt) => {
    const d = Math.hypot(player.pos.x - x, player.pos.z - z)
    if (!fired.current && d < 14) {
      fired.current = true
      playCinematic('summit')
      setFinale(true)
    }
    // doors swing open as the player reaches the structure
    const dg = Math.hypot(player.pos.x - gate[0], player.pos.z - gate[1])
    const want = dg < 7
    if (want !== open) setOpen(want)
    const angle = want ? 1.25 : 0
    if (doorL.current) doorL.current.rotation.y = MathUtils.damp(doorL.current.rotation.y, -angle, 3, dt)
    if (doorR.current) doorR.current.rotation.y = MathUtils.damp(doorR.current.rotation.y, angle, 3, dt)
  })

  return (
    <group>
      <Athlete position={[x, z - 3]} rotation={0} exercise="idle" />
      {/* a client finishing their session at the top, where the journey ends */}
      <Athlete position={[x - 8, z - 1]} rotation={0.8} exercise="squat" speed={0.8} model="/models/client-c.glb" />
      <WorldWord text="TRANSFORM" position={[x, y + 8, z - 6]} size={1.8} opacity={0.4} />

      {/* the booking structure */}
      <group position={[gate[0], y, gate[1]]}>
        {[-1, 1].map((s) => (
          <mesh key={s} castShadow receiveShadow position={[s * 3.4, 1.9, 0]}>
            <boxGeometry args={[0.5, 3.8, 1.6]} />
            <meshStandardMaterial color="#2f3436" roughness={0.7} metalness={0.2} />
          </mesh>
        ))}
        <mesh castShadow position={[0, 3.95, 0]}>
          <boxGeometry args={[7.6, 0.4, 1.8]} />
          <meshStandardMaterial color="#262b2d" roughness={0.6} metalness={0.3} />
        </mesh>
        <Text font={DISPLAY_FONT} position={[0, 3.95, 0.95]} fontSize={0.42} color={MINT}
          anchorX="center" anchorY="middle" letterSpacing={0.22}>
          START COACHING
        </Text>
        {/* doors */}
        {[{ ref: doorL, side: -1 }, { ref: doorR, side: 1 }].map(({ ref, side }) => (
          <group key={side} ref={ref} position={[side * 3.1, 0, 0.8]}>
            <mesh castShadow position={[-side * 1.42, 1.7, 0]}>
              <boxGeometry args={[2.84, 3.3, 0.1]} />
              <meshStandardMaterial
                color="#121718"
                roughness={0.18}
                metalness={0.75}
                transparent
                opacity={0.88}
                emissive={MINT}
                emissiveIntensity={open ? 0.06 : 0.015}
              />
            </mesh>
            {/* a thin lit edge, so the doors read without glowing like a sign */}
            <mesh position={[-side * 0.05, 1.7, 0.07]}>
              <boxGeometry args={[0.06, 3.3, 0.04]} />
              <meshStandardMaterial color="#0b1412" emissive={MINT} emissiveIntensity={open ? 2.4 : 1.1} />
            </mesh>
          </group>
        ))}
        <GlowRing position={[0, 0.05, 2.4]} radius={1.8} />
      </group>

      <GlowRing position={[x, y + 0.05, z - 2]} radius={2.4} />
    </group>
  )
}
