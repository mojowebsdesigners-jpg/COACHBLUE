import { Color, Vector3 } from 'three'

/**
 * A clock-driven day/night cycle: dawn -> morning -> noon -> afternoon ->
 * sunset -> blue hour -> night. `t` is 0..1 where 0 is midnight, 0.5 is noon.
 * Everything visual (sun, moon, sky, fog, when the lights come on) reads from
 * this one place, so the world always agrees with itself.
 */
type Key = {
  at: number
  sunAlt: number          // degrees above the horizon (negative = below)
  sunAz: number           // degrees, 0 = north
  sunColor: string
  sunIntensity: number
  ambient: string
  ambientIntensity: number
  fog: string
  fogDensity: number
  zenith: string
  night: number           // 0 day .. 1 full night
  cloud: number
}

const keys: Key[] = [
  { at: 0.00, sunAlt: -35, sunAz: 0,   sunColor: '#4d6ea8', sunIntensity: 0.0,  ambient: '#31405e', ambientIntensity: 0.40, fog: '#0e1622', fogDensity: 0.0072, zenith: '#060b16', night: 1,    cloud: 0.40 },
  { at: 0.21, sunAlt: -12, sunAz: 70,  sunColor: '#7a7fb0', sunIntensity: 0.15, ambient: '#40506e', ambientIntensity: 0.44, fog: '#27374e', fogDensity: 0.0066, zenith: '#12203a', night: 0.85, cloud: 0.45 },
  { at: 0.26, sunAlt: 2,   sunAz: 85,  sunColor: '#ffc796', sunIntensity: 1.7,  ambient: '#a9b2d6', ambientIntensity: 1.25, fog: '#d9bfae', fogDensity: 0.0030, zenith: '#5f8ccc', night: 0.35, cloud: 0.35 },
  { at: 0.34, sunAlt: 24,  sunAz: 100, sunColor: '#ffe0bd', sunIntensity: 2.4,  ambient: '#b8c3ea', ambientIntensity: 1.85, fog: '#d3dcee', fogDensity: 0.0019, zenith: '#6a98d4', night: 0,    cloud: 0.30 },
  { at: 0.50, sunAlt: 58,  sunAz: 180, sunColor: '#ffe6c9', sunIntensity: 2.75, ambient: '#bcc8ee', ambientIntensity: 2.0,  fog: '#d4def0', fogDensity: 0.0016, zenith: '#6b9bd8', night: 0,    cloud: 0.26 },
  { at: 0.66, sunAlt: 28,  sunAz: 250, sunColor: '#ffdcb4', sunIntensity: 2.5,  ambient: '#b7c1e8', ambientIntensity: 1.85, fog: '#d6dcec', fogDensity: 0.0019, zenith: '#6a96d0', night: 0,    cloud: 0.30 },
  { at: 0.74, sunAlt: 6,   sunAz: 268, sunColor: '#ffb57a', sunIntensity: 2.1,  ambient: '#b3a6c8', ambientIntensity: 1.35, fog: '#dcb49a', fogDensity: 0.0028, zenith: '#5a7cbc', night: 0.10, cloud: 0.40 },
  { at: 0.79, sunAlt: -2,  sunAz: 276, sunColor: '#ff7a3c', sunIntensity: 1.5,  ambient: '#7b7ba0', ambientIntensity: 0.64, fog: '#9c6d5e', fogDensity: 0.0054, zenith: '#2f4a85', night: 0.40, cloud: 0.60 },
  { at: 0.84, sunAlt: -9,  sunAz: 284, sunColor: '#6f7cc0', sunIntensity: 0.35, ambient: '#54618a', ambientIntensity: 0.54, fog: '#3c4a66', fogDensity: 0.0064, zenith: '#18294d', night: 0.75, cloud: 0.50 },
  { at: 1.00, sunAlt: -35, sunAz: 360, sunColor: '#4d6ea8', sunIntensity: 0.0,  ambient: '#31405e', ambientIntensity: 0.40, fog: '#0e1622', fogDensity: 0.0072, zenith: '#060b16', night: 1,    cloud: 0.40 },
]

const cA = new Color()
const cB = new Color()

export type DayState = {
  t: number
  sun: Vector3
  sunColor: Color
  sunIntensity: number
  moon: Vector3
  moonIntensity: number
  ambient: Color
  ambientIntensity: number
  fog: Color
  fogDensity: number
  zenith: Color
  night: number
  cloud: number
  /** true once it is dark enough for street, house and vehicle lights */
  lightsOn: boolean
}

function dirFrom(altDeg: number, azDeg: number, out: Vector3) {
  const alt = (altDeg * Math.PI) / 180
  const az = (azDeg * Math.PI) / 180
  return out.set(Math.sin(az) * Math.cos(alt), Math.sin(alt), Math.cos(az) * Math.cos(alt)).normalize()
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k

export function dayState(t: number, out: DayState): DayState {
  const x = ((t % 1) + 1) % 1
  let i = 0
  while (i < keys.length - 2 && keys[i + 1].at < x) i++
  const a = keys[i]
  const b = keys[i + 1]
  const k = Math.min(1, Math.max(0, (x - a.at) / (b.at - a.at)))
  const s = k * k * (3 - 2 * k)

  out.t = x
  dirFrom(lerp(a.sunAlt, b.sunAlt, s), lerp(a.sunAz, b.sunAz, s), out.sun)
  // the moon rides opposite the sun, so the night is lit from the other side
  dirFrom(-lerp(a.sunAlt, b.sunAlt, s), lerp(a.sunAz, b.sunAz, s) + 180, out.moon)

  out.sunColor.copy(cA.set(a.sunColor)).lerp(cB.set(b.sunColor), s)
  out.ambient.copy(cA.set(a.ambient)).lerp(cB.set(b.ambient), s)
  out.fog.copy(cA.set(a.fog)).lerp(cB.set(b.fog), s)
  out.zenith.copy(cA.set(a.zenith)).lerp(cB.set(b.zenith), s)
  out.sunIntensity = lerp(a.sunIntensity, b.sunIntensity, s)
  out.ambientIntensity = lerp(a.ambientIntensity, b.ambientIntensity, s)
  out.fogDensity = lerp(a.fogDensity, b.fogDensity, s)
  out.night = lerp(a.night, b.night, s)
  out.cloud = lerp(a.cloud, b.cloud, s)
  out.moonIntensity = out.night * 0.6 * (out.moon.y > 0 ? 1 : 0.2)
  out.lightsOn = out.night > 0.32
  return out
}

export const makeDayState = (): DayState => ({
  t: 0.4,
  sun: new Vector3(0.4, 0.6, 0.7),
  sunColor: new Color('#ffe0b8'),
  sunIntensity: 2.9,
  moon: new Vector3(-0.4, -0.6, -0.7),
  moonIntensity: 0,
  ambient: new Color('#b9cfdd'),
  ambientIntensity: 1,
  fog: new Color('#c6d5d6'),
  fogDensity: 0.0032,
  zenith: new Color('#2f6bad'),
  night: 0,
  cloud: 0.45,
  lightsOn: false,
})

export const BRAND = {
  mint: '#1DE9B6',
  deep: '#0A5240',
  ink: '#1C1C1C',
  text: '#BEBEBE',
}
