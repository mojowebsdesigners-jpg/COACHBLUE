import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Vector3 } from 'three'
import { locationById } from '../../data/journey'
import { groundHeight } from '../../lib/terrain'
import { player, useStore } from '../../state/store'
import { cameraOverride, releaseFocus } from './CameraController'
import { gymPlacement } from './Gym'

/**
 * Short, scripted camera moves for the big arrivals, with the place's name and
 * what it is for. Each one runs once and hands control straight back.
 *
 * The camera used to chase the scripted path on a heavy ease, so it drifted
 * slowly into the shot, arrived late, then drifted slowly back — which read as
 * the game hanging. Now the shot blends in from wherever the camera actually
 * is over a fixed moment, follows the path tightly, and blends back out to the
 * player's own follow position before letting go. Every frame of the path is
 * kept above the ground and clear of the hillside between it and the subject,
 * so a shot never starts inside a hill or looks at the back of one.
 */
type Shot = {
  duration: number
  title: string
  line: string
  /** where the camera sits and looks, as a function of time (0..1) */
  frame: (t: number, pos: Vector3, target: Vector3) => void
}

function orbit(centre: [number, number], opts: {
  radius: number; height: number; from: number; to: number; lookHeight?: number; lookY?: number
}) {
  return (t: number, pos: Vector3, target: Vector3) => {
    const e = t * t * (3 - 2 * t)
    const a = opts.from + (opts.to - opts.from) * e
    const y = opts.lookY ?? groundHeight(centre[0], centre[1])
    pos.set(centre[0] + Math.cos(a) * opts.radius, y + opts.height, centre[1] + Math.sin(a) * opts.radius)
    target.set(centre[0], y + (opts.lookHeight ?? 1.6), centre[1])
  }
}

function crane(centre: [number, number], opts: { radius: number; from: number; to: number; angle: number }) {
  return (t: number, pos: Vector3, target: Vector3) => {
    const e = t * t * (3 - 2 * t)
    const y = groundHeight(centre[0], centre[1])
    const a = opts.angle + e * 0.5
    pos.set(centre[0] + Math.cos(a) * opts.radius, y + opts.from + (opts.to - opts.from) * e,
      centre[1] + Math.sin(a) * opts.radius)
    target.set(centre[0], y + 2, centre[1])
  }
}

const gym = gymPlacement(locationById.camp.pos)
const POOL_AT: [number, number] = [-1, 32]

const SHOTS: Record<string, Shot> = {
  coach: {
    duration: 4.2, title: 'Meet Coach Blue', line: 'The man behind the method. Say hello.',
    frame: orbit(locationById.coach.pos, { radius: 5, height: 1.9, from: -0.6, to: 0.9, lookHeight: 1.7 }),
  },
  camp: {
    duration: 5, title: 'The Training Camp', line: 'Build strength with workouts you control.',
    // round the open, road side of the compound: the back wall is behind it
    frame: orbit([gym.cx, gym.cz], {
      radius: 15, height: 6.5, from: Math.PI / 2 - gym.angle - 0.75, to: Math.PI / 2 - gym.angle + 0.45, lookHeight: 1,
    }),
  },
  pool: {
    duration: 4.4, title: 'The Pool', line: 'Recover, swim and build your conditioning.',
    frame: orbit(POOL_AT, { radius: 13, height: 4.5, from: 2.2, to: 3.1, lookHeight: 0.4 }),
  },
  hundred: {
    duration: 4.6, title: '100 Days of Discipline', line: 'One decision a day. Stack a hundred of them.',
    frame: crane(locationById.hundred.pos, { radius: 24, from: 4, to: 18, angle: 1.3 }),
  },
  gallery: {
    duration: 4.4, title: 'The Transformation Gallery', line: 'Real clients. Real results.',
    frame: orbit(locationById.gallery.pos, { radius: 17, height: 5.5, from: 1.2, to: 2.4, lookHeight: 2.4 }),
  },
  hub: {
    duration: 4, title: 'The Coaching Hub', line: 'Plans, check-ins and accountability, all in one place.',
    frame: orbit(locationById.hub.pos, { radius: 12, height: 4.2, from: 1.1, to: 1.9, lookHeight: 2.2 }),
  },
  summit: {
    duration: 6, title: 'The Final Summit', line: 'This is where the journey becomes yours.',
    frame: orbit(locationById.summit.pos, { radius: 11, height: 4.4, from: 0.2, to: 2.6, lookHeight: 2.2 }),
  },
}

