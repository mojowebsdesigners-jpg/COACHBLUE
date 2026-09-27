import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useProgress } from '@react-three/drei'
import { useStore } from '../../state/store'

/**
 * The way in.
 *
 * It opens on black and stays there for a beat, because arriving somewhere
 * should feel like a curtain going up rather than a page painting in. The name
 * fades up, then a line of what is being prepared, then the way through.
 *
 * The bar tracks real work. Files arriving only gets it to 92%; the last
 * stretch is the shader compile, which is the part that decides whether the
 * first minute of play stutters. Nothing here claims to be finished before it
 * is — a progress bar that lies is worse than no progress bar.
 */
const STAGES = [
  { at: 0.0, label: 'Preparing the forest' },
  { at: 0.3, label: 'Waking the trail' },
  { at: 0.55, label: 'Preparing the training grounds' },
  { at: 0.78, label: 'Setting the light' },
  { at: 0.93, label: 'Almost there' },
]

/**
 * The six reels behind the title — short, silent cuts from Coach Blue's own
 * training videos (tools: ffmpeg from assets/video/clip1-6, 8 s, 24 fps, no
 * audio track at all, so nothing can ever autoplay sound).
 *
 * They are portrait footage, so on a wide screen they stand as three
 * full-height panels at their native sharpness rather than one clip blown up
 * four times. Each panel carries two reels and trades them on its own clock,
 * staggered, so the wall is always changing somewhere but never all at once.
 * On a phone held upright one panel fills the screen and walks all six.
 */
const REELS = [
  { src: '/video/splash/reel1.mp4', label: 'Conditioning' },
  { src: '/video/splash/reel2.mp4', label: 'Strength' },
  { src: '/video/splash/reel3.mp4', label: 'Legs' },
  { src: '/video/splash/reel4.mp4', label: 'Core' },
  { src: '/video/splash/reel5.mp4', label: 'Power' },
  { src: '/video/splash/reel6.mp4', label: 'Build' },
]
const TRIPTYCH = [
  { clips: [0, 3], hold: 8200, delay: 250 },
  { clips: [1, 4], hold: 8200, delay: 900 },
  { clips: [2, 5], hold: 8200, delay: 1550 },
]
const SINGLE_LAYOUT = [{ clips: [0, 1, 2, 3, 4, 5], hold: 5200, delay: 250 }]

