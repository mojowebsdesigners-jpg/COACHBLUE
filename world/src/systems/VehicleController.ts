import { MathUtils, Vector3 } from 'three'
import { input } from '../lib/input'
import {
  PATH_HALF_WIDTH, addDynamicCollider, forestDensity, groundHeight, pathDistance, pathSamples,
  resolveCollisions, type Collider,
} from '../lib/terrain'
import { player } from '../state/store'

/**
 * SUV handling. Same steering idea as the character — W drives forward along
 * the vehicle's heading — but with a vehicle's weight: slow to gather speed,
 * slower to shed it, steering that tightens as you slow down, body roll and
 * pitch under load, and wheels that actually turn at the right rate.
 */
export const CAR = {
  // the Coach Blue GT (tools/car): quick off the line, a real top end
  accel: 10.5,
  brake: 17,
  drag: 0.9,
  rollingResistance: 2.0,
  maxSpeed: 34,           // ~120 km/h, plenty on these roads
  reverseSpeed: 7,
  steerAtRest: 1.6,
  steerAtSpeed: 0.6,
  wheelBase: 2.7,
  track: 1.64,
  wheelRadius: 0.345,
  bodyRadius: 1.6,
  /** how far a wheel can drop or rise from its rest position, metres */
  travel: 0.14,
}

/**
 * The parked car is solid: a box the size of its body, so you walk round it
 * rather than through it. While someone is driving it, it is not an obstacle
 * to them, and it never collides with itself.
 */
export const carCollider = (): Collider | null =>
  vehicle.occupied ? null : { x: vehicle.pos.x, z: vehicle.pos.z, hx: 1.0, hz: 2.3, angle: vehicle.yaw }
addDynamicCollider(carCollider)

/** 0 while the car is arriving, 1 once it has fully materialised. */
export const arrival = { t: 1 }

export const vehicle = {
  pos: new Vector3(24, 0, 128),
  yaw: -0.5,
  speed: 0,
  steer: 0,
  /** visual state for the body and wheels */
  roll: 0,
  pitch: 0,
  wheelSpin: 0,
  occupied: false,
  handbrake: false,
  /**
   * The body's ride on the ground. `ground*` is the plane through the four
   * contact patches; `lift`, `groundPitch` and `groundRoll` chase it on
   * springs, so the car settles over a crest instead of snapping to it.
   */
  groundPitch: 0,
  groundRoll: 0,
  lift: 0,
  liftVel: 0,
  pitchVel: 0,
  rollVel: 0,
  /** per-wheel suspension offset (FL, FR, RL, RR), metres, + = extended */
  susp: [0, 0, 0, 0],
  /** ground height under each wheel (FL, FR, RL, RR) */
  contact: [0, 0, 0, 0],
  /** what the car is rolling on: 0 tarmac, 1 grass, 2 dirt */
  surface: 0,
}

/**
 * Bring the car to the player rather than making them hunt for it.
 *
 * It is placed a few metres ahead, pulled onto the road if one is close (a
 * supercar parked in a hedge looks like a bug), nudged clear of anything solid
 * and dropped onto the ground. There is only ever one: pressing the key again
 * moves this car rather than littering the valley with copies.
 */
export function summonVehicle() {
  const ahead = 7.5
  placeVehicle(
    player.pos.x + Math.sin(player.yaw) * ahead,
    player.pos.z + Math.cos(player.yaw) * ahead,
    player.yaw,
  )
  arrival.t = 0
  return vehicle.pos
}

/**
 * Park the car beside the road near a point, nose pointing the way the road
 * runs. Used both for the car waiting at the start and for summoning: a
 * supercar sitting in a hedge reads as a bug, so if a road is anywhere near it
 * goes on the road.
 */
export function placeVehicle(wantX: number, wantZ: number, facing: number) {
  let x = wantX
  let z = wantZ
  let yaw = facing

  let closest = pathSamples[0]
  let best = Infinity
  for (const sample of pathSamples) {
    const d = Math.hypot(sample.x - wantX, sample.z - wantZ)
    if (d < best) { best = d; closest = sample }
  }

  if (best < 16) {
    const i = pathSamples.indexOf(closest)
    const next = pathSamples[Math.min(pathSamples.length - 1, i + 2)]
    const prev = pathSamples[Math.max(0, i - 2)]
    const tx = next.x - prev.x
    const tz = next.z - prev.z
    const len = Math.hypot(tx, tz) || 1
    yaw = Math.atan2(tx / len, tz / len)
    // face the way the player is looking, not backwards down the road
    if (Math.cos(yaw - facing) < 0) yaw += Math.PI
    // sit on the near side of the carriageway rather than dead centre
    x = closest.x - (tz / len) * 2.4
    z = closest.z + (tx / len) * 2.4
  }

  const clear = resolveCollisions(x, z, CAR.bodyRadius + 0.4, carCollider)
  vehicle.pos.set(clear.x, groundHeight(clear.x, clear.z), clear.z)
  vehicle.yaw = yaw
  vehicle.speed = 0
  vehicle.steer = 0
  vehicle.roll = 0
  vehicle.pitch = 0
  settleOnGround(1, true)
}

