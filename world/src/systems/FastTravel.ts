import { Vector3 } from 'three'
import { player, useStore } from '../state/store'
import { groundHeight, resolveCollisions, waterSurfaceAt } from '../lib/terrain'
import { placeVehicle, vehicle } from './VehicleController'
import { cue } from '../lib/audio'

/**
 * Travel by the map, the way GTA V switches characters: the camera lifts
 * straight up out of the world into the sky, glides across the valley high
 * enough to see it laid out below, and drops back down behind Coach Blue at
 * the other end. He is moved while the camera is up where you cannot see it.
 * Driving, the car comes with him.
 */
export const travel = {
  active: false,
  t: 0,
  from: new Vector3(),
  to: new Vector3(),
  label: '',
  moved: false,
  yaw: 0,
}

const RISE = 1.0, GLIDE = 1.5, DROP = 1.1
export const TRAVEL_TIME = RISE + GLIDE + DROP
export const HIGH = 140

/** Nearest dry, open ground to a point: never into a lake, a wall or a tree. */
function landing(x: number, z: number) {
  for (let r = 0; r < 40; r += 1.5) {
    for (let a = 0; a < Math.PI * 2; a += r === 0 ? 7 : 0.5) {
      const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r
      if (waterSurfaceAt(px, pz) !== null) continue
      const c = resolveCollisions(px, pz, 0.6)
      if (Math.hypot(c.x - px, c.z - pz) > 0.05) continue
      return new Vector3(px, groundHeight(px, pz), pz)
    }
  }
  return new Vector3(x, groundHeight(x, z), z)
}

export function travelTo(x: number, z: number, label: string) {
  if (travel.active) return
  travel.active = true
  travel.t = 0
  travel.moved = false
  travel.label = label
  travel.from.copy(player.pos)
  travel.to.copy(landing(x, z))
  // arrive facing on the way you were heading
  travel.yaw = Math.atan2(travel.to.x - travel.from.x, travel.to.z - travel.from.z)
  player.frozen = true
  cue('interact')
  useStore.getState().showToast('TRAVELLING', label)
}

const ease = (x: number) => { const c = Math.min(1, Math.max(0, x)); return c < 0.5 ? 2 * c * c : 1 - (-2 * c + 2) ** 2 / 2 }

/**
 * Where the camera is and looks during travel (writes into pos/look).
 * Returns false once travel is over.
 */
export function stepTravel(dt: number, pos: Vector3, look: Vector3) {
  if (!travel.active) return false
  travel.t += dt
  const t = travel.t
  const a = travel.from, b = travel.to
  // behind the player, where the follow camera will want to be
  const behind = (p: Vector3, out: Vector3) =>
    out.set(p.x - Math.sin(travel.yaw) * 4.6, p.y + 2.2, p.z - Math.cos(travel.yaw) * 4.6)
  if (t < RISE) {
    const k = ease(t / RISE)
    behind(a, pos)
    pos.y += (a.y + HIGH - pos.y) * k
    look.set(a.x + Math.sin(travel.yaw) * 20 * k, a.y + 1.2 - 30 * k, a.z + Math.cos(travel.yaw) * 20 * k)
  } else if (t < RISE + GLIDE) {
    const k = ease((t - RISE) / GLIDE)
    pos.lerpVectors(a, b, k)
    pos.y = Math.max(a.y, b.y) + HIGH + Math.sin(k * Math.PI) * 25
    look.lerpVectors(a, b, Math.min(1, k + 0.18)).setY(pos.y - HIGH - 30)
    // move him while nobody can see it
    if (k > 0.5 && !travel.moved) {
      travel.moved = true
      if (vehicle.occupied) {
        placeVehicle(b.x, b.z, travel.yaw)
      } else {
        player.pos.copy(b)
        player.yaw = travel.yaw
        player.camYaw = travel.yaw + Math.PI
      }
      cue('discover')
    }
  } else if (t < TRAVEL_TIME) {
    const k = ease((t - RISE - GLIDE) / DROP)
    const land = vehicle.occupied ? vehicle.pos : player.pos
    behind(land, pos)
    pos.y = land.y + 2.2 + (HIGH * (1 - k))
    look.set(land.x, land.y + 1.3 - 30 * (1 - k), land.z)
  } else {
    travel.active = false
    player.frozen = false
    return false
  }
  return true
}
