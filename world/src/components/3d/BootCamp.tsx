import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Text, useGLTF } from '@react-three/drei'
import {
  Box3, CanvasTexture, Color, DoubleSide, Group, InstancedMesh, Mesh, MeshStandardMaterial, Object3D, PlaneGeometry,
  RepeatWrapping, SRGBColorSpace, TorusGeometry, Vector3,
} from 'three'
import { addCollider, addGrassClear, groundHeight, pathSamples, terrainHeight } from '../../lib/terrain'
import { scanned, scannedTexture } from '../../lib/materials'
import { locationById } from '../../data/journey'
import { exerciseById } from '../../data/exercises'
import { player, useStore } from '../../state/store'
import { cue } from '../../lib/audio'
import { startWorkout, stopWorkout, workout, type Station } from '../../systems/Workout'
import { course, startCourse, stepCourse, type CourseDef } from '../../systems/Course'
import { registerInteractable } from './InteractionSystem'
import { DISPLAY_FONT, MINT } from './Props'

/**
 * Boot Camp: a levelled dirt yard off the trail where the training is done
 * with the whole body and the player drives every rep of it —
 *
 *  - a boulder to push down a log-lined lane (hold W, or Space);
 *  - a climbing rope under an A-frame with a bell at the top (tap Space for
 *    each pull, hand over hand);
 *  - a cone drill: six gates in a zigzag, against the clock;
 *  - a crawl net (hold W, on your elbows), a timber wall to climb (Space for
 *    each move: jump, pull up, over, down) and a tyre run (hold W, high knees);
 *  - and, on the road just below, a timed hill sprint.
 *
 * The first time each one comes into view it is announced, once.
 */
const L = locationById.bootcamp
const [CX, CZ] = L.pos
const YAW = 0.35                   // the yard's own orientation
const cy = Math.cos(YAW), sy = Math.sin(YAW)
/** yard-local metres -> world x/z */
const place = (lx: number, lz: number): [number, number] => [CX + lx * cy + lz * sy, CZ - lx * sy + lz * cy]
const FWD = new Vector3(sy, 0, cy)     // local +z in world
const SIDE = new Vector3(cy, 0, -sy)   // local +x in world

// ---------------------------------------------------------------- materials
function useYardMaterials() {
  return useMemo(() => {
    const dirt = new MeshStandardMaterial({
      map: scannedTexture('dirt_diff', 6, true), normalMap: scannedTexture('dirt_nor', 6),
      roughness: 1, color: new Color('#b49a7c'),
    })
    const timber = new MeshStandardMaterial({
      map: scannedTexture('timber_diff', 1, true), normalMap: scannedTexture('timber_nor', 1),
      roughness: 0.9, color: new Color('#8a6a4a'),
    })
    const rope = new MeshStandardMaterial({ color: '#c8b089', roughness: 0.95 })
    const brass = new MeshStandardMaterial({ color: '#b8923a', roughness: 0.3, metalness: 0.9 })
    const cone = new MeshStandardMaterial({ color: '#f26a1b', roughness: 0.6 })
    const white = new MeshStandardMaterial({ color: '#f1f1ea', roughness: 0.6 })
    const dark = new MeshStandardMaterial({ color: '#2a2018', roughness: 0.9 })
    const rubber = new MeshStandardMaterial({ color: '#141416', roughness: 0.92 })
    return { dirt, timber, rope, brass, cone, white, dark, rubber }
  }, [])
}

// ---------------------------------------------------------------- boulder
const LANE = { lx: -7, lz: 4, len: 12 }       // lane runs along local +x from here
const ROCK_R = 0.75
// metres along the lane; which way the next push goes; where the push under
// way began (null when nobody is pushing)
const rock = { at: 0, dir: 1 as 1 | -1, pushStart: null as number | null, last: 0 }

function laneWorld(d: number) {
  const [x, z] = place(LANE.lx + d, LANE.lz)
  return new Vector3(x, groundHeight(x, z), z)
}

