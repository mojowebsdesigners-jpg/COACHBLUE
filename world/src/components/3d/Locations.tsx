import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { registerLamp } from './LightPool'
import { Text, useGLTF } from '@react-three/drei'
import { InstancedMesh, MathUtils, Mesh, MeshStandardMaterial, Object3D, Vector3, Box3 } from 'three'
import { locationById, trailWords } from '../../data/journey'
import { faq } from '../../data/faq'
import { app, pillars, process } from '../../data/programs'
import { coach } from '../../data/coach'
import { transformations } from '../../data/transformations'
import {
  GYM, GYM_SLAB_W, GYM_SLAB_D, PATH_HALF_WIDTH, addBoxFor, addCollider, addGrassClear, addPlatform, groundHeight,
  pathCurve, pathDistance,
} from '../../lib/terrain'
import { player, useStore } from '../../state/store'
import { registerInteractable } from './InteractionSystem'
import {
  BODY_FONT, DISPLAY_FONT, Fire, GlowRing, MINT, Monolith, Near, PhotoFrame,
  PullUpBar, SignPost, WorldWord,
} from './Props'
import { Athlete } from './Athlete'
import { CampNPCs } from './NPCSystem'
import { Gym, HeldDumbbell, HeldKettlebell } from './Gym'
import { BootCamp, HillSprint } from './BootCamp'
import { Smoke } from './Weather'
import { Summit } from './Summit'

const at = (x: number, z: number) => groundHeight(x, z)

/** Loads one of the generated props and drops it on the ground at a spot. */
function Prop({
  file, position, rotation = 0, scale = 1, collider,
}: { file: string; position: [number, number]; rotation?: number; scale?: number; collider?: number }) {
  const { scene } = useGLTF(`/models/${file}`)
  const model = useMemo(() => {
    const c = scene.clone(true)
    c.traverse((o) => {
      const m = o as Mesh
      if (m.isMesh) {
        m.castShadow = true
        m.receiveShadow = true
      }
    })
    return c
  }, [scene])
  useEffect(() => {
    if (!collider) return
    // a box fitted to the model's own footprint, not a circle round it: the
    // boulders stay round, the cabin and the rig get their real corners
    if (/boulder|campfire/.test(file)) {
      addCollider({ x: position[0], z: position[1], r: collider })
      return
    }
    addBoxFor(new Box3().setFromObject(scene), { x: position[0], z: position[1] }, rotation, scale)
  }, [position, collider, scene, rotation, scale, file])
  return (
    <primitive
      object={model}
      position={[position[0], at(position[0], position[1]), position[1]]}
      rotation={[0, rotation, 0]}
      scale={scale}
    />
  )
}

// ---------------------------------------------------------------- entrance
export function Entrance() {
  const l = locationById.entrance
  const [x, z] = l.pos
  const y = at(x, z)
  useEffect(() => {
    for (const dx of [-3.2, 3.2]) addCollider({ x: x + dx, z, r: 0.34 })
  }, [x, z])
  return (
    <group>
      {[-3.2, 3.2].map((dx) => (
        <mesh key={dx} castShadow position={[x + dx, y + 1.9, z]}>
          <cylinderGeometry args={[0.24, 0.3, 3.8, 8]} />
          <meshStandardMaterial color="#4a3a28" roughness={0.95} />
        </mesh>
      ))}
      <mesh castShadow position={[x, y + 3.7, z]}>
        <boxGeometry args={[7.4, 0.42, 0.34]} />
        <meshStandardMaterial color="#5c4832" roughness={0.9} />
      </mesh>
      <Text font={DISPLAY_FONT} position={[x, y + 3.72, z + 0.2]} fontSize={0.34} color="#f6f1e6"
        anchorX="center" anchorY="middle" letterSpacing={0.2}>
        COACH BLUE
      </Text>
      <Text font={BODY_FONT} position={[x, y + 3.15, z + 0.2]} fontSize={0.14} color={MINT}
        anchorX="center" anchorY="middle" letterSpacing={0.04}>
        Your transformation starts here.
      </Text>
      <Lantern position={[x - 5.2, z - 1.5]} />
      <SignPost position={[x + 6.5, z - 6]} rotation={-0.6} label="COACH BLUE →" />
      <SignPost position={[x + 12, z - 2]} rotation={-1.6} label="YOUR GOALS →" sub="off the trail" />
      {trailWords.map((w) => (
        <WorldWord key={w.text} text={w.text} position={[w.pos[0], at(w.pos[0], w.pos[1]) + 3.2, w.pos[1]]}
          size={1.5} opacity={0.22} />
      ))}
    </group>
  )
}

