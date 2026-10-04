import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { resetPerformanceWatch } from '../../systems/PerformanceManager'
import { useStore } from '../../state/store'
import { harmonizeMaterials } from '../../lib/freeze'
import { setRenderNow } from '../../lib/share'
import { setInstanceFar } from '../../lib/instanceCull'
import { LEVELS, detail, setDetailLevel } from '../../lib/detail'

/** Frame rate the adaptive resolution aims to hold. */
const TARGET_FPS = 57
/** It never renders below this fraction of the tier's resolution. */
const MIN_SCALE = 0.6
/** ...and only once the world is already at its lightest, this far */
const LAST_SCALE = 0.5
const floorScale = () => (detail.level >= LEVELS.length - 1 ? LAST_SCALE : MIN_SCALE)

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
  const camera = useThree((s) => s.camera)
  // photo saves render a frame on demand rather than keeping every frame
  const advance = useThree((s) => s.advance)
  useEffect(() => {
    setRenderNow(() => advance(performance.now()))
    return () => setRenderNow(null)
  }, [advance])
  // for profiling from the console: draw calls, triangles, object count
  useEffect(() => {
    const w = window as unknown as { __cb?: Record<string, unknown> }
    w.__cb = { ...w.__cb, gl, scene, camera, setInstanceFar, detail }
  }, [gl, scene, camera])
  // as the world streams in, keep shared materials on one shader variant each;
  // once it has settled a walk of the whole scene every few seconds is a
  // stutter on a phone for nothing, so it slows right down
  useEffect(() => {
    let id = 0
    const started = performance.now()
    const run = () => {
      harmonizeMaterials(scene)
      const settled = useStore.getState().worldReady && performance.now() - started > 30000
      id = window.setTimeout(run, settled ? 20000 : 3000)
    }
    id = window.setTimeout(run, 3000)
    return () => window.clearTimeout(id)
  }, [scene])
  const preset = useStore((s) => s.preset)
  const acc = useRef({ t: 0, frames: 0, scale: 1, calm: 0, hold: 0, dhold: 0, sinceRestore: 99, patience: 4 })

  useEffect(() => resetPerformanceWatch(), [])
  // a new tier starts from its own full resolution
  useEffect(() => {
    acc.current.scale = 1
    setDpr(Math.min(window.devicePixelRatio, preset.dpr[1]))
  }, [preset, setDpr])

  // Shadows are re-rendered every frame. Every other frame halved their
  // cost, but it made alternate frames heavy and light, so motion juddered,
  // and the coach's shadow (and the sun's frame, which follows him) moved at
  // half rate behind him: he looked as if he were lagging.
  useFrame((_, dt) => {
    const a = acc.current
    a.t += dt
    a.frames++
    if (a.t >= 0.5) {
      const fps = a.frames / a.t
      a.t = 0
      a.frames = 0
      a.hold = Math.max(0, a.hold - 0.5)
      a.dhold = Math.max(0, a.dhold - 0.5)
      a.sinceRestore += 0.5
      const before = a.scale
      // Every change resizes the canvas and every post-processing buffer,
      // which itself costs a frame or two, so it changes in whole steps and
      // never see-saws: after stepping down it waits a good while before
      // trying more pixels again.
      if (fps < TARGET_FPS - 4) {
        // slow: step down in proportion to how far off it is
        const want = a.scale * Math.max(0.85, Math.sqrt(fps / TARGET_FPS))
        a.scale = Math.max(floorScale(), Math.floor(want * 20) / 20)
        a.calm = 0
        a.hold = 8
        // already at the lowest resolution and still slow: draw less of the
        // world instead (less grass, simpler trees from nearer, small things
        // hidden sooner). Free to change, nothing recompiles.
        if (before <= MIN_SCALE + 1e-6 && a.dhold === 0 && setDetailLevel(detail.level + 1)) {
          a.dhold = 3
          // the level it just gave back was too much: wait longer next time,
          // so the grass and trees don't visibly pulse in and out
          if (a.sinceRestore < 15) a.patience = Math.min(120, a.patience * 2)
        }
      } else if (fps > TARGET_FPS + 1 && a.hold === 0) {
        // headroom: detail comes back first, then pixels, a step at a time
        a.calm += 0.5
        if (a.scale < MIN_SCALE - 1e-6) {
          // the emergency resolution goes first, back to the usual floor
          if (a.calm >= 3) { a.scale = Math.min(MIN_SCALE, a.scale + 0.05); a.calm = 0; a.hold = 3 }
        } else if (detail.level > 0) {
          if (a.calm >= a.patience && a.dhold === 0) { setDetailLevel(detail.level - 1); a.calm = 0; a.dhold = 6; a.sinceRestore = 0 }
        } else if (a.calm >= 3) { a.scale = Math.min(1, a.scale + 0.05); a.calm = 0; a.hold = 3 }
      } else {
        a.calm = 0
      }
      if (a.scale !== before) {
        const full = Math.min(window.devicePixelRatio, preset.dpr[1])
        setDpr(Math.max(preset.dpr[0] * LAST_SCALE, full * a.scale))
      }
    }

    // The tier itself never changes during play. Stepping it down switched
    // shadows and post effects off and rebuilt the forest and grass: every
    // shader in the world recompiled and every instance was regenerated at
    // once, a freeze of seconds, which is worse than any slow frame it was
    // meant to cure. The tier is settled at start-up behind the splash;
    // after that only the resolution flexes, and that costs nothing to change.
  })

  return null
}
