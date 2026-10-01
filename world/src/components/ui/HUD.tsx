import { RadioCard, useRadio } from './RadioCard'
import { toggle as toggleRadio } from '../../lib/radio'
import { useEffect, useState } from 'react'
import { journeySteps } from '../../data/journey'
import { isTouchDevice, setTouchAction, setTouchDive } from '../../lib/input'
import { player, useStore } from '../../state/store'
import { triggerNearest } from '../3d/InteractionSystem'
import { WorldClock } from './WorldClock'
import { MouseLookHint } from './MouseLookHint'
import { summonVehicle, vehicle } from '../../systems/VehicleController'
import { WorkoutHud } from './WorkoutHud'
import { CoachNudge } from './CoachNudge'
import { CourseHud } from './CourseHud'
import { SwimHud } from './SwimHud'
import { Dialog } from './Dialog'
import { Waypoint } from './Waypoint'
import { ControlsCard } from './ControlsCard'

export function HUD() {
  const phase = useStore((s) => s.phase)
  const nearest = useStore((s) => s.nearest)
  const panel = useStore((s) => s.panel)
  const photo = useStore((s) => s.photoIndex)
  const mapOpen = useStore((s) => s.mapOpen)
  const journalOpen = useStore((s) => s.journalOpen)
  const settingsOpen = useStore((s) => s.settingsOpen)
  const bookingOpen = useStore((s) => s.bookingOpen)
  const photoMode = useStore((s) => s.photoMode)
  const cinematic = useStore((s) => s.cinematic)
  const settings = useStore((s) => s.settings)
  const update = useStore((s) => s.updateSettings)
  const setMap = useStore((s) => s.setMap)
  const setJournal = useStore((s) => s.setJournal)
  const setSettingsOpen = useStore((s) => s.setSettingsOpen)
  const setPhotoMode = useStore((s) => s.setPhotoMode)
  const mode = useStore((s) => s.mode)
  const setMode = useStore((s) => s.setMode)
  const view = useStore((s) => s.view)
  const toggleView = useStore((s) => s.toggleView)
  const setPhase = useStore((s) => s.setPhase)
  const toast = useStore((s) => s.toast)
  const banner = useStore((s) => s.journeyBanner)
  const offPathHint = useStore((s) => s.offPathHint)
  const campPrompt = useStore((s) => s.campPrompt)
  const setCampPrompt = useStore((s) => s.setCampPrompt)
  const advance = useStore((s) => s.advanceJourney)
  const finale = useStore((s) => s.finale)

  const [toastOn, setToastOn] = useState(false)
  const [bannerOn, setBannerOn] = useState(false)
  const touch = isTouchDevice()

  useEffect(() => {
    if (!toast) return
    setToastOn(true)
    const t = setTimeout(() => setToastOn(false), 3400)
    return () => clearTimeout(t)
  }, [toast?.key])

  useEffect(() => {
    if (!banner) return
    setBannerOn(true)
    const t = setTimeout(() => setBannerOn(false), 6000)
    return () => clearTimeout(t)
  }, [banner?.key])

  const { playing: music } = useRadio()
  // a cinematic has the whole frame: only the letterbox and its title show
  if (phase !== 'world' || photoMode || cinematic) return null
  const busy = !!panel || photo !== null || mapOpen || journalOpen || settingsOpen || bookingOpen || finale || !!cinematic

  return (
    <div className="hud">
      <div className="hud-brand">
        <img src="/img/logo.webp" alt="" />
        Coach Blue
      </div>
      <WorldClock />
      <MouseLookHint />
      <WorkoutHud />
      <CoachNudge />
      <CourseHud />
      <SwimHud />
      <Dialog />
      <Waypoint />
      <ControlsCard />
      <RadioCard />

      <div className="hud-tools">
        <button
          className="tool wide coach-me"
          onClick={() => useStore.getState().openBooking({ reason: 'Exploring the world' })}
          title="Train with Coach Blue"
        >
          COACH ME
        </button>
        <button
          className="tool"
          onClick={() => {
            if (vehicle.occupied) return
            summonVehicle()
            useStore.getState().showToast('CAR READY', 'It is waiting just ahead — press E to get in')
          }}
          title="Bring the car to you (O)"
        >
          CAR
        </button>
        <button className="tool" onClick={() => {
          const st = useStore.getState()
          const next = st.outfit === 'shirt' ? 'shirtless' : 'shirt'
          st.setOutfit(next)
          st.showToast(next === 'shirt' ? 'COACH BLUE SHIRT' : 'SHIRT OFF', next === 'shirt' ? 'Team colours on' : 'Training in the sun')
        }} title="Change outfit (K)">👕</button>
        <button className="tool" onClick={() => setMap(!mapOpen)} title="Map (M)">MAP</button>
        <button className="tool" onClick={() => setJournal(!journalOpen)} title="Journey log (J)">LOG</button>
        <button className="tool" onClick={() => setPhotoMode(true)} title="Photo mode (P)">PHOTO</button>
        <button
          className={`tool ${settings.sound ? 'on' : ''}`}
          onClick={() => update({ sound: !settings.sound })}
          title="Sound"
        >
          {settings.sound ? '♪' : '✕'}
        </button>
        <button
          className={`tool wide headset-btn ${music ? 'on' : ''}`}
          onClick={toggleRadio}
          title="Headset music (H)"
          aria-pressed={music}
        >
          🎧 <span>{music ? 'AUDIO ON' : 'AUDIO OFF'}</span>
        </button>
        <button className="tool wide" onClick={() => setMode(mode === 'free' ? 'guided' : 'free')}>
          {mode === 'free' ? 'FREE' : 'GUIDED'}
        </button>
        <button className="tool" onClick={toggleView} title="First / third person (V)">
          {view === 'third' ? '3P' : '1P'}
        </button>
        <button className="tool" onClick={() => setSettingsOpen(!settingsOpen)} title="Settings">⚙</button>
        <button className="tool wide" onClick={() => setPhase('classic')}>EXIT 3D</button>
      </div>

      {mode === 'guided' && banner && bannerOn && !busy && (
        <div className="journey" key={banner.key}>
          <div className="step">
            {`JOURNEY  ${String(banner.index + 1).padStart(2, '0')} / ${String(journeySteps.length).padStart(2, '0')}`}
          </div>
          <div className="label">{banner.label}</div>
          <div className="line">{banner.line}</div>
        </div>
      )}

      {toast && toastOn && !busy && (
        <div className="toast" key={toast.key}>
          <div className="rule" />
          <div className="title">{toast.title}</div>
          {toast.sub && <div className="sub">{toast.sub}</div>}
          <div className="rule" style={{ marginTop: 10 }} />
        </div>
      )}

      {offPathHint && mode === 'guided' && !busy && (
        <div className="hint">The journey continues this way</div>
      )}

      {campPrompt && mode === 'guided' && !busy && (
        <div className="choice">
          <p>Ready for the next step?</p>
          <div>
            <button className="btn primary" onClick={() => advance()}>Continue journey</button>
            <button className="btn" onClick={() => { setCampPrompt(false); setMode('free') }}>Keep exploring</button>
          </div>
        </div>
      )}

      {nearest && !busy && (
        <button className="prompt" onClick={triggerNearest}>
          <span className="key">{touch ? '⦿' : 'E'}</span>
          {nearest.label}
        </button>
      )}

      {!touch && (
        <div className="hud-controls">
          <span><b>WASD / ↑↓←→</b> move</span>
          <span><b>Shift</b> run</span>
          <span><b>Space</b> jump</span>
          <span><b>E</b> interact</span>
          <span><b>M</b> map</span>
          <span><b>J</b> log</span>
          <span><b>P</b> photo</span>
          <span><b>V</b> view</span>
        </div>
      )}
    </div>
  )
}

