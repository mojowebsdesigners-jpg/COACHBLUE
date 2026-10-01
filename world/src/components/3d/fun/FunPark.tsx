import { useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Text } from '@react-three/drei'
import { Vector3 } from 'three'
import { registerLamp } from '../LightPool'
import { registerInteractable } from '../InteractionSystem'
import { LINKS, openLink } from '../../../data/links'
import { DISPLAY_FONT } from '../Props'
import { showResult } from '../../../systems/Workout'
import { HeavyBag, SkipRope, FloorWork, PlyoBox, BattleRopes, TyreFlip, HammerTyre, HighStriker, KeepyUppy } from './Workouts'
import { SwingSet, Trampoline, DanceFloor, HulaHoop, YogaDeck } from './Leisure'
import { Basketball, Penalty, MiniGolf, Darts } from './Sports'
import { ph, pw, useParkMaterials, useStation, type ParkMats } from './common'

/**
 * The photo wall: stand on the mark, strike a pose, the camera flashes.
 * Three poses on a loop, each one snapped.
 */
function PhotoSpot({ m }: { m: ParkMats }) {
  const LX = -19, LZ = 6
  const pop = useRef(0)
  useStation({
    id: 'fp-photo', def: 'photo_spot', lx: LX, lz: LZ, yaw: Math.PI / 2, label: 'STRIKE A POSE',
    extra: {
      onRep: (n) => {
        pop.current = 1
        showResult(['SNAP! DOUBLE BICEPS', 'SNAP! MOST MUSCULAR', 'SNAP! THUMBS UP'][(n - 1) % 3], 0)
      },
    },
  })
  useFrame((_, dt) => { pop.current = Math.max(0, pop.current - dt * 5) })
  const [bx, bz] = pw(LX - 1.3, LZ)
  const [cx, cz] = pw(LX + 3.4, LZ)
  // the flash borrows one of the world's pooled lights (a light of its own
  // would change the light count and recompile every shader in the world)
  useEffect(() => registerLamp({
    position: new Vector3(cx, ph(LX + 3.4, LZ) + 1.5, cz), color: '#f4f8ff', distance: 9,
    intensity: () => pop.current * 60,
  }), [cx, cz])
  return (
    <group>
      {/* the backdrop */}
      <group position={[bx, ph(LX - 1.3, LZ), bz]} rotation={[0, Math.PI / 2, 0]}>
        <mesh position={[0, 1.5, 0]} castShadow receiveShadow><boxGeometry args={[4, 3, 0.08]} /><meshStandardMaterial color="#123a6b" roughness={0.8} /></mesh>
        <Text font={DISPLAY_FONT} fontSize={0.62} position={[0, 2.4, 0.05]} color="#efefea" anchorX="center" anchorY="middle">COACH BLUE</Text>
        <Text font={DISPLAY_FONT} fontSize={0.22} position={[0, 1.95, 0.05]} color="#1de9b6" anchorX="center" anchorY="middle" letterSpacing={0.3}>3D WORLD · FUN PARK</Text>
        {[-1.95, 1.95].map((x) => <mesh key={x} position={[x, 1.5, -0.1]} material={m.steel}><boxGeometry args={[0.08, 3, 0.08]} /></mesh>)}
      </group>
      {/* the mark on the floor */}
      <mesh position={[pw(LX, LZ)[0], ph(LX, LZ) + 0.02, pw(LX, LZ)[1]]} rotation={[-Math.PI / 2, 0, 0]} material={m.yellow}><ringGeometry args={[0.32, 0.38, 24]} /></mesh>
      {/* the camera on its tripod, and a ring light */}
      <group position={[cx, ph(LX + 3.4, LZ), cz]} rotation={[0, -Math.PI / 2, 0]}>
        {[0, 2.1, 4.2].map((a) => (
          <mesh key={a} position={[Math.sin(a) * 0.22, 0.65, Math.cos(a) * 0.22]} rotation={[Math.cos(a) * 0.3, 0, -Math.sin(a) * 0.3]} material={m.black}>
            <cylinderGeometry args={[0.012, 0.012, 1.36, 5]} />
          </mesh>
        ))}
        <mesh position={[0, 1.4, 0]} material={m.black}><boxGeometry args={[0.16, 0.11, 0.09]} /></mesh>
        <mesh position={[0, 1.4, 0.08]} rotation={[Math.PI / 2, 0, 0]} material={m.black}><cylinderGeometry args={[0.04, 0.045, 0.1, 16]} /></mesh>
        <mesh position={[0, 1.4, 0.131]} rotation={[Math.PI / 2, 0, 0]}><circleGeometry args={[0.035, 16]} /><meshStandardMaterial color="#0c1a2a" roughness={0.05} metalness={0.8} /></mesh>
        <mesh position={[0.6, 1.55, 0]}><torusGeometry args={[0.28, 0.035, 8, 32]} /><meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={1.2} /></mesh>
        <mesh position={[0.6, 0.75, 0]} material={m.black}><cylinderGeometry args={[0.012, 0.012, 1.5, 5]} /></mesh>
      </group>
    </group>
  )
}

