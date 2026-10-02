import { Component, Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { AdaptiveDpr, Preload } from '@react-three/drei'
import { Bloom, BrightnessContrast, DepthOfField, EffectComposer, HueSaturation, SMAA, Vignette } from '@react-three/postprocessing'
import { ACESFilmicToneMapping } from 'three'
import { World } from './components/3d/World'
import { Player } from './components/3d/Player'
import { CameraController, cameraOverride } from './components/3d/CameraController'
import { Cinematics } from './components/3d/Cinematics'
import { InteractionSystem, closeInteraction, findInteractable, triggerById, triggerNearest } from './components/3d/InteractionSystem'
import { DebugHud, debugEnabled } from './components/ui/DebugHud'
import { summonVehicle, vehicle } from './systems/VehicleController'
import { isWorkingOut, stopWorkout, workout } from './systems/Workout'
import { setDestination } from './systems/Navigation'
import { travel } from './systems/FastTravel'
import { registerMapPlaces } from './systems/MapPlaces'
import './systems/Coaching'
import './systems/DevCheats'
import { preloadModels } from './systems/AssetManager'
import { ShaderWarmup } from './components/3d/ShaderWarmup'
import { ShaderGate } from './components/3d/ShaderGate'
import { AutoColliders } from './components/3d/AutoColliders'
import { PerformanceWatch } from './components/3d/PerformanceWatch'
import { DistanceCull } from './components/3d/DistanceCull'
import { attachInput, input, setJoystick } from './lib/input'
import * as terrain from './lib/terrain'
import { locationById } from './data/journey'
import { mushrooms } from './components/3d/Vegetation'
import { benchSpots } from './components/3d/Seats'
import { resetCamera } from './systems/ThirdPersonCamera'
import { next as nextTrack, prev as prevTrack, radio, toggle as toggleRadio } from './lib/radio'

/**
 * A touch over neutral. ACES rolls the highlights off gently, so lifting the
 * exposure brightens the midtones — grass, skin, asphalt — without blowing out
 * the sky, which is what makes a summer afternoon read as sunny rather than
 * merely lit. Night stays dark because the sun contributes almost nothing.
 */
const SUN_EXPOSURE = 1.02

// start fetching every model the moment the module is evaluated, so the
// progress bar covers the real work rather than a subset of it
preloadModels()
import { webglAvailable, webgpuAvailable } from './lib/quality'
import { player, setCinematicBlock, useStore } from './state/store'
import { boarding, isBoarding } from './systems/Boarding'
import { isBusyHand } from './systems/HandAction'
import { LoadingScreen } from './components/ui/LoadingScreen'
import { ModeSelect } from './components/ui/ModeSelect'
import { HUD, TouchControls } from './components/ui/HUD'
import { Panel } from './components/ui/Panel'
import { PhotoViewer } from './components/ui/PhotoViewer'
import { MiniMap } from './components/ui/MiniMap'
import { Finale } from './components/ui/Finale'
import { ClassicSite } from './components/ui/ClassicSite'
import { Settings } from './components/ui/Settings'
import { JourneyLog } from './components/ui/JourneyLog'
import { Booking } from './components/ui/Booking'
import { Cursor, Letterbox, PhotoModeBar, Unsupported } from './components/ui/Chrome'
import { setAmbienceEnabled, setMusicEnabled, startAmbience } from './lib/audio'
import './styles/global.css'

/** Shirt on, shirt off — with a word about it. */
export function toggleOutfit() {
  const s = useStore.getState()
  const next = s.outfit === 'shirt' ? 'shirtless' : 'shirt'
  s.setOutfit(next)
  s.showToast(next === 'shirt' ? 'COACH BLUE SHIRT' : 'SHIRT OFF', next === 'shirt' ? 'Team colours on' : 'Training in the sun')
}

registerMapPlaces()

// no arrival cinematics while driving, training, boarding or holding a hand action
setCinematicBlock(() => vehicle.occupied || isWorkingOut() || isBoarding() || isBusyHand())

// dev builds only: a handle for scripted testing (headless screenshots drive
// the world through this rather than guessing at load times)
if (import.meta.env.DEV) {
  const w = window as unknown as { __cb?: Record<string, unknown> }
  w.__cb = { ...w.__cb, player, vehicle, useStore, triggerById, input, terrain, locationById, resetCamera, cameraOverride, workout, mushrooms, findInteractable, benchSpots, boarding }
}

/** If the 3D scene throws, fall back to the readable site instead of a blank page. */
class SceneBoundary extends Component<{ children: ReactNode; onError: () => void }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error: unknown) {
    console.error('3D scene failed:', error)
    this.props.onError()
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

/**
 * Using a priority in any useFrame hands the render loop to us (the IK and camera
 * passes need to run after the animation mixer). When post-processing is off,
 * nothing else draws the scene — so this does, last in the frame.
 */
function RenderPass() {
  useFrame(({ gl, scene, camera }) => {
    gl.render(scene, camera)
  }, 1000)
  return null
}

function Scene({ webgpu }: { webgpu: boolean }) {
  const noPost = typeof location !== 'undefined' && new URLSearchParams(location.search).has('nopost')
  const preset = useStore((s) => s.preset)
  const reduced = useStore((s) => s.settings.reducedMotion)
  return (
    <>
      <CameraController />
      <InteractionSystem />
      <Cinematics />
      <Suspense fallback={null}>
        <World />
        <Player />
        {debugEnabled() && <DebugHud />}
        <Preload all />
        <ShaderWarmup />
        <ShaderGate />
        <AutoColliders />
        <PerformanceWatch />
        <DistanceCull />
      </Suspense>
      {preset.post && !noPost && !webgpu ? (
        <EffectComposer enableNormalPass={false} renderPriority={1000}>
          <Bloom intensity={reduced ? 0.2 : 0.32} luminanceThreshold={0.8} luminanceSmoothing={0.28} mipmapBlur />
          {preset.depthOfField
            ? <DepthOfField focusDistance={0.012} focalLength={0.05} bokehScale={2.2} />
            : <></>}
          {/* a gentle grade: a little less saturation and contrast, so the
              day reads soft and painterly rather than harsh */}
          <HueSaturation saturation={-0.1} />
          <BrightnessContrast brightness={0.01} contrast={-0.07} />
          <Vignette offset={0.28} darkness={0.45} />
          <SMAA />
        </EffectComposer>
      ) : (
        <RenderPass />
      )}
      <AdaptiveDpr pixelated />
    </>
  )
}

export default function App() {
  const phase = useStore((s) => s.phase)
  const settings = useStore((s) => s.settings)
  const preset = useStore((s) => s.preset)
  const photoMode = useStore((s) => s.photoMode)
  const setPhase = useStore((s) => s.setPhase)
  const host = useRef<HTMLDivElement>(null)
  const [canRender3D, setCanRender3D] = useState(true)
  const [gpuOk, setGpuOk] = useState(false)

  // WebGPU is opt-in; anything unexpected drops straight back to WebGL
  useEffect(() => {
    let live = true
    webgpuAvailable().then((ok) => live && setGpuOk(ok))
    return () => {
      live = false
    }
  }, [])

  const useWebGPU = gpuOk && settings.renderer === 'webgpu'

  useEffect(() => {
    if (!webglAvailable()) {
      setCanRender3D(false)
      useStore.getState().setPhase('unsupported')
    }
  }, [])

  useEffect(() => {
    const el = host.current
    if (!el) return
    return attachInput(el, {
      onInteract: () => {
        const s = useStore.getState()
        if (s.phase !== 'world') return
        if (s.panel || s.photoIndex !== null) {
          s.openPhoto(null)
          closeInteraction()
        } else {
          triggerNearest()
        }
      },
      onMap: () => {
        const s = useStore.getState()
        if (s.phase === 'world' && !s.panel && !s.photoMode) s.setMap(!s.mapOpen)
      },
      onJournal: () => {
        const s = useStore.getState()
        if (s.phase === 'world' && !s.panel && !s.photoMode) s.setJournal(!s.journalOpen)
      },
      onPhotoMode: () => {
        const s = useStore.getState()
        if (s.phase === 'world') s.setPhotoMode(!s.photoMode)
      },
      onHeadset: () => {
        if (useStore.getState().phase === 'world') toggleRadio()
      },
      onNextTrack: () => { if (radio.playing) nextTrack() },
      onPrevTrack: () => { if (radio.playing) prevTrack() },
      onView: () => {
        const s = useStore.getState()
        if (s.phase === 'world' && !s.panel) s.toggleView()
      },
      onSummonVehicle: () => {
        const s = useStore.getState()
        if (s.phase !== 'world' || s.panel || vehicle.occupied) return
        summonVehicle()
        s.showToast('CAR READY', 'It is waiting just ahead — press E to get in')
      },
      onOutfit: () => {
        const s = useStore.getState()
        if (s.phase === 'world' && !s.panel) toggleOutfit()
      },
      onEscape: () => {
        const s = useStore.getState()
        // a set in progress owns Escape: ending it is what the key is for
        if (isWorkingOut()) { stopWorkout(); return }
        if (s.photoMode) s.setPhotoMode(false)
        else if (s.photoIndex !== null) {
          s.openPhoto(null)
          closeInteraction()
        } else if (s.panel) closeInteraction()
        else if (s.bookingOpen) s.setBooking(false)
        else if (s.mapOpen) s.setMap(false)
        else if (s.journalOpen) s.setJournal(false)
        else if (s.settingsOpen) s.setSettingsOpen(false)
        else if (s.finale) s.setFinale(false)
      },
    })
  }, [])

  // First arrival: name the world, then give one destination. Being dropped
  // into open country with no idea which way to walk is the most common way a
  // world like this loses someone in the first thirty seconds.
  useEffect(() => {
    let greeted = false
    return useStore.subscribe((s) => {
      if (greeted || s.phase !== 'world') return
      greeted = true
      s.showToast("COACH BLUE'S WORLD", 'Follow the road — the training camp is ahead')
      setDestination('camp')
    })
  }, [])

  // freeze the character whenever something is open over the world
  useEffect(() =>
    useStore.subscribe((s) => {
      const busy =
        !!s.panel || s.photoIndex !== null || s.mapOpen || s.journalOpen || s.settingsOpen ||
        s.bookingOpen || s.photoMode || !!s.cinematic || !!s.dialog || s.phase !== 'world'
      // a map flight, a boarding, a hand action or a set keep him held too
      player.frozen = busy || travel.active || isBoarding() || isBusyHand() || isWorkingOut()
      // Mouse look may only capture the pointer while the world is actually
      // being played. The canvas mounts during loading so assets can stream,
      // which means a click on the splash or the mode screen lands on it — and
      // capturing there hides the cursor over a screen built to be clicked.
      input.mouseLook = s.phase === 'world' && !busy
      if (!input.mouseLook && document.pointerLockElement) document.exitPointerLock?.()
    }), [])

  // testing shortcuts: ?start=guided|free &at=x,z &cam=dist,pitch,yaw &panel=… &map=1
  //                     &hour=0..24 &act=<interactable id> &lite=1
  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const q = params.get('start')
    if (q === 'guided' || q === 'free') {
      const s = useStore.getState()
      s.setMode(q, false)
      s.setPhase('world')
    }
    const tier = params.get('tier')
    if (tier) useStore.getState().updateSettings({ tier: tier as never })
    if (params.get('map')) useStore.getState().setMap(true)
    if (params.get('view') === 'first') useStore.getState().toggleView()
    const panel = params.get('panel')
    if (panel) useStore.getState().openPanel({ kind: panel as never, index: Number(params.get('i') ?? 0) })
    const at = params.get('at')
    if (at) {
      const [x, z] = at.split(',').map(Number)
      if (Number.isFinite(x) && Number.isFinite(z)) player.pos.set(x, 0, z)
    }
    // ?act=<id> fires one interactable once the world has settled, so a
    // screenshot can capture a state that normally needs a keypress
    const act = params.get('act')
    if (act) {
      const deadline = Date.now() + 180000   // slow first loads (software GL) take a while
      const tick = setInterval(() => {
        if (triggerById(act) || Date.now() > deadline) clearInterval(tick)
      }, 400)
    }
    const cam = params.get('cam')
    if (cam) {
      const [dist, pitch, yaw] = cam.split(',').map(Number)
      if (Number.isFinite(dist)) {
        player.camDist = dist
        player.camDistMax = Math.max(11, dist)
      }
      if (Number.isFinite(pitch)) player.camPitch = pitch
      if (Number.isFinite(yaw)) player.camYaw = yaw
    }
  }, [])

  useEffect(() => {
    setAmbienceEnabled(settings.sound && phase === 'world')
    setMusicEnabled(settings.music && settings.sound && phase === 'world')
  }, [settings.sound, settings.music, phase])

  useEffect(() => {
    if (phase === 'world') startAmbience()
  }, [phase])

  return (
    <div ref={host} style={{ position: 'fixed', inset: 0 }}>
      {phase !== 'classic' && phase !== 'unsupported' && canRender3D && (
        <SceneBoundary onError={() => setPhase('classic')}>
          <Canvas
            key={useWebGPU ? 'webgpu' : 'webgl'}
            shadows={preset.shadows}
            dpr={preset.dpr}
            // Behind the splash the world only needs to load and compile, not
            // draw sixty times a second under an opaque screen: rendering it
            // there cost seconds of main thread and froze the opening film.
            frameloop={phase === 'loading' ? 'demand' : 'always'}
            gl={
              useWebGPU
                ? async (props) => {
                    try {
                      const { WebGPURenderer } = await import('three/webgpu')
                      const renderer = new WebGPURenderer({
                        ...(props as object),
                        antialias: false,
                        forceWebGL: false,
                      } as never)
                      await renderer.init()
                      renderer.toneMapping = ACESFilmicToneMapping
                      renderer.toneMappingExposure = SUN_EXPOSURE
                      return renderer as never
                    } catch (err) {
                      console.warn('WebGPU failed, falling back to WebGL:', err)
                      useStore.getState().updateSettings({ renderer: 'webgl' })
                      useStore.getState().showToast('WEBGPU UNAVAILABLE', 'Using WebGL')
                      throw err
                    }
                  }
                : {
                    antialias: false,
                    powerPreference: 'high-performance',
                    toneMapping: ACESFilmicToneMapping,
                    toneMappingExposure: SUN_EXPOSURE,
                  }
            }
            camera={{ fov: 58, near: 0.12, far: 2600, position: [0, 6, 176] }}
            onCreated={({ gl }) => {
              // the error check reads the program log synchronously, which
              // blocks until the driver has linked it; a shipped build has no
              // use for the log and should never wait on it
              if (import.meta.env.PROD && 'debug' in gl) (gl as { debug: { checkShaderErrors: boolean } }).debug.checkShaderErrors = false
              gl.domElement.addEventListener('webglcontextlost', () => setPhase('classic'))
            }}
          >
            <Scene webgpu={useWebGPU} />
          </Canvas>
        </SceneBoundary>
      )}
      <LoadingScreen />
      <ModeSelect />
      <HUD />
      <TouchControls onStick={setJoystick} />
      <Panel />
      <PhotoViewer />
      <MiniMap />
      <JourneyLog />
      <Settings />
      <Booking />
      <Finale />
      <Letterbox />
      <PhotoModeBar />
      {!photoMode && <Cursor />}
      <ClassicSite />
      <Unsupported />
    </div>
  )
}
