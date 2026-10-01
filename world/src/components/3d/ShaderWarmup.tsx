import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import { useProgress } from '@react-three/drei'
import { warmShaders } from '../../systems/AssetManager'
import { useStore } from '../../state/store'

/**
 * Compiles every material once the scene is assembled, then reports that the
 * world is genuinely ready. Asset progress reaching 100% only means the files
 * arrived; the shaders still have to be built, and doing that lazily is what
 * makes the first walk through a new area stutter.
 */
export function ShaderWarmup() {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)
  const invalidate = useThree((s) => s.invalidate)
  const setWorldReady = useStore((s) => s.setWorldReady)

  useEffect(() => {
    let cancelled = false
    // every area builds behind the splash, each loading its own models,
    // fonts and textures: wait until nothing has loaded for half a second
    // (at most twenty), then compile and upload the lot in one go
    let id = 0
    const t0 = performance.now()
    let quietSince = 0
    const waitForQuiet = () => {
      if (cancelled) return
      const now = performance.now()
      if (useProgress.getState().active) quietSince = 0
      else if (!quietSince) quietSince = now
      if ((quietSince && now - quietSince > 500) || now - t0 > 20000) warm()
      else id = requestAnimationFrame(waitForQuiet)
    }
    id = requestAnimationFrame(waitForQuiet)
    const warm = () => {
      warmShaders(gl, scene, camera)
        .catch(() => {})
        .finally(() => {
          if (cancelled) return
          // one real frame while still behind the splash, so textures and
          // shadow maps upload now rather than on the first step into the world
          invalidate()
          setWorldReady(true)
        })
    }
    return () => {
      cancelled = true
      cancelAnimationFrame(id)
    }
  }, [gl, scene, camera, setWorldReady, invalidate])

  return null
}
