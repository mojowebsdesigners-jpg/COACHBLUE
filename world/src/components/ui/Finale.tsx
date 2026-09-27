import { useState } from 'react'
import { LINKS } from '../../data/links'
import { locations } from '../../data/journey'
import { buildShareCard, downloadDataUrl } from '../../lib/share'
import { useStore } from '../../state/store'

export function Finale() {
  const finale = useStore((s) => s.finale)
  const setFinale = useStore((s) => s.setFinale)
  const panel = useStore((s) => s.panel)
  const setBooking = useStore((s) => s.setBooking)
  const discovered = useStore((s) => s.discovered)
  const showToast = useStore((s) => s.showToast)
  const [saving, setSaving] = useState(false)

  if (!finale || panel) return null

  const share = async () => {
    setSaving(true)
    const card = await buildShareCard({ found: discovered.length, total: locations.length })
    setSaving(false)
    if (card) {
      downloadDataUrl(card)
      showToast('SAVED', 'Your journey card')
    } else {
      showToast('COULD NOT SAVE', 'Try again from photo mode')
    }
  }

  return (
    <div className="finale">
      <div>
        <h1 className="h-display">
          <span>Your goals.</span>
          <span>Your discipline.</span>
          <span>Your transformation.</span>
        </h1>
        <p className="ask">Are you ready?</p>
        <div className="cta">
          <button className="btn primary" onClick={() => { setFinale(false); setBooking(true) }}>
            Start coaching
          </button>
          <a className="btn" href={LINKS.hundredDays} target="_blank" rel="noreferrer">Explore coaching</a>
          <button className="btn" onClick={share} disabled={saving}>
            {saving ? 'Saving…' : 'Share your journey'}
          </button>
          <button className="btn" onClick={() => setFinale(false)}>Keep exploring</button>
        </div>
      </div>
    </div>
  )
}
