import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import { Group, Mesh, MeshStandardMaterial, Object3D, Quaternion, SpotLight, Vector3 } from 'three'
import { useDay } from './Lighting'
import { player, useStore } from '../../state/store'
import { registerInteractable } from './InteractionSystem'
import { CAR, arrival, placeVehicle, stepVehicle, vehicle } from '../../systems/VehicleController'
import { input } from '../../lib/input'
import { GlowRing } from './Props'
import { SeatedDriver, type CarMarkers } from './Driver'
import { door, isBoarding, startBoarding } from '../../systems/Boarding'
import { engineOff, engineRunning, engineStep, ignition } from '../../lib/engineSound'
import { locationById } from '../../data/journey'
import { groundHeight } from '../../lib/terrain'

const MAX_STEER = 0.52          // radians at the front wheels, full lock
const WHEEL_TURNS = 2.4         // steering wheel rotation at full lock, radians

type Wheel = { pivot: Object3D; spin: Object3D; front: boolean; restY: number }

/**
 * The Coach Blue GT, built in Blender by tools/car (see README).
 *
 * The model arrives at real scale, nose down +Z, origin on the ground between
 * the axles, with the parts the game drives kept as named nodes: four wheel
 * pivots with spinning halves, the steering wheel and its grip points, and
 * markers for the seat, the pedals, the driver's door and the lamps.
 */
