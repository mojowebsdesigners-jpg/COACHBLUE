import { useEffect, useState } from 'react'
import { useStore } from '../../state/store'
import { isTouchDevice } from '../../lib/input'
import { onWorkoutChange, workout } from '../../systems/Workout'

/**
 * The controls, shown once on first arrival and then on demand.
 *
 * Both schemes are listed together rather than one being treated as the real
 * way in: some people will reach for the mouse and some will not, and a player
 * who cannot find how to look around gives up long before they find the gym.
 */
const ROWS: [string, string][] = [
  ['W A S D / Arrows', 'Move — relative to the camera'],
  ['Mouse / Trackpad', 'Look around (click once to capture, Esc releases)'],
  ['Shift', 'Sprint'],
  ['Space', 'Jump'],
  ['E', 'Interact — talk, enter the car, start a set'],
  ['O', 'Bring the car to you'],
  ['M · J · P', 'Map · Journey log · Photo mode'],
  ['Esc', 'Close anything, or finish a set'],
]

const TOUCH_ROWS: [string, string][] = [
  ['Left stick', 'Move — push it all the way to sprint'],
  ['Drag the screen', 'Look around'],
  ['▲', 'Jump · in an activity, tap for a rep (hold to keep going)'],
  ['E', 'Interact — talk, enter the car, start an activity'],
  ['⬇', 'Dive, when you are swimming'],
  ['Top bar', 'Map · car · photo · settings (swipe it sideways)'],
]

export function ControlsCard() {
  const phase = useStore((s) => s.phase)
  const [open, setOpen] = useState(false)
  const [seen, setSeen] = useState(false)

  // show it once, the first time the world appears
  useEffect(() => {
    if (phase !== 'world' || seen) return
    setSeen(true)
    setOpen(true)
    const t = setTimeout(() => setOpen(false), 9000)
    return () => clearTimeout(t)
  }, [phase, seen])

  // an activity's own card needs the space more
  useEffect(() => onWorkoutChange(() => { if (workout.station) setOpen(false) }), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Slash' || e.code === 'F1') {
        e.preventDefault()
        setOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (phase !== 'world' || !open) return null

  return (
    <div className="controls-card">
      <div className="controls-card__head">
        <span>Controls</span>
        <button onClick={() => setOpen(false)} aria-label="Close">×</button>
      </div>
      <dl>
        {(isTouchDevice() ? TOUCH_ROWS : ROWS).map(([key, what]) => (
          <div key={key}>
            <dt>{key}</dt>
            <dd>{what}</dd>
          </div>
        ))}
      </dl>
      {!isTouchDevice() && <p className="controls-card__foot">Press <kbd>/</kbd> to show this again</p>}
    </div>
  )
}
