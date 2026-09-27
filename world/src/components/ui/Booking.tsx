import { useEffect, useState } from 'react'
import { coach } from '../../data/coach'
import { LINKS } from '../../data/links'
import { process } from '../../data/programs'
import { useStore } from '../../state/store'

/**
 * The CTA at the summit. Coaching enquiries are handled by Coach Blue's own
 * form, so this collects the same first details and hands them straight over
 * rather than pretending to be a second system of record.
 */
export function Booking() {
  const open = useStore((s) => s.bookingOpen)
  const setOpen = useStore((s) => s.setBooking)
  const context = useStore((s) => s.bookingContext)
  const [name, setName] = useState('')
  const [goal, setGoal] = useState<string>(coach.goals[0])

  // opened from something the player did: start on the goal that fits it
  useEffect(() => {
    if (open && context?.goal && (coach.goals as readonly string[]).includes(context.goal)) setGoal(context.goal)
  }, [open, context])

  if (!open) return null

  const href = `${LINKS.inquiry}${LINKS.inquiry.includes('?') ? '&' : '?'}${new URLSearchParams({
    ...(name ? { name } : {}),
    goal,
  })}`

  return (
    <div className="sheet-wrap" onClick={() => setOpen(false)}>
      <div className="sheet booking" onClick={(e) => e.stopPropagation()}>
        <button className="close" onClick={() => setOpen(false)} aria-label="Close">✕</button>
        <span className="eyebrow">{context?.reason ? `After ${context.reason}` : 'Start coaching'}</span>
        <h2>{coach.closing.title}</h2>
        <p>{coach.intro}</p>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            window.open(href, '_blank', 'noopener')
          }}
        >
          <label className="field">
            <span>Your name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="First name" autoComplete="given-name" />
          </label>
          <label className="field">
            <span>What do you want to achieve?</span>
            <select value={goal} onChange={(e) => setGoal(e.target.value)}>
              {coach.goals.map((g) => <option key={g}>{g}</option>)}
            </select>
          </label>
          <button className="btn primary wide" type="submit">Continue to the inquiry form</button>
          <p className="note">
            This opens Coach Blue's own inquiry form, where the enquiry is actually received.
            Nothing is stored here.
          </p>
        </form>

        <h3>{process.title}</h3>
        <ol className="steps">
          {process.steps.map((s) => (
            <li key={s.title}><b>{s.title}.</b> {s.body}</li>
          ))}
        </ol>
      </div>
    </div>
  )
}
