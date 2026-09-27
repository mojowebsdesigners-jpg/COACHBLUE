import { useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import type { Object3D } from 'three'
import { useStore } from '../../state/store'

/**
 * No shader is ever compiled on the frame it is first needed.
 *
 * The world streams in as you move: a location mounts when you come within
 * range, the car arrives, a prop loads late. Each new material used to be
 * compiled synchronously on the first frame it was drawn — the renderer
 * blocks until the driver has linked it — and profiling the pool showed two
 * thirds of all main-thread time going there. That is the hitch you feel
 * arriving somewhere.
 *
 * So anything that appears after the world is ready is held off the render
 * layers for the moment it takes to compile in the background (with
 * KHR_parallel_shader_compile, compileAsync polls instead of blocking), and
 * shown the frame its programs are ready. Something already compiled shows a
 * frame or two late, which is not visible; a new shader no longer freezes the
 * world.
 */
const HOLD_LAYER = 31
const seen = new WeakSet<Object3D>()

export function ShaderGate() {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)
  const worldReady = useStore((s) => s.worldReady)
  const held = useRef<{ o: Object3D; mask: number }[]>([])
  const busy = useRef(false)
  const clock = useRef(0)
  const primed = useRef(false)

  useFrame((_, dt) => {
    if (!worldReady) return
    // everything present at the moment the world became ready was compiled
    // by ShaderWarmup: record it once and leave it alone
    if (!primed.current) {
      scene.traverse((o) => seen.add(o))
      primed.current = true
      return
    }
    clock.current += dt
    if (clock.current < 0.12 || busy.current) return
    clock.current = 0

    let found = false
    scene.traverse((o) => {
      if (seen.has(o)) return
      seen.add(o)
      const r = o as Object3D & { isMesh?: boolean; isPoints?: boolean; isLine?: boolean }
      if (!(r.isMesh || r.isPoints || r.isLine)) return
      held.current.push({ o, mask: o.layers.mask })
      o.layers.set(HOLD_LAYER)
      found = true
    })
    if (!found) return

    busy.current = true
    const batch = held.current
    if (import.meta.env.DEV) {
      const w = window as unknown as { __gate?: { runs: number; objs: number; names: string[] } }
      w.__gate = w.__gate ?? { runs: 0, objs: 0, names: [] }
      w.__gate.runs++
      w.__gate.objs += batch.length
      w.__gate.names = [...w.__gate.names, ...batch.slice(0, 3).map((h) => `${h.o.type}:${h.o.name || h.o.parent?.name || '?'}`)].slice(-30)
    }
    held.current = []
    // compile() walks visible objects regardless of layer, so the held ones
    // are included; everything already compiled is a cache hit
    gl.compileAsync(scene, camera)
      .catch(() => {})
      .finally(() => {
        for (const h of batch) h.o.layers.mask = h.mask
        busy.current = false
      })
  })
  return null
}
