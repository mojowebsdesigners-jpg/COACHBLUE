import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
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
    // one frame of grace so children have mounted and added themselves
    const id = requestAnimationFrame(() => {
      warmShaders(gl, scene, camera)
        .catch(() => {})
        .finally(() => {
          if (cancelled) return
          // one real frame while still behind the splash, so textures and
          // shadow maps upload now rather than on the first step into the world
          invalidate()
          setWorldReady(true)
        })
    })
    return () => {
      cancelled = true
      cancelAnimationFrame(id)
    }
  }, [gl, scene, camera, setWorldReady, invalidate])

  return null
}
