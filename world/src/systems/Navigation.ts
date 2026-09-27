import { locationById, type LocationId } from '../data/journey'
import { pathSamples } from '../lib/terrain'
import { player } from '../state/store'

/**
 * Where the player is headed, and how far it is.
 *
 * Guidance here is deliberately quiet. No arrow hangs in the air and no line
 * is painted across the grass: the world already has a road, and a road that
 * goes somewhere is better direction than a marker that tells you where to
 * look. What this provides is the name of the place, the distance to it, and
 * the bearing — enough for a compass strip and a route on the map, and no
 * more.
 *
 * Choosing a destination never constrains movement. Wander off and the
 * distance simply grows.
 */
export const nav = {
  destination: null as LocationId | null,
  /** metres, straight line */
  distance: 0,
  /** world yaw from the player towards the destination */
  bearing: 0,
}

type Listener = () => void
const listeners = new Set<Listener>()
export function onNavChange(fn: Listener) {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

export function setDestination(id: LocationId | null) {
  nav.destination = id
  update()
  listeners.forEach((fn) => fn())
}

export function clearDestination() {
  setDestination(null)
}

/** Recompute distance and bearing. Cheap enough to call every frame. */
export function update() {
  const id = nav.destination
  if (!id) {
    nav.distance = 0
    return
  }
  const [x, z] = locationById[id].pos
  const dx = x - player.pos.x
  const dz = z - player.pos.z
  nav.distance = Math.hypot(dx, dz)
  nav.bearing = Math.atan2(dx, dz)
  // close enough to have arrived: stop nagging
  if (nav.distance < locationById[id].discoverRadius * 0.8) {
    nav.destination = null
    nav.distance = 0
    listeners.forEach((fn) => fn())
  }
}

/**
 * A route along the road rather than straight through the trees. The trail
 * already threads every location, so the useful route is the stretch of it
 * between where you are and where you are going.
 */
export function routeTo(id: LocationId) {
  const [tx, tz] = locationById[id].pos
  const nearest = (x: number, z: number) => {
    let best = Infinity
    let at = 0
    for (let i = 0; i < pathSamples.length; i++) {
      const s = pathSamples[i]
      const d = (s.x - x) ** 2 + (s.z - z) ** 2
      if (d < best) { best = d; at = i }
    }
    return at
  }
  const from = nearest(player.pos.x, player.pos.z)
  const to = nearest(tx, tz)
  const step = from <= to ? 1 : -1
  const out: { x: number; z: number }[] = []
  for (let i = from; step > 0 ? i <= to : i >= to; i += step) out.push(pathSamples[i])
  return out
}

/** "350 m" or "1.2 km", the way a sign would put it. */
export function formatDistance(m: number) {
  if (m >= 1000) return `${(m / 1000).toFixed(1)} km`
  return `${Math.round(m / 5) * 5} m`
}
