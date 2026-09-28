import { Quaternion, Vector3 } from 'three'
import { groundHeight, resolveCollisions, waterSurfaceAt } from '../lib/terrain'
import { player } from '../state/store'
import { CAR, vehicle } from './VehicleController'

/**
 * A little rigid-body world for the things you throw, kick and knock over:
 * balls (spheres) and pins, crates and letters (boxes).
 *
 * Deliberately small. Gravity, the ground (any ground: terrain, platforms,
 * the gym), the static colliders, the car and the player as pushers, balls
 * against each other, and bodies against boxes as spheres. Boxes tumble and
 * settle onto a face (lowest corner against the ground, a righting torque
 * onto the nearest flat side). Bodies at rest sleep and cost nothing; nothing
 * steps unless something is awake.
 */
export type Body = {
  kind: 'ball' | 'box'
  p: Vector3
  v: Vector3
  q: Quaternion
  w: Vector3
  /** ball radius; for boxes, the bounding radius */
  r: number
  /** box half extents (the origin at the middle of its base) */
  half?: Vector3
  mass: number
  bounce: number
  friction: number
  awake: boolean
  still: number
  /** balls float and drift on water */
  floats?: boolean
  /** told when it hits something hard (for a thud, a bounce off the rim) */
  onHit?: (speed: number) => void
}

const bodies = new Set<Body>()
export function addBody(b: Body) {
  bodies.add(b)
  return () => { bodies.delete(b) }
}

export function makeBall(r: number, mass: number, bounce = 0.6): Body {
  return {
    kind: 'ball', p: new Vector3(), v: new Vector3(), q: new Quaternion(), w: new Vector3(),
    r, mass, bounce, friction: 0.35, awake: false, still: 0,
  }
}
export function makeBox(hx: number, hy: number, hz: number, mass: number): Body {
  return {
    kind: 'box', p: new Vector3(), v: new Vector3(), q: new Quaternion(), w: new Vector3(),
    r: Math.hypot(hx, hz), half: new Vector3(hx, hy, hz), mass, bounce: 0.18, friction: 0.6,
    awake: false, still: 0,
  }
}

export function wake(b: Body) { b.awake = true; b.still = 0 }

const G = 9.8
const _c = new Vector3()
const _d = new Vector3()
const _q = new Quaternion()
const _ax = new Vector3()
const _up = new Vector3()
const _low = new Vector3()

function stepBall(b: Body, dt: number) {
  b.v.y -= G * dt
  const water = b.floats ? waterSurfaceAt(b.p.x, b.p.z) : null
  if (water !== null && b.p.y < water) {
    // bobbing on the water, dragged slowly to rest
    b.v.y += (water - b.p.y) * 30 * dt
    b.v.multiplyScalar(1 - Math.min(1, dt * 1.5))
  }
  b.p.addScaledVector(b.v, dt)
  // solid things in the world: a sphere against the colliders
  if (b.p.y - b.r < groundHeight(b.p.x, b.p.z) + 2) {
    const c = resolveCollisions(b.p.x, b.p.z, b.r)
    const dx = c.x - b.p.x, dz = c.z - b.p.z
    const push = Math.hypot(dx, dz)
    if (push > 1e-4) {
      const nx = dx / push, nz = dz / push
      const vn = b.v.x * nx + b.v.z * nz
      if (vn < 0) {
        b.v.x -= (1 + b.bounce) * vn * nx
        b.v.z -= (1 + b.bounce) * vn * nz
        b.onHit?.(-vn)
      }
      b.p.x = c.x; b.p.z = c.z
    }
  }
  const g = groundHeight(b.p.x, b.p.z)
  if (b.p.y - b.r < g) {
    b.p.y = g + b.r
    if (b.v.y < -0.6) b.onHit?.(-b.v.y)
    b.v.y = b.v.y < -0.4 ? -b.v.y * b.bounce : 0
    // rolling: friction slows it, and it spins with the ground speed
    const k = Math.min(1, dt * b.friction * 2.2)
    b.v.x *= 1 - k
    b.v.z *= 1 - k
    b.w.set(b.v.z / b.r, 0, -b.v.x / b.r)
  }
  const wl = b.w.length()
  if (wl > 1e-4) b.q.premultiply(_q.setFromAxisAngle(_ax.copy(b.w).divideScalar(wl), wl * dt))
}

function stepBox(b: Body, dt: number) {
  const h = b.half!
  b.v.y -= G * dt
  b.p.addScaledVector(b.v, dt)
  const wl = b.w.length()
  if (wl > 1e-5) b.q.premultiply(_q.setFromAxisAngle(_ax.copy(b.w).divideScalar(wl), wl * dt))
  // the lowest corner against the ground
  let pen = 0
  for (let c = 0; c < 8; c++) {
    _c.set(c & 1 ? h.x : -h.x, c & 2 ? h.y * 2 : 0, c & 4 ? h.z : -h.z).applyQuaternion(b.q).add(b.p)
    const d = _c.y - groundHeight(_c.x, _c.z)
    if (d < pen) { pen = d; _low.copy(_c) }
  }
  if (pen < 0) {
    b.p.y -= pen
    if (b.v.y < -1) b.onHit?.(-b.v.y)
    if (b.v.y < 0) b.v.y = -b.v.y * b.bounce
    const f = Math.min(1, dt * 5 * b.friction)
    b.v.x *= 1 - f; b.v.z *= 1 - f
    b.w.multiplyScalar(1 - Math.min(1, dt * 2.5))
    // topple onto whichever face is nearest to lying flat
    _up.set(0, 1, 0).applyQuaternion(_q.copy(b.q).invert())
    const ax = Math.abs(_up.x), ay = Math.abs(_up.y), az = Math.abs(_up.z)
    const want = ax > ay && ax > az ? _d.set(Math.sign(_up.x), 0, 0)
      : ay > az ? _d.set(0, Math.sign(_up.y), 0) : _d.set(0, 0, Math.sign(_up.z))
    b.w.addScaledVector(_ax.crossVectors(_up, want).applyQuaternion(b.q), dt * 14)
  }
  // walls and posts stop a sliding box too
  const c = resolveCollisions(b.p.x, b.p.z, Math.min(h.x, h.z))
  if (Math.hypot(c.x - b.p.x, c.z - b.p.z) > 1e-4) {
    b.v.x *= -0.2; b.v.z *= -0.2
    b.p.x = c.x; b.p.z = c.z
  }
}