function Boulder({ m }: { m: ReturnType<typeof useYardMaterials> }) {
  const { scene } = useGLTF('/models/boulder.glb')
  const model = useMemo(() => {
    const c = scene.clone(true)
    const box = new Box3().setFromObject(c)
    const size = box.getSize(new Vector3())
    c.scale.setScalar((ROCK_R * 2) / Math.max(size.x, size.z))
    const box2 = new Box3().setFromObject(c)
    const centre = box2.getCenter(new Vector3())
    c.position.set(-centre.x, -box2.min.y - 0.12, -centre.z)
    // bare granite, not the generator's neon moss: this one gets handled
    const granite = scanned('rock', 1.5, { color: new Color('#a8a39a') })
    c.traverse((o) => {
      const mm = o as Mesh
      if (!mm.isMesh) return
      mm.castShadow = true
      mm.receiveShadow = true
      mm.material = granite
    })
    const g = new Group()
    g.add(c)
    return g
  }, [scene])
  const ref = useRef<Group>(null)
  const roll = useRef(0)
  const [rev, setRev] = useState(0)

  // the lane: two logs either side, and the start and end marked on the dirt
  const logs = useMemo(() => [-1.35, 1.35].map((off) => {
    const a = laneWorld(-0.5), b = laneWorld(LANE.len + 0.5)
    return { mid: a.clone().add(b).multiplyScalar(0.5).addScaledVector(FWD, off), off }
  }), [])

  useEffect(() => {
    // hands on it from whichever side the next push goes
    const at = laneWorld(rock.at).addScaledVector(SIDE, -rock.dir * 1.2)
    return registerInteractable({
      id: 'boulder',
      label: 'PUSH THE BOULDER',
      verb: 'LIFT',
      position: at.setY(at.y + 1),
      radius: 2.6,
      panel: null,
      action: () => {
        const dir = rock.dir
        const start = rock.at
        rock.pushStart = start
        const station: Station = {
          id: 'boulder', def: exerciseById.boulder_push, spot: [0, 0], yaw: 0, ground: 0,
          grip: { forward: 0.72 },
          length: dir > 0 ? LANE.len - start : start,
          track: (d) => {
            const c = laneWorld(start + dir * d)
            const back = ROCK_R * 0.95 + 0.72
            const x = c.x - SIDE.x * dir * back, z = c.z - SIDE.z * dir * back
            return { spot: [x, z], ground: groundHeight(x, z) }
          },
          onComplete: () => {
            useStore.getState().showToast('BOULDER MOVED', `${LANE.len} metres of pure effort`)
          },
        }
        const p = station.track!(0)
        station.spot = p.spot
        station.ground = p.ground
        station.yaw = Math.atan2(SIDE.x * dir, SIDE.z * dir)
        startWorkout(station)
      },
    })
  }, [rev])

  useFrame((_, dt) => {
    const g = ref.current
    if (!g) return
    let at = rock.at
    if (workout.station?.id === 'boulder' && rock.pushStart !== null) {
      at = rock.pushStart + rock.dir * workout.distance
      rock.last = at
      roll.current += workout.belt * rock.dir * dt / ROCK_R
    } else if (rock.pushStart !== null) {
      // the push is over: the rock stays where it got to, and from either
      // end the next push goes back the other way
      rock.at = Math.max(0, Math.min(LANE.len, rock.last))
      if (rock.at >= LANE.len - 0.05) rock.dir = -1
      if (rock.at <= 0.05) rock.dir = 1
      rock.pushStart = null
      at = rock.at
      setRev((r) => r + 1)
    }
    const p = laneWorld(at)
    g.position.copy(p)
    g.rotation.set(0, YAW, roll.current)
  })

  return (
    <group>
      <group ref={ref}><primitive object={model} /></group>
      {logs.map((l, i) => (
        <mesh key={i} position={[l.mid.x, l.mid.y + 0.12, l.mid.z]} rotation={[0, YAW + Math.PI / 2, Math.PI / 2]}
          material={m.timber} castShadow receiveShadow>
          <cylinderGeometry args={[0.14, 0.16, LANE.len + 1, 10]} />
        </mesh>
      ))}
    </group>
  )
}