function useSinglePanel() {
  const query = '(max-aspect-ratio: 1/1), (max-width: 720px)'
  const [single, setSingle] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(query).matches)
  useEffect(() => {
    const mq = matchMedia(query)
    const on = () => setSingle(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return single
}

/**
 * One panel. Only the showing reel decodes; the rest sit paused on their
 * poster, so however many reels there are, at most three videos ever play —
 * the world is compiling shaders underneath and needs the machine more.
 */
function Reel({ clips, hold, delay, slot }: { clips: number[]; hold: number; delay: number; slot: number }) {
  const [active, setActive] = useState(0)
  const vids = useRef<(HTMLVideoElement | null)[]>([])

  // The first reel starts itself (the autoPlay attribute), so the film is
  // running before any script gets a turn. Only the later swaps need a clock.
  useEffect(() => {
    if (clips.length < 2) return
    let iv = 0
    const t = setTimeout(() => {
      iv = window.setInterval(() => setActive((a) => (a + 1) % clips.length), hold)
    }, delay)
    return () => {
      clearTimeout(t)
      clearInterval(iv)
    }
  }, [hold, delay, clips.length])

  useEffect(() => {
    const timers: number[] = []
    vids.current.forEach((v, i) => {
      if (!v) return
      if (i === active) {
        if (v.paused) {
          v.currentTime = 0
          v.play().catch(() => {})   // muted + playsInline autoplays everywhere; if not, the poster stands in
        }
      } else if (!v.paused) {
        // let the outgoing reel finish its crossfade before it stops
        timers.push(window.setTimeout(() => v.pause(), 1600))
      }
    })
    return () => timers.forEach(clearTimeout)
  }, [active])

  // hand the decoders back the moment the splash goes
  useEffect(() => {
    const list = vids.current
    return () => list.forEach((v) => {
      if (!v) return
      v.pause()
      v.removeAttribute('src')
      v.load()
    })
  }, [])

  const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

  return (
    <div className="reel" style={{ ['--slot' as string]: slot }}>
      {clips.map((c, i) => (
        <video
          key={c}
          ref={(el) => {
            vids.current[i] = el
            if (el) el.muted = true   // the property, not just the attribute, is what autoplay checks
          }}
          className={`reel__clip ${i === active ? 'is-active' : ''}`}
          src={REELS[c].src}
          poster={REELS[c].src.replace('.mp4', '.jpg')}
          muted
          playsInline
          loop
          autoPlay={i === 0 && !reduced}
          preload={i === 0 ? 'auto' : 'metadata'}
        />
      ))}
      <span className="reel__label">
        <b>0{clips[active] + 1}</b>{REELS[clips[active]].label}
      </span>
    </div>
  )
}

export function LoadingScreen() {
  const { progress } = useProgress()
  const setPhase = useStore((s) => s.setPhase)
  const phase = useStore((s) => s.phase)
  const worldReady = useStore((s) => s.worldReady)
  const [ready, setReady] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const held = useRef(0)

  const fetched = Math.min(1, progress / 100)
  const p = worldReady ? 1 : Math.min(0.92, fetched * 0.92)

  // the bar never goes backwards, however the loader reports itself
  held.current = Math.max(held.current, p)
  const shown = held.current

  const stage = useMemo(
    () => [...STAGES].reverse().find((s) => shown >= s.at) ?? STAGES[0],
    [shown],
  )

  useEffect(() => {
    if (worldReady) {
      const t = setTimeout(() => setReady(true), 500)
      return () => clearTimeout(t)
    }
  }, [worldReady])

  const enter = useCallback(() => {
    // Only ever leaves the splash. Without this guard a late call — a second
    // key press during the fade — would send someone already in the world
    // back to the mode screen 620 ms later.
    if (useStore.getState().phase !== 'loading') return
    // fade through black rather than cutting straight to the world
    setLeaving(true)
    setTimeout(() => {
      if (useStore.getState().phase === 'loading') setPhase('mode')
    }, 620)
  }, [setPhase])

  // Enter or Space clears the splash without reaching for the mouse. This has
  // to sit above the early return below: a hook after a conditional return is
  // skipped on the render where the phase changes, and React throws.
  useEffect(() => {
    // listen only while the splash is showing: in the world, Space is jump
    // and Enter is used elsewhere, and neither may re-trigger the splash
    if (!ready || phase !== 'loading') return
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space') {
        e.preventDefault()
        enter()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ready, phase, enter])

  const single = useSinglePanel()

  if (phase !== 'loading') return null

  return (
    <div className={`splash ${leaving ? 'is-leaving' : ''} ${ready ? 'is-ready' : ''}`}>
      <div className={`splash__reels ${single ? 'is-single' : ''}`} aria-hidden>
        {(single ? SINGLE_LAYOUT : TRIPTYCH).map((r, i) => (
          <Reel key={`${single}-${i}`} clips={r.clips} hold={r.hold} delay={r.delay} slot={i} />
        ))}
      </div>
      <div className="splash__scrim" aria-hidden />
      <div className="splash__grain" aria-hidden />
      <div className="splash__inner">
        <img className="splash__mark" src="/img/logo.webp" alt="" aria-hidden />
        <p className="splash__eyebrow">Welcome to the world of</p>
        <h1 className="splash__title">Coach Blue</h1>
        <p className="splash__tagline">Train · Explore · Transform</p>

        <div className="splash__bar" role="progressbar" aria-valuenow={Math.round(shown * 100)}>
          <span style={{ width: `${Math.round(shown * 100)}%` }} />
        </div>
        <p className="splash__stage">
          {ready ? 'Your journey begins here.' : `${stage.label}…`}
        </p>

        <button className="splash__enter" onClick={enter} disabled={!ready} autoFocus>
          {ready ? 'Enter the world' : `${Math.round(shown * 100)}%`}
        </button>
        {ready && (
          <p className="splash__keys" aria-hidden>
            <kbd>Enter</kbd> or click
          </p>
        )}
      </div>
    </div>
  )
}
