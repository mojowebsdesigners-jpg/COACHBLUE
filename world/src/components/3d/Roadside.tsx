import { useEffect, useMemo, useRef, useState } from 'react'
import { registerLamp } from './LightPool'
import { useFrame } from '@react-three/fiber'
import { Text, useGLTF, useTexture } from '@react-three/drei'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import {
  AdditiveBlending, Box3, BoxGeometry, BufferGeometry, CanvasTexture, DoubleSide, Group, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, SRGBColorSpace, Vector3, VideoTexture,
} from 'three'
import { transformations } from '../../data/transformations'
import { coach } from '../../data/coach'
import { app, hundredDays, pillars } from '../../data/programs'
import { locations } from '../../data/journey'
import { scanned } from '../../lib/materials'
import { addCollider, bridge, groundHeight, gymOutside, pathCurve, streamDistanceAt } from '../../lib/terrain'
import { player, useStore } from '../../state/store'
import { registerInteractable } from './InteractionSystem'
import { BODY_FONT, DISPLAY_FONT, MINT } from './Props'

/** Places something beside the road at trail position `t`, `offset` m to the side. */
function beside(t: number, offset: number) {
  const p = pathCurve.getPoint(t)
  const tan = pathCurve.getTangent(t)
  const nx = -tan.z * offset
  const nz = tan.x * offset
  const x = p.x + nx
  const z = p.z + nz
  // face back towards the road, not away from it
  return { x, z, y: groundHeight(x, z), facing: Math.atan2(nx, nz) }
}

