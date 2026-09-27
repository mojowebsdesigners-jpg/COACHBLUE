import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { AnimationMixer, Color, Group, MathUtils, MeshStandardMaterial, SkinnedMesh, Vector3, type AnimationAction } from 'three'
import { LAKE, addDynamicCollider, groundHeight, pathSamples } from '../../lib/terrain'
import { player, useStore } from '../../state/store'
import { aimBone } from '../../lib/ik'
import { alignFeet, relaxPosture } from '../../systems/ExercisePose'
import { CHATS } from '../../data/chatter'
import { offerCoaching } from '../../systems/Coaching'
import { findBones, useCoachModel } from './Player'
import { registerInteractable } from './InteractionSystem'
import { Athlete } from './Athlete'
import { benchSpots } from './Seats'

/**
 * The people who live in the valley: runners on the road, walkers round the
 * lake, someone resting on a bench. Any of them will stop for a word.
 *
 * Kept light on purpose. Each person drives their own animation mixer so the
 * far ones can be updated a few times a second instead of every frame, and
 * the very far ones are not drawn at all; foot placement and a head that
 * follows you only run up close, where they can be seen.
 */
type Tint = { shirt?: string; pants?: string }

const _look = new Vector3()
const _dir = new Vector3()
const _hp = new Vector3()

function tintClothes(root: Group, tint?: Tint) {
  if (!tint) return
  root.traverse((o) => {
    const m = o as SkinnedMesh
    if (!m.isSkinnedMesh) return
    for (const mat of (Array.isArray(m.material) ? m.material : [m.material]) as MeshStandardMaterial[]) {
      if (tint.shirt && mat.name === 'CB_Shirt') mat.color = new Color(tint.shirt)
      if (tint.pants && mat.name === 'CB_Pants') mat.color = new Color(tint.pants)
    }
  })
}

let chatCursor = 0
function nextChat() {
  const c = CHATS[chatCursor % CHATS.length]
  chatCursor++
  return c
}

/** Start a conversation; `done` runs when it closes. */
function talk(name: string, done: () => void) {
  const chat = nextChat()
  const s = useStore.getState()
  s.setDialog({ name, lines: chat.lines })
  const off = useStore.subscribe((st) => {
    if (st.dialog) return
    off()
    done()
    if (chat.cta) {
      offerCoaching({
        topic: 'talk',
        title: 'Heard it from a client',
        body: 'Want the same plan they are on? Coach Blue builds one around you.',
        goal: 'Better Lifestyle',
      })
    }
  })
}

