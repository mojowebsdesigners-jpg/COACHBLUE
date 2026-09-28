import { GYM, LAKE, POOL, lakeRadius, pathSamples } from '../lib/terrain'
import { locationById } from '../data/journey'
import { bootCampPoints } from '../components/3d/BootCamp'
import { benchSpots } from '../components/3d/Seats'
import { registerMapPoint } from './MapPoints'
import { jettyFrame } from '../components/3d/LakeScene'

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
  // the fun park, activity by activity
  const [px, pz] = locationById.funpark.pos
  const fun: [string, string, 'fun' | 'sport' | 'rest', number, number, string][] = [
    ['fp-bag', 'Heavy Bag', 'sport', -12, -8, 'Box the bag'], ['fp-rope', 'Skipping Rope', 'sport', -8, -8, 'Skip to the beat'],
    ['fp-floor', 'Mat Work', 'sport', 2, -8.5, 'Jacks, burpees, sit-ups, plank'], ['fp-box', 'Box Jumps', 'sport', 12, -8.7, 'Explode up'],
    ['fp-ropes', 'Battle Ropes', 'sport', -14, 0, 'Make waves'], ['fp-tyre', 'Tyre Flip', 'sport', -7, 0, 'Flip it down the lane'],
    ['fp-hammer', 'Sledgehammer', 'sport', 4, 0, 'Hit the tyre'], ['fp-striker', 'High Striker', 'fun', 9, 0, 'Ring the bell, strongman'],
    ['fp-keepy', 'Keepy-Uppy', 'fun', 14, 0, 'Don’t let it drop'], ['fp-swing', 'Swings', 'fun', -10, -16, 'Pump higher and higher'],
    ['fp-tramp', 'Trampoline', 'fun', -3, -16, 'Bounce, then backflip'], ['fp-dance', 'Dance Floor', 'fun', 4, -15, 'Light it up'],
    ['fp-hula', 'Hula Hoop', 'fun', 16, -5, 'Keep it spinning'], ['fp-yoga', 'Yoga Deck', 'rest', 11, -14, 'Flow, then sit and breathe'],
    ['fp-hoop', 'Basketball', 'sport', -12, 11, 'Free throws'], ['fp-pen', 'Penalty Spot', 'sport', -3, 13, 'Beat the net'],
    ['fp-golf', 'Mini Golf', 'fun', 7.5, 10, 'Sink the putt'], ['fp-darts', 'Darts', 'fun', 15, 6, 'Go for the bull'],
    ['fp-photo', 'Photo Wall', 'fun', -19, 6, 'Strike a pose'],
  ]
  for (const [id, name, kind, lx, lz, blurb] of fun) registerMapPoint({ id, name, kind, x: px + lx, z: pz + lz, blurb, group: 'funpark' })
  const [sx, sz] = locationById.stunts.pos
  registerMapPoint({ id: 'stunt-ramp', name: 'Stunt Ramp', kind: 'car', x: sx - 9, z: sz - 4, blurb: 'Hit it flat out — distance and air time', group: 'stunts' })
  registerMapPoint({ id: 'stunt-donut', name: 'Donut Ring', kind: 'car', x: sx + 9, z: sz + 9, blurb: 'Handbrake circles', group: 'stunts' })
  registerMapPoint({ id: 'stunt-bowl', name: 'Car Bowling', kind: 'car', x: sx + 9, z: sz - 9, blurb: 'Ten giant pins. Get a strike', group: 'stunts' })
  registerMapPoint({ id: 'stunt-crates', name: 'Crate Wall', kind: 'car', x: sx - 8, z: sz + 11, blurb: 'Drive straight through it', group: 'stunts' })
  const J = jettyFrame(), [fx0, fz0] = J.at(J.len - 1.6)
  registerMapPoint({ id: 'fishing', name: 'Fishing', kind: 'rest', x: fx0, z: fz0, blurb: 'Cast, strike, reel in a Nile perch' })
  const sa = 0.35, sr = lakeRadius(sa) + 1.5
  registerMapPoint({ id: 'skim', name: 'Skim Stones', kind: 'fun', x: LAKE.x + Math.cos(sa) * sr, z: LAKE.z + Math.sin(sa) * sr, blurb: 'How many skips?' })
  registerMapPoint({ id: 'cannonball', name: 'Diving Board', kind: 'fun', x: POOL.x + POOL.hx * Math.cos(POOL.angle), z: POOL.z - POOL.hx * Math.sin(POOL.angle), blurb: 'Cannonball! Biggest splash wins' })

  // the woods, where the mushrooms grow
  let fx = 0, fz = 0
  const s = pathSamples[Math.floor(pathSamples.length * 0.45)]
  fx = s.x + 26; fz = s.z
  registerMapPoint({ id: 'forage', name: 'The Woods', kind: 'food', x: fx, z: fz, blurb: 'Pick wild mushrooms' })
}