/** A lantern on the entrance post. [E] LIGHT turns it up. */
export function Lantern({ position }: { position: [number, number] }) {
  const [x, z] = position
  const y = at(x, z)
  const [lit, setLit] = useState(false)
  const glow = useRef<Mesh>(null)

  useEffect(() => registerInteractable({
    id: 'lantern',
    label: lit ? 'PUT OUT THE LANTERN' : 'LIGHT THE LANTERN',
    verb: 'LIGHT',
    position: new Vector3(x, y + 1.5, z),
    radius: 3.4,
    panel: null,
    action: () => setLit((v) => !v),
    focus: { dist: 3, height: 1.7 },
  }), [x, z, y, lit])

  // lit from the shared light pool while it burns
  const litRef = useRef(lit)
  litRef.current = lit
  useEffect(() => registerLamp({
    position: new Vector3(x, y + 1.95, z),
    color: '#ffb35c',
    intensity: () => (litRef.current ? 7 * (1 + Math.sin(performance.now() / 125) * 0.08) : 0),
    distance: 11,
  }), [x, y, z])

  useFrame(({ clock }) => {
    if (!glow.current) return
    const m = glow.current.material as MeshStandardMaterial
    const flicker = lit ? 2.4 + Math.sin(clock.elapsedTime * 8) * 0.35 : 0.05
    m.emissiveIntensity = MathUtils.lerp(m.emissiveIntensity, flicker, 0.12)
  })

  return (
    <group position={[x, y, z]}>
      <mesh castShadow position={[0, 1, 0]}>
        <cylinderGeometry args={[0.06, 0.08, 2, 6]} />
        <meshStandardMaterial color="#4a3a28" roughness={0.95} />
      </mesh>
      <mesh ref={glow} castShadow position={[0, 1.95, 0]}>
        <boxGeometry args={[0.3, 0.4, 0.3]} />
        <meshStandardMaterial color="#1d2224" emissive="#ffb35c" emissiveIntensity={0.05} roughness={0.5} />
      </mesh>
      <GlowRing position={[0, 0.04, 0]} radius={0.7} />
    </group>
  )
}

// ---------------------------------------------------------------- meet coach
export function CoachMeeting() {
  const l = locationById.coach
  const [x, z] = l.pos
  const y = at(x, z)
  const coachPos: [number, number] = [x + 0.1, z - 0.4]
  const openPanel = useStore((s) => s.openPanel)
  const panel = useStore((s) => s.panel)

  useEffect(() => {
    addCollider({ x, z: z - 0.4, r: 0.6 })
    return registerInteractable({
      id: 'coach',
      label: 'TALK TO COACH BLUE',
      verb: 'TALK',
      position: new Vector3(x, y + 1.4, z),
      radius: 5.5,
      panel: { kind: 'coach' },
      focus: { dist: 3.6, height: 1.7 },
    })
  }, [x, z, y])

  const talking = panel?.kind === 'coach'

  return (
    <group>
      <PullUpBar position={[x, z]} rotation={0} height={2.5} />
      <Prop file="calisthenics.glb" position={[x + 4.2, z - 1.5]} rotation={-0.5} scale={1.35} collider={1.6} />
      {talking ? (
        <Athlete position={coachPos} rotation={Math.PI} exercise="idle" />
      ) : (
        // the pull-up solver puts his hands at his own position, bar height
        // up: so he must hang from the bar's own spot, not the talking spot
        // beside it, or he pulls himself up on thin air
        <Athlete position={[x, z]} rotation={Math.PI} exercise="pullup" barHeight={2.5} speed={1} />
      )}
      <GlowRing position={[x, y + 0.05, z + 2.2]} radius={1.4} />
      <WorldWord text="MEET COACH BLUE" position={[x, y + 5.4, z]} size={0.4} opacity={0.34} />
      <SignPost position={[x + 5, z + 4]} rotation={-0.9} label="THE CAMP →" />
      <mesh position={[x - 3.4, y + 0.35, z + 2.6]} castShadow receiveShadow onClick={() => openPanel({ kind: 'coach' })}>
        <boxGeometry args={[1.8, 0.7, 0.6]} />
        <meshStandardMaterial color="#3d3226" roughness={0.9} />
      </mesh>
    </group>
  )
}

