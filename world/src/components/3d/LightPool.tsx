import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Color, Vector3, type PointLight } from 'three'
import { player } from '../../state/store'

/**
 * Every local light in the world — street lamps, floodlights, porch lights,
 * the lantern, the campfire — shares a fixed pool of real lights.
 *
 * three.js builds each material's shader for an exact number of lights, so
 * adding or removing a light anywhere recompiles every material in the scene.
 * Lamps used to mount their own light (a floodlight when the gym streamed in,
 * the nearest street lamps as you drove past them at night): each one froze
 * the frame it arrived, and a light with its intensity at zero still cost
 * every pixel on screen. Now the number of lights never changes. A lamp is a
 * registration; the pool hands its few lights to the lamps nearest the player
 * and fades them across, so what you see is the same and the shader never is.
 */
export type Lamp = {
  position: Vector3
  color: string
  /** candela, or a function for flicker; 0 or less means off */
  intensity: number | (() => number)
  distance: number
  decay?: number
}

const lamps = new Set<Lamp>()
export function registerLamp(l: Lamp) {
  lamps.add(l)
  return () => { lamps.delete(l) }
}

const POOL = 4
const _c = new Color()

type Slot = { lamp: Lamp | null; level: number }

export function LightPool() {
  const refs = useRef<(PointLight | null)[]>([])
  const slots = useRef<Slot[]>(Array.from({ length: POOL }, () => ({ lamp: null, level: 0 })))
  const clock = useRef(0)
  const wanted = useRef<Lamp[]>([])

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05)
    clock.current += dt
    // choose the nearest lit lamps a few times a second
    if (clock.current > 0.25) {
      clock.current = 0
      const lit: { l: Lamp; d: number }[] = []
      for (const l of lamps) {
        const i = typeof l.intensity === 'function' ? l.intensity() : l.intensity
        if (i <= 0) continue
        const d = l.position.distanceToSquared(player.pos)
        if (d > (l.distance * 2.2) ** 2) continue
        lit.push({ l, d })
      }
      lit.sort((a, b) => a.d - b.d)
      wanted.current = lit.slice(0, POOL).map((x) => x.l)
    }
    const want = wanted.current
    const sl = slots.current
    // keep a lamp in the slot it already has; free slots fade out first
    for (const s of sl) if (s.lamp && !want.includes(s.lamp)) s.lamp = s.level < 0.02 ? null : s.lamp
    for (const l of want) {
      if (sl.some((s) => s.lamp === l)) continue
      const free = sl.find((s) => !s.lamp)
      if (free) { free.lamp = l; free.level = 0 }
    }
    for (let i = 0; i < POOL; i++) {
      const s = sl[i]
      const light = refs.current[i]
      if (!light) continue
      const on = !!s.lamp && want.includes(s.lamp)
      s.level += ((on ? 1 : 0) - s.level) * Math.min(1, dt * 3)
      if (!s.lamp) { light.intensity = 0; continue }
      const l = s.lamp
      const base = typeof l.intensity === 'function' ? l.intensity() : l.intensity
      light.position.copy(l.position)
      light.color.copy(_c.set(l.color))
      light.distance = l.distance
      light.decay = l.decay ?? 2
      light.intensity = Math.max(0, base) * s.level
    }
  })

  return (
    <>
      {Array.from({ length: POOL }, (_, i) => (
        <pointLight key={i} ref={(el) => { refs.current[i] = el }} intensity={0} distance={20} decay={2} castShadow={false} />
      ))}
    </>
  )
}