/** Pushers: the car sends things flying; walking into a ball dribbles it. */
function pushers(b: Body) {
  if (vehicle.occupied && Math.abs(vehicle.speed) > 0.8) {
    const cy = Math.cos(vehicle.yaw), sy = Math.sin(vehicle.yaw)
    _d.copy(b.p).sub(vehicle.pos)
    const lx = _d.x * cy - _d.z * sy, lz = _d.x * sy + _d.z * cy
    if (Math.abs(lx) < 1.05 + b.r && Math.abs(lz) < CAR.wheelBase / 2 + 0.95 + b.r && _d.y < 2) {
      const dir = Math.sign(vehicle.speed), s = Math.abs(vehicle.speed)
      const fx = Math.sin(vehicle.yaw) * dir, fz = Math.cos(vehicle.yaw) * dir
      const light = Math.min(1.6, 30 / b.mass)
      b.v.set(fx * s * 1.1 * light + (Math.random() - 0.5) * 2, 1.2 + s * 0.2 * light, fz * s * 1.1 * light + (Math.random() - 0.5) * 2)
      b.w.set((Math.random() - 0.5) * s, (Math.random() - 0.5) * s * 0.6, (Math.random() - 0.5) * s)
      b.p.x += fx * 0.35; b.p.z += fz * 0.35
      vehicle.speed *= 1 - Math.min(0.2, b.mass / 400)
      wake(b)
      b.onHit?.(s)
    }
  } else if (!vehicle.occupied && !player.frozen && b.kind === 'ball') {
    // walking into a ball rolls it on ahead of your feet (not while he is
    // lining up a kick or a putt: then the ball is his to strike)
    const dx = b.p.x - player.pos.x, dz = b.p.z - player.pos.z
    const d = Math.hypot(dx, dz)
    const reach = 0.32 + b.r
    if (d < reach && b.p.y - player.pos.y < 0.6 && d > 1e-3) {
      const sp = Math.max(1.2, player.speed * 1.35)
      b.v.x = (dx / d) * sp
      b.v.z = (dz / d) * sp
      b.v.y = Math.max(b.v.y, 0.3)
      b.p.x = player.pos.x + (dx / d) * reach
      b.p.z = player.pos.z + (dz / d) * reach
      wake(b)
    }
  }
}

/** Balls bounce off each other and off boxes (as spheres). */
function contacts() {
  const list = [...bodies].filter((b) => b.awake)
  for (const a of list) {
    for (const b of bodies) {
      if (a === b) continue
      _d.copy(b.p).sub(a.p)
      if (a.kind === 'box') _d.y -= 0
      const rr = (a.kind === 'box' ? a.half!.x + 0.05 : a.r) + (b.kind === 'box' ? b.half!.x + 0.05 : b.r)
      const d = _d.length()
      if (d >= rr || d < 1e-5) continue
      _d.divideScalar(d)
      const rel = (a.v.x - b.v.x) * _d.x + (a.v.y - b.v.y) * _d.y + (a.v.z - b.v.z) * _d.z
      if (rel <= 0) continue
      const ma = a.mass, mb = b.mass
      const j = (1.35 * rel) / (1 / ma + 1 / mb)
      a.v.addScaledVector(_d, -j / ma)
      b.v.addScaledVector(_d, j / mb)
      if (b.kind === 'box') b.w.add(_ax.set(_d.z, 0, -_d.x).multiplyScalar(rel * 2.5))
      wake(b)
      // separate them
      const push = (rr - d) / 2
      a.p.addScaledVector(_d, -push)
      b.p.addScaledVector(_d, push)
    }
  }
}

export function stepPhysics(delta: number) {
  const dt = Math.min(delta, 1 / 30)
  for (const b of bodies) {
    // a sleeping body only needs to know if something has come for it
    if (!b.awake) {
      const near = Math.hypot(b.p.x - (vehicle.occupied ? vehicle.pos.x : player.pos.x), b.p.z - (vehicle.occupied ? vehicle.pos.z : player.pos.z))
      if (near < 6) pushers(b)
      continue
    }
    pushers(b)
    if (b.kind === 'ball') stepBall(b, dt)
    else stepBox(b, dt)
    const moving = b.v.lengthSq() + b.w.lengthSq() * 0.2
    if (moving < 0.01) b.still += dt
    else b.still = 0
    if (b.still > 0.8) { b.awake = false; b.v.set(0, 0, 0); b.w.set(0, 0, 0) }
    if (b.p.y < -200) b.awake = false
  }
  contacts()
}
