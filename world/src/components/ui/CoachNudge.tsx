import { useEffect } from 'react'
import { useStore } from '../../state/store'
import { openLink } from '../../data/links'

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

  // his site in a new tab, or his sign-up form with the goal already chosen
  const act = () => {
    if (!nudge) return
    if (nudge.href) { openLink(nudge.href); setNudge(null) }
    else openBooking({ goal: nudge.goal, reason: nudge.title })
  }
  useEffect(() => {
    if (!nudge) return
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'KeyB') act()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nudge, openBooking])

  if (!nudge || busy) return null
  return (
    <div className="nudge" key={nudge.key} role="dialog" aria-label="Train with Coach Blue">
      <img src="/img/coach-cutout.webp" alt="" className="nudge__face" />
      <div className="nudge__text">
        <span className="nudge__eyebrow">{nudge.title}</span>
        <p>{nudge.body}</p>
        <div className="nudge__actions">
          <button className="btn primary" onClick={act}>
            <kbd>B</kbd> {nudge.cta ?? 'Get my plan'}
          </button>
          <button className="btn ghost" onClick={() => setNudge(null)}>Not now</button>
        </div>
      </div>
    </div>
  )
}
