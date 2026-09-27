import { useEffect, useState } from 'react'

/**
 * A one-line nudge that the view is yours to turn. It shows until the pointer
 * has been captured once, then never again in this visit — an instruction you
 * have already followed is just clutter.
 */
export function MouseLookHint() {
  const [locked, setLocked] = useState(false)
  const [used, setUsed] = useState(false)

  useEffect(() => {
    const onChange = () => {
      const on = !!document.pointerLockElement
      setLocked(on)
      if (on) setUsed(true)
    }
    document.addEventListener('pointerlockchange', onChange)
    return () => document.removeEventListener('pointerlockchange', onChange)
  }, [])

  if (locked || used) return null
  return (
    <div className="look-hint" aria-hidden>
      Click to look around · <kbd>Esc</kbd> to release
    </div>
  )
}
