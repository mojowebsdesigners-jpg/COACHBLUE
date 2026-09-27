import { useEffect, useRef, useState } from 'react'
import { locationById } from '../../data/journey'
import { clearDestination, formatDistance, nav, onNavChange, update } from '../../systems/Navigation'
import { player } from '../../state/store'

/**
 * A thin strip naming where you are headed and how far it is, with a chevron
 * that turns to point at it relative to the way you are facing.
 *
 * It refreshes about four times a second rather than every frame: a distance
 * that flickers through every metre is harder to read than one that settles,
 * and re-rendering React sixty times a second to move a number is exactly the
 * cost this project has been trying to shed.
 */
export function Waypoint() {
  const [, force] = useState(0)
  const timer = useRef(0)

  useEffect(() => onNavChange(() => force((n) => n + 1)), [])

  useEffect(() => {
    timer.current = window.setInterval(() => {
      if (!nav.destination) return
      update()
      force((n) => n + 1)
    }, 250)
    return () => clearInterval(timer.current)
  }, [])

  if (!nav.destination) return null
  const place = locationById[nav.destination]
  // where the destination sits relative to where the player is looking
  let rel = nav.bearing - player.yaw
  while (rel > Math.PI) rel -= Math.PI * 2
  while (rel < -Math.PI) rel += Math.PI * 2

  return (
    <div className="waypoint">
      <span className="waypoint__arrow" style={{ transform: `rotate(${rel}rad)` }} aria-hidden>↑</span>
      <span className="waypoint__name">{place.name}</span>
      <span className="waypoint__dist">{formatDistance(nav.distance)}</span>
      <button className="waypoint__clear" onClick={() => clearDestination()} title="Clear destination">×</button>
    </div>
  )
}
