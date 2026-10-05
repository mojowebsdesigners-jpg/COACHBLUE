/**
 * How much of the world is drawn, adjusted while playing.
 *
 * The quality tier is chosen once, behind the splash, because changing it
 * recompiles shaders (a freeze). Everything here can change between two
 * frames for free: it only decides how many instances are drawn and from how
 * far away. PerformanceWatch moves the level when even the lowest resolution
 * can't hold the frame rate, so a weak GPU gets a lighter world instead of a
 * slow one, and gets the detail back once there is headroom.
 */
type Level = {
  /** multiplier on the distance at which trees switch to their simple version */
  treeLod: number
  /** share of the grass tufts drawn */
  grass: number
  /** small objects (under 3 m across) are hidden beyond this, in metres */
  smallRange: number
  /** scattered vegetation beyond this is not drawn at all, in metres */
  far: number
  /** other people beyond this are not drawn, in metres */
  peopleRange: number
  /** small scattered things (bushes, ferns, rocks, flowers) beyond this are not drawn */
  smallVeg: number
  /** regular objects further than this from the camera cast no shadow */
  shadowRange: number
}

export const LEVELS: Level[] = [
  { treeLod: 1, grass: 1, smallRange: 90, far: Infinity, peopleRange: 60, smallVeg: 150, shadowRange: 30 },
  { treeLod: 0.75, grass: 0.7, smallRange: 70, far: 420, peopleRange: 48, smallVeg: 110, shadowRange: 24 },
  { treeLod: 0.55, grass: 0.45, smallRange: 55, far: 340, peopleRange: 38, smallVeg: 80, shadowRange: 18 },
  { treeLod: 0.4, grass: 0.25, smallRange: 42, far: 260, peopleRange: 30, smallVeg: 60, shadowRange: 14 },
]

export const detail = { level: 0, ...LEVELS[0] }

export function setDetailLevel(level: number) {
  const l = Math.max(0, Math.min(LEVELS.length - 1, level))
  if (l === detail.level) return false
  Object.assign(detail, LEVELS[l], { level: l })
  return true
}