// ---------------------------------------------------------------- rope climb
const ROPE = { lx: 5, lz: 5, top: 6.2 }
function RopeClimb({ m }: { m: ReturnType<typeof useYardMaterials> }) {
  const [x, z] = place(ROPE.lx, ROPE.lz)
  const y = groundHeight(x, z)
  const bell = useRef<Group>(null)
  const ring = useRef(0)
  useEffect(() => {
    for (const s of [-1, 1]) {
      const p = place(ROPE.lx + s * 1.6, ROPE.lz)
      addCollider({ x: p[0], z: p[1], r: 0.25 })
    }
    return registerInteractable({
      id: 'rope',
      label: 'CLIMB THE ROPE',
      verb: 'LIFT',
      position: new Vector3(x, y + 1.2, z),
      radius: 2.2,
      panel: null,
      action: () => {
        const station: Station = {
          id: 'rope', def: exerciseById.rope_climb, spot: [x, z], yaw: YAW + Math.PI, ground: y,
          barHeight: 2.05, length: ROPE.top - 2.05 - 0.45,
          track: () => ({ spot: [x, z], ground: y }),
          onComplete: () => {
            ring.current = 1.6
            cue('discover')
            useStore.getState().showToast('BELL RUNG', 'Top of the rope. Now come down slowly')
          },
        }
        startWorkout(station)
      },
    })
  }, [x, y, z])
  useFrame((_, dt) => {
    if (ring.current > 0 && bell.current) {
      ring.current = Math.max(0, ring.current - dt)
      bell.current.rotation.x = Math.sin(ring.current * 18) * 0.35 * ring.current
    }
  })
  return (
    <group position={[x, y, z]} rotation={[0, YAW, 0]}>
      {/* A-frame: two legs each side, a beam across the top */}
      {[-1, 1].map((s) => (
        <group key={s}>
          {[-1, 1].map((f) => (
            <mesh key={f} position={[s * 1.6, ROPE.top / 2, f * 0.55]} rotation={[f * 0.17, 0, 0]} material={m.timber} castShadow>
              <cylinderGeometry args={[0.1, 0.12, ROPE.top + 0.2, 10]} />
            </mesh>
          ))}
        </group>
      ))}
      <mesh position={[0, ROPE.top, 0]} rotation={[0, 0, Math.PI / 2]} material={m.timber} castShadow>
        <cylinderGeometry args={[0.12, 0.12, 3.6, 10]} />
      </mesh>
      {/* the rope, with a knot at the bottom */}
      <mesh position={[0, ROPE.top / 2 + 0.2, 0]} material={m.rope} castShadow>
        <cylinderGeometry args={[0.022, 0.022, ROPE.top - 0.4, 8]} />
      </mesh>
      <mesh position={[0, 0.55, 0]} material={m.rope}>
        <sphereGeometry args={[0.05, 10, 8]} />
      </mesh>
      {/* the bell, hung beside the rope */}
      <group ref={bell} position={[0.45, ROPE.top - 0.1, 0]}>
        <mesh position={[0, -0.18, 0]} material={m.brass} castShadow>
          <cylinderGeometry args={[0.06, 0.14, 0.24, 16, 1, true]} />
        </mesh>
      </group>
      <Text font={DISPLAY_FONT} position={[0, ROPE.top + 0.4, 0]} fontSize={0.26} color="#f2f2ee"
        anchorX="center" letterSpacing={0.16}>
        RING THE BELL
      </Text>
    </group>
  )
}


// ---------------------------------------------------------------- crawl net
/** A lane in yard-local metres running along +x from (lx, lz), `len` long. */
const NET = { lx: -6, lz: -9.5, len: 8, h: 0.55, w: 1.6 }