// ---------------------------------------------------------------- challenge
export function Challenge() {
  const l = locationById.challenge
  const [x, z] = l.pos
  const y = at(x, z)
  useEffect(() => registerInteractable({
    id: 'challenge',
    label: 'READ THE CHALLENGE',
    verb: 'READ',
    position: new Vector3(x, y + 1.5, z),
    radius: 5.5,
    panel: { kind: 'challenge' },
    focus: { dist: 6, height: 2.6 },
  }), [x, z, y])

  return (
    <group>
      {[-2.6, 2.6].map((dx, i) => (
        <mesh key={dx} castShadow receiveShadow position={[x + dx, y + 1.5, z]} rotation={[0, i ? -0.3 : 0.3, 0]}>
          <boxGeometry args={[2.2, 3, 0.5]} />
          <meshStandardMaterial color="#3c4042" roughness={0.9} />
        </mesh>
      ))}
      <Text font={BODY_FONT} position={[x - 2.6, y + 1.9, z + 0.32]} rotation={[0, 0.3, 0]} fontSize={0.15}
        color="#d8d2c6" maxWidth={1.8} anchorX="center" textAlign="center">
        {`“${coach.quotePair.client}”`}
      </Text>
      <Text font={BODY_FONT} position={[x + 2.6, y + 1.9, z + 0.32]} rotation={[0, -0.3, 0]} fontSize={0.15}
        color={MINT} maxWidth={1.8} anchorX="center" textAlign="center">
        {`“${coach.quotePair.coach}”`}
      </Text>
      <WorldWord text="COMMIT" position={[x, y + 5.2, z]} size={0.7} opacity={0.26} />
      <GlowRing position={[x, y + 0.05, z + 1.6]} radius={1.2} />
    </group>
  )
}

// ---------------------------------------------------------------- camp
/**
 * The app's features, as signs in a row along the front of the gym, between
 * the carpet and the road, facing the road (they used to stand in a ring
 * round the camp's centre, which put them on the tarmac and the gym floor).
 */
const featureYaw = GYM.angle           // the slab's local +z, towards the road
function featureSpot(i: number): [number, number] {
  const n = app.features.length
  const lx = -GYM_SLAB_W / 2 + 1.8 + (i + 0.5) * ((GYM_SLAB_W - 3.6) / n)
  const lz = GYM_SLAB_D / 2 + 1.4
  const c = Math.cos(GYM.angle), s = Math.sin(GYM.angle)
  return [GYM.cx + lx * c + lz * s, GYM.cz - lx * s + lz * c]
}

export function TrainingCamp() {
  const l = locationById.camp
  const [x, z] = l.pos

  useEffect(() => {
    const offs: (() => void)[] = []
    app.features.forEach((f, i) => {
      const [px, pz] = featureSpot(i)
      offs.push(registerInteractable({
        id: `camp-${i}`,
        label: `EXPLORE ${f.toUpperCase()}`,
        position: new Vector3(px, at(px, pz) + 1.3, pz),
        radius: 4.2,
        panel: { kind: 'camp-item', index: i },
        focus: { dist: 4.4, height: 2 },
      }))
    })
    return () => offs.forEach((o) => o())
  }, [x, z])

  return (
    <group>
      {!OFF.has('gym') && <Gym centre={[x, z]} />}
      {!OFF.has('npcs') && <CampNPCs centre={[x, z]} />}

      {app.features.map((f, i) => {
        const [px, pz] = featureSpot(i)
        const py = at(px, pz)
        return (
          <group key={f} position={[px, py, pz]} rotation={[0, featureYaw, 0]}>
            <mesh castShadow position={[0, 0.75, 0]}>
              <boxGeometry args={[0.16, 1.5, 0.16]} />
              <meshStandardMaterial color="#4b3c2a" roughness={0.9} />
            </mesh>
            <mesh castShadow position={[0, 1.6, 0]}>
              <boxGeometry args={[1.7, 0.42, 0.08]} />
              <meshStandardMaterial color="#2b2f31" roughness={0.6} metalness={0.2} />
            </mesh>
            <Text font={DISPLAY_FONT} position={[0, 1.6, 0.06]} fontSize={0.16} color="#eef4f1"
              anchorX="center" anchorY="middle" maxWidth={1.55} textAlign="center" letterSpacing={0.05}>
              {f.toUpperCase()}
            </Text>
            <GlowRing position={[0, 0.05, 0]} radius={0.9} />
          </group>
        )
      })}
    </group>
  )
}