export function Walker({
  name, model, waypoints, speed = 1.3, gait = 'walk', tint, pauseAt = 2,
}: {
  name: string
  model: string
  waypoints: [number, number][]
  speed?: number
  gait?: 'walk' | 'run'
  tint?: Tint
  pauseAt?: number
}) {
  const group = useRef<Group>(null)
  const { clone, animations } = useCoachModel(model)
  const bones = useMemo(() => findBones(clone), [clone])
  const reduced = useStore((s) => s.settings.reducedMotion)
  const rig = useMemo(() => {
    tintClothes(clone, tint)
    const mixer = new AnimationMixer(clone)
    const get = (n: string) => {
      const clip = animations.find((a) => a.name === n)
      return clip ? mixer.clipAction(clip) : null
    }
    const move = get(gait) as AnimationAction
    const idle = get('idle') as AnimationAction
    const nod = get('agree')
    move?.play()
    idle?.play()
    if (move) move.weight = 1
    if (idle) idle.weight = 0
    if (gait === 'run' && move) move.timeScale = speed / 3.4
    if (gait === 'walk' && move) move.timeScale = speed / 1.35
    return { mixer, move, idle, nod }
  }, [clone, animations, gait, speed, tint])

  const st = useRef({ leg: 0, t: 0, waiting: 0, yaw: 0, talking: false, pending: 0, frame: 0 })

  useEffect(() => addDynamicCollider(() => {
    const g = group.current
    return g && g.visible ? { x: g.position.x, z: g.position.z, r: 0.3 } : null
  }), [])

  // a word, when you are close enough to have one
  const offTalk = useRef<(() => void) | null>(null)
  useEffect(() => () => offTalk.current?.(), [])

  useFrame((_, delta) => {
    const g = group.current
    if (!g) return
    const dt = Math.min(delta, 0.05)
    const s = st.current
    const d = Math.hypot(player.pos.x - g.position.x, player.pos.z - g.position.z)

    // ---- level of detail: far away, draw nothing; further than the gym,
    // animate a few times a second; up close, every frame
    g.visible = d < 110
    if (!g.visible) { s.pending += dt; advance(dt); return }
    s.frame++
    s.pending += dt
    const every = d > 60 ? 6 : d > 30 ? 2 : 1

    // ---- talking
    const canTalk = d < 2.8 && !s.talking
    if (canTalk && !offTalk.current) {
      offTalk.current = registerInteractable({
        id: `talk-${name}`, label: `TALK TO ${name.toUpperCase()}`, verb: 'TALK',
        position: new Vector3(g.position.x, g.position.y + 1.6, g.position.z), radius: 2.8, panel: null,
        action: () => {
          s.talking = true
          offTalk.current?.()
          offTalk.current = null
          rig.nod?.reset().setLoop(2201, 2).play()
          talk(name, () => { s.talking = false; s.waiting = 0.8 })
        },
      })
    } else if (!canTalk && offTalk.current) {
      offTalk.current()
      offTalk.current = null
    }

    advance(dt)

    if (s.frame % every !== 0) return
    rig.mixer.update(s.pending)
    s.pending = 0
    if (d < 35) {
      g.updateMatrixWorld(true)
      relaxPosture(bones, g, gait === 'run' ? 0.35 : 0.8)
      alignFeet(bones, g, groundHeight, dt)
      // look at you as you pass, or while you talk
      if (d < 7 || s.talking) {
        bones.head.getWorldPosition(_hp)
        _look.set(player.pos.x, player.pos.y + 1.6, player.pos.z)
        _dir.copy(_look).sub(_hp).normalize()
        // only turn the head so far: past the shoulder it is an owl
        const fwd = Math.sin(s.yaw) * _dir.x + Math.cos(s.yaw) * _dir.z
        if (fwd > 0.1) aimBone(bones.head, bones.head.children[0] ?? bones.head, _dir)
      }
    }
  })

  function advance(dt: number) {
    const g = group.current!
    const s = st.current
    const from = waypoints[s.leg % waypoints.length]
    const to = waypoints[(s.leg + 1) % waypoints.length]
    const dist = Math.hypot(to[0] - from[0], to[1] - from[1])
    const moving = !s.talking && s.waiting <= 0
    if (s.talking) {
      // face the player while talking
      const want = Math.atan2(player.pos.x - g.position.x, player.pos.z - g.position.z)
      s.yaw += MathUtils.damp(0, Math.atan2(Math.sin(want - s.yaw), Math.cos(want - s.yaw)), 6, dt)
    } else if (s.waiting > 0) {
      s.waiting -= dt
    } else {
      s.t += (dt * (reduced ? 0 : speed)) / Math.max(dist, 0.001)
      if (s.t >= 1) {
        s.t = 0
        s.leg++
        s.waiting = pauseAt
      }
      const want = Math.atan2(to[0] - from[0], to[1] - from[1])
      s.yaw += MathUtils.damp(0, Math.atan2(Math.sin(want - s.yaw), Math.cos(want - s.yaw)), 6, dt)
    }
    const k = MathUtils.clamp(dt * 8, 0, 1)
    if (rig.move) rig.move.weight += ((moving ? 1 : 0) - rig.move.weight) * k
    if (rig.idle) rig.idle.weight += ((moving ? 0 : 1) - rig.idle.weight) * k
    const x = MathUtils.lerp(from[0], to[0], s.t)
    const z = MathUtils.lerp(from[1], to[1], s.t)
    g.position.set(x, groundHeight(x, z), z)
    g.rotation.y = s.yaw
  }

  return (
    <group ref={group} position={[waypoints[0][0], groundHeight(waypoints[0][0], waypoints[0][1]), waypoints[0][1]]}>
      <primitive object={clone} />
    </group>
  )
}