export const cinematicTitle = (name: string | null) => (name && SHOTS[name]) ? SHOTS[name] : null

const BLEND = 0.9            // seconds to blend in, and out again

const _path = new Vector3()
const _look = new Vector3()
const _startPos = new Vector3()
const _startLook = new Vector3()
const _endPos = new Vector3()
const _endLook = new Vector3()
const _dir = new Vector3()

/** Lift a camera position clear of the ground under it and between it and what it looks at. */
function keepClear(pos: Vector3, look: Vector3) {
  pos.y = Math.max(pos.y, groundHeight(pos.x, pos.z) + 1.4)
  for (let i = 1; i <= 8; i++) {
    const k = i / 9
    const x = pos.x + (look.x - pos.x) * k
    const z = pos.z + (look.z - pos.z) * k
    const y = pos.y + (look.y - pos.y) * k
    const floor = groundHeight(x, z) + 0.6
    if (y < floor) pos.y += (floor - y) / (1 - k)
  }
}

export function Cinematics() {
  const cinematic = useStore((s) => s.cinematic)
  const playCinematic = useStore((s) => s.playCinematic)
  const camera = useThree((s) => s.camera)
  const t = useRef(0)

  useEffect(() => {
    t.current = 0
    if (!cinematic) return
    player.frozen = true
    // start from exactly where the camera is now
    _startPos.copy(camera.position)
    camera.getWorldDirection(_dir)
    _startLook.copy(camera.position).addScaledVector(_dir, 8)
    return () => {
      player.frozen = !!useStore.getState().panel
    }
  }, [cinematic, camera])

  useFrame((_, delta) => {
    if (!cinematic) return
    const shot = SHOTS[cinematic]
    if (!shot) {
      playCinematic(null)
      return
    }
    t.current += Math.min(delta, 0.05)
    const k = Math.min(1, t.current / shot.duration)
    shot.frame(k, _path, _look)
    keepClear(_path, _look)

    // blend in from the player's view, and back out to it at the end
    const inW = Math.min(1, t.current / BLEND)
    const outW = Math.min(1, Math.max(0, (shot.duration - t.current) / BLEND))
    const wIn = inW * inW * (3 - 2 * inW)
    const wOut = outW * outW * (3 - 2 * outW)
    // where the follow camera will want to be when control returns
    const back = player.camYaw
    _endPos.set(
      player.pos.x + Math.sin(back) * 4.6, player.pos.y + 2.1, player.pos.z + Math.cos(back) * 4.6,
    )
    _endLook.set(player.pos.x, player.pos.y + 1.45, player.pos.z)
    cameraOverride.pos.copy(_path)
    cameraOverride.target.copy(_look)
    if (wIn < 1) {
      cameraOverride.pos.lerpVectors(_startPos, _path, wIn)
      cameraOverride.target.lerpVectors(_startLook, _look, wIn)
    } else if (wOut < 1) {
      cameraOverride.pos.lerpVectors(_endPos, _path, wOut)
      cameraOverride.target.lerpVectors(_endLook, _look, wOut)
    }
    // the blend runs in a straight line from wherever the camera was, which
    // can cut through a hillside; keep the blended point clear as well
    if (wIn < 1 || wOut < 1) keepClear(cameraOverride.pos, cameraOverride.target)
    cameraOverride.active = true
    cameraOverride.ease = 14        // follow the path, do not trail it
    if (k >= 1) {
      releaseFocus()
      playCinematic(null)
    }
  }, 1)

  return null
}

export const cinematicNames = Object.keys(SHOTS)
