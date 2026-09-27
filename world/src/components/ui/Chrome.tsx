import { useEffect, useRef, useState } from 'react'
import { cinematicTitle } from '../3d/Cinematics'
import { locations } from '../../data/journey'
import { isTouchDevice } from '../../lib/input'
import { buildShareCard, downloadDataUrl } from '../../lib/share'
import { useStore } from '../../state/store'

/** Cinematic bars, shown only while a scripted camera move is running. */
export function Letterbox() {
  const cinematic = useStore((s) => s.cinematic)
  const shot = cinematicTitle(cinematic)
  return (
    <div className={`letterbox ${cinematic ? 'on' : ''}`}>
      <i /><i />
      {shot && (
        <div className="cine-title" key={cinematic}>
          <span className="cine-title__rule" />
          <h2>{shot.title}</h2>
          <p>{shot.line}</p>
        </div>
      )}
    </div>
  )
}

const VERB_LABEL: Record<string, string> = {
  INTERACT: 'Interact', VIEW: 'View', TALK: 'Talk', READ: 'Read', OPEN: 'Open',
  ENTER: 'Enter', LIGHT: 'Light', START: 'Start', LOOK: 'Look', INSPECT: 'Inspect',
}

/** Desktop cursor that names what's under the player's attention. */
export function Cursor() {
  const nearest = useStore((s) => s.nearest)
  const phase = useStore((s) => s.phase)
  const ref = useRef<HTMLDivElement>(null)
  const [touch, setTouch] = useState(true)

  useEffect(() => {
    setTouch(isTouchDevice())
  }, [])

  useEffect(() => {
    if (touch) return
    const move = (e: PointerEvent) => {
      const el = ref.current
      if (el) el.style.transform = `translate3d(${e.clientX}px, ${e.clientY}px, 0)`
    }
    window.addEventListener('pointermove', move)
    document.body.classList.add('custom-cursor')
    return () => {
      window.removeEventListener('pointermove', move)
      document.body.classList.remove('custom-cursor')
    }
  }, [touch])

  if (touch || phase === 'classic' || phase === 'unsupported') return null
  const verb = nearest?.verb ?? (nearest ? 'INTERACT' : null)

  return (
    <div ref={ref} className={`cursor ${verb ? 'active' : ''}`}>
      <i />
      {verb && <span>{VERB_LABEL[verb] ?? 'Interact'}</span>}
    </div>
  )
}

/** Photo mode: HUD out of the way, orbit and zoom, ESC to leave. */
export function PhotoModeBar() {
  const on = useStore((s) => s.photoMode)
  const setPhotoMode = useStore((s) => s.setPhotoMode)
  const discovered = useStore((s) => s.discovered)
  const showToast = useStore((s) => s.showToast)
  const [saving, setSaving] = useState(false)
  if (!on) return null

  const save = async () => {
    setSaving(true)
    const card = await buildShareCard({ found: discovered.length, total: locations.length })
    setSaving(false)
    if (card) {
      downloadDataUrl(card)
      showToast('SAVED', 'Your journey card')
    } else {
      showToast('COULD NOT SAVE')
    }
  }

  return (
    <div className="photo-bar">
      <span className="eyebrow">Photo mode</span>
      <span>Drag to orbit · scroll to zoom · <b>P</b> or <b>Esc</b> to exit</span>
      <button className="btn" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save image'}</button>
      <button className="btn" onClick={() => setPhotoMode(false)}>Exit</button>
    </div>
  )
}

/** Shown when WebGL isn't available at all. */
export function Unsupported() {
  const phase = useStore((s) => s.phase)
  const setPhase = useStore((s) => s.setPhase)
  if (phase !== 'unsupported') return null
  return (
    <div className="screen">
      <div className="loading">
        <img className="logo" src="/img/logo.webp" alt="Coach Blue" />
        <span className="eyebrow">Coach Blue</span>
        <h1 className="h-display">The forest needs 3D graphics</h1>
        <p style={{ textTransform: 'none', letterSpacing: 0 }}>
          This browser can&rsquo;t run WebGL, so the world can&rsquo;t load. Everything Coach Blue
          offers is on the standard site instead.
        </p>
        <button className="enter-btn" onClick={() => setPhase('classic')}>Open the site</button>
      </div>
    </div>
  )
}
