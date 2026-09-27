import { Vector3 } from 'three'
import { player } from '../state/store'

/**
 * Getting into the car and out of it the way people actually do.
 *
 * In: walk up behind the driver's door and pull it open; step into the gap
 * and turn your back to the seat; sit down on the edge of it; lift the right
 * leg over the sill into the footwell; bring the left leg in as you slide
 * across and turn to face the wheel. The door swings shut, the key turns.
 * Out: the same in reverse — the door opens, turn and put the left foot out,
 * then the right, stand up, step clear, and the door shuts behind you.
 *
 * Everything is placed from the car's own frame (x toward the driver's door,
 * z forward, y up from the ground under it), using where its seat, sill and
 * pedals really are, so the body lands on the car rather than near it.
 * `door.target` is how open the door should be (0..1).
 */
export const door = { target: 0 }

// the car, in its own metres (see tools/car: Seat_Driver 0.37/0.335/-0.3,
// pedals 0.4/0.26/0.64, sill at about x 0.95)
const P = {
  pull: [1.45, 0, -1.2],         // behind the door, to open it
  gap: [1.28, 0, -0.32],         // in the opening, between door and body
  edge: [0.8, 0.48, -0.32],      // hips on the outer edge of the seat
  seat: [0.37, 0.435, -0.3],     // hips in the seat
  footOutL: [1.34, 0.11, -0.52], // feet on the ground outside
  footOutR: [1.36, 0.11, -0.1],
  footInR: [0.4, 0.34, 0.58],    // right foot to the pedals
  footInL: [0.64, 0.34, 0.5],    // left foot beside it
} as const

type Pt = readonly [number, number, number]
export type Phase = 'walk' | 'open' | 'turn' | 'sit' | 'rightIn' | 'leftIn'
  | 'leftOut' | 'rightOut' | 'stand' | 'away'

const TIME: Record<Phase, number> = {
  walk: 0, open: 0.6, turn: 0.4, sit: 0.6, rightIn: 0.5, leftIn: 0.65,
  leftOut: 0.6, rightOut: 0.45, stand: 0.6, away: 0.55,
}

export const boarding = {
  kind: null as null | 'in' | 'out',
  phases: [] as Phase[],
  index: 0,
  t: 0,
  from: new Vector3(),
  car: new Vector3(),
  carYaw: 0,
  done: null as null | (() => void),
}

export const isBoarding = () => boarding.kind !== null

/** Car-local metres to world. */
function W(p: Pt, out = new Vector3()) {
  const c = Math.cos(boarding.carYaw), s = Math.sin(boarding.carYaw)
  return out.set(
    boarding.car.x + p[0] * c + p[2] * s,
    boarding.car.y + p[1],
    boarding.car.z - p[0] * s + p[2] * c,
  )
}

export function startBoarding(kind: 'in' | 'out', car: Vector3, carYaw: number, done: () => void) {
  const b = boarding
  b.kind = kind
  b.car.copy(car)
  b.carYaw = carYaw
  b.from.copy(player.pos)
  b.phases = kind === 'in'
    ? ['walk', 'open', 'turn', 'sit', 'rightIn', 'leftIn']
    : ['leftOut', 'rightOut', 'stand', 'away']
  b.index = 0
  b.t = 0
  b.done = done
  TIME.walk = Math.hypot(W(P.pull).x - player.pos.x, W(P.pull).z - player.pos.z) / 1.4
  player.frozen = true
  player.speed = 0
}

