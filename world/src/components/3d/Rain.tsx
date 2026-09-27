import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  AdditiveBlending, BufferAttribute, BufferGeometry, DynamicDrawUsage, LineBasicMaterial,
  type LineSegments, MathUtils,
} from 'three'
import { pathProgress, terrainHeight } from '../../lib/terrain'
import { setRain } from '../../lib/audio'
import { player, useStore } from '../../state/store'

// A shower that passes over the hard middle of the journey — the Discipline Path
// and the climb to the 100 Days ring — then clears again. Weather is used for
// this one stretch rather than running all the time.
const START = 0.40
const PEAK_A = 0.47
const PEAK_B = 0.58
const END = 0.66

function intensityAt(t: number) {
  if (t <= START || t >= END) return 0
  if (t < PEAK_A) return MathUtils.smoothstep(t, START, PEAK_A)
  if (t > PEAK_B) return 1 - MathUtils.smoothstep(t, PEAK_B, END)
  return 1
}

export function Rain() {
  const preset = useStore((s) => s.preset)
  const reduced = useStore((s) => s.settings.reducedMotion)
  const soundOn = useStore((s) => s.settings.sound)
  const ref = useRef<LineSegments>(null)
  const strength = useRef(0)
  const count = preset.leaves > 0 ? Math.round(preset.leaves * 5) : 0
  const RADIUS = 22

  const { geometry, material, speeds } = useMemo(() => {
    const g = new BufferGeometry()
    const n = Math.max(1, count)
    const pos = new Float32Array(n * 6)      // two points per drop
    const speeds = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      const x = (Math.random() - 0.5) * RADIUS * 2
      const z = (Math.random() - 0.5) * RADIUS * 2
      const y = Math.random() * 16
      const len = 0.34 + Math.random() * 0.3
      pos.set([x, y, z, x + 0.03, y - len, z], i * 6)
      speeds[i] = 14 + Math.random() * 9
    }
    const attr = new BufferAttribute(pos, 3)
    attr.setUsage(DynamicDrawUsage)
    g.setAttribute('position', attr)
    const m = new LineBasicMaterial({
      color: '#cfe0e6', transparent: true, opacity: 0, depthWrite: false, blending: AdditiveBlending,
    })
    return { geometry: g, material: m, speeds }
  }, [count])

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05)
    const want = reduced || count === 0 ? 0 : intensityAt(pathProgress(player.pos.x, player.pos.z))
    strength.current = MathUtils.damp(strength.current, want, 0.7, dt)
    material.opacity = strength.current * 0.5
    if (soundOn) setRain(strength.current)

    const mesh = ref.current
    if (!mesh || strength.current < 0.01) return
    mesh.position.set(player.pos.x, 0, player.pos.z)

    const attr = geometry.attributes.position as BufferAttribute
    const arr = attr.array as Float32Array
    // one ground sample per frame is plenty — drops recycle just below the player
    const floor = terrainHeight(player.pos.x, player.pos.z) - 1.5
    for (let i = 0; i < count; i++) {
      const o = i * 6
      const fall = speeds[i] * dt
      arr[o + 1] -= fall
      arr[o + 4] -= fall
      if (arr[o + 1] < floor) {
        const x = (Math.random() - 0.5) * RADIUS * 2
        const z = (Math.random() - 0.5) * RADIUS * 2
        const y = 14 + Math.random() * 6
        const len = 0.34 + Math.random() * 0.3
        arr[o] = x; arr[o + 1] = y; arr[o + 2] = z
        arr[o + 3] = x + 0.03; arr[o + 4] = y - len; arr[o + 5] = z
      }
    }
    attr.needsUpdate = true
  })

  if (count === 0) return null
  return <lineSegments key={count} ref={ref} args={[geometry, material]} frustumCulled={false} />
}
