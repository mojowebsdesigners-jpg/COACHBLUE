import { useStore } from '../../state/store'
import { useMenuKeys } from '../../lib/useMenuKeys'

export function ModeSelect() {
  const phase = useStore((s) => s.phase)
  const setPhase = useStore((s) => s.setPhase)
  const setMode = useStore((s) => s.setMode)
  const visited = useStore((s) => s.visited)
  const preferred = useStore((s) => s.mode)

  const start = (mode: 'free' | 'guided') => {
    setMode(mode)
    setPhase('world')
  }

  // mouse and keyboard both drive this screen, and agree on what is selected.
  // The hook has to run before the early return below, on every render.
  const [picked, setPicked] = useMenuKeys(
    2,
    (i) => start(i === 0 ? 'free' : 'guided'),
    phase === 'mode',
  )

  if (phase !== 'mode') return null

  return (
    <div className="mode-screen">
      <div className="mode-inner">
        <span className="eyebrow">
          {visited ? 'Welcome back' : 'How do you want to experience Coach Blue?'}
        </span>
        <div className="mode-cards">
          <button
            className={`mode-card ${picked === 0 ? 'is-picked' : ''}`}
            onClick={() => start('free')}
            onMouseEnter={() => setPicked(0)}
          >
            <span className="tag">Free explore</span>
            <h2>Your world. Your pace.</h2>
            <p>Explore Coach Blue&rsquo;s world freely and discover the story yourself.</p>
            <span className="go">Enter world →</span>
          </button>
          <button
            className={`mode-card ${picked === 1 ? 'is-picked' : ''}`}
            onClick={() => start('guided')}
            onMouseEnter={() => setPicked(1)}
          >
            <span className="tag">Guided journey</span>
            <h2>Your transformation starts here.</h2>
            <p>
              Follow a cinematic journey through Coach Blue&rsquo;s coaching philosophy, programs and
              client transformations.
            </p>
            <span className="go">Begin journey →</span>
          </button>
        </div>
        <p className="mode-keys" aria-hidden>
          <kbd>←</kbd><kbd>→</kbd> choose · <kbd>Enter</kbd> confirm · or click
        </p>
        {visited && (
          <button className="mode-skip" onClick={() => start(preferred)}>
            Continue exploring
          </button>
        )}
        <br />
        <button className="mode-skip" onClick={() => setPhase('classic')}>
          Skip exploration — read the site
        </button>
      </div>
    </div>
  )
}