function laneAt(lane: { lx: number; lz: number }, d: number): [number, number] {
  return place(lane.lx + d, lane.lz)
}
const LANE_YAW = Math.atan2(SIDE.x, SIDE.z)          // facing along local +x

/** A camouflage-green cargo net, drawn once to a canvas: knotted mesh on clear. */
function netTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')!
  g.clearRect(0, 0, 128, 128)
  g.strokeStyle = '#4b5534'
  g.lineWidth = 5
  for (let i = 0; i <= 128; i += 32) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 128); g.stroke()
    g.beginPath(); g.moveTo(0, i); g.lineTo(128, i); g.stroke()
  }
  const t = new CanvasTexture(c)
  t.wrapS = t.wrapT = RepeatWrapping
  t.repeat.set(NET.len * 3, NET.w * 3)
  t.colorSpace = SRGBColorSpace
  return t
}

function CrawlNet({ m }: { m: ReturnType<typeof useYardMaterials> }) {
  const net = useMemo(() => {
    const g = new PlaneGeometry(NET.len, NET.w, 24, 6)
    g.rotateX(-Math.PI / 2)
    // sags between the posts, most in the middle
    const p = g.attributes.position
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i) / (NET.len / 2), z = p.getZ(i) / (NET.w / 2)
      p.setY(i, -0.12 * (1 - x * x) * (1 - z * z * 0.5) - 0.05 * Math.abs(Math.sin(p.getX(i) * 1.6)))
    }
    g.computeVertexNormals()
    return g
  }, [])
  const netMat = useMemo(() => new MeshStandardMaterial({
    map: netTexture(), alphaTest: 0.5, transparent: false, side: DoubleSide, roughness: 1,
  }), [])
  const mid = laneAt(NET, NET.len / 2)
  const y = groundHeight(mid[0], mid[1])
  useEffect(() => {
    const [x0, z0] = laneAt(NET, -0.4)
    return registerInteractable({
      id: 'crawl', label: 'CRAWL UNDER THE NET', verb: 'LIFT',
      position: new Vector3(x0, groundHeight(x0, z0) + 0.8, z0), radius: 2.2, panel: null,
      action: () => {
        const track = (d: number) => {
          const [x, z] = laneAt(NET, d)
          return { spot: [x, z] as [number, number], ground: groundHeight(x, z) }
        }
        const s0 = track(0)
        const station: Station = {
          id: 'crawl', def: exerciseById.crawl_net, spot: s0.spot, yaw: LANE_YAW, ground: s0.ground,
          length: NET.len, track,
          exitAt: (d) => laneAt(NET, Math.min(NET.len + 0.9, d + 1.2)),
          onComplete: () => {
            useStore.getState().showToast('THROUGH THE NET', 'Eight metres on your elbows')
            window.setTimeout(() => stopWorkout(), 500)
          },
        }
        startWorkout(station)
      },
    })
  }, [])
  return (
    <group>
      <group position={[mid[0], y + NET.h, mid[1]]} rotation={[0, YAW, 0]}>
        <mesh geometry={net} material={netMat} castShadow receiveShadow />
      </group>
      {/* the posts the net is lashed to, both sides, both ends and the middle */}
      {[-1, 0, 1].flatMap((i) => [-1, 1].map((s) => {
        const [x, z] = place(NET.lx + NET.len / 2 + i * NET.len / 2, NET.lz + s * NET.w / 2)
        return (
          <mesh key={`${i}${s}`} position={[x, groundHeight(x, z) + NET.h / 2, z]} material={m.timber} castShadow>
            <cylinderGeometry args={[0.05, 0.06, NET.h + 0.1, 8]} />
          </mesh>
        )
      }))}
    </group>
  )
}

// ---------------------------------------------------------------- wall
const WALL = { lx: -11.3, lz: -1.5, h: 2.3, w: 2.6 }

