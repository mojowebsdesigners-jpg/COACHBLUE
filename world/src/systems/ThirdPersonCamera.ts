import { MathUtils, Vector3, type PerspectiveCamera } from 'three'
import { input } from '../lib/input'
import { terrainHeight, sweepColliders } from '../lib/terrain'
import { player } from '../state/store'

/**
 * A follow camera that sits behind and slightly above the character, swings
 * round as the character turns, leads the view when running, and pulls itself
 * in rather than clipping through anything.
 */
export const CAM = {
  // Close enough that the character stays the subject. Running used to swing
  // the camera out to 7.4 m, which pushed him into the distance exactly when
  // there was most to look at.
  distance: 4.6,
  sprintDistance: 5.3,
  height: 1.88,
  lookHeight: 1.46,
  lookAhead: 0.38,        // metres of lead per m/s of speed
  positionLag: 6,         // damping rate
  rotationLag: 3.4,       // how fast the camera swings back behind the player
  minDistance: 1.6,
  collisionRadius: 0.36,
  maxPitch: 1.05,
  // low enough to look right up a hill, a rope or the sky
  minPitch: -1.2,
}

const desired = new Vector3()
const lookTarget = new Vector3()
const smoothPos = new Vector3()
const smoothLook = new Vector3()
const ray = new Vector3()

// The camera's own heading, in world space. It used to be an offset from the
// character's yaw, which cannot work once the stick is read relative to the
// camera: the character turns to match the camera, the camera swings to match
// the character, and holding left walks you in circles. The camera owns its
// heading; the character reads from it.
let camYaw = Math.PI
let started = false

export function resetCamera() {
  started = false
  camYaw = player.yaw + Math.PI
}

export type CameraMode = 'third' | 'first' | 'photo' | 'cinematic'