export function Vehicle() {
  const { scene } = useGLTF('/models/car.glb')
  const body = useRef<Group>(null)
  const headL = useRef<SpotLight>(null)
  const headR = useRef<SpotLight>(null)
  const [inCar, setInCar] = useState(false)
  const day = useDay()
  const setToast = useStore((s) => s.showToast)

  const rig = useMemo(() => {
    const model = scene.clone(true)
    const faded: { mat: MeshStandardMaterial; transparent: boolean; opacity: number }[] = []
    const byName: Record<string, MeshStandardMaterial> = {}
    model.traverse((o) => {
      const m = o as Mesh
      if (!m.isMesh) return
      m.castShadow = true
      m.receiveShadow = true
      const mats = (Array.isArray(m.material) ? m.material : [m.material]) as MeshStandardMaterial[]
      for (const mat of mats) {
        if (byName[mat.name]) continue
        byName[mat.name] = mat
        // car paint and chrome want the sky in them
        mat.envMapIntensity = mat.name === 'CB_CarPaint' ? 1.5 : 1.1
        faded.push({ mat, transparent: mat.transparent, opacity: mat.opacity })
      }
    })
    const get = (n: string) => model.getObjectByName(n) as Object3D
    const wheels: Wheel[] = (['FL', 'FR', 'RL', 'RR'] as const).map((k) => ({
      pivot: get(`Wheel_${k}`), spin: get(`Wheel_${k}_Spin`), front: k[0] === 'F',
      restY: get(`Wheel_${k}`).position.y,
    }))
    const steering = get('SteeringWheel')
    const markers: CarMarkers = {
      seat: get('Seat_Driver'), gripL: get('Grip_L'), gripR: get('Grip_R'), pedals: get('Pedals'),
    }
    const lamp = (n: string) => get(n).position.clone()
    return {
      model, wheels, steering, steeringRest: steering.quaternion.clone(), markers, faded,
      door: get('Door_Driver'),
      hinge: model.getObjectByName('DoorHinge_L') ?? null,
      tail: byName.CB_CarTail, led: byName.CB_CarLED, drl: byName.CB_CarDRL,
      headAt: [lamp('Lamp_Head_L'), lamp('Lamp_Head_R')] as const,
    }
  }, [scene])

  // Park it by the road at the entrance, where the player starts, so the first
  // car is something you walk past rather than something you have to hunt for.
  useEffect(() => {
    const [ex, ez] = locationById.entrance.pos
    placeVehicle(ex + 9, ez - 6, Math.PI)
  }, [])

  // The prompt follows the car, so a summoned car is always enterable.
  const promptAt = useRef(new Vector3())

  useEffect(() => {
    promptAt.current.set(vehicle.pos.x, vehicle.pos.y + 1.2, vehicle.pos.z)
    return registerInteractable({
      id: 'suv',
      label: inCar ? 'EXIT CAR' : 'ENTER CAR',
      verb: 'ENTER',
      position: promptAt.current,
      // while driving it must stay reachable wherever the car has got to
      radius: inCar ? 200 : 6,
      panel: null,
      action: () => {
        if (isBoarding()) return
        if (!inCar) {
          startBoarding('in', vehicle.pos, vehicle.yaw, () => {
            vehicle.occupied = true
            setInCar(true)
            resetChase()
            // the door swings shut behind him; then the key
            window.setTimeout(() => { door.target = 0 }, 250)
            window.setTimeout(() => ignition(), 700)
            setToast('ENGINE ON', 'W accelerate · S brake / reverse · A/D steer · Space handbrake · E exit')
          })
        } else {
          if (Math.abs(vehicle.speed) > 2) {
            setToast('SLOW DOWN FIRST', 'Brake to a stop, then E to get out')
            return
          }
          vehicle.speed = 0
          engineOff()
          // the door opens, then he climbs out past it
          door.target = 1
          window.setTimeout(() => {
            vehicle.occupied = false
            setInCar(false)
            startBoarding('out', vehicle.pos, vehicle.yaw, () => {})
          }, 500)
        }
      },
      focus: { dist: 7, height: 2.4 },
    })
  }, [inCar, setToast, rig])

  const _q = useMemo(() => new Quaternion(), [])
  const _axis = useMemo(() => new Vector3(0, 1, 0), [])

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05)
    const g = body.current
    if (!g) return

    // the car only drives once the engine has caught
    if (inCar && !player.frozen && engineRunning()) stepVehicle(dt)
    if (inCar) engineStep(dt, vehicle.speed, input.forward)

    // The car does not pop into being: it fades up over a beat and settles.
    if (arrival.t < 1) {
      arrival.t = Math.min(1, arrival.t + dt * 1.6)
      const e = 1 - Math.pow(1 - arrival.t, 3)
      g.scale.setScalar(0.94 + 0.06 * e)
      for (const f of rig.faded) {
        f.mat.transparent = f.transparent || e < 0.995
        f.mat.opacity = f.opacity * e
        f.mat.depthWrite = e > 0.5 || !f.transparent
      }
    }

    g.position.set(vehicle.pos.x, vehicle.pos.y, vehicle.pos.z)
    // the body lies on the plane through its four tyres, plus its own
    // squat, dive and lean on top
    g.rotation.set(vehicle.groundPitch + vehicle.pitch, vehicle.yaw, vehicle.groundRoll + vehicle.roll, 'YXZ')
    promptAt.current.set(vehicle.pos.x, vehicle.pos.y + 1.2, vehicle.pos.z)

    // the driver's door swings on its hinge towards where it is wanted
    if (rig.hinge) {
      const want = -1.05 * door.target
      rig.hinge.rotation.y += (want - rig.hinge.rotation.y) * Math.min(1, dt * (door.target ? 5 : 7))
    }

    // wheels roll with the road and the fronts steer; turning right is a
    // negative yaw in this world, so the pivots turn the same way
    const lock = -vehicle.steer * MAX_STEER
    rig.wheels.forEach((w, i) => {
      w.spin.rotation.x = vehicle.wheelSpin
      w.pivot.rotation.y = w.front ? lock : 0
      // each wheel rides its own spring down to the ground under it
      w.pivot.position.y = w.restY + vehicle.susp[i]
    })
    // the steering wheel turns about its own column
    _q.setFromAxisAngle(_axis, vehicle.steer * WHEEL_TURNS)
    rig.steering.quaternion.copy(rig.steeringRest).multiply(_q)

    // lamps: running lights always, headlights at night, brake lights under braking
    const night = day.lightsOn || day.night > 0.15
    const braking = inCar && ((input.forward < 0 && vehicle.speed > 0.5) || vehicle.handbrake)
    if (rig.tail) rig.tail.emissiveIntensity = braking ? 6 : night ? 1.6 : 0.5
    if (rig.led) rig.led.emissiveIntensity = night ? 8 : 0.6
    if (rig.drl) rig.drl.emissiveIntensity = 6
    for (const light of [headL.current, headR.current]) {
      if (!light) continue
      light.intensity = night ? 110 : 0
      light.target.position.set(
        vehicle.pos.x + Math.sin(vehicle.yaw) * 26,
        vehicle.pos.y + 0.2,
        vehicle.pos.z + Math.cos(vehicle.yaw) * 26,
      )
      light.target.updateMatrixWorld()
    }
  })

  return (
    <group userData={{ noCollide: true }}>
      <group ref={body}>
        <primitive object={rig.model} />
        {/* the driver rides inside the body group, so he takes the car's yaw,
            roll and pitch, and sits behind its glass */}
        {inCar && <SeatedDriver markers={rig.markers} />}
        {rig.headAt.map((p, i) => (
          <spotLight
            key={i}
            ref={i === 0 ? headL : headR}
            position={p}
            angle={0.5}
            penumbra={0.6}
            distance={60}
            decay={1.3}
            color="#eaf0ff"
            intensity={0}
            castShadow={false}
          />
        ))}
      </group>
      {!inCar && <GlowRing position={[vehicle.pos.x, vehicle.pos.y + 0.05, vehicle.pos.z]} radius={2.8} />}
    </group>
  )
}