// ---------------------------------------------------------------- discipline
export function DisciplinePath() {
  const spots = useMemo(() => {
    // spread the pillars along the trail, alternating sides
    return pillars.map((_, i) => {
      const t = 0.42 + (i / Math.max(1, pillars.length - 1)) * 0.15
      const p = pathCurve.getPoint(t)
      const tan = pathCurve.getTangent(t)
      const side = i % 2 === 0 ? 1 : -1
      const nx = -tan.z * side * 4.6
      const nz = tan.x * side * 4.6
      return {
        pos: [p.x + nx, p.z + nz] as [number, number],
        rot: Math.atan2(-nx, -nz),
      }
    })
  }, [])

  return (
    <group>
      {pillars.map((p, i) => (
        <Monolith
          key={p.word}
          position={spots[i].pos}
          rotation={spots[i].rot}
          word={p.word}
          index={i}
          panel={{ kind: 'pillar', index: i }}
        />
      ))}
    </group>
  )
}

// ---------------------------------------------------------------- 100 days
/**
 * Where the 100 podium stands: the location's centre sits on the trail, so it
 * is set back onto the verge — far enough that its lowest step clears the
 * tarmac — along whichever side of the road has room.
 */
function podiumSpot(cx: number, cz: number): [number, number] {
  let best: [number, number] = [cx, cz], bd = -1
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 16) {
    for (let d = 4; d <= 14; d += 1) {
      const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d
      const clear = pathDistance(x, z) - (PATH_HALF_WIDTH + 1.4) - 4.4
      if (clear > 0.8) { if (bd < 0 || d < bd) { bd = d; best = [x, z] } break }
    }
  }
  return best
}

function PodiumSteps({ x, z, y }: { x: number; z: number; y: number }) {
  useEffect(() => {
    const offs = [0, 1, 2].map((k) => addPlatform({ x, z, r: 3.9 - k * 0.55, top: y + 0.3 * (k + 1) }))
    return () => offs.forEach((o) => o())
  }, [x, z, y])
  return null
}

