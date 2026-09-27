import { coach } from '../../data/coach'
import { faq } from '../../data/faq'
import { LINKS } from '../../data/links'
import { app, hundredDays, pillars, process } from '../../data/programs'
import { testimonials } from '../../data/testimonials'
import { secrets } from '../../data/secrets'
import { timelineSteps } from '../3d/Timeline'
import { useStore } from '../../state/store'
import { closeInteraction } from '../3d/InteractionSystem'

function Cta({ label = 'Start your journey' }: { label?: string }) {
  return (
    <div className="cta">
      <a className="btn primary" href={LINKS.inquiry} target="_blank" rel="noreferrer">{label}</a>
      <a className="btn" href={LINKS.coachingInfo} target="_blank" rel="noreferrer">Coaching info</a>
    </div>
  )
}

export function Panel() {
  const panel = useStore((s) => s.panel)
  if (!panel) return null

  const body = () => {
    switch (panel.kind) {
      case 'coach':
        return (
          <>
            <span className="eyebrow">Meet Coach Blue</span>
            <h2>{coach.name}</h2>
            <img className="portrait" src={coach.portrait} alt="Coach Blue" />
            <p>{coach.about.body}</p>
            <h3>What to expect from me</h3>
            <p>{coach.expect.body}</p>
            <p style={{ color: '#fff' }}><b>{coach.expect.challenge}</b></p>
            <div className="stats">
              {coach.stats.map((s) => (
                <div key={s.label}>
                  <span>{s.value}</span>
                  <small>{s.label}</small>
                </div>
              ))}
            </div>
            <Cta />
            <div className="socials">
              <a href={LINKS.instagram} target="_blank" rel="noreferrer">Instagram</a>
              <a href={LINKS.tiktok} target="_blank" rel="noreferrer">TikTok</a>
              <a href={LINKS.facebook} target="_blank" rel="noreferrer">Facebook</a>
            </div>
          </>
        )

      case 'challenge':
        return (
          <>
            <span className="eyebrow">The challenge</span>
            <h2>{coach.realResults.title}</h2>
            <div className="feature">
              <b>Client</b>
              <p>&ldquo;{coach.quotePair.client}&rdquo;</p>
            </div>
            <div className="feature">
              <b>Coach Blue</b>
              <p>&ldquo;{coach.quotePair.coach}&rdquo;</p>
            </div>
            <p>{coach.realResults.body}</p>
            <Cta />
          </>
        )

      case 'camp-item': {
        const name = app.features[panel.index ?? 0]
        return (
          <>
            <span className="eyebrow">The training camp</span>
            <h2>{name}</h2>
            <p>{app.body}</p>
            <h3>How coaching works</h3>
            <p>{coach.howItWorks.body}</p>
            <Cta />
          </>
        )
      }

      case 'pillar': {
        const p = pillars[panel.index ?? 0]
        return (
          <>
            <span className="eyebrow">The discipline path</span>
            <h2>{p.word}</h2>
            <p>{p.body}</p>
            <h3>Real results</h3>
            <p>{coach.realResults.body}</p>
            <Cta />
          </>
        )
      }

      case 'hundred':
        return (
          <>
            <span className="eyebrow">{hundredDays.title}</span>
            <h2>{hundredDays.headline}</h2>
            <p>{hundredDays.sub}</p>
            <h3>What is the challenge?</h3>
            <p>{hundredDays.what}</p>
            {hundredDays.features.map((f) => (
              <div className="feature" key={f.title}>
                <b>{f.title}</b>
                <p>{f.body}</p>
              </div>
            ))}
            <div className="cta">
              <a className="btn primary" href={LINKS.hundredDays} target="_blank" rel="noreferrer">
                {hundredDays.cta}
              </a>
              <a className="btn" href={LINKS.inquiry} target="_blank" rel="noreferrer">Start coaching</a>
            </div>
          </>
        )

      case 'hub':
        return (
          <>
            <span className="eyebrow">The coaching hub</span>
            <h2>{app.title}</h2>
            <p>{app.body}</p>
            <ul>{app.features.map((f) => <li key={f}>{f}</li>)}</ul>
            <p className="note">
              The app screenshots from the original site were not recoverable, so the screens in the
              hub show the feature names. Drop the images into <code>public/img</code> to use them here.
            </p>
            <Cta />
          </>
        )

      case 'process': {
        const s = process.steps[panel.index ?? 0]
        return (
          <>
            <span className="eyebrow">{`Step 0${(panel.index ?? 0) + 1}`}</span>
            <h2>{s.title}</h2>
            <p>{s.body}</p>
            <Cta />
          </>
        )
      }

      case 'campfire':
        return (
          <>
            <span className="eyebrow">Reviews from people like you</span>
            <h2>Real people. Real results.</h2>
            <div className="stats">
              {coach.stats.map((s) => (
                <div key={s.label}>
                  <span>{s.value}</span>
                  <small>{s.label}</small>
                </div>
              ))}
            </div>
            {testimonials.length > 0 ? (
              testimonials.map((t) => (
                <div className="feature" key={t.quote}>
                  <p>&ldquo;{t.quote}&rdquo;</p>
                  {t.name && <b>{t.name}</b>}
                </div>
              ))
            ) : (
              <>
                <p>
                  Walk up to any photograph around the fire to see the before and after in full
                  screen.
                </p>
                <p className="note">
                  coach-blue.com publishes these reviews as photographs only — no written quotes or
                  names — so none are shown here. Add approved quotes to
                  <code> src/data/testimonials.ts</code> and they appear around the fire.
                </p>
              </>
            )}
            <Cta />
          </>
        )

      case 'faq': {
        const item = faq[panel.index ?? 0]
        return (
          <>
            <span className="eyebrow">Question</span>
            <h2>{item.q}</h2>
            <p>{item.a}</p>
            <h3>More questions</h3>
            <ul>{faq.filter((f) => f !== item).map((f) => <li key={f.q}>{f.q}</li>)}</ul>
            <Cta />
          </>
        )
      }

      case 'goal': {
        const g = coach.goals[panel.index ?? 0]
        return (
          <>
            <span className="eyebrow">My clients goals</span>
            <h2>{g}</h2>
            <p>{coach.realResults.body}</p>
            <h3>Your goals are my goals</h3>
            <p>{coach.about.body}</p>
            <Cta />
          </>
        )
      }

      case 'secret': {
        const s = secrets.find((x) => x.id === panel.id) ?? secrets[0]
        return (
          <>
            <span className="eyebrow">Off the trail</span>
            <h2>{s.title}</h2>
            {s.image && <img className="portrait" src={s.image} alt="" />}
            <p style={{ whiteSpace: 'pre-line' }}>{s.body}</p>
            <Cta />
          </>
        )
      }

      case 'notebook': {
        return (
          <>
            <span className="eyebrow">The notebook</span>
            <h2>{coach.about.title}</h2>
            <p>{coach.about.body}</p>
            <Cta />
          </>
        )
      }

      case 'timeline': {
        const s = timelineSteps[panel.index ?? 0]
        return (
          <>
            <span className="eyebrow">{`Transformation · 0${(panel.index ?? 0) + 1}`}</span>
            <h2>{s.word}</h2>
            <p>{s.body}</p>
            <Cta />
          </>
        )
      }

      case 'mirror':
        return (
          <>
            <span className="eyebrow">The mirror</span>
            <h2>{coach.expect.challenge}</h2>
            <p>{coach.expect.body}</p>
            <Cta />
          </>
        )

      case 'summit':
        return (
          <>
            <span className="eyebrow">The summit</span>
            <h2>{coach.closing.title}</h2>
            <p>{coach.closing.body}</p>
            <Cta label="Start coaching" />
          </>
        )

      default:
        return null
    }
  }

  return (
    <div className="panel-wrap">
      <div className="panel">
        <button className="close" onClick={closeInteraction} aria-label="Close">✕</button>
        {body()}
      </div>
    </div>
  )
}