export const isDriving = () => vehicle.occupied

/**
 * The chase camera. It owns a heading that swings after the car's rather than
 * a world position that trails it: damping the position meant that at speed
 * the camera fell metres behind and then lunged in whenever the car slowed.
 * Now the distance is steady and only the angle lags, which is what reads as
 * a heavy car turning under you.
 *
 * The mouse swings it round the car (to look at it from the front, say); once
 * the car is moving again the view drifts back behind it.
 */
const chase = { yaw: 0, orbit: 0, pitch: 0.2, idle: 0, started: false }

export function vehicleCameraTarget(out: { pos: Vector3; look: Vector3 }, dt: number, lookDX = 0, lookDY = 0) {
  const speed = Math.abs(vehicle.speed)
  if (!chase.started) {
    chase.yaw = vehicle.yaw
    chase.started = true
  }
  // follow the heading, faster the quicker the car is going; reversing does
  // not swing the camera round to the front
  const rate = 2.2 + Math.min(speed, 20) * 0.12
  let d = vehicle.yaw - chase.yaw
  d = Math.atan2(Math.sin(d), Math.cos(d))
  chase.yaw += d * (1 - Math.exp(-rate * dt))

  if (lookDX !== 0 || lookDY !== 0) {
    chase.orbit -= lookDX
    chase.pitch = Math.min(0.9, Math.max(-0.05, chase.pitch + lookDY))
    chase.idle = 0
  } else {
    chase.idle += dt
    if (chase.idle > 1.2 && speed > 2) {
      const k = 1 - Math.exp(-2.2 * dt)
      chase.orbit = Math.atan2(Math.sin(chase.orbit), Math.cos(chase.orbit)) * (1 - k)
      chase.pitch += (0.2 - chase.pitch) * k
    }
  }

  const yaw = chase.yaw + chase.orbit
  const dist = 5.8 + Math.min(1.4, speed * 0.045)
  const cosP = Math.cos(chase.pitch)
  out.pos.set(
    vehicle.pos.x - Math.sin(yaw) * dist * cosP,
    vehicle.pos.y + 1.1 + Math.sin(chase.pitch) * dist,
    vehicle.pos.z - Math.cos(yaw) * dist * cosP,
  )
  const lead = Math.min(speed * 0.3, 6) * Math.max(0, Math.cos(chase.orbit))
  out.look.set(
    vehicle.pos.x + Math.sin(vehicle.yaw) * lead,
    vehicle.pos.y + 1.05,
    vehicle.pos.z + Math.cos(vehicle.yaw) * lead,
  )
  // Keep the hillside out of the shot by coming in closer to the car, the
  // way a chase camera on a boom does — not by climbing. Lifting the camera
  // over every crest between it and the car threw it straight up into a view
  // from the sky on any real slope.
  const blockedAt = () => {
    for (let i = 1; i <= 8; i++) {
      const k = i / 8
      const x = out.look.x + (out.pos.x - out.look.x) * k
      const z = out.look.z + (out.pos.z - out.look.z) * k
      const y = out.look.y + (out.pos.y - out.look.y) * k
      if (y < groundHeight(x, z) + 0.5) return k
    }
    return 0
  }
  const k = blockedAt()
  // in, but never into the car itself (about four metres behind it)...
  if (k) out.pos.lerpVectors(out.look, out.pos, Math.max(0.72, k - 0.1))
  // ...and if the slope still hides it, up a little at a time
  for (let i = 0; i < 8 && blockedAt(); i++) out.pos.y += 0.25
  // and a little headroom over the ground right under it
  out.pos.y = Math.max(out.pos.y, groundHeight(out.pos.x, out.pos.z) + 0.8)
  return out
}

/** Called on entering the car, so the camera starts behind it. */
export function resetChase() {
  chase.started = false
  chase.orbit = 0
  chase.pitch = 0.2
}

export const _carConsts = CAR

useGLTF.preload('/models/car.glb')
