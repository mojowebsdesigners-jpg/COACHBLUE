import { useGLTF } from '@react-three/drei'
import type { Camera, Scene, WebGLRenderer } from 'three'

/**
 * Everything the world is built from, fetched before the world is shown.
 *
 * A model that loads on demand costs a frame at the worst possible moment —
 * the first time you walk round a corner and see it. The list is explicit
 * rather than derived so that adding an asset and forgetting to preload it is
 * a visible omission here rather than an intermittent stutter in play.
 */
export const MODELS = [
  // characters
  'coach', 'coach-npc', 'client-a', 'client-b', 'client-c',
  // vehicle
  'car',
  // gym kit
  'gym_rack', 'gym_bench', 'gym_barbell', 'gym_dumbbells', 'gym_cable',
  'gym_plates', 'gym_kettlebells', 'gym_mat', 'gym_bottle',
  // world props
  'streetlamp', 'house', 'bench',
  'boulder', 'cabin', 'campfire', 'calisthenics', 'sealife', 'letters',
] as const

export const modelUrl = (name: string) => `/models/${name}.glb`

/** Queue every model with the loader that the progress bar watches. */
export function preloadModels() {
  for (const name of MODELS) useGLTF.preload(modelUrl(name))
}

/**
 * Compile every material against the live camera before the first frame is
 * shown. Without this the shaders compile lazily as each object first comes
 * into view, and a compile is tens of milliseconds of stall — the single most
 * common cause of a world that "hangs" while you walk through it.
 */
export async function warmShaders(gl: WebGLRenderer, scene: Scene, camera: Camera) {
  const compile = (gl as WebGLRenderer & {
    compileAsync?: (s: Scene, c: Camera) => Promise<unknown>
  }).compileAsync
  if (compile) {
    await compile.call(gl, scene, camera)
  } else {
    gl.compile(scene, camera)
  }
}