export function stepCamera(
  camera: PerspectiveCamera,
  dt: number,
  mode: CameraMode,
  override?: { pos: Vector3; target: Vector3; ease: number },
  reducedMotion = false,
) {
  // ---- input ----------------------------------------------------------
  camYaw -= input.lookDX
  player.camPitch = MathUtils.clamp(player.camPitch + input.lookDY, CAM.minPitch, CAM.maxPitch)
  input.lookDX = 0
  input.lookDY = 0
  const zoomMax = mode === 'photo' ? 40 : player.camDistMax
  player.camDist = MathUtils.clamp(player.camDist + input.zoom, mode === 'photo' ? 1.2 : 2.6, zoomMax)
  input.zoom = 0

  const speed = player.speed
  const moving = speed > 0.4 && player.moveDir > 0

  if (mode === 'first') {
    const yaw = player.yaw
    desired.set(player.pos.x - Math.sin(yaw) * 0.08, player.pos.y + 1.67, player.pos.z - Math.cos(yaw) * 0.08)
    lookTarget.set(
      desired.x + Math.sin(yaw) * 6,
      desired.y - Math.sin(player.camPitch) * 6,
      desired.z + Math.cos(yaw) * 6,
    )
    camYaw = player.yaw + Math.PI
  } else if (override && mode === 'cinematic') {
    desired.copy(override.pos)
    lookTarget.copy(override.target)
  } else {
    // Ease back behind the character, but only in proportion to how forward
    // the input is. Recentring while the player holds left or right would
    // rotate the very frame the input is measured against, and the character
    // would spiral instead of strafing.
    if (moving) {
      const forwardness = Math.max(0, 1 - Math.abs(input.strafe))
      const rate = CAM.rotationLag * forwardness * (reducedMotion ? 0.6 : 1)
      if (rate > 0.01) {
        let d = (player.yaw + Math.PI - camYaw) % (Math.PI * 2)
        if (d > Math.PI) d -= Math.PI * 2
        if (d < -Math.PI) d += Math.PI * 2
        camYaw += d * (1 - Math.exp(-rate * dt))
      }
    }
    const yaw = camYaw
    player.camYaw = yaw

    const sprintT = MathUtils.clamp((speed - 4.4) / 2.8, 0, 1)
    const dist = MathUtils.lerp(
      Math.min(player.camDist, CAM.distance),
      Math.min(player.camDist + 0.7, CAM.sprintDistance),
      sprintT,
    )
    const pitch = player.camPitch
    const cos = Math.cos(pitch)

    desired.set(
      player.pos.x + Math.sin(yaw) * dist * cos,
      player.pos.y + CAM.height + Math.sin(pitch) * dist,
      player.pos.z + Math.cos(yaw) * dist * cos,
    )

    // look slightly ahead of the character when they're moving
    const lead = moving ? Math.min(speed * CAM.lookAhead, 4) : 0
    // Looking up: as the camera drops below him, the aim point rises above
    // his head, so the view tilts up the hill (or the rope, or into the sky)
    // instead of staring at his back
    // (never so far that he leaves the bottom of the frame)
    const up = Math.max(0, -pitch)
    lookTarget.set(
      player.pos.x + Math.sin(player.yaw) * lead,
      player.pos.y + CAM.lookHeight + sprintT * 0.15 + Math.min(1.1, up * up * 2.2),
      player.pos.z + Math.cos(player.yaw) * lead,
    )

    // ---- keep it out of the scenery -----------------------------------
    // looking up puts the camera low: let it rest just above the ground
    // behind him (the way a game camera skims the grass) rather than sink
    desired.y = Math.max(desired.y, terrainHeight(desired.x, desired.z) + 0.45)
    // terrain first. If the hillside comes between the camera and him, the
    // camera rises over it (a crane, not a dive into the slope); only if that
    // is not enough does it come in closer along its line.
    const chestY = player.pos.y + 1.25
    const blocked = () => {
      for (let i = 1; i <= 8; i++) {
        const k = i / 9
        const sx = MathUtils.lerp(player.pos.x, desired.x, k)
        const sz = MathUtils.lerp(player.pos.z, desired.z, k)
        const sy = MathUtils.lerp(chestY, desired.y, k)
        if (sy < terrainHeight(sx, sz) + 0.3) return k
      }
      return 0
    }
    for (let i = 0; i < 12 && blocked(); i++) desired.y += 0.25
    const k = blocked()
    if (k) desired.lerpVectors(lookTarget, desired, Math.max(CAM.minDistance / Math.max(dist, 0.01), k - 0.1))
    desired.y = Math.max(desired.y, terrainHeight(desired.x, desired.z) + 0.6)
    // then solid objects: pull the camera in along its own line
    ray.copy(desired).sub(lookTarget)
    const full = ray.length()
    if (full > 0.001) {
      const hit = sweepColliders(lookTarget, ray.normalize(), full, CAM.collisionRadius)
      if (hit < full) {
        const pulled = Math.max(CAM.minDistance, hit - 0.15)
        desired.copy(lookTarget).addScaledVector(ray, pulled)
        desired.y = Math.max(desired.y, terrainHeight(desired.x, desired.z) + 0.5)
      }
    }
  }

  // ---- never inside him ------------------------------------------------
  // whatever pulled the camera in, it stays a body-width clear of him, so he
  // is always in front of it and never clipped away by the near plane
  if (mode === 'third') {
    const dx = desired.x - player.pos.x, dz = desired.z - player.pos.z
    const hd = Math.hypot(dx, dz)
    const MIN = 1.1
    if (hd < MIN && desired.y < player.pos.y + 2.1) {
      if (hd > 1e-3) { desired.x = player.pos.x + (dx / hd) * MIN; desired.z = player.pos.z + (dz / hd) * MIN }
      else { desired.x = player.pos.x + Math.sin(camYaw) * MIN; desired.z = player.pos.z + Math.cos(camYaw) * MIN }
      desired.y = Math.max(desired.y, player.pos.y + 1.9)
    }
  }

  // ---- smoothing -------------------------------------------------------
  if (!started) {
    smoothPos.copy(desired)
    smoothLook.copy(lookTarget)
    started = true
  }
  let posLag = mode === 'first' ? 26 : mode === 'photo' ? 12 : CAM.positionLag
  let lookLag = mode === 'first' ? 26 : mode === 'photo' ? 12 : CAM.positionLag * 1.5
  if (override && mode === 'cinematic') {
    posLag = override.ease
    lookLag = override.ease
  }
  if (reducedMotion) {
    posLag *= 1.8
    lookLag *= 1.8
  }

  smoothPos.x = MathUtils.damp(smoothPos.x, desired.x, posLag, dt)
  smoothPos.y = MathUtils.damp(smoothPos.y, desired.y, posLag, dt)
  smoothPos.z = MathUtils.damp(smoothPos.z, desired.z, posLag, dt)
  smoothLook.x = MathUtils.damp(smoothLook.x, lookTarget.x, lookLag, dt)
  smoothLook.y = MathUtils.damp(smoothLook.y, lookTarget.y, lookLag, dt)
  smoothLook.z = MathUtils.damp(smoothLook.z, lookTarget.z, lookLag, dt)

  camera.position.copy(smoothPos)
  camera.lookAt(smoothLook)

  // a touch more field of view at sprint, so speed reads
  const targetFov = mode === 'first' ? 68 : 58 + MathUtils.clamp((speed - 4.4) / 2.8, 0, 1) * 6
  camera.fov = MathUtils.damp(camera.fov, targetFov, 4, dt)
  camera.updateProjectionMatrix()
}