// ---------------------------------------------------------------- ride
const WHEEL_AT: [number, number][] = [
  [CAR.track / 2, CAR.wheelBase / 2], [-CAR.track / 2, CAR.wheelBase / 2],
  [CAR.track / 2, -CAR.wheelBase / 2], [-CAR.track / 2, -CAR.wheelBase / 2],
]

/** A critically-damped-ish spring: returns the new [value, velocity]. */
function spring(x: number, v: number, target: number, k: number, c: number, dt: number): [number, number] {
  const a = (target - x) * k - v * c
  v += a * dt
  return [x + v * dt, v]
}

/**
 * Fit the body to the ground under its four tyres.
 *
 * The car used to take one height, at its middle, and stay level: on a crest
 * the ends hung in the air, in a dip the nose and tail sank into the hill,
 * and on a side slope the downhill wheels vanished. Now each contact patch is
 * sampled, the body pitches and rolls to the plane through them (on springs,
 * so bumps are felt rather than copied), and each wheel then drops or rises
 * within its travel to meet the ground the body could not follow exactly.
 */
function settleOnGround(dt: number, snap = false) {
  const c = Math.cos(vehicle.yaw)
  const s = Math.sin(vehicle.yaw)
  const h = vehicle.contact
  for (let i = 0; i < 4; i++) {
    const [lx, lz] = WHEEL_AT[i]
    h[i] = groundHeight(vehicle.pos.x + lx * c + lz * s, vehicle.pos.z - lx * s + lz * c)
  }
  const front = (h[0] + h[1]) / 2, rear = (h[2] + h[3]) / 2
  const left = (h[0] + h[2]) / 2, right = (h[1] + h[3]) / 2
  // the model's pitch is about X with the nose on +Z: nose up is negative
  const tp = -Math.atan2(front - rear, CAR.wheelBase)
  const tr = Math.atan2(left - right, CAR.track)
  const mid = (h[0] + h[1] + h[2] + h[3]) / 4

  if (snap) {
    vehicle.groundPitch = tp
    vehicle.groundRoll = tr
    vehicle.lift = mid
    vehicle.liftVel = vehicle.pitchVel = vehicle.rollVel = 0
  } else {
    const step = Math.min(dt, 1 / 30)
    ;[vehicle.groundPitch, vehicle.pitchVel] = spring(vehicle.groundPitch, vehicle.pitchVel, tp, 140, 20, step)
    ;[vehicle.groundRoll, vehicle.rollVel] = spring(vehicle.groundRoll, vehicle.rollVel, tr, 160, 22, step)
    ;[vehicle.lift, vehicle.liftVel] = spring(vehicle.lift, vehicle.liftVel, mid, 180, 22, step)
    // the body may lag a bump, but never by more than the springs could
    // really compress: no amount of lag lets a tyre sink into the road
    vehicle.lift = MathUtils.clamp(vehicle.lift, mid - CAR.travel * 0.8, mid + CAR.travel * 0.8)
  }
  vehicle.pos.y = vehicle.lift

  // each wheel meets its own ground: the body plane is at
  // lift + (pitch, roll) · offset; the difference is suspension travel
  const tanP = Math.tan(-(vehicle.groundPitch + vehicle.pitch))
  const tanR = Math.tan(vehicle.groundRoll + vehicle.roll)
  for (let i = 0; i < 4; i++) {
    const [lx, lz] = WHEEL_AT[i]
    const bodyAt = vehicle.lift + lz * tanP + lx * tanR
    vehicle.susp[i] = MathUtils.clamp(h[i] - bodyAt, -CAR.travel, CAR.travel)
  }
}

