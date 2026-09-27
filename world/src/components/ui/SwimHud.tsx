import { useEffect, useState } from 'react'
import { player } from '../../state/store'

/**
 * While swimming: how to dive, and — once under — how much air is left.
 * Polled a few times a second, and only drawn in the water.
 */
export function SwimHud() {
  const [s, set] = useState({ swim: false, dive: 0, breath: 1 })
  useEffect(() => {
    const id = setInterval(() => {
      const next = { swim: player.swimming, dive: player.dive, breath: player.breath }
      set((p) => (p.swim === next.swim && Math.abs(p.dive - next.dive) < 0.05 && Math.abs(p.breath - next.breath) < 0.01 ? p : next))
    }, 150)
    return () => clearInterval(id)
  }, [])
  if (!s.swim) return null
  const under = s.dive > 0.5
  return (
    <div className="swim-hud" role="status">
      <p><kbd>C</kbd> dive · <kbd>Space</kbd> up{under ? ` · ${s.dive.toFixed(1)} m` : ''}</p>
      {(under || s.breath < 0.99) && (
        <div className={`swim-hud__air ${s.breath < 0.25 ? 'is-low' : ''}`}>
          <span>Air</span>
          <i><b style={{ width: `${s.breath * 100}%` }} /></i>
        </div>
      )}
    </div>
  )
}