function ClimbWall({ m }: { m: ReturnType<typeof useYardMaterials> }) {
  // the wall runs across the lane; you come at it from -x and go over to +x
  const [sx, sz] = place(WALL.lx, WALL.lz)
  const y = groundHeight(sx, sz)
  const [wx, wz] = place(WALL.lx + 0.55 + 0.1, WALL.lz)
  useEffect(() => {
    addCollider({ x: wx, z: wz, hx: 0.12, hz: WALL.w / 2, angle: YAW })
    return registerInteractable({
      id: 'wall', label: 'CLIMB THE WALL', verb: 'LIFT',
      position: new Vector3(sx, y + 1.1, sz), radius: 1.9, panel: null,
      action: () => {
        const station: Station = {
          id: 'wall', def: exerciseById.wall_climb, spot: [sx, sz], yaw: LANE_YAW, ground: y,
          barHeight: WALL.h, length: 4,
          exitAt: (d) => d >= 3.9 ? place(WALL.lx + 1.45, WALL.lz) : [sx, sz],
          onComplete: () => {
            useStore.getState().showToast('OVER THE WALL', 'Grip, pull, commit')
            window.setTimeout(() => stopWorkout(), 450)
          },
        }
        startWorkout(station)
      },
    })
  }, [sx, sz, wx, wz, y])
  return (
    <group position={[wx, y, wz]} rotation={[0, YAW, 0]}>
      {/* the wall itself: vertical boards, a capping rail along the top */}
      <mesh position={[0, WALL.h / 2, 0]} material={m.timber} castShadow receiveShadow>
        <boxGeometry args={[0.2, WALL.h, WALL.w]} />
      </mesh>
      {Array.from({ length: 9 }, (_, i) => (
        <mesh key={i} position={[-0.105, WALL.h / 2, -WALL.w / 2 + (i + 0.5) * (WALL.w / 9)]} material={m.dark}>
          <boxGeometry args={[0.005, WALL.h - 0.05, 0.012]} />
        </mesh>
      ))}
      <mesh position={[0, WALL.h + 0.03, 0]} material={m.timber} castShadow>
        <boxGeometry args={[0.28, 0.06, WALL.w + 0.1]} />
      </mesh>
      {/* raking braces on the far side, so it stands up to being climbed */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[0.7, WALL.h / 2 - 0.1, s * (WALL.w / 2 - 0.2)]} rotation={[0, 0, 0.62]}
          material={m.timber} castShadow>
          <boxGeometry args={[0.1, WALL.h * 1.15, 0.1]} />
        </mesh>
      ))}
    </group>
  )
}

// ---------------------------------------------------------------- tyres
const TYRES = { lx: 3.5, lz: -8.5, n: 10 }

function TyreRun({ m }: { m: ReturnType<typeof useYardMaterials> }) {
  const ref = useRef<InstancedMesh>(null)
  const geo = useMemo(() => {
    const g = new TorusGeometry(0.26, 0.11, 10, 20)
    g.rotateX(Math.PI / 2)
    g.translate(0, 0.11, 0)
    return g
  }, [])
  useEffect(() => {
    const d = new Object3D()
    for (let i = 0; i < TYRES.n; i++) {
      // alternating sides, 0.6 m apart: the left foot takes the even ones
      const [x, z] = place(TYRES.lx + i * 0.6, TYRES.lz + (i % 2 ? -0.28 : 0.28))
      d.position.set(x, groundHeight(x, z), z)
      d.rotation.set((i % 3) * 0.03, i * 0.7, 0)
      d.updateMatrix()
      ref.current!.setMatrixAt(i, d.matrix)
    }
    ref.current!.instanceMatrix.needsUpdate = true
    ref.current!.computeBoundingSphere()
    const [sx, sz] = place(TYRES.lx - 0.1, TYRES.lz)
    return registerInteractable({
      id: 'tyres', label: 'TYRE RUN', verb: 'LIFT',
      position: new Vector3(sx, groundHeight(sx, sz) + 1, sz), radius: 2, panel: null,
      action: () => {
        const len = (TYRES.n - 1) * 0.6 + 0.6
        const station: Station = {
          id: 'tyres', def: exerciseById.tyre_run, spot: [sx, sz], yaw: LANE_YAW, ground: groundHeight(sx, sz),
          length: len,
          exitAt: (d) => place(TYRES.lx - 0.1 + d + 0.4, TYRES.lz),
          onComplete: () => {
            useStore.getState().showToast('QUICK FEET', 'Knees high, every tyre')
            window.setTimeout(() => stopWorkout(), 350)
          },
        }
        startWorkout(station)
      },
    })
  }, [])
  return <instancedMesh ref={ref} args={[geo, m.rubber, TYRES.n]} castShadow receiveShadow />
}

