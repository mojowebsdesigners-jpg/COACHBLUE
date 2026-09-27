import { MathUtils } from 'three'
import { input } from '../lib/input'
import {
  PATH_HALF_WIDTH, bridge, groundHeight, pathDistance, resolveCollisions, waterDepthAt, waterSurfaceAt,
} from '../lib/terrain'
import { SWIM } from './Swim'
import { CROSS, carry, startPress } from './Carry'
import { player, useStore } from '../state/store'

/**
 * Third-person character movement, relative to the camera.
 *
 * The stick — WASD or the arrows — describes a direction on the ground as the
 * camera sees it: forward is away from the camera, right is the camera's
 * right. The character then turns towards that direction and always walks
 * along its own facing, so it never slides sideways or moonwalks. Turning is
 * damped rather than snapped, which is what separates a character from a
 * capsule with a mesh on it.
 *
 * Pressing back does not reverse: the character turns around and walks, the
 * way a person does.
 */
export const MOVE = {
  walk: 1.9,
  run: 4.4,
  sprint: 7.2,
  accel: 9,
  friction: 9,
  /** how fast the body swings onto a new heading, radians/sec */
  turn: 11,
  turnAtSpeed: 6.5,
  gravity: 20,
  jump: 6.4,
  radius: 0.42,
}

export type MoveState = {
  speed: number        // ground speed, always forward along the facing
  turning: number      // -1..1, for lean; signed by which way the body swung
  airborne: boolean
  justLanded: boolean
  justJumped: boolean
  surface: 'grass' | 'dirt' | 'wood' | 'stone' | 'asphalt' | 'rubber' | 'water'
  swimming: boolean
}

const state: MoveState = {
  speed: 0,
  turning: 0,
  airborne: false,
  justLanded: false,
  justJumped: false,
  surface: 'grass',
  swimming: false,
}

let vy = 0

/** Shortest signed angle from a to b. */
function angleDelta(a: number, b: number) {
  let d = (b - a) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d < -Math.PI) d += Math.PI * 2
  return d
}

let outOfAir = false

