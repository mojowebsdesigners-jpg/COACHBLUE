import { useSyncExternalStore } from 'react'
import { currentTrack, next, prev, radio, toggle } from '../../lib/radio'

const snapshot = () => `${radio.playing}:${radio.index}`

export function useRadio() {
  useSyncExternalStore(radio.subscribe, snapshot, snapshot)
  return { playing: radio.playing, track: currentTrack() }
}

/**
 * Now playing, bottom right: what is in the headset, and the three buttons a
 * player needs. Shown only while the headset is on (H), so it never sits in
 * the way of the world otherwise.
 */
export function RadioCard() {
  const { playing, track } = useRadio()
  if (!playing) return null
  return (
    <div className="radio-card" role="region" aria-label="Headset music">
      <div className="radio-eq" aria-hidden>
        <span /><span /><span /><span />
      </div>
      <div className="radio-meta">
        <div className="radio-title">{track.title}</div>
        <div className="radio-artist">{track.artist}</div>
      </div>
      <div className="radio-buttons">
        <button onClick={prev} aria-label="Previous track">‹‹</button>
        <button onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>{playing ? '❚❚' : '►'}</button>
        <button onClick={next} aria-label="Next track">››</button>
      </div>
      <div className="radio-keys" aria-hidden><kbd>H</kbd> headset · <kbd>,</kbd> <kbd>.</kbd> skip</div>
    </div>
  )
}
