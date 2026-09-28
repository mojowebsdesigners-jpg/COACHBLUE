import { GYM, LAKE, POOL, lakeRadius, pathSamples } from '../lib/terrain'
import { locationById } from '../data/journey'
import { bootCampPoints } from '../components/3d/BootCamp'
import { benchSpots } from '../components/3d/Seats'
import { registerMapPoint } from './MapPoints'

/**
 * The places the map always shows, registered once at start-up from their
 * own coordinates (areas load and unload as you move; the map must not).
 */
export function registerMapPlaces() {
  registerMapPoint({ id: 'gym', name: 'The Training Floor', kind: 'gym', x: GYM.cx, z: GYM.cz, blurb: 'Bench, squat, pull-ups, treadmill' })
  registerMapPoint({ id: 'pool', name: 'The Pool', kind: 'water', x: POOL.x, z: POOL.z, blurb: 'Swim laps, lie on a lounger' })
  registerMapPoint({ id: 'lake', name: 'The Lake', kind: 'water', x: LAKE.x, z: LAKE.z, blurb: 'Dive eight metres down among the fish' })
  const a = 2.6, r = lakeRadius(a) + 6
  registerMapPoint({ id: 'jetty', name: 'The Jetty', kind: 'rest', x: LAKE.x + Math.cos(a) * r, z: LAKE.z + Math.sin(a) * r, blurb: 'Sit with your feet over the water' })
  const [ex, ez] = locationById.entrance.pos
  registerMapPoint({ id: 'letters', name: 'COACH BLUE Letters', kind: 'fun', x: ex - 9, z: ez - 4, blurb: 'Drive straight through them' })
  for (const p of bootCampPoints()) registerMapPoint({ ...p, kind: 'sport' })
  benchSpots().slice(0, 4).forEach((b, i) => registerMapPoint({ id: `bench-${i}`, name: 'A Quiet Bench', kind: 'rest', x: b.x, z: b.z, blurb: 'Sit and take in the view' }))
  // the woods, where the mushrooms grow
  let fx = 0, fz = 0
  const s = pathSamples[Math.floor(pathSamples.length * 0.45)]
  fx = s.x + 26; fz = s.z
  registerMapPoint({ id: 'forage', name: 'The Woods', kind: 'food', x: fx, z: fz, blurb: 'Pick wild mushrooms' })
}
