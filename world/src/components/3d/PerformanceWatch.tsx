import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { resetPerformanceWatch, watchPerformance } from '../../systems/PerformanceManager'
import { useStore } from '../../state/store'
import { harmonizeMaterials } from '../../lib/freeze'

/** Frame rate the adaptive resolution aims to hold. */
const TARGET_FPS = 57
/** It never renders below this fraction of the tier's resolution. */
const MIN_SCALE = 0.6

/**
 * Runs the frame-rate watch, and keeps the frame smooth between tier changes.
 *
 * Adaptive resolution does the fine work: every half second it looks at the
 * average frame time and, if the frame is running slow, renders a few percent
 * fewer pixels; when there is headroom it gives them back. Pixel count is
 * what an integrated GPU runs out of first, and a 10% drop in resolution is
 * invisible in motion while a dropped frame is not. The tier watch only steps
 * in when even the lowest resolution isn't enough.
 *
 * Lives in the render loop because that is the only place the true frame
 * cost is visible, and reports nothing to React unless the tier moves.
 */
export function PerformanceWatch() {
  const setDpr = useThree((s) => s.setDpr)
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  // for profiling from the console: draw calls, triangles, object count
  useEffect(() => {
    const w = window as unknown as { __cb?: Record<string, unknown> }
    w.__cb = { ...w.__cb, gl, scene }
  }, [gl, scene])
  // as the world streams in, keep shared materials on one shader variant each
  useEffect(() => {
    const id = window.setInterval(() => harmonizeMaterials(scene), 3000)
    return () => window.clearInterval(id)
  }, [scene])
  const preset = useStore((s) => s.preset)
  const acc = useRef({ t: 0, frames: 0, scale: 1, calm: 0 })

  useEffect(() => resetPerformanceWatch(), [])
  // a new tier starts from its own full resolution
  useEffect(() => {
    acc.current.scale = 1
    setDpr(Math.min(window.devicePixelRatio, preset.dpr[1]))
  }, [preset, setDpr])

  // shadows re-rendered every other frame: 30 updates a second is smooth to
  // the eye, and the shadow pass is a second draw of everything that casts
  useEffect(() => {
    gl.shadowMap.autoUpdate = false
    gl.shadowMap.needsUpdate = true
    return () => { gl.shadowMap.autoUpdate = true }
  }, [gl])
  const frame = useRef(0)

  useFrame((_, dt) => {
    if ((frame.current++ & 1) === 0) gl.shadowMap.needsUpdate = true
    const a = acc.current
    a.t += dt
    a.frames++
    if (a.t >= 0.5) {
      const fps = a.frames / a.t
      a.t = 0
      a.frames = 0
      const before = a.scale
      if (fps < TARGET_FPS - 4) {
        // slow: step down in proportion to how far off it is
        a.scale = Math.max(MIN_SCALE, a.scale * Math.max(0.85, Math.sqrt(fps / TARGET_FPS)))
        a.calm = 0
      } else if (fps > TARGET_FPS + 1) {
        // only give pixels back after a couple of seconds of headroom
        a.calm += 0.5
        if (a.calm >= 2) a.scale = Math.min(1, a.scale + 0.05)
      }
      if (a.scale !== before) {
        const full = Math.min(window.devicePixelRatio, preset.dpr[1])
        setDpr(Math.max(preset.dpr[0] * MIN_SCALE, full * a.scale))
      }
    }

    // only let the tier drop once resolution can give no more
    if (a.scale > MIN_SCALE + 0.01) return
    const moved = watchPerformance(dt)
    if (moved) {
      useStore.getState().showToast(
        'GRAPHICS EASED',
        `Running at ${moved.toUpperCase()} to keep things smooth — change it in Settings`,
      )
    }
  })

  return null
}