/** Virtual stick and interact button for touch devices. */
export function TouchControls({ onStick }: { onStick: (x: number, y: number) => void }) {
  const phase = useStore((s) => s.phase)
  const photoMode = useStore((s) => s.photoMode)
  const [knob, setKnob] = useState({ x: 0, y: 0 })
  const [touch, setTouch] = useState(false)

  useEffect(() => {
    setTouch(isTouchDevice())
  }, [])
  // the dive button only while he is in the water (polled: swimming lives
  // outside React)
  const [swimming, setSwimming] = useState(false)
  useEffect(() => {
    if (!touch) return
    const id = setInterval(() => setSwimming(player.swimming), 300)
    return () => clearInterval(id)
  }, [touch])

  if (phase !== 'world' || !touch || photoMode) return null

  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2)
    const dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2)
    const len = Math.hypot(dx, dy)
    const nx = len > 1 ? dx / len : dx
    const ny = len > 1 ? dy / len : dy
    setKnob({ x: nx * 38, y: ny * 38 })
    onStick(nx, ny)
  }
  const stop = () => {
    setKnob({ x: 0, y: 0 })
    onStick(0, 0)
    player.speed = 0
  }

  return (
    <>
      <div
        className="stick"
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); move(e) }}
        onPointerMove={(e) => e.currentTarget.hasPointerCapture(e.pointerId) && move(e)}
        onPointerUp={stop}
        onPointerCancel={stop}
      >
        <i style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} />
      </div>
      <button className="touch-e" onClick={triggerNearest}>E</button>
      {/* jump in the world; in an activity, a tap is a rep and holding keeps going */}
      <button
        className="touch-a"
        aria-label="Action"
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setTouchAction(true) }}
        onPointerUp={() => setTouchAction(false)}
        onPointerCancel={() => setTouchAction(false)}
      >▲</button>
      {swimming && (
        <button
          className="touch-dive"
          aria-label="Dive"
          onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setTouchDive(true) }}
          onPointerUp={() => setTouchDive(false)}
          onPointerCancel={() => setTouchDive(false)}
        >⬇</button>
      )}
    </>
  )
}
