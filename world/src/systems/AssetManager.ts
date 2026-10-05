import { useGLTF } from '@react-three/drei'
import { Texture, WebGLRenderTarget, type Camera, type InstancedMesh, type Mesh, type Object3D, type Scene, type VideoTexture, type WebGLRenderer } from 'three'
import { harmonizeMaterials } from '../lib/freeze'

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
  // compiling only sees what is visible, and distance culling has already
  // hidden the far side of the world: show everything for the compile, so
  // nothing has to be compiled (a freeze of seconds) the first time it is seen
  // settle shared materials (and single-pass transparency) first, so the
  // variants compiled here are the ones the world will actually draw
  harmonizeMaterials(scene)
  const hidden: Object3D[] = []
  scene.traverse((o) => { if (!o.visible) { hidden.push(o); o.visible = true } })
  try {
  if (compile) {
    // some drivers never report a program as finished; never let that keep
    // the visitor on the splash screen for good
    const t0 = performance.now()
    let timedOut = false
    await Promise.race([
      compile.call(gl, scene, camera),
      new Promise<void>((r) => setTimeout(() => { timedOut = true; r() }, 15000)),
    ])
    if (import.meta.env.DEV) console.log(`[warm] shaders ${timedOut ? 'TIMED OUT' : 'ready'} in ${Math.round(performance.now() - t0)} ms`)
  } else {
    gl.compile(scene, camera)
  }
  } finally {
    for (const o of hidden) o.visible = false
  }
  // and put every texture on the GPU now, not the first time it comes into
  // view (an upload is a visible hitch on the way through the world)
  const seen = new Set<Texture>()
  scene.traverse((o) => {
    const m = (o as Mesh).material
    if (!m) return
    for (const mat of Array.isArray(m) ? m : [m]) {
      for (const v of Object.values(mat)) {
        if (v instanceof Texture && !seen.has(v) && !(v as VideoTexture).isVideoTexture) {
          seen.add(v)
          gl.initTexture(v)
        }
      }
    }
  })
  if (import.meta.env.DEV) console.log(`[warm] ${seen.size} textures uploaded`)
  uploadGeometry(gl, scene, camera)
}

/**
 * Put every mesh's vertex buffers on the GPU now. three.js uploads geometry
 * the first time it is drawn, so a ground tile, a tree stand-in or a far
 * version that first comes into view mid-walk stalls the frame while its
 * buffers go up. Here each one is drawn once, with its own material, into a
 * single hidden pixel, behind the splash screen.
 */
function uploadGeometry(gl: WebGLRenderer, scene: Scene, camera: Camera) {
  // the real scene, so the lights, fog and reflections match and every
  // program drawn is one already compiled: everything switched on, nothing
  // culled, every instanced mesh drawing at least one instance
  const shown: Object3D[] = []
  const culled: Object3D[] = []
  const counts: [InstancedMesh, number][] = []
  scene.traverse((o) => {
    if (!o.visible) { shown.push(o); o.visible = true }
    const m = o as Mesh & { isInstancedMesh?: boolean }
    if (!m.isMesh) return
    if (m.frustumCulled) { culled.push(m); m.frustumCulled = false }
    if (m.isInstancedMesh) {
      const im = m as unknown as InstancedMesh
      if (im.count === 0) { counts.push([im, 0]); im.count = 1 }
    }
  })
  const target = new WebGLRenderTarget(1, 1)
  const prev = gl.getRenderTarget()
  const shadows = gl.shadowMap.autoUpdate
  gl.shadowMap.autoUpdate = false
  try {
    gl.setRenderTarget(target)
    gl.render(scene, camera)
  } finally {
    gl.setRenderTarget(prev)
    gl.shadowMap.autoUpdate = shadows
    target.dispose()
    for (const o of shown) o.visible = false
    for (const o of culled) o.frustumCulled = true
    for (const [im, n] of counts) im.count = n
  }
  if (import.meta.env.DEV) console.log(`[warm] ${culled.length + counts.length} meshes drawn once to upload their buffers`)
}
