import { journeySteps, locations } from '../../data/journey'
import { secrets } from '../../data/secrets'
import { useStore } from '../../state/store'

/** Press J — what you've found, and what the world has told you so far. */
export function JourneyLog() {
  const open = useStore((s) => s.journalOpen)
  const setOpen = useStore((s) => s.setJournal)
  const discovered = useStore((s) => s.discovered)
  const found = useStore((s) => s.secrets)
  const index = useStore((s) => s.journeyIndex)
  const mode = useStore((s) => s.mode)

  if (!open) return null

  const insights = journeySteps.slice(0, mode === 'guided' ? index + 1 : journeySteps.length)
    .filter((s) => discovered.includes(s.id))

  return (
    <div className="sheet-wrap" onClick={() => setOpen(false)}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <button className="close" onClick={() => setOpen(false)} aria-label="Close">✕</button>
        <span className="eyebrow">Your journey</span>
        <h2>{discovered.length} of {locations.length} places found</h2>

        <h3>Places</h3>
        <ul className="ticks">
          {locations.map((l) => (
            <li key={l.id} className={discovered.includes(l.id) ? 'on' : ''}>
              <b>{discovered.includes(l.id) ? '✓' : '○'}</b> {l.name}
            </li>
          ))}
        </ul>

        <h3>Off the trail</h3>
        <ul className="ticks">
          {secrets.map((s) => {
            const got = found.some((f) => f.id === s.id)
            return (
              <li key={s.id} className={got ? 'on' : ''}>
                <b>{got ? '✓' : '○'}</b> {got ? s.name : '— not found yet'}
              </li>
            )
          })}
        </ul>

        {insights.length > 0 && (
          <>
            <h3>What the coach said</h3>
            {insights.map((s) => (
              <p key={s.id} className="insight">“{s.line}”</p>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
