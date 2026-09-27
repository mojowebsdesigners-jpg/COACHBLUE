import { useEffect } from 'react'
import { useStore } from '../../state/store'

/**
 * "Want Coach Blue to help you with this?" — offered after something the
 * player actually did (see systems/Coaching). One tap (or B) opens his inquiry
 * form with the goal already chosen; left alone it bows out after a while.
 */
export function CoachNudge() {
  const nudge = useStore((s) => s.nudge)
  const setNudge = useStore((s) => s.setNudge)
  const openBooking = useStore((s) => s.openBooking)
  const busy = useStore((s) => !!s.panel || s.bookingOpen || !!s.cinematic || s.photoMode)

  useEffect(() => {
    if (!nudge) return
    const t = setTimeout(() => setNudge(null), 14000)
    return () => clearTimeout(t)
  }, [nudge, setNudge])

  useEffect(() => {
    if (!nudge) return
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'KeyB') openBooking({ goal: nudge.goal, reason: nudge.title })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [nudge, openBooking])

  if (!nudge || busy) return null
  return (
    <div className="nudge" key={nudge.key} role="dialog" aria-label="Train with Coach Blue">
      <img src="/img/coach-cutout.webp" alt="" className="nudge__face" />
      <div className="nudge__text">
        <span className="nudge__eyebrow">{nudge.title}</span>
        <p>{nudge.body}</p>
        <div className="nudge__actions">
          <button className="btn primary" onClick={() => openBooking({ goal: nudge.goal, reason: nudge.title })}>
            <kbd>B</kbd> Get my plan
          </button>
          <button className="btn ghost" onClick={() => setNudge(null)}>Not now</button>
        </div>
      </div>
    </div>
  )
}