// ---------------------------------------------------------------- courses
function coneGates(): Vector3[] {
  return [0, 1, 2, 3, 4, 5, 6].map((i) => {
    const [x, z] = place(-6 + i * 2.2, -5 + (i % 2 ? 2.2 : 0))
    return new Vector3(x, groundHeight(x, z), z)
  })
}

/** The steepest 45 m of road near the camp, uphill: the sprint. */
function hillGates(): Vector3[] {
  const [cx, cz] = locationById.camp.pos
  let best = { i: 0, j: 0, rise: -1 }
  for (let i = 0; i < pathSamples.length - 1; i++) {
    const a = pathSamples[i]
    if (Math.hypot(a.x - cx, a.z - cz) > 90) continue
    let len = 0, j = i
    while (j < pathSamples.length - 1 && len < 45) {
      len += Math.hypot(pathSamples[j + 1].x - pathSamples[j].x, pathSamples[j + 1].z - pathSamples[j].z)
      j++
    }
    for (const [s, e] of [[i, j], [j, i]] as const) {
      const rise = terrainHeight(pathSamples[e].x, pathSamples[e].z) - terrainHeight(pathSamples[s].x, pathSamples[s].z)
      if (rise > best.rise) best = { i: s, j: e, rise }
    }
  }
  const pick = (k: number) => {
    const p = pathSamples[k]
    return new Vector3(p.x, terrainHeight(p.x, p.z), p.z)
  }
  const mid = Math.round((best.i + best.j) / 2)
  return [pick(best.i), pick(mid), pick(best.j)]
}

const COURSES: CourseDef[] = [
  { id: 'cones', name: 'Cone Drill', gates: coneGates(), radius: 1.3, praise: 'QUICK FEET' },
  { id: 'hill', name: 'Hill Sprint', gates: hillGates(), radius: 3.2, praise: 'GREAT RUN' },
]

function Gates({ def, m }: { def: CourseDef; m: ReturnType<typeof useYardMaterials> }) {
  const rings = useRef<(Mesh | null)[]>([])
  useEffect(() => registerInteractable({
    id: `course-${def.id}`,
    label: `START · ${def.name.toUpperCase()}`,
    verb: 'START',
    position: def.gates[0].clone().setY(def.gates[0].y + 1),
    radius: def.radius + 0.6,
    panel: null,
    action: () => startCourse(def),
  }), [def])
  useFrame((_, dt) => {
    if (course.def?.id === def.id) stepCourse(dt)
    const active = course.def?.id === def.id
    rings.current.forEach((r, i) => {
      if (!r) return
      const mat = r.material as MeshStandardMaterial
      const lit = active ? i === course.next : i === 0
      const done = active && i < course.next
      mat.emissiveIntensity = lit ? 2.4 + Math.sin(performance.now() / 180) * 0.6 : done ? 0.2 : 0.5
      mat.opacity = lit ? 0.85 : done ? 0.15 : 0.35
    })
  })
  return (
    <group>
      {def.gates.map((g, i) => (
        <group key={i} position={[g.x, g.y, g.z]}>
          <mesh ref={(el) => { rings.current[i] = el }} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.06, 0]}>
            <ringGeometry args={[def.radius * 0.82, def.radius, 40]} />
            <meshStandardMaterial color={MINT} emissive={MINT} emissiveIntensity={0.5} transparent opacity={0.35} depthWrite={false} />
          </mesh>
          {def.id === 'cones' && (
            <mesh position={[0, 0.23, 0]} material={m.cone} castShadow>
              <coneGeometry args={[0.16, 0.46, 16]} />
            </mesh>
          )}
          {i === 0 && (
            <Text font={DISPLAY_FONT} position={[0, 2.2, 0]} fontSize={0.3} color="#f2f2ee" anchorX="center"
              letterSpacing={0.14}>
              {def.name.toUpperCase()}
            </Text>
          )}
        </group>
      ))}
    </group>
  )
}

