import { useEffect } from 'react'
import { coach } from '../../data/coach'
import { faq } from '../../data/faq'
import { LINKS } from '../../data/links'
import { app, hundredDays, process } from '../../data/programs'
import { transformations } from '../../data/transformations'
import { testimonials } from '../../data/testimonials'
import { useStore } from '../../state/store'

/** Everything the site says, in a plain premium layout, for anyone who would
 *  rather read than explore. */
export function ClassicSite() {
  const phase = useStore((s) => s.phase)
  const setPhase = useStore((s) => s.setPhase)

  useEffect(() => {
    document.body.classList.toggle('classic', phase === 'classic')
    return () => document.body.classList.remove('classic')
  }, [phase])

  if (phase !== 'classic') return null

  return (
    <div className="classic-site">
      <div className="wrap">
        <header>
          <strong style={{ fontFamily: 'var(--display)', letterSpacing: '0.2em' }}>COACH BLUE</strong>
          <nav>
            <a href="#results">Results</a>
            <a href="#how">How coaching works</a>
            <a href="#app">App</a>
            <a href="#challenge">100 days</a>
            <a href="#me">About</a>
            <a href="#faq">FAQ</a>
          </nav>
          <button className="btn primary" onClick={() => setPhase('world')}>Enter 3D experience</button>
        </header>

        <section className="hero">
          <div>
            <span className="eyebrow">{coach.eyebrow}</span>
            <h1>{coach.headline}</h1>
            <p>{coach.intro}</p>
            <p style={{ display: 'flex', gap: 34, marginTop: 28 }}>
              {coach.stats.map((s) => (
                <span key={s.label}>
                  <span className="stat">{s.value}</span>
                  <br />
                  <small style={{ letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--muted)' }}>
                    {s.label}
                  </small>
                </span>
              ))}
            </p>
            <a className="btn primary" href={LINKS.inquiry} target="_blank" rel="noreferrer">Sign up here</a>
          </div>
          <img src={coach.portrait} alt="Coach Blue" />
        </section>

        <section id="results">
          <span className="eyebrow">{coach.realResults.title}</span>
          <h2>Get real results</h2>
          <p>{coach.realResults.body}</p>
          <div className="grid" style={{ marginTop: 30 }}>
            {coach.goals.map((g) => (
              <div className="card" key={g}><h3>{g}</h3></div>
            ))}
          </div>
          <div className="card" style={{ marginTop: 22 }}>
            <p><b>Client:</b> &ldquo;{coach.quotePair.client}&rdquo;</p>
            <p style={{ color: 'var(--mint)' }}><b>Coach Blue:</b> &ldquo;{coach.quotePair.coach}&rdquo;</p>
          </div>
        </section>

        <section id="reviews">
          <span className="eyebrow">Reviews from people like you</span>
          <h2>Transformations</h2>
          <div className="gallery">
            {transformations.map((t) => <img key={t.src} src={t.src} alt="Client transformation" loading="lazy" />)}
          </div>
          {testimonials.length > 0 && (
            <div className="grid" style={{ marginTop: 24 }}>
              {testimonials.map((t) => (
                <div className="card" key={t.quote}>
                  <p>&ldquo;{t.quote}&rdquo;</p>
                  {t.name && <strong>{t.name}</strong>}
                </div>
              ))}
            </div>
          )}
        </section>

        <section>
          <span className="eyebrow">{coach.expect.title}</span>
          <h2>{coach.expect.challenge}</h2>
          <p>{coach.expect.body}</p>
        </section>

        <section id="how">
          <span className="eyebrow">{process.title}</span>
          <h2>How coaching works</h2>
          <p>{coach.howItWorks.body}</p>
          <div className="grid" style={{ marginTop: 28 }}>
            {process.steps.map((s, i) => (
              <div className="card" key={s.title}>
                <span className="eyebrow">{`0${i + 1}`}</span>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="app">
          <span className="eyebrow">{app.title}</span>
          <h2>Everything at your fingertips</h2>
          <p>{app.body}</p>
          <div className="grid" style={{ marginTop: 28 }}>
            {app.features.map((f) => <div className="card" key={f}><h3>{f}</h3></div>)}
          </div>
        </section>

        <section id="challenge">
          <span className="eyebrow">{hundredDays.title}</span>
          <h2>{hundredDays.headline}</h2>
          <p>{hundredDays.sub}</p>
          <p>{hundredDays.what}</p>
          <div className="grid" style={{ marginTop: 28 }}>
            {hundredDays.features.map((f) => (
              <div className="card" key={f.title}>
                <h3>{f.title}</h3>
                <p>{f.body}</p>
              </div>
            ))}
          </div>
          <a className="btn primary" style={{ marginTop: 26, display: 'inline-block' }}
            href={LINKS.hundredDays} target="_blank" rel="noreferrer">
            {hundredDays.cta}
          </a>
        </section>

        <section id="me">
          <span className="eyebrow">{coach.about.title}</span>
          <h2>{coach.name}</h2>
          <div className="hero">
            <p>{coach.about.body}</p>
            <img src={coach.photos.training} alt="Coach Blue training" loading="lazy" />
          </div>
          <div className="socials" style={{ display: 'flex', gap: 18, marginTop: 20 }}>
            <a href={LINKS.instagram} target="_blank" rel="noreferrer">Instagram</a>
            <a href={LINKS.tiktok} target="_blank" rel="noreferrer">TikTok</a>
            <a href={LINKS.facebook} target="_blank" rel="noreferrer">Facebook</a>
            <a href={LINKS.apparel} target="_blank" rel="noreferrer">Apparel</a>
          </div>
        </section>

        <section id="faq">
          <span className="eyebrow">FAQ</span>
          <h2>Questions</h2>
          <div className="grid">
            {faq.map((f) => (
              <div className="card" key={f.q}>
                <h3>{f.q}</h3>
                <p>{f.a}</p>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2>{coach.closing.title}</h2>
          <p>{coach.closing.body}</p>
          <div style={{ display: 'flex', gap: 12, marginTop: 24, flexWrap: 'wrap' }}>
            <a className="btn primary" href={LINKS.inquiry} target="_blank" rel="noreferrer">Start now</a>
            <button className="btn" onClick={() => setPhase('world')}>Enter 3D experience</button>
          </div>
        </section>

        <footer>
          ©2026 Coach Blue. All Rights Reserved ·{' '}
          <a href={LINKS.terms} target="_blank" rel="noreferrer">Website Terms</a> |{' '}
          <a href={LINKS.privacy} target="_blank" rel="noreferrer">Privacy Policy</a> |{' '}
          <a href={LINKS.coachingInfo} target="_blank" rel="noreferrer">Coaching Information</a>
        </footer>
      </div>
    </div>
  )
}