/** The arch over the way in. */
function ParkGate({ m }: { m: ParkMats }) {
  const LX = 0, LZ = 21
  const [x, z] = pw(LX, LZ)
  // a board by the gate for Coach Blue's own site: everything in the park is
  // what his Hybrid Athlete System trains
  const [bx, bz] = pw(LX + 5.4, LZ + 0.6)
  const by = ph(LX + 5.4, LZ + 0.6)
  useEffect(() => registerInteractable({
    id: 'hybrid-board', label: 'FREE HYBRID ATHLETE TRAINING · COACHBLUE.FIT', verb: 'OPEN',
    position: new Vector3(bx, by + 1.4, bz), radius: 3.2, panel: null,
    action: () => openLink(LINKS.hybrid),
  }), [bx, by, bz])
  return (
    <>
    <group position={[bx, by, bz]} rotation={[0, -0.35, 0]}>
      {[-1.4, 1.4].map((px) => <mesh key={px} position={[px, 0.9, 0]} material={m.steel} castShadow><boxGeometry args={[0.08, 1.8, 0.08]} /></mesh>)}
      <mesh position={[0, 1.75, 0]} castShadow><boxGeometry args={[3.1, 1.5, 0.08]} /><meshStandardMaterial color="#0f2f5c" roughness={0.6} /></mesh>
      <Text font={DISPLAY_FONT} fontSize={0.17} position={[0, 2.25, 0.05]} color="#1de9b6" anchorX="center" anchorY="middle" letterSpacing={0.08}>THE HYBRID ATHLETE SYSTEM</Text>
      <Text font={DISPLAY_FONT} fontSize={0.3} position={[0, 1.85, 0.05]} color="#ffffff" anchorX="center" anchorY="middle" maxWidth={2.2} textAlign="center">FREE TRAINING</Text>
      <Text font={DISPLAY_FONT} fontSize={0.15} position={[0, 1.5, 0.05]} color="#cfe0f5" anchorX="center" anchorY="middle" maxWidth={2.2} textAlign="center">Strength · mobility · conditioning in under 5 hours a week</Text>
      <Text font={DISPLAY_FONT} fontSize={0.2} position={[0, 1.18, 0.05]} color="#f2c14e" anchorX="center" anchorY="middle">COACHBLUE.FIT  ·  PRESS E</Text>
    </group>
    <group position={[x, ph(LX, LZ), z]}>
      {[-3.2, 3.2].map((px) => (
        <mesh key={px} position={[px, 2, 0]} material={m.blue} castShadow><boxGeometry args={[0.35, 4, 0.35]} /></mesh>
      ))}
      <mesh position={[0, 4.2, 0]} material={m.blue} castShadow><boxGeometry args={[7.1, 0.9, 0.35]} /></mesh>
      {[1, -1].map((s) => (
        <Text key={s} font={DISPLAY_FONT} fontSize={0.62} position={[0, 4.22, s * 0.18]} rotation={[0, s > 0 ? 0 : Math.PI, 0]} color="#f2c14e" anchorX="center" anchorY="middle">
          THE FUN PARK
        </Text>
      ))}
    </group>
    </>
  )
}

export function FunPark() {
  const m = useParkMaterials()
  return (
    <group>
      <HeavyBag m={m} />
      <SkipRope m={m} />
      <FloorWork m={m} />
      <PlyoBox m={m} />
      <BattleRopes m={m} />
      <TyreFlip m={m} />
      <HammerTyre m={m} />
      <HighStriker m={m} />
      <KeepyUppy m={m} />
      <SwingSet m={m} />
      <Trampoline m={m} />
      <DanceFloor m={m} />
      <HulaHoop m={m} />
      <YogaDeck m={m} />
      <Basketball m={m} />
      <Penalty m={m} />
      <MiniGolf m={m} />
      <Darts m={m} />
      <PhotoSpot m={m} />
      <ParkGate m={m} />
    </group>
  )
}
