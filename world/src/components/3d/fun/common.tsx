import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { Color, MeshStandardMaterial, Object3D, Vector3 } from 'three'
import { baseGround, groundHeight } from '../../../lib/terrain'
import { locationById } from '../../../data/journey'
import { exerciseById } from '../../../data/exercises'
import { startWorkout, workout, type Station } from '../../../systems/Workout'
import { stepPhysics } from '../../../systems/Physics'
import { registerInteractable } from '../InteractionSystem'
import { scannedTexture } from '../../../lib/materials'

/** The Fun Park's own frame: park-local metres, x east, z south. */
export const PARK = locationById.funpark.pos
export const pw = (lx: number, lz: number): [number, number] => [PARK[0] + lx, PARK[1] + lz]
/** The park's ground (never the top of a deck or floor raised on it). */
export const ph = (lx: number, lz: number) => baseGround(PARK[0] + lx, PARK[1] + lz)
/** Facing towards a park-local point from another. */
export const face = (fx: number, fz: number, tx: number, tz: number) => Math.atan2(tx - fx, tz - fz)

/** Shared materials for everything in the park (one set, many props). */
export function useParkMaterials() {
  return useMemo(() => {
    const m = (color: string, rough = 0.6, metal = 0) => new MeshStandardMaterial({ color, roughness: rough, metalness: metal })
    const timber = new MeshStandardMaterial({
      map: scannedTexture('timber_diff', 1, true), normalMap: scannedTexture('timber_nor', 1), roughness: 0.85, color: new Color('#b48a60'),
    })
    return {
      steel: m('#2b3137', 0.45, 0.7), chrome: m('#c9ced4', 0.2, 1), black: m('#141516', 0.7), rubber: m('#18191b', 0.92),
      leather: m('#2a1d18', 0.55), red: m('#c7372f', 0.5), blue: m('#2f6fd6', 0.5), white: m('#efefea', 0.55),
      yellow: m('#f2c14e', 0.5), mint: m('#1de9b6', 0.45), orange: m('#e8742a', 0.55), matGreen: m('#3b7d56', 0.9),
      matBlue: m('#2c4f8c', 0.9), matPurple: m('#6a3f93', 0.9), rope: m('#c8b089', 0.95), net: m('#f4f4f0', 0.8),
      grass: m('#4f8a3a', 0.95), sand: m('#d8c49a', 0.95), cushion: m('#8a2d3b', 0.9), timber,
    }
  }, [])
}
export type ParkMats = ReturnType<typeof useParkMaterials>

/**
 * One activity: a station at a park-local spot, and the prompt that starts
 * it. Returns the station so its props can read and drive it.
 */
export function useStation(opts: {
  id: string; def: string; lx: number; lz: number; yaw: number; label: string
  extra?: Partial<Station>; radius?: number
  /** world x/z instead of park-local (the jetty, the pool), and its floor */
  world?: [number, number]; ground?: number
}) {
  const station = useMemo<Station>(() => {
    const [x, z] = opts.world ?? pw(opts.lx, opts.lz)
    return { id: opts.id, def: exerciseById[opts.def], spot: [x, z], yaw: opts.yaw, ground: opts.ground ?? groundHeight(x, z), ...opts.extra }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.id])
  useEffect(() => {
    const [x, z] = station.spot
    // the prompt stands a step in front of where he will stand
    const px = x - Math.sin(station.yaw) * 0.6, pz = z - Math.cos(station.yaw) * 0.6
    return registerInteractable({
      id: opts.id, label: opts.label, verb: 'START',
      position: new Vector3(px, station.ground + 1.1, pz), radius: opts.radius ?? 2.2, panel: null,
      action: () => startWorkout(station),
    })
  }, [station, opts.id, opts.label, opts.radius])
  return station
}

/** Is the player on this station right now (and not stepping off)? */
export const onStation = (id: string) => workout.station?.id === id && workout.enter > 0.9 && !workout.leaving

const _up = new Vector3(0, 1, 0)
const _d = new Vector3()
/** Lay a unit-tall cylinder (or anything along +y) from `a` to `b`. */
export function stretch(o: Object3D, a: Vector3, b: Vector3) {
  _d.subVectors(b, a)
  const len = _d.length()
  o.position.addVectors(a, b).multiplyScalar(0.5)
  if (len > 1e-5) o.quaternion.setFromUnitVectors(_up, _d.divideScalar(len))
  o.scale.set(1, Math.max(1e-4, len), 1)
}

/** Steps every thrown, kicked and knocked-over thing in the world. */
export function PhysicsWorld() {
  useFrame((_, dt) => stepPhysics(dt))
  return null
}