export function stepVehicle(dt: number) {
  const throttle = input.forward
  const steerInput = input.strafe
  vehicle.handbrake = input.jump

  const speedFrac = Math.min(1, Math.abs(vehicle.speed) / CAR.maxSpeed)
  const steerRate = MathUtils.lerp(CAR.steerAtRest, CAR.steerAtSpeed, speedFrac)
  vehicle.steer = MathUtils.damp(vehicle.steer, steerInput, 8, dt)

  // ---- longitudinal ----------------------------------------------------
  if (throttle > 0) {
    vehicle.speed += CAR.accel * dt * (1 - speedFrac * 0.65)
  } else if (throttle < 0) {
    vehicle.speed -= (vehicle.speed > 0.5 ? CAR.brake : CAR.accel * 0.6) * dt
  }
  // the handbrake scrubs speed gently: at pace it is for turning, not stopping
  if (vehicle.handbrake) vehicle.speed = MathUtils.damp(vehicle.speed, 0, Math.abs(vehicle.speed) > 6 ? 1.6 : 6, dt)

  // hills: gravity along the car's pitch slows a climb and speeds a descent
  vehicle.speed += 9.8 * Math.sin(vehicle.groundPitch) * dt * 0.55

  // drag and rolling resistance; grass and dirt hold a road car back
  const sign = Math.sign(vehicle.speed)
  const soft = vehicle.surface === 0 ? 1 : vehicle.surface === 1 ? 2.2 : 1.8
  vehicle.speed -= sign * (CAR.rollingResistance * soft + Math.abs(vehicle.speed) * CAR.drag * 0.12 * soft) * dt
  if (Math.abs(vehicle.speed) < 0.05) vehicle.speed = 0
  vehicle.speed = MathUtils.clamp(vehicle.speed, -CAR.reverseSpeed, CAR.maxSpeed)

  // ---- heading ---------------------------------------------------------
  // a car only turns while it is rolling, and reverses its steering backwards
  // a handbrake turn swings the tail round: the rear lets go and the car
  // rotates faster than its wheels are pointing, the GTA move
  const slide = vehicle.handbrake && Math.abs(vehicle.speed) > 6 ? 1.9 : 1
  const turn = vehicle.steer * steerRate * slide * dt * Math.min(1, Math.abs(vehicle.speed) / 3) * Math.sign(vehicle.speed || 1)
  vehicle.yaw -= turn

  // ---- translate -------------------------------------------------------
  if (vehicle.speed !== 0) {
    const step = vehicle.speed * dt
    const nx = vehicle.pos.x + Math.sin(vehicle.yaw) * step
    const nz = vehicle.pos.z + Math.cos(vehicle.yaw) * step
    const fixed = resolveCollisions(nx, nz, CAR.bodyRadius, carCollider)
    const moved = Math.hypot(fixed.x - vehicle.pos.x, fixed.z - vehicle.pos.z)
    if (moved < Math.abs(step) * 0.4) vehicle.speed *= 0.35   // clipped something
    vehicle.pos.x = fixed.x
    vehicle.pos.z = fixed.z
  }
  vehicle.surface = surfaceAt(vehicle.pos.x, vehicle.pos.z)
  settleOnGround(dt)

  // ---- body attitude ---------------------------------------------------
  const lateral = vehicle.steer * speedFrac
  vehicle.roll = MathUtils.damp(vehicle.roll, -lateral * (slide > 1 ? 0.11 : 0.07), 5, dt)
  const accelNow = throttle > 0 ? 1 : throttle < 0 ? -1 : 0
  // squat under power lifts the nose (negative pitch), braking dives it
  vehicle.pitch = MathUtils.damp(vehicle.pitch, -accelNow * 0.035 * (1 - speedFrac * 0.5), 4, dt)
  // off the tarmac the body shimmies over the ruts
  if (vehicle.surface !== 0 && Math.abs(vehicle.speed) > 1) {
    const t = performance.now() / 1000
    const amp = Math.min(1, Math.abs(vehicle.speed) / 12) * 0.006
    vehicle.roll += Math.sin(t * 23.0) * amp
    vehicle.pitch += Math.sin(t * 17.0 + 1.3) * amp * 0.7
  }
  vehicle.wheelSpin += (vehicle.speed / CAR.wheelRadius) * dt

  // keep the occupant with the car
  if (vehicle.occupied) {
    player.pos.set(vehicle.pos.x, vehicle.pos.y, vehicle.pos.z)
    player.yaw = vehicle.yaw
    player.speed = Math.abs(vehicle.speed)
  }
  return vehicle
}

/**
 * What the ground is at a point: 0 tarmac (the road and bridge), 1 grass,
 * 2 dirt / forest floor. Tyre tracks and handling both read it.
 */
export function surfaceAt(x: number, z: number) {
  if (pathDistance(x, z) < PATH_HALF_WIDTH + 1.4) return 0
  const fd = forestDensity(x, z)
  if (fd > 0.42) return 2
  const patch = (Math.sin(x * 0.035) + Math.cos(z * 0.041) + Math.sin((x + z) * 0.017)) / 3
  return patch * 0.55 - 0.05 > 0.35 ? 2 : 1
}