/** Someone resting on a bench, who will also stop for a word. */
function Sitter({ name, model, at, yaw, tint }: {
  name: string; model: string; at: [number, number]; yaw: number; tint?: Tint
}) {
  const y = groundHeight(at[0], at[1])
  useEffect(() => {
    let talking = false
    return registerInteractable({
      id: `talk-${name}`, label: `TALK TO ${name.toUpperCase()}`, verb: 'TALK',
      position: new Vector3(at[0], y + 1.1, at[1]), radius: 2.4, panel: null,
      action: () => {
        if (talking) return
        talking = true
        talk(name, () => { talking = false })
      },
    })
  }, [name, at, y])
  return (
    <Athlete position={at} rotation={yaw} exercise="sit" grip={{ height: 0.45 }} y={y} speed={1}
      model={model} tint={tint?.pants} />
  )
}

// ---------------------------------------------------------------- the cast
/** Waypoints along the road on one side, and back down the other: a run loop. */
function roadLoop(from: number, to: number, step: number, side: number) {
  const out: [number, number][] = []
  const at = (i: number, off: number) => {
    const p = pathSamples[i], q = pathSamples[Math.min(pathSamples.length - 1, i + 1)]
    const tx = q.x - p.x, tz = q.z - p.z, len = Math.hypot(tx, tz) || 1
    out.push([p.x - (tz / len) * off, p.z + (tx / len) * off])
  }
  for (let i = from; i <= to; i += step) at(i, side)
  for (let i = to; i >= from; i -= step) at(i, -side)
  return out
}

function lakeLoop(r: number, n: number, phase: number) {
  return Array.from({ length: n }, (_, i) => {
    const a = phase + (i / n) * Math.PI * 2
    return [LAKE.x + Math.cos(a) * r, LAKE.z + Math.sin(a) * r] as [number, number]
  })
}

export function Townsfolk() {
  const benches = benchSpots()
  const sitters = [benches[1], benches[4]].filter(Boolean)
  return (
    <group>
      {/* the road runner: out along one verge and back along the other */}
      <Walker name="Maya" model="/models/client-b.glb" gait="run" speed={3.2} pauseAt={0.2}
        waypoints={roadLoop(40, 520, 12, 3.3)} tint={{ shirt: '#1d3b5c', pants: '#1a1a1d' }} />
      {/* two walkers round the lake, opposite ways */}
      <Walker name="Daniel" model="/models/client-a.glb" speed={1.2}
        waypoints={lakeLoop(LAKE.r + 6.5, 10, 0)} tint={{ shirt: '#6b2e2e', pants: '#3b3f46' }} />
      <Walker name="Grace" model="/models/client-c.glb" speed={1.1}
        waypoints={lakeLoop(LAKE.r + 8, 10, Math.PI).reverse()} tint={{ shirt: '#2f5d4a', pants: '#26262b' }} />
      {/* people taking a breather on the benches */}
      {sitters.map((b, i) => (
        <Sitter key={i} name={i === 0 ? 'Tom' : 'Aisha'} model={i === 0 ? '/models/client-a.glb' : '/models/client-c.glb'}
          at={[b.x + Math.cos(b.yaw) * 0.42 - Math.sin(b.yaw) * 0.06, b.z - Math.sin(b.yaw) * 0.42 - Math.cos(b.yaw) * 0.06]}
          yaw={b.yaw}
          tint={{ pants: i === 0 ? '#2c3e50' : '#4a3b2f' }} />
      ))}
    </group>
  )
}