export function stepPlayer(dt: number): MoveState {
  state.justLanded = false
  state.justJumped = false

  const frozen = player.frozen
  const fx = frozen ? 0 : input.forward     // +1 W / up, -1 S / down
  const sx = frozen ? 0 : input.strafe      // +1 D / right, -1 A / left

  // ---- what the stick is asking for, in world terms --------------------
  // Clamped rather than normalised: holding two keys must not be faster than
  // one, but easing off must still ease off.
  const push = Math.min(1, Math.hypot(fx, sx))
  let wantYaw = player.yaw

  if (push > 0.001) {
    // camYaw points from the character out to the camera, so the direction the
    // camera looks is that turned through half a circle.
    const camForward = player.camYaw + Math.PI
    // A yaw of t points along (sin t, cos t), which makes the right-hand side
    // of a facing t - PI/2, not t + PI/2. Turning right therefore subtracts.
    wantYaw = camForward - Math.atan2(sx, fx)
  }

  // ---- turn the body onto that heading ---------------------------------
  const speedFrac = Math.min(1, state.speed / MOVE.sprint)
  const turnRate = MathUtils.lerp(MOVE.turn, MOVE.turnAtSpeed, speedFrac)
  let swung = 0
  if (push > 0.001) {
    const delta = angleDelta(player.yaw, wantYaw)
    swung = MathUtils.clamp(delta, -turnRate * dt, turnRate * dt)
    player.yaw += swung
  }
  // lean reads off how hard the body is actually turning, not off the key
  state.turning = MathUtils.damp(state.turning, MathUtils.clamp(swung / (turnRate * dt || 1), -1, 1), 9, dt)

  // ---- speed -----------------------------------------------------------
  const wantsSprint = input.run && push > 0.1
  // in the water the pace is a swimmer's; wading through the shallows is
  // slower than walking, and the deeper it is the slower
  const wade = player.swimming ? 0 : waterDepthAt(player.pos.x, player.pos.z)
  const load = carry.active ? CROSS.carrySpeed : 1
  const top = player.swimming
    ? (wantsSprint ? SWIM.sprint : SWIM.speed) * push
    : (wantsSprint ? MOVE.sprint : MOVE.walk + (MOVE.run - MOVE.walk) * 0.55) * push *
      (wade > 0.2 ? Math.max(0.35, 1 - wade * 0.55) : 1) * load
  if (push > 0.001) {
    // a body does not accelerate at full tilt while it is still turning round
    const facing = Math.max(0, Math.cos(angleDelta(player.yaw, wantYaw)))
    state.speed = MathUtils.damp(state.speed, top * (0.35 + 0.65 * facing), MOVE.accel, dt)
  } else {
    state.speed = MathUtils.damp(state.speed, 0, MOVE.friction, dt)
    if (state.speed < 0.02) state.speed = 0
  }

  // ---- translate along the facing --------------------------------------
  if (state.speed !== 0) {
    const step = state.speed * dt
    const nx = player.pos.x + Math.sin(player.yaw) * step
    const nz = player.pos.z + Math.cos(player.yaw) * step
    const fixed = resolveCollisions(nx, nz, MOVE.radius)
    // running into something bleeds speed off instead of stopping dead
    const moved = Math.hypot(fixed.x - player.pos.x, fixed.z - player.pos.z)
    if (moved < step * 0.35) state.speed *= 0.6
    player.pos.x = fixed.x
    player.pos.z = fixed.z
  }

  // ---- water -----------------------------------------------------------
  const surface = waterSurfaceAt(player.pos.x, player.pos.z)
  const ground = groundHeight(player.pos.x, player.pos.z)
  const depth = surface === null ? 0 : surface - ground
  if (player.swimming ? depth > SWIM.leaveDepth : depth > SWIM.enterDepth && player.pos.y < surface! + 0.3) {
    player.swimming = true
    player.waterSurface = surface!
    player.grounded = true
    vy = 0
    input.jump = false
    // Diving: C (or Ctrl) takes him down, Space brings him up, and left to
    // himself he drifts slowly back to the surface. He cannot go deeper than
    // a body's length off the bottom, and he has one breath: stay down too
    // long and he has to come up for air.
    const maxDive = Math.max(0, depth - 1.1)
    let want = -0.35                                   // buoyancy
    if (!frozen && input.diveHeld) want = 1.3
    else if (!frozen && input.actionHeld) want = -1.7
    if (player.breath <= 0) want = -2.2
    player.diveVel = MathUtils.damp(player.diveVel, want, 4, dt)
    player.dive = MathUtils.clamp(player.dive + player.diveVel * dt, 0, maxDive)
    if (player.dive <= 0 || player.dive >= maxDive) player.diveVel *= 0.5
    const under = player.dive > 0.9
    if (under) {
      player.breath = Math.max(0, player.breath - dt / 45)
      if (player.breath === 0 && !outOfAir) {
        outOfAir = true
        useStore.getState().showToast('OUT OF AIR', 'Back to the surface')
      }
    } else {
      player.breath = Math.min(1, player.breath + dt / 3.5)
      if (player.breath > 0.3) outOfAir = false
    }
    // treading water when still at the surface; underwater, always swimming
    player.swimBlend = MathUtils.damp(player.swimBlend, state.speed > 0.35 || player.dive > 0.6 ? 1 : 0, 2.5, dt)
    player.pos.y = surface! - player.dive
    state.airborne = false
    state.surface = 'water'
    state.swimming = true
    player.speed = state.speed
    player.surface = 'water'
    return state
  }
  player.swimming = false
  player.swimBlend = 0
  player.dive = 0
  player.diveVel = 0
  player.breath = 1
  state.swimming = false

  // ---- gravity and jumping ---------------------------------------------
  // under the cross, Space is a press rep, not a jump
  if (!frozen && input.jump && carry.active) {
    startPress()
    input.jump = false
  }
  if (!frozen && input.jump && player.grounded) {
    vy = MOVE.jump
    player.grounded = false
    state.justJumped = true
  }
  input.jump = false

  vy -= MOVE.gravity * dt
  player.pos.y += vy * dt
  if (player.pos.y <= ground) {
    if (!player.grounded) state.justLanded = true
    player.pos.y = ground
    vy = 0
    player.grounded = true
  }
  state.airborne = !player.grounded

  // ---- what's underfoot --------------------------------------------------
  state.surface = surfaceUnder(player.pos.x, player.pos.z)

  player.speed = state.speed
  player.moveDir = 1
  player.surface = state.surface
  return state
}

/** Which material the feet are on, for the footstep sounds. */
export function surfaceUnder(x: number, z: number): MoveState['surface'] {
  const onBridge =
    Math.abs(x - bridge.x) < bridge.width && Math.abs(z - bridge.z) < bridge.length
  if (onBridge) return 'wood'
  if (Math.hypot(x - GYM_FLOOR.x, z - GYM_FLOOR.z) < GYM_FLOOR.r) return 'rubber'
  const pd = pathDistance(x, z)
  if (pd < PATH_HALF_WIDTH + 1.4) return 'asphalt'
  if (waterDepthAt(x, z) > 0.05) return 'water'
  return 'grass'
}

/**
 * The training compound's slab. Registered by the gym at mount rather than
 * hard-coded, so the two cannot drift apart.
 */
const GYM_FLOOR = { x: Infinity, z: Infinity, r: 0 }
export function setGymFloor(x: number, z: number, r: number) {
  GYM_FLOOR.x = x
  GYM_FLOOR.z = z
  GYM_FLOOR.r = r
}

export const moveState = state