// ---------------------------------------------------------------- the yard
const ANNOUNCE: { id: string; at: () => Vector3; title: string; line: string }[] = [
  { id: 'boulder', at: () => laneWorld(0), title: 'NEW ACTIVITY · BOULDER PUSH', line: 'Hands on the rock. Hold W to drive it' },
  { id: 'rope', at: () => { const [x, z] = place(ROPE.lx, ROPE.lz); return new Vector3(x, 0, z) }, title: 'NEW ACTIVITY · ROPE CLIMB', line: 'Tap Space for every pull. Ring the bell' },
  { id: 'cones', at: () => COURSES[0].gates[0], title: 'NEW ACTIVITY · CONE DRILL', line: 'Six gates, against the clock' },
  { id: 'crawl', at: () => { const [x, z] = laneAt(NET, 0); return new Vector3(x, 0, z) }, title: 'NEW ACTIVITY · CRAWL NET', line: 'Down on your elbows. Hold W' },
  { id: 'wall', at: () => { const [x, z] = place(WALL.lx, WALL.lz); return new Vector3(x, 0, z) }, title: 'NEW ACTIVITY · WALL CLIMB', line: 'Space for each move. Over the top' },
  { id: 'tyres', at: () => { const [x, z] = place(TYRES.lx, TYRES.lz); return new Vector3(x, 0, z) }, title: 'NEW ACTIVITY · TYRE RUN', line: 'High knees, a foot in every tyre' },
  { id: 'hill', at: () => COURSES[1].gates[0], title: 'NEW ACTIVITY · HILL SPRINT', line: 'Start at the bottom. Top gate stops the clock' },
]

export function BootCamp() {
  const m = useYardMaterials()
  const y = groundHeight(CX, CZ)
  const seen = useRef(new Set<string>())
  const clock = useRef(0)

  useEffect(() => { addGrassClear(CX, CZ, 13.5) }, [])

  useFrame((_, dt) => {
    clock.current += dt
    if (clock.current < 0.5) return
    clock.current = 0
    for (const a of ANNOUNCE) {
      if (seen.current.has(a.id)) continue
      const p = a.at()
      if (Math.hypot(player.pos.x - p.x, player.pos.z - p.z) < 12) {
        seen.current.add(a.id)
        useStore.getState().showToast(a.title, a.line)
        break
      }
    }
  })

  return (
    <group>
      {/* the yard: packed dirt, levelled into the hillside */}
      <mesh position={[CX, y + 0.02, CZ]} rotation={[-Math.PI / 2, 0, 0]} material={m.dirt} receiveShadow>
        <circleGeometry args={[13.5, 48]} />
      </mesh>
      <Boulder m={m} />
      <RopeClimb m={m} />
      <Gates def={COURSES[0]} m={m} />
      <CrawlNet m={m} />
      <ClimbWall m={m} />
      <TyreRun m={m} />
      <Text font={DISPLAY_FONT} position={[CX - FWD.x * 10, y + 4.2, CZ - FWD.z * 10]} rotation={[0, YAW, 0]}
        fontSize={1.1} color="#eef6f2" fillOpacity={0.28} anchorX="center" letterSpacing={0.2}>
        BOOT CAMP
      </Text>
    </group>
  )
}

/** The hill sprint lives on the road, so it is mounted with the world, not the yard. */
export function HillSprint() {
  const m = useYardMaterials()
  return <Gates def={COURSES[1]} m={m} />
}

useGLTF.preload('/models/boulder.glb')
