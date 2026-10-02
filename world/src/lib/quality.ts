// Graphics tiers. AUTO picks one from what the device reports, then the world
// reads a single resolved preset so every system scales together.

export type Tier = 'auto' | 'ultra' | 'high' | 'medium' | 'low'
export type ResolvedTier = Exclude<Tier, 'auto'>

export type Preset = {
  name: ResolvedTier
  dpr: [number, number]
  shadows: boolean
  shadowSize: number
  trees: number
  grass: number
  grassRadius: number
  rocks: number
  motes: number
  leaves: number
  birds: boolean
  post: boolean
  depthOfField: boolean
  drawDistance: number      // fog density multiplier (lower = see further)
  streamLoadRadius: number  // how early a location mounts
  treeLod: number           // metres at which trees switch to their simpler stand-in
}

export const PRESETS: Record<ResolvedTier, Preset> = {
  ultra: {
    name: 'ultra', dpr: [1, 2], shadows: true, shadowSize: 2048, trees: 2600, grass: 30000,
    grassRadius: 22, rocks: 110, motes: 520, leaves: 220, birds: true, post: true,
    depthOfField: true, drawDistance: 0.85, streamLoadRadius: 1.15, treeLod: 90,
  },
  high: {
    name: 'high', dpr: [1, 1.75], shadows: true, shadowSize: 2048, trees: 2100, grass: 24000,
    grassRadius: 18, rocks: 90, motes: 400, leaves: 140, birds: true, post: true,
    depthOfField: false, drawDistance: 1, streamLoadRadius: 1, treeLod: 70,
  },
  medium: {
    name: 'medium', dpr: [1, 1.4], shadows: true, shadowSize: 1024, trees: 1400, grass: 12000,
    grassRadius: 14, rocks: 60, motes: 220, leaves: 70, birds: true, post: false,
    depthOfField: false, drawDistance: 1.15, streamLoadRadius: 0.85, treeLod: 55,
  },
  low: {
    name: 'low', dpr: [0.8, 1.15], shadows: false, shadowSize: 512, trees: 700, grass: 4000,
    grassRadius: 10, rocks: 30, motes: 90, leaves: 0, birds: false, post: false,
    depthOfField: false, drawDistance: 1.35, streamLoadRadius: 0.7, treeLod: 40,
  },
}

/** A rough guess from the hardware, used when the tier is AUTO. */
export function detectTier(): ResolvedTier {
  if (typeof navigator === 'undefined') return 'high'
  const coarse = window.matchMedia?.('(pointer: coarse)').matches
  const mem = (navigator as { deviceMemory?: number }).deviceMemory ?? 4
  const cores = navigator.hardwareConcurrency ?? 4

  let renderer = ''
  try {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl')
    const ext = gl?.getExtension('WEBGL_debug_renderer_info')
    if (gl && ext) renderer = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)).toLowerCase()
  } catch {
    /* blocked — fall through to the memory/core guess */
  }

  // software rasterisers can't cope with the forest at all
  if (/swiftshader|llvmpipe|software|basic render/.test(renderer)) return 'low'
  if (coarse) return mem >= 6 && cores >= 8 ? 'medium' : 'low'
  if (/rtx|radeon rx|apple m[1-9]|arc a/.test(renderer) && cores >= 8) return 'ultra'
  // integrated graphics share memory bandwidth with the CPU: the forest, the
  // shadows and full-resolution post-processing at 'high' run well under 30
  // fps on an Iris Xe. 'medium' plus adaptive resolution holds a smooth frame.
  if (/intel|iris|uhd|adreno|mali|powervr|apple gpu/.test(renderer)) return 'medium'
  if (mem <= 4 || cores <= 4) return 'medium'
  return 'high'
}

/** A phone or tablet: touch is the main pointer and there is no mouse. */
export function isHandheld() {
  if (typeof window === 'undefined') return false
  return !!window.matchMedia?.('(pointer: coarse)').matches && !window.matchMedia?.('(any-pointer: fine)').matches
}

/**
 * The same tier, trimmed for a phone. A phone GPU is small, shares memory
 * with the CPU and throttles as it warms, and its screen packs two or three
 * pixels into every CSS pixel. The shadow pass (a second draw of everything)
 * and the extra resolution are what it runs out of first, and on a small
 * screen they are the least visible, so they go; the forest and grass thin a
 * little. Only applied on AUTO: a tier picked by hand is taken as given.
 */
const handheldCache = new Map<ResolvedTier, Preset>()
function forHandheld(p: Preset): Preset {
  let t = handheldCache.get(p.name)
  if (!t) {
    t = {
      ...p,
      dpr: [Math.min(p.dpr[0], 0.85), Math.min(p.dpr[1], 1.2)],
      shadows: false,
      post: false,
      depthOfField: false,
      trees: Math.round(p.trees * 0.75),
      grass: Math.round(p.grass * 0.6),
      grassRadius: Math.min(p.grassRadius, 12),
      motes: Math.round(p.motes * 0.5),
      leaves: Math.round(p.leaves * 0.5),
      treeLod: Math.min(p.treeLod, 40),
    }
    handheldCache.set(p.name, t)
  }
  return t
}

export function resolveTier(tier: Tier, cache?: { auto?: ResolvedTier }): Preset {
  if (tier !== 'auto') return PRESETS[tier]
  if (cache && !cache.auto) cache.auto = detectTier()
  const p = PRESETS[cache?.auto ?? detectTier()]
  return isHandheld() ? forHandheld(p) : p
}

export function webglAvailable() {
  try {
    const canvas = document.createElement('canvas')
    return !!(canvas.getContext('webgl2') ?? canvas.getContext('webgl'))
  } catch {
    return false
  }
}

/** WebGPU is only offered where the browser actually exposes an adapter. */
export async function webgpuAvailable() {
  const gpu = (navigator as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu
  if (!gpu) return false
  try {
    return !!(await gpu.requestAdapter())
  } catch {
    return false
  }
}

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
