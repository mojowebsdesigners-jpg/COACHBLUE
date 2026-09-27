import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import {
  BackSide, FogExp2, Mesh, MeshBasicMaterial, PMREMGenerator, Scene,
  SphereGeometry, Vector3, type DirectionalLight, type HemisphereLight,
} from 'three'
import { dayState, makeDayState, type DayState } from '../../lib/dayCycle'
import { DAY_LENGTH_SECONDS, minutesOfDay } from '../../systems/TimeSystem'
import { player, useStore } from '../../state/store'
import { SkyDome } from './Sky'
import { setNightAmount } from '../../lib/audio'

/** Shared, per-frame day state. Read it from any useFrame; never in render. */
export const day: DayState = makeDayState()
export const useDay = () => day

/**
 * Jump the world clock. The day is deliberately long — three real hours —
 * which means night would otherwise never arrive inside a single visit, and
 * every lamp, window and headlight in the world would sit unused. This is how
 * the time control reaches it.
 */
let setClock: ((t: number) => void) | null = null
export function setTimeOfDay(fraction: number) {
  setClock?.(((fraction % 1) + 1) % 1)
}

/**
 * Carry the clock forward to a time over a few seconds instead of cutting to
 * it: the sun visibly sets (or rises), the sky and fog follow, the lamps come
 * on in their turn and the soundscape changes with them.
 */
const glide = { active: false, from: 0, span: 0, t: 0, seconds: 1 }
let readClock: (() => number) | null = null
export function glideToTimeOfDay(fraction: number, seconds = 7) {
  const now = readClock?.() ?? 0
  const target = ((fraction % 1) + 1) % 1
  glide.from = now
  glide.span = ((target - now) % 1 + 1) % 1      // always forward in time
  glide.t = 0
  glide.seconds = seconds
  glide.active = true
}

/** One in-world day takes this many real seconds. */
// the clock now lives in systems/TimeSystem; see GAME_TIME_SCALE there

/**
 * Sun, moon, sky, fog and image-based lighting. Time advances on a clock, so
 * the world moves through dawn, noon, sunset, blue hour and night, and every
 * light in the world switches on from the same signal.
 */