export function HundredDays() {
  const l = locationById.hundred
  const [x, z] = useMemo(() => podiumSpot(l.pos[0], l.pos[1]), [l.pos])
  const y = at(x, z)
  const ref = useRef<InstancedMesh>(null)
  const lit = useRef<number>(0)
  const R = 17

  useEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    const d = new Object3D()
    const [cx, cz] = l.pos
    for (let i = 0; i < 100; i++) {
      const a = (i / 100) * Math.PI * 2
      const px = cx + Math.cos(a) * R
      const pz = cz + Math.sin(a) * R
      // where the road runs through the ring, the posts step aside for it
      if (pathDistance(px, pz) < PATH_HALF_WIDTH + 2.2) {
        d.position.set(px, -999, pz); d.scale.setScalar(0); d.updateMatrix(); mesh.setMatrixAt(i, d.matrix); d.scale.setScalar(1)
        continue
      }
      addCollider({ x: px, z: pz, r: 0.22 })
      d.position.set(px, at(px, pz) + 0.55, pz)
      d.rotation.set(0, -a, 0)
      d.updateMatrix()
      mesh.setMatrixAt(i, d.matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
  }, [x, z])

  useEffect(() => registerInteractable({
    id: 'hundred',
    label: 'EXPLORE THE 100 DAYS',
    verb: 'INSPECT',
    position: new Vector3(x, y + 1.6, z),
    radius: 7,
    panel: { kind: 'hundred' },
    focus: { dist: 9, height: 4 },
  }), [x, z, y])

  // markers light up as the player walks the ring
  useFrame(() => {
    const ang = Math.atan2(player.pos.z - z, player.pos.x - x)
    const dist = Math.hypot(player.pos.x - x, player.pos.z - z)
    if (dist > R + 9) return
    const idx = Math.floor(((ang + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2) * 100)
    lit.current = Math.max(lit.current, idx)
    const mesh = ref.current
    if (!mesh) return
    const mat = mesh.material as MeshStandardMaterial
    mat.emissiveIntensity = MathUtils.lerp(mat.emissiveIntensity, 0.6 + (lit.current / 100) * 2.6, 0.04)
  })

  return (
    <group>
      <instancedMesh ref={ref} args={[undefined as never, undefined as never, 100]} castShadow frustumCulled={false}>
        <boxGeometry args={[0.28, 1.1, 0.28]} />
        <meshStandardMaterial color="#1b2422" emissive={MINT} emissiveIntensity={0.7} roughness={0.5} />
      </instancedMesh>

      {/* three broad steps up to the top: climb them, stand on the 100 */}
      {[0, 1, 2].map((k) => (
        <mesh key={k} castShadow receiveShadow position={[x, y + 0.15 + k * 0.3, z]}>
          <cylinderGeometry args={[3.9 - k * 0.55, 3.95 - k * 0.55, 0.3, 40]} />
          <meshStandardMaterial color={k === 2 ? '#3a4144' : '#33393b'} roughness={0.85} />
        </mesh>
      ))}
      <PodiumSteps x={x} z={z} y={y} />
      <Text font={DISPLAY_FONT} position={[x, y + 3.2, z]} fontSize={1.5} color="#f2fffb"
        anchorX="center" anchorY="middle" letterSpacing={0.05} outlineWidth={0.02} outlineColor="#0a1512">
        100
      </Text>
      <Text font={DISPLAY_FONT} position={[x, y + 2.35, z]} fontSize={0.42} color={MINT}
        anchorX="center" anchorY="middle" letterSpacing={0.2}>
        DAYS OF DISCIPLINE
      </Text>
      <GlowRing position={[x, y + 0.95, z]} radius={3.6} />
      <WorldWord text="ONE DECISION A DAY" position={[x, y + 6.4, z]} size={0.8} opacity={0.3} />
    </group>
  )
}

// ---------------------------------------------------------------- gallery
export function Gallery() {
  const l = locationById.gallery
  const [x, z] = l.pos
  const y = at(x, z)
  const openPhoto = useStore((s) => s.openPhoto)

  useEffect(() => {
    const offs = transformations.map((_, i) => {
      const a = -1.15 + (i / (transformations.length - 1)) * 2.3
      const px = x + Math.sin(a) * 13
      const pz = z + Math.cos(a) * 13
      return registerInteractable({
        id: `photo-${i}`,
        label: 'VIEW TRANSFORMATION',
        verb: 'VIEW',
        position: new Vector3(px, at(px, pz) + 1.9, pz),
        radius: 4.4,
        panel: null,
        action: () => openPhoto(i),
        focus: { dist: 4.2, height: 2.1 },
      })
    })
    return () => offs.forEach((o) => o())
  }, [x, z, openPhoto])

  return (
    <group>
      {transformations.map((t, i) => {
        const a = -1.15 + (i / (transformations.length - 1)) * 2.3
        const px = x + Math.sin(a) * 13
        const pz = z + Math.cos(a) * 13
        return (
          <PhotoFrame
            key={t.src}
            src={t.src}
            index={i}
            position={[px, pz]}
            rotation={a + Math.PI}
            height={2.4}
          />
        )
      })}
      <WorldWord text="RESULTS ARE BUILT" position={[x, y + 6.2, z]} size={0.8} opacity={0.28} />
      <Text font={BODY_FONT} position={[x, y + 0.9, z]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.42}
        color="#cfd8d3" anchorX="center" anchorY="middle" letterSpacing={0.18}>
        REVIEWS FROM PEOPLE LIKE YOU
      </Text>
    </group>
  )
}

// ---------------------------------------------------------------- hub
export function CoachingHub() {
  const l = locationById.hub
  const [x, z] = l.pos
  const y = at(x, z)

  useEffect(() => {
    const offs = [
      registerInteractable({
        id: 'hub',
        label: 'VIEW THE APP',
        verb: 'VIEW',
        position: new Vector3(x, y + 1.6, z + 4),
        radius: 5.5,
        panel: { kind: 'hub' },
        focus: { dist: 5, height: 2.2 },
      }),
      ...process.steps.map((s, i) =>
        registerInteractable({
          id: `process-${i}`,
          label: `STEP 0${i + 1} — ${s.title.toUpperCase()}`,
          position: new Vector3(x + 9 - i * 5.5, at(x + 9 - i * 5.5, z + 13) + 1.3, z + 13),
          radius: 3.8,
          panel: { kind: 'process', index: i },
          focus: { dist: 4, height: 1.9 },
        }),
      ),
    ]
    return () => offs.forEach((o) => o())
  }, [x, z, y])

  return (
    <group>
      <Prop file="cabin.glb" position={[x, z]} rotation={Math.PI} scale={3.4} collider={4.2} />
      <WorldWord text="THE COACHING HUB" position={[x, y + 8, z]} size={0.6} opacity={0.3} />
      {/* screens on the porch showing what the app does */}
      {app.features.map((f, i) => (
        <group key={f} position={[x - 3 + i * 2, y + 1.9, z + 4.4]} rotation={[0, 0.1 - i * 0.07, 0]}>
          <mesh castShadow>
            <boxGeometry args={[1.5, 2.2, 0.08]} />
            <meshStandardMaterial color="#14181a" roughness={0.4} metalness={0.4} emissive={MINT} emissiveIntensity={0.15} />
          </mesh>
          <Text font={DISPLAY_FONT} position={[0, 0, 0.06]} fontSize={0.16} color={MINT} anchorX="center"
            maxWidth={1.3} textAlign="center" letterSpacing={0.06}>
            {f.toUpperCase()}
          </Text>
        </group>
      ))}
      <GlowRing position={[x, y + 0.05, z + 4]} radius={1.4} />

      {process.steps.map((s, i) => {
        const px = x + 9 - i * 5.5
        const pz = z + 13
        const py = at(px, pz)
        return (
          <group key={s.title} position={[px, py, pz]} rotation={[0, -0.4, 0]}>
            <mesh castShadow position={[0, 1.05, 0]}>
              <boxGeometry args={[1.5, 2.1, 0.3]} />
              <meshStandardMaterial color="#39322a" roughness={0.92} />
            </mesh>
            <Text font={DISPLAY_FONT} position={[0, 1.55, 0.17]} fontSize={0.38} color={MINT} anchorX="center">
              {`0${i + 1}`}
            </Text>
            <Text font={DISPLAY_FONT} position={[0, 0.95, 0.17]} fontSize={0.14} color="#efe9dd" anchorX="center"
              maxWidth={1.3} textAlign="center">
              {s.title.toUpperCase()}
            </Text>
            <GlowRing position={[0, 0.05, 0]} radius={0.85} />
          </group>
        )
      })}
    </group>
  )
}

// ---------------------------------------------------------------- campfire
export function TestimonialCamp() {
  const l = locationById.campfire
  const [x, z] = l.pos
  const y = at(x, z)

  useEffect(() => registerInteractable({
    id: 'campfire',
    label: 'READ THE REVIEWS',
    verb: 'READ',
    position: new Vector3(x, y + 1.2, z),
    radius: 6,
    panel: { kind: 'campfire' },
    focus: { dist: 6, height: 2.4 },
  }), [x, z, y])

  return (
    <group>
      <Prop file="campfire.glb" position={[x, z]} scale={1.6} collider={1.6} />
      <Fire position={[x, y + 0.5, z]} scale={1.15} />
      <Smoke position={[x, y + 1.1, z]} />
      {transformations.slice(0, 5).map((t, i) => {
        const a = (i / 5) * Math.PI * 2 + 0.4
        return (
          <PhotoFrame
            key={t.src}
            src={t.src}
            index={i}
            position={[x + Math.cos(a) * 6.5, z + Math.sin(a) * 6.5]}
            rotation={-a + Math.PI / 2}
            height={1.5}
            lift={1.9}
            label="VIEW REVIEW"
          />
        )
      })}
      <WorldWord text="REVIEWS FROM PEOPLE LIKE YOU" position={[x, y + 5.4, z]} size={0.42} opacity={0.3} />
    </group>
  )
}

// ---------------------------------------------------------------- faq cave
export function FAQCave() {
  const l = locationById.faq
  const [x, z] = l.pos
  const y = at(x, z)

  useEffect(() => {
    const offs = faq.map((_q, i) => {
      const a = -0.9 + (i / (faq.length - 1)) * 1.8
      const px = x + Math.sin(a) * 6
      const pz = z + Math.cos(a) * 6
      return registerInteractable({
        id: `faq-${i}`,
        label: 'OPEN QUESTION',
        verb: 'OPEN',
        position: new Vector3(px, at(px, pz) + 1.6, pz),
        radius: 3.6,
        panel: { kind: 'faq', index: i },
        focus: { dist: 3.6, height: 2 },
      })
    })
    return () => offs.forEach((o) => o())
  }, [x, z])

  return (
    <group>
      {[0, 1, 2, 3, 4, 5].map((i) => {
        const a = (i / 6) * Math.PI * 2
        const px = x + Math.cos(a) * 10
        const pz = z + Math.sin(a) * 10
        return (
          <Prop key={i} file="boulder.glb" position={[px, pz]} rotation={a} scale={2.6 + (i % 3)} collider={2.4} />
        )
      })}
      {faq.map((q, i) => {
        const a = -0.9 + (i / (faq.length - 1)) * 1.8
        const px = x + Math.sin(a) * 6
        const pz = z + Math.cos(a) * 6
        const py = at(px, pz)
        return (
          <group key={q.q} position={[px, py + 1.6, pz]}>
            <mesh>
              <icosahedronGeometry args={[0.34, 1]} />
              <meshStandardMaterial color="#0d1a17" emissive={MINT} emissiveIntensity={1.6} roughness={0.3} />
            </mesh>
            <Text font={DISPLAY_FONT} position={[0, 0, 0.36]} fontSize={0.3} color="#04110e" anchorX="center" anchorY="middle">
              ?
            </Text>
            <GlowRing position={[0, -1.55, 0]} radius={0.8} />
          </group>
        )
      })}
      <WorldWord text="ASK" position={[x, y + 5.4, z]} size={1.4} opacity={0.3} />
    </group>
  )
}

// ---------------------------------------------------------------- goals
/**
 * Each goal is shown by someone working towards it: a real client, on a mat,
 * doing the work that goal is made of, with the kit in their hands. (These
 * were once scanned statues; they read as broken figures sinking into their
 * plinths.)
 */
type GoalStation = {
  model: string
  exercise: 'squat' | 'kettlebell' | 'curl' | 'pushup'
  holds?: 'kettlebell' | 'dumbbells'
  speed: number
}
const GOAL_STATIONS: GoalStation[] = [
  { model: '/models/client-a.glb', exercise: 'squat', speed: 0.9 },                           // better lifestyle
  { model: '/models/client-b.glb', exercise: 'kettlebell', holds: 'kettlebell', speed: 0.8 }, // lose weight
  { model: '/models/client-c.glb', exercise: 'curl', holds: 'dumbbells', speed: 0.9 },        // gain muscle
  { model: '/models/client-a.glb', exercise: 'pushup', speed: 0.85 },                         // get toned
]

function GoalAthlete({ station, at, yaw, offset }: {
  station: GoalStation; at: [number, number]; yaw: number; offset: number
}) {
  const hands = useRef<[Vector3, Vector3]>([new Vector3(), new Vector3()])
  const y = at_(at[0], at[1])
  useEffect(() => addGrassClear(at[0], at[1], 1.35), [at])
  return (
    <group>
      {/* a rubber training mat, flush on the ground */}
      <mesh receiveShadow position={[at[0], y + 0.015, at[1]]} rotation={[-Math.PI / 2, 0, -yaw]}>
        <planeGeometry args={[1.5, 2.2]} />
        <meshStandardMaterial color="#1c1f22" roughness={0.95} />
      </mesh>
      <Athlete
        position={at}
        rotation={yaw}
        exercise={station.exercise}
        y={y + 0.02}
        speed={station.speed}
        offset={offset}
        model={station.model}
        onHands={station.holds ? (l, r) => { hands.current[0].copy(l); hands.current[1].copy(r) } : undefined}
      />
      {station.holds === 'kettlebell' && <HeldKettlebell hands={hands} />}
      {station.holds === 'dumbbells' && (
        <>
          <HeldDumbbell hand={hands} side={0} yaw={yaw} />
          <HeldDumbbell hand={hands} side={1} yaw={yaw} />
        </>
      )}
    </group>
  )
}
const at_ = (x: number, z: number) => at(x, z)

export function ClientGoals() {
  const l = locationById.goals
  const [x, z] = l.pos
  const y = at(x, z)

  useEffect(() => {
    const offs = coach.goals.map((g, i) => {
      const a = (i / coach.goals.length) * Math.PI * 2
      const px = x + Math.cos(a) * 7
      const pz = z + Math.sin(a) * 7
      return registerInteractable({
        id: `goal-${i}`,
        label: `EXPLORE ${g.toUpperCase()}`,
        position: new Vector3(px, at(px, pz) + 1.4, pz),
        radius: 4,
        panel: { kind: 'goal', index: i },
        focus: { dist: 4.6, height: 2.1 },
      })
    })
    return () => offs.forEach((o) => o())
  }, [x, z])

  return (
    <group>
      {coach.goals.map((g, i) => {
        const a = (i / coach.goals.length) * Math.PI * 2
        const px = x + Math.cos(a) * 7
        const pz = z + Math.sin(a) * 7
        const py = at(px, pz)
        // facing the middle of the ring, where the player stands
        const yaw = Math.atan2(x - px, z - pz)
        return (
          <group key={g}>
            <GoalAthlete station={GOAL_STATIONS[i]} at={[px, pz]} yaw={yaw} offset={i * 1.3} />
            <Text font={DISPLAY_FONT} position={[px, py + 2.6, pz]} fontSize={0.34} color="#eef6f2"
              anchorX="center" anchorY="middle" letterSpacing={0.1} rotation={[0, yaw, 0]}>
              {g.toUpperCase()}
            </Text>
            <GlowRing position={[px, py + 0.05, pz]} radius={1.6} />
          </group>
        )
      })}
      <WorldWord text="YOUR GOALS ARE MY GOALS" position={[x, y + 6, z]} size={0.55} opacity={0.28} />
    </group>
  )
}

// ---------------------------------------------------------------- all of it
const OFF = new Set((typeof location !== 'undefined' ? new URLSearchParams(location.search).get('off') ?? '' : '').split(','))

export function Locations() {
  const on = (k: string) => !OFF.has(k)
  return (
    <group>
      <Entrance />
      <Near pos={locationById.coach.pos} dist={80}><CoachMeeting /></Near>
      <Near pos={locationById.challenge.pos} dist={70}>{on('challenge') && <Challenge />}</Near>
      <Near pos={locationById.camp.pos} dist={95}>{on('camp') && <TrainingCamp />}</Near>
      <Near pos={locationById.discipline.pos} dist={90}>{on('discipline') && <DisciplinePath />}</Near>
      <Near pos={locationById.hundred.pos} dist={95}>{on('hundred') && <HundredDays />}</Near>
      <Near pos={locationById.gallery.pos} dist={85}><Gallery /></Near>
      <Near pos={locationById.hub.pos} dist={85}><CoachingHub /></Near>
      <Near pos={locationById.campfire.pos} dist={80}><TestimonialCamp /></Near>
      <Near pos={locationById.faq.pos} dist={70}>{on('faq') && <FAQCave />}</Near>
      <Near pos={locationById.goals.pos} dist={75}><ClientGoals /></Near>
      <Near pos={locationById.bootcamp.pos} dist={80}>{on('bootcamp') && <BootCamp />}</Near>
      <Near pos={locationById.camp.pos} dist={110}>{on('hill') && <HillSprint />}</Near>
      <Near pos={locationById.summit.pos} dist={95}><Summit /></Near>
    </group>
  )
}

useGLTF.preload('/models/calisthenics.glb')
useGLTF.preload('/models/cabin.glb')
useGLTF.preload('/models/campfire.glb')