const ease = (x: number) => { const c = Math.min(1, Math.max(0, x)); return c * c * (3 - 2 * c) }
const lerpYaw = (a: number, b: number, k: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k

/**
 * The pose for this frame. `mode` 'walk'/'stand' means the clip drives the
 * body (walking or idle) at `pos`/`yaw`; 'transfer' means carTransfer places
 * the hips at `hip` and the feet at `feet`.
 */
const _a = new Vector3(), _b = new Vector3()
const out = {
  mode: 'stand' as 'walk' | 'stand' | 'transfer',
  pos: new Vector3(), yaw: 0,
  hip: new Vector3(), sit: 0,
  feet: [new Vector3(), new Vector3()] as [Vector3, Vector3],
  lift: [0, 0] as [number, number],
  reach: 0, handle: new Vector3(),
}

/** A foot swinging from one place to another, up and over the sill. */
function swing(from: Pt, to: Pt, k: number, o: Vector3) {
  W(from, _a); W(to, _b)
  o.lerpVectors(_a, _b, k)
  o.y += Math.sin(k * Math.PI) * 0.42
  return o
}

export function stepBoarding(dt: number) {
  const b = boarding
  b.t += dt
  let phase = b.phases[b.index]
  while (b.t >= TIME[phase]) {
    b.t -= TIME[phase]
    b.index++
    if (b.index >= b.phases.length) { finish(); return out }
    phase = b.phases[b.index]
  }
  const k = ease(b.t / Math.max(TIME[phase], 0.001))
  const facingOut = b.carYaw + Math.PI / 2       // back to the seat
  const facingCar = b.carYaw - Math.PI / 2
  const forward = b.carYaw
  out.reach = 0
  out.lift[0] = out.lift[1] = 0
  switch (phase) {
    case 'walk':
      out.mode = 'walk'
      W(P.pull, _a)
      out.pos.lerpVectors(b.from, _a, b.t / Math.max(TIME.walk, 0.001))
      out.yaw = Math.atan2(_a.x - b.from.x, _a.z - b.from.z)
      break
    case 'open':
      out.mode = 'stand'
      W(P.pull, out.pos)
      out.yaw = lerpYaw(out.yaw, facingCar + 0.5, Math.min(1, dt * 10))
      door.target = b.t > TIME.open * 0.35 ? 1 : 0
      out.reach = Math.sin((b.t / TIME.open) * Math.PI)
      out.handle.copy(out.pos).setY(out.pos.y + 0.92)
        .add(_a.set(Math.sin(facingCar), 0, Math.cos(facingCar)).multiplyScalar(0.42))
        .add(_b.set(Math.sin(forward), 0, Math.cos(forward)).multiplyScalar(0.3))
      break
    case 'turn':
      out.mode = 'walk'
      out.pos.lerpVectors(W(P.pull, _a), W(P.gap, _b), k)
      out.yaw = lerpYaw(facingCar + 0.5, facingOut, k)
      break
    case 'sit':
    case 'stand': {
      const s = phase === 'sit' ? k : 1 - k
      out.mode = 'transfer'
      out.yaw = facingOut
      // from standing in the gap down onto the seat's edge
      W(P.gap, _a); _a.y += 0.95
      W(P.edge, _b)
      out.hip.lerpVectors(_a, _b, s)
      out.sit = s
      W(P.footOutL, out.feet[0]); W(P.footOutR, out.feet[1])
      out.pos.copy(W(P.gap, _a))
      break
    }
    case 'rightIn':
    case 'rightOut': {
      const s = phase === 'rightIn' ? k : 1 - k
      out.mode = 'transfer'
      out.sit = 1
      out.yaw = lerpYaw(facingOut, forward, s * 0.45)
      W(P.edge, out.hip)
      W(P.footOutL, out.feet[0])
      swing(P.footOutR, P.footInR, s, out.feet[1])
      out.lift[1] = Math.sin(s * Math.PI)
      out.pos.copy(W(P.gap, _a))
      break
    }
    case 'leftIn':
    case 'leftOut': {
      const s = phase === 'leftIn' ? k : 1 - k
      out.mode = 'transfer'
      out.sit = 1
      out.yaw = lerpYaw(facingOut, forward, 0.45 + s * 0.55)
      out.hip.lerpVectors(W(P.edge, _a), W(P.seat, _b), s)
      W(P.footInR, out.feet[1])
      swing(P.footOutL, P.footInL, s, out.feet[0])
      out.lift[0] = Math.sin(s * Math.PI)
      out.pos.copy(W(P.gap, _a))
      break
    }
    case 'away':
      out.mode = 'walk'
      out.pos.lerpVectors(W(P.gap, _a), W(P.pull, _b), k)
      out.yaw = forward + Math.PI
      if (k > 0.5) door.target = 0
      break
  }
  player.pos.x = out.pos.x
  player.pos.z = out.pos.z
  player.yaw = out.yaw
  return out
}

function finish() {
  const done = boarding.done
  boarding.kind = null
  boarding.done = null
  player.frozen = false
  done?.()
}