export function Lighting() {
  const sunRef = useRef<DirectionalLight>(null)
  const moonRef = useRef<DirectionalLight>(null)
  const hemi = useRef<HemisphereLight>(null)
  const { scene, gl } = useThree()
  const preset = useStore((s) => s.preset)
  const timeScale = useStore((s) => s.timeScale)
  const setLightsOn = useStore((s) => s.setLightsOn)
  // ?hour=0..24 parks the clock, so a screenshot can be taken at a known time
  const forced = typeof location !== 'undefined'
    ? Number(new URLSearchParams(location.search).get('hour'))
    : NaN
  const pinned = Number.isFinite(forced) && new URLSearchParams(location.search).has('hour')
  const clock = useRef(pinned ? (forced / 24) % 1 : useStore.getState().timeOfDay)
  const lastMinute = useRef(-1)

  useEffect(() => {
    setClock = (t) => { clock.current = t; glide.active = false }
    readClock = () => clock.current
    return () => { setClock = null; readClock = null }
  }, [])
  const soundClock = useRef(0)
  const sunPos = useRef(new Vector3()).current
  const envTimer = useRef(99)
  const lastLights = useRef(false)

  if (!scene.fog) scene.fog = new FogExp2('#c6d5d6', 0.0032)

  const { envScene, envSky, envGround, pmrem } = useMemo(() => {
    const envScene = new Scene()
    const envSky = new Mesh(
      new SphereGeometry(10, 16, 12),
      new MeshBasicMaterial({ color: '#c6d5d6', side: BackSide }),
    )
    const envGround = new Mesh(
      new SphereGeometry(9.6, 12, 8),
      new MeshBasicMaterial({ color: '#3a4a33', side: BackSide }),
    )
    envGround.scale.set(1, 0.42, 1)
    envGround.position.y = -6
    envScene.add(envSky, envGround)
    const pmrem = new PMREMGenerator(gl)
    pmrem.compileEquirectangularShader()
    return { envScene, envSky, envGround, pmrem }
  }, [gl])

  useEffect(() => () => pmrem.dispose(), [pmrem])

  useFrame((_, dt) => {
    if (glide.active) {
      glide.t = Math.min(1, glide.t + dt / glide.seconds)
      const e = glide.t * glide.t * (3 - 2 * glide.t)
      clock.current = (glide.from + glide.span * e) % 1
      if (glide.t >= 1) glide.active = false
    } else if (!pinned) {
      clock.current = (clock.current + (dt / DAY_LENGTH_SECONDS) * timeScale) % 1
    }
    dayState(clock.current, day)
    // the soundscape follows the light, a couple of times a second
    soundClock.current += dt
    if (soundClock.current > 0.5) {
      soundClock.current = 0
      setNightAmount(day.night)
    }
    // Publishing the clock to the store every frame is a React state update
    // every frame. The HUD only shows whole minutes, so only tell it when the
    // minute actually changes.
    const minute = minutesOfDay(clock.current)
    if (minute !== lastMinute.current) {
      lastMinute.current = minute
      useStore.getState().setTimeOfDay(clock.current)
    }

    const sun = sunRef.current
    if (sun) {
      sunPos.copy(day.sun).multiplyScalar(70)
      sun.position.set(player.pos.x + sunPos.x, player.pos.y + sunPos.y, player.pos.z + sunPos.z)
      sun.target.position.copy(player.pos)
      sun.target.updateMatrixWorld()
      sun.color.copy(day.sunColor)
      sun.intensity = Math.max(0, day.sunIntensity) * (day.sun.y > -0.05 ? 1 : 0)
    }
    const moon = moonRef.current
    if (moon) {
      moon.position.set(
        player.pos.x + day.moon.x * 70,
        player.pos.y + Math.abs(day.moon.y) * 70 + 10,
        player.pos.z + day.moon.z * 70,
      )
      moon.target.position.copy(player.pos)
      moon.target.updateMatrixWorld()
      moon.intensity = day.moonIntensity
    }
    if (hemi.current) {
      hemi.current.color.copy(day.ambient)
      hemi.current.intensity = day.ambientIntensity * 0.55
    }

    const fog = scene.fog as FogExp2
    fog.color.copy(day.fog)
    fog.density = day.fogDensity * preset.drawDistance
    scene.background = null

    if (day.lightsOn !== lastLights.current) {
      lastLights.current = day.lightsOn
      setLightsOn(day.lightsOn)
    }

    envTimer.current += dt
    if (envTimer.current > 2) {
      envTimer.current = 0
      const skyMat = envSky.material as MeshBasicMaterial
      const groundMat = envGround.material as MeshBasicMaterial
      skyMat.color.copy(day.fog).lerp(day.zenith, 0.45).multiplyScalar(0.55 + day.sunIntensity * 0.18)
      groundMat.color.copy(day.ambient).multiplyScalar(0.22 + (1 - day.night) * 0.3)
      const target = pmrem.fromScene(envScene, 0.04)
      const previous = scene.environment
      scene.environment = target.texture
      scene.environmentIntensity = 0.55 + (1 - day.night) * 0.35
      previous?.dispose()
    }
  })

  return (
    <>
      <SkyDome state={day} />
      {/* the ground bounce is a warm violet, so shadows read soft and coloured, not black */}
      <hemisphereLight ref={hemi} args={['#b9cfdd', '#6a5a72', 0.6]} />
      <directionalLight
        ref={sunRef}
        castShadow={preset.shadows}
        shadow-mapSize-width={preset.shadowSize}
        shadow-mapSize-height={preset.shadowSize}
        shadow-camera-near={1}
        shadow-camera-far={130}
        shadow-camera-left={-30}
        shadow-camera-right={30}
        shadow-camera-top={30}
        shadow-camera-bottom={-30}
        shadow-bias={-0.0008}
        shadow-normalBias={0.03}
      />
      {/* moonlight: cool, soft, and never bright enough to read as daylight */}
      <directionalLight ref={moonRef} color="#9fb6e8" intensity={0} />
    </>
  )
}