// ---------------------------------------------------------------- lamps
/** One soft radial gradient, shared by every lamp's halo. */
function makeHalo() {
  const size = 128
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  g.addColorStop(0, 'rgba(255,238,206,1)')
  g.addColorStop(0.35, 'rgba(255,220,165,0.42)')
  g.addColorStop(1, 'rgba(255,210,150,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  return new CanvasTexture(c)
}

export function StreetLamps() {
  const { scene } = useGLTF('/models/streetlamp.glb')
  const lightsOn = useStore((s) => s.lightsOn)
  const halo = useMemo(makeHalo, [])

  const model = useMemo(() => {
    const clone = scene.clone(true)
    const box = new Box3().setFromObject(clone)
    const size = new Vector3()
    box.getSize(size)
    clone.scale.setScalar(6.2 / (size.y || 1))      // a ~6 m lamp post
    const box2 = new Box3().setFromObject(clone)
    clone.position.y = -box2.min.y
    clone.traverse((o) => {
      const m = o as Mesh
      if (m.isMesh) {
        m.castShadow = true
        m.receiveShadow = true
      }
    })
    return clone
  }, [scene])

  const spots = useMemo(() => {
    const out: { x: number; z: number; y: number; facing: number }[] = []
    for (let i = 0; i < 26; i++) {
      const t = 0.03 + (i / 26) * 0.94
      out.push(beside(t, i % 2 === 0 ? 6.2 : -6.2))
    }
    return out
  }, [])

  useEffect(() => {
    spots.forEach((s) => addCollider({ x: s.x, z: s.z, r: 0.35 }))
  }, [spots])

  // every lamp is lit from the shared light pool: the nearest few get a real
  // light, the rest just glow — and the light count never changes
  useEffect(() => {
    const offs = spots.map((s) => registerLamp({
      position: new Vector3(s.x, s.y + 5.7, s.z),
      color: '#ffd9a0',
      intensity: () => (useStore.getState().lightsOn ? 190 : 0),
      distance: 38,
      decay: 1.5,
    }))
    return () => offs.forEach((o) => o())
  }, [spots])

  return (
    <group>
      {spots.map((s, i) => (
        <group key={i} position={[s.x, s.y, s.z]} rotation={[0, s.facing, 0]}>
          <primitive object={model.clone()} />
          {lightsOn && (
            <>
              <mesh position={[0, 5.9, 0]}>
                <sphereGeometry args={[0.34, 10, 8]} />
                <meshBasicMaterial color="#fff1d4" />
              </mesh>
              {/* a soft halo, so a lamp still reads as lit from far enough
                  away that its pool of light is off screen */}
              <sprite position={[0, 5.9, 0]} scale={[3.4, 3.4, 1]}>
                <spriteMaterial
                  map={halo}
                  color="#ffd9a0"
                  transparent
                  opacity={0.5}
                  depthWrite={false}
                  blending={AdditiveBlending}
                />
              </sprite>
            </>
          )}
        </group>
      ))}
    </group>
  )
}

// ---------------------------------------------------------------- billboards
type BoardContent =
  | { kind: 'video'; src: string; caption: string }
  | { kind: 'photo'; src: string; caption: string; index: number; aspect: number }
  | { kind: 'image'; src: string; caption: string; aspect: number }
  | { kind: 'text'; title: string; caption: string }

/** A roadside billboard: steel frame, posts, a lit face, and its own lamps. */
function Billboard({
  at, content, height = 4.2,
}: { at: { x: number; z: number; y: number; facing: number }; content: BoardContent; height?: number }) {
  // pictures keep their own proportions instead of being stretched to fit
  const width = 'aspect' in content ? Math.min(7.4, Math.max(3.2, height * content.aspect)) : 7.4
  const lightsOn = useStore((s) => s.lightsOn)
  const openPhoto = useStore((s) => s.openPhoto)
  const [videoTex, setVideoTex] = useState<VideoTexture | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const steel = useMemo(
    () => scanned('concrete', 2, { roughness: 0.6, metalness: 0.35 }),
    [],
  )
  const photo = useTexture(content.kind === 'photo' || content.kind === 'image' ? content.src : '/img/logo.webp')
  photo.colorSpace = SRGBColorSpace

  useEffect(() => {
    if (content.kind !== 'video') return
    const v = document.createElement('video')
    v.src = content.src
    v.loop = true
    v.muted = true
    v.playsInline = true
    v.play().catch(() => {})
    const t = new VideoTexture(v)
    t.colorSpace = SRGBColorSpace
    videoRef.current = v
    setVideoTex(t)
    return () => {
      v.pause()
      v.src = ''
      t.dispose()
    }
  }, [content])

  useEffect(() => {
    addCollider({ x: at.x, z: at.z, r: 1 })
    if (content.kind !== 'photo') return
    return registerInteractable({
      id: `board-${content.index}-${Math.round(at.x)}-${Math.round(at.z)}`,
      label: 'VIEW TRANSFORMATION',
      verb: 'VIEW',
      position: new Vector3(at.x, at.y + 3, at.z),
      radius: 7,
      panel: null,
      action: () => openPhoto(content.index),
      focus: { dist: 9, height: 4 },
    })
  }, [at, content, openPhoto])

  // boards out of sight cost nothing: hidden beyond 150 m, and distant videos
  // pause so a row of boards doesn't decode all at once
  const groupRef = useRef<Group>(null)
  useFrame(() => {
    const d = Math.hypot(player.pos.x - at.x, player.pos.z - at.z)
    // readable to about 60 m; past 75 m a board is a speck and not worth a draw
    if (groupRef.current) groupRef.current.visible = d < 75
    const v = videoRef.current
    if (!v) return
    if (d > 70 && !v.paused) v.pause()
    if (d <= 70 && v.paused) v.play().catch(() => {})
  })

  const faceY = height / 2 + 3.2
  const steelGeo = useMemo(() => {
    const parts: BufferGeometry[] = []
    for (const dx of [-width / 2 + 0.7, width / 2 - 0.7]) {
      parts.push(new BoxGeometry(0.34, 3.4, 0.34).translate(dx, 1.7, 0))
    }
    parts.push(new BoxGeometry(width + 0.5, height + 0.5, 0.28).translate(0, faceY, 0))
    for (const dx of [-width / 4, width / 4]) {
      const g = new BoxGeometry(0.9, 0.14, 0.28)
      g.rotateX(Math.PI / 2.6)
      g.translate(dx, faceY + height / 2 + 0.55, 0.75)
      parts.push(g)
    }
    return mergeGeometries(parts, false)!
  }, [width, height, faceY])
  return (
    <group ref={groupRef} position={[at.x, at.y, at.z]} rotation={[0, at.facing, 0]}>
      {/* posts, frame and lamp heads: one mesh, one draw */}
      <mesh geometry={steelGeo} castShadow receiveShadow material={steel} />
      {/* face */}
      <mesh position={[0, faceY, 0.16]}>
        <planeGeometry args={[width, height]} />
        {content.kind === 'video' && videoTex ? (
          <meshBasicMaterial map={videoTex} toneMapped={false} />
        ) : content.kind === 'photo' || content.kind === 'image' ? (
          <meshStandardMaterial
            map={photo}
            roughness={0.7}
            emissive="#ffffff"
            emissiveMap={photo}
            emissiveIntensity={lightsOn ? 0.55 : 0}
            toneMapped={false}
          />
        ) : (
          <meshStandardMaterial color="#10171a" roughness={0.6}
            emissive={MINT} emissiveIntensity={lightsOn ? 0.25 : 0.05} />
        )}
      </mesh>

      {content.kind === 'text' && (
        <>
          <Text font={DISPLAY_FONT} position={[0, faceY + 0.7, 0.2]} fontSize={0.8} color="#f4fbf8"
            anchorX="center" maxWidth={width - 1} textAlign="center" letterSpacing={0.04}>
            {content.title}
          </Text>
          <Text font={BODY_FONT} position={[0, faceY - 0.9, 0.2]} fontSize={0.3} color={MINT}
            anchorX="center" maxWidth={width - 1.4} textAlign="center">
            {content.caption}
          </Text>
        </>
      )}
      {content.kind !== 'text' && (
        <Text font={DISPLAY_FONT} position={[0, faceY - height / 2 - 0.45, 0.2]} fontSize={0.34}
          color="#dfe9e6" anchorX="center" letterSpacing={0.14}>
          {content.caption}
        </Text>
      )}

      {/* the lamps' lit strips (their colour follows the lights) */}
      {[-width / 4, width / 4].map((dx) => (
        <mesh key={dx} position={[dx, faceY + height / 2 + 0.5, 0.8]} rotation={[Math.PI / 2.6 + Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.8, 0.1]} />
          <meshBasicMaterial color={lightsOn ? '#fff4dc' : '#3a3d40'} />
        </mesh>
      ))}
    </group>
  )
}

const pillarBoards: BoardContent[] = pillars.map((p) => ({
  kind: 'text', title: p.word.toUpperCase(), caption: p.body,
}))

/**
 * The roadside campaign: Coach Blue's own photos, videos and words, lining the
 * whole road rather than a handful at its far ends. Every word is his own copy
 * (src/data), and every transformation photo opens the full-screen viewer.
 */
const CAMPAIGN: BoardContent[] = [
  { kind: 'text', title: 'REAL STRENGTH IS FUNCTIONAL', caption: 'Coach Blue — online coaching' },
  { kind: 'image', src: coach.photos.training, caption: 'TRAIN WITH COACH BLUE', aspect: 1.5 },
  { kind: 'photo', src: transformations[0].src, caption: 'CLIENT TRANSFORMATION', index: 0, aspect: 1 },
  { kind: 'text', title: hundredDays.title.toUpperCase(), caption: hundredDays.headline },
  { kind: 'video', src: '/video/training.mp4', caption: 'TRAIN WITH COACH BLUE' },
  { kind: 'photo', src: transformations[1].src, caption: 'CLIENT TRANSFORMATION', index: 1, aspect: 1 },
  { kind: 'text', title: `${coach.stats[0].value} ${coach.stats[0].label.toUpperCase()}`,
    caption: `${coach.stats[1].value} ${coach.stats[1].label}` },
  pillarBoards[0],
  { kind: 'photo', src: transformations[2].src, caption: 'CLIENT TRANSFORMATION', index: 2, aspect: 1600 / 964 },
  { kind: 'text', title: hundredDays.features[0].title.toUpperCase(), caption: hundredDays.features[0].body },
  { kind: 'image', src: coach.photos.running, caption: 'COACH BLUE', aspect: 1.5 },
  { kind: 'photo', src: transformations[3].src, caption: 'CLIENT TRANSFORMATION', index: 3, aspect: 1600 / 951 },
  pillarBoards[1],
  { kind: 'text', title: app.title.toUpperCase(), caption: app.features.join(' · ') },
  { kind: 'photo', src: transformations[4].src, caption: 'CLIENT TRANSFORMATION', index: 4, aspect: 1 },
  { kind: 'text', title: hundredDays.features[1].title.toUpperCase(), caption: hundredDays.features[1].body },
  { kind: 'video', src: '/video/coach-talk.mp4', caption: 'WHAT TO EXPECT' },
  { kind: 'photo', src: transformations[5].src, caption: 'CLIENT TRANSFORMATION', index: 5, aspect: 1 },
  pillarBoards[2],
  { kind: 'text', title: coach.expect.challenge.toUpperCase(), caption: coach.expect.body },
  { kind: 'photo', src: transformations[6].src, caption: 'CLIENT TRANSFORMATION', index: 6, aspect: 1 },
  { kind: 'image', src: coach.photos.motivation, caption: 'DISCIPLINE', aspect: 1.5 },
  pillarBoards[3],
  { kind: 'photo', src: transformations[7].src, caption: 'CLIENT TRANSFORMATION', index: 7, aspect: 1600 / 1216 },
  { kind: 'text', title: hundredDays.features[2].title.toUpperCase(), caption: hundredDays.features[2].body },
  { kind: 'photo', src: transformations[8].src, caption: 'CLIENT TRANSFORMATION', index: 8, aspect: 1 },
  ...pillarBoards.slice(4),
  { kind: 'photo', src: transformations[9].src, caption: 'CLIENT TRANSFORMATION', index: 9, aspect: 1 },
  { kind: 'text', title: hundredDays.cta.toUpperCase(), caption: hundredDays.sub },
]

/** Boards keep clear of the stops, where the scene belongs to the location. */
function clearOfStops(x: number, z: number) {
  for (const l of locations) {
    if (Math.hypot(x - l.pos[0], z - l.pos[1]) < l.pad + 2) return false
  }
  // and out of the water, off the pool deck and the lake shore, and off the gym
  if (streamDistanceAt(x, z) < 4) return false
  if (gymOutside(x, z) < 4) return false
  return Math.hypot(x - bridge.x, z - bridge.z) > 12
}

export function Billboards() {
  const boards = useMemo(() => {
    const items: { at: ReturnType<typeof beside>; content: BoardContent }[] = []
    // walk the road and drop a board roughly every 12 m, alternating sides,
    // wherever the ground is clear of a stop (by true distance along the road,
    // not curve parameter, so the spacing stays even round the bends)
    const length = pathCurve.getLength()
    const spacing = 12
    let next = 18
    let side = 1
    let k = 0
    // the campaign runs round again rather than leaving the far end bare
    const MAX_BOARDS = 44
    for (let d = 0; d < length && k < MAX_BOARDS; d += 2) {
      if (d < next) continue
      const t = pathCurve.getUtoTmapping(d / length, 0)
      // both verges, nearest first; where a stop occupies the near spot the
      // board steps back from the road rather than being dropped
      let placed = 0
      for (const sd of [side, -side]) {
        for (const off of [11.5, 16, 21]) {
          const at = beside(t, sd * off)
          // `beside` faces things along the road-to-verge direction; a board's
          // face is its +z, so turn it half round to look back at the road
          at.facing += Math.PI
          if (!clearOfStops(at.x, at.z)) continue
          if (items.some((b) => Math.hypot(b.at.x - at.x, b.at.z - at.z) < 14)) break
          if (k >= MAX_BOARDS) break
          items.push({ at, content: CAMPAIGN[k++ % CAMPAIGN.length] })
          placed++
          break
        }
      }
      if (placed) {
        side = -side
        next = d + spacing
      }
    }
    return items
  }, [])

  return (
    <group>
      {boards.map((b, i) => (
        <Billboard key={i} at={b.at} content={b.content} />
      ))}
    </group>
  )
}

// ---------------------------------------------------------------- houses
export function Residential() {
  const { scene } = useGLTF('/models/house.glb')
  const lightsOn = useStore((s) => s.lightsOn)
  const group = useRef<Group>(null)

  const model = useMemo(() => {
    const clone = scene.clone(true)
    const box = new Box3().setFromObject(clone)
    const size = new Vector3()
    box.getSize(size)
    clone.scale.setScalar(7.5 / (size.y || 1))      // a two-storey house
    const box2 = new Box3().setFromObject(clone)
    const centre = new Vector3()
    box2.getCenter(centre)
    clone.position.set(-centre.x, -box2.min.y, -centre.z)
    clone.traverse((o) => {
      const m = o as Mesh
      if (m.isMesh) {
        m.castShadow = true
        m.receiveShadow = true
      }
    })
    return clone
  }, [scene])

  // a small cluster off the road, each with its own plot
  const homes = useMemo(() => {
    const out: { x: number; z: number; y: number; facing: number; lit: boolean; tint: number }[] = []
    const spots: [number, number][] = [
      [0.12, 26], [0.17, -25], [0.22, 30], [0.27, -31], [0.33, 27], [0.38, -27], [0.44, 33],
    ]
    spots.forEach(([t, off], i) => {
      // a house never stands in the lake, the pool or the stream: step it
      // further back from the road until the plot is dry
      let at = beside(t, off)
      for (let k = 1; k < 6 && streamDistanceAt(at.x, at.z) < 9; k++) at = beside(t, off + Math.sign(off) * k * 6)
      if (streamDistanceAt(at.x, at.z) < 9) return
      out.push({ ...at, lit: i % 3 !== 1, tint: 0.85 + (i % 4) * 0.08 })
    })
    return out
  }, [])

  useEffect(() => {
    homes.forEach((h) => addCollider({ x: h.x, z: h.z, r: 4.6 }))
    // porch lights, from the shared pool
    const offs = homes.filter((h) => h.lit).map((h) => registerLamp({
      position: new Vector3(h.x + Math.sin(h.facing) * 2.6, h.y + 3.4, h.z + Math.cos(h.facing) * 2.6),
      color: '#ffc98a',
      intensity: () => (useStore.getState().lightsOn ? 70 : 0),
      distance: 20,
      decay: 1.6,
    }))
    return () => offs.forEach((o) => o())
  }, [homes])

  useFrame(() => {
    if (!group.current) return
    group.current.visible = Math.hypot(player.pos.x, player.pos.z) < 400
  })

  const driveMat = useMemo(() => scanned('asphalt', 4, { roughness: 0.9 }), [])
  // `day` is rewritten every frame and never triggers a render, so reading it
  // here would freeze whatever value it happened to hold on mount. The store's
  // lightsOn is published on change and is the only safe signal in JSX.

  return (
    <group ref={group}>
      {homes.map((h, i) => (
        <group key={i} position={[h.x, h.y, h.z]} rotation={[0, h.facing, 0]}>
          <primitive object={model.clone()} scale={h.tint} />
          {/* driveway out to the road */}
          <mesh position={[0, 0.05, 7]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow material={driveMat}>
            <planeGeometry args={[4.2, 14]} />
          </mesh>
          {/* warm windows and a porch light after dark */}
          {lightsOn && h.lit && (
            <>
              <mesh position={[0, 2.4, 3.3]}>
                <planeGeometry args={[1.6, 1.2]} />
                <meshBasicMaterial color="#ffd79a" side={DoubleSide} />
              </mesh>
              <mesh position={[0, 4.6, 3.3]}>
                <planeGeometry args={[1.2, 0.9]} />
                <meshBasicMaterial color="#ffce8c" side={DoubleSide} />
              </mesh>
            </>
          )}
        </group>
      ))}
    </group>
  )
}

export const _mat = MeshStandardMaterial
export const _basic = MeshBasicMaterial

useGLTF.preload('/models/streetlamp.glb')
useGLTF.preload('/models/house.glb')
