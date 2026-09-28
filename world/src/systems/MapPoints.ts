/**
 * Everything the map shows as an icon you can travel to. Places and activities
 * register themselves (with a kind that picks the icon), so anything added to
 * the world appears on the map without the map knowing about it.
 */
export type MapKind =
  | 'place' | 'gym' | 'water' | 'car' | 'fun' | 'sport' | 'rest' | 'food' | 'secret' | 'coach'

export type MapPoint = {
  id: string; name: string; x: number; z: number; kind: MapKind; blurb?: string
  /** one of a crowd (the fun park's activities): drawn only once zoomed in */
  group?: string
}
/** How far in the map must be zoomed before a group's own icons show. */
export const GROUP_ZOOM = 2.6

const points = new Map<string, MapPoint>()
type Listener = () => void
const listeners = new Set<Listener>()

export function registerMapPoint(p: MapPoint) {
  points.set(p.id, p)
  listeners.forEach((f) => f())
  return () => { points.delete(p.id); listeners.forEach((f) => f()) }
}

export const mapPoints = () => [...points.values()]
export function onMapPoints(fn: Listener) {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

/** The glyph and colour each kind of place wears on the map. */
export const MAP_ICON: Record<MapKind, { glyph: string; colour: string }> = {
  place: { glyph: '◆', colour: '#1de9b6' },
  coach: { glyph: '★', colour: '#1de9b6' },
  gym: { glyph: '🏋', colour: '#ff6b6b' },
  water: { glyph: '🌊', colour: '#4fc3f7' },
  car: { glyph: '🚗', colour: '#ffd54f' },
  fun: { glyph: '🎯', colour: '#ba68c8' },
  sport: { glyph: '⚽', colour: '#81c784' },
  rest: { glyph: '🪑', colour: '#bcaaa4' },
  food: { glyph: '🍄', colour: '#ffb74d' },
  secret: { glyph: '?', colour: '#ffffff' },
}
