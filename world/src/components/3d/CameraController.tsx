import { useFrame, useThree } from '@react-three/fiber'
import { Vector3, type PerspectiveCamera } from 'three'
import { player, useStore } from '../../state/store'
import { stepCamera, type CameraMode } from '../../systems/ThirdPersonCamera'
import { vehicle } from '../../systems/VehicleController'
import { input } from '../../lib/input'
import { vehicleCameraTarget } from './Vehicle'

/** Cinematic camera takeover, set by interactions. Not React state — per frame. */
export const cameraOverride = {
  active: false,
  pos: new Vector3(),
  target: new Vector3(),
  ease: 2.2,
}

const driveFrame = { pos: new Vector3(), look: new Vector3() }

export function CameraController() {
  const camera = useThree((s) => s.camera) as PerspectiveCamera
  const view = useStore((s) => s.view)
  const photoMode = useStore((s) => s.photoMode)
  const reduced = useStore((s) => s.settings.reducedMotion)

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05)
    // driving takes over the camera: further back, higher, looking up the road
    if (vehicle.occupied && !photoMode) {
      // the chase camera reads the mouse itself (to orbit the car)
      vehicleCameraTarget(driveFrame, dt, input.lookDX, input.lookDY)
      input.lookDX = 0
      input.lookDY = 0
      cameraOverride.pos.copy(driveFrame.pos)
      cameraOverride.target.copy(driveFrame.look)
      // the chase frame already carries the lag in its heading; this only
      // takes the edge off, so the car stays locked in frame at speed
      cameraOverride.ease = 14
      stepCamera(camera, dt, 'cinematic', cameraOverride, reduced)
      return
    }

    const mode: CameraMode = photoMode
      ? 'photo'
      : cameraOverride.active
        ? 'cinematic'
        : view === 'first'
          ? 'first'
          : 'third'
    stepCamera(camera, dt, mode, cameraOverride.active ? cameraOverride : undefined, reduced)
  }, 2)

  return null
}

/** Frame a point of interest, e.g. while a panel is open. */
export function focusOn(point: Vector3, dist = 4.5, height = 1.9) {
  const dir = new Vector3(player.pos.x - point.x, 0, player.pos.z - point.z)
  if (dir.lengthSq() < 0.01) dir.set(0, 0, 1)
  dir.normalize()
  cameraOverride.pos.set(point.x + dir.x * dist, point.y + height, point.z + dir.z * dist)
  cameraOverride.target.copy(point)
  cameraOverride.ease = 3
  cameraOverride.active = true
}

export function releaseFocus() {
  cameraOverride.active = false
}
