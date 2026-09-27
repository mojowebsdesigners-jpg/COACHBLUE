import { useEffect, useState } from 'react'
import { useStore } from '../../state/store'
import { webgpuAvailable, type Tier } from '../../lib/quality'
import { setTimeOfDay } from '../3d/Lighting'
import { DAY_LENGTH_SECONDS } from '../../systems/TimeSystem'

const TIERS: { id: Tier; label: string; note: string }[] = [
  { id: 'auto', label: 'Auto', note: 'Match this device' },
  { id: 'ultra', label: 'Ultra', note: 'Everything on' },
  { id: 'high', label: 'High', note: 'Recommended' },
  { id: 'medium', label: 'Medium', note: 'Lighter forest' },
  { id: 'low', label: 'Low', note: 'No shadows or effects' },
]

const TIMES = [
  { label: 'Morning', at: 8 / 24, note: '08:00' },
  { label: 'Midday', at: 12 / 24, note: '12:00' },
  { label: 'Sunset', at: 18.3 / 24, note: '18:20' },
  { label: 'Night', at: 21.5 / 24, note: '21:30' },
]

export function Settings() {
  const open = useStore((s) => s.settingsOpen)
  const setOpen = useStore((s) => s.setSettingsOpen)
  const settings = useStore((s) => s.settings)
  const preset = useStore((s) => s.preset)
  const update = useStore((s) => s.updateSettings)
  const setPhase = useStore((s) => s.setPhase)
  const [gpu, setGpu] = useState(false)

  useEffect(() => {
    let live = true
    webgpuAvailable().then((ok) => live && setGpu(ok))
    return () => {
      live = false
    }
  }, [])

  if (!open) return null

  return (
    <div className="sheet-wrap" onClick={() => setOpen(false)}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <button className="close" onClick={() => setOpen(false)} aria-label="Close">✕</button>
        <span className="eyebrow">Settings</span>
        <h2>Experience</h2>

        <h3>Graphics</h3>
        <div className="chips">
          {TIERS.map((t) => (
            <button
              key={t.id}
              className={`chip ${settings.tier === t.id ? 'on' : ''}`}
              onClick={() => update({ tier: t.id })}
            >
              {t.label}
              <small>{t.note}</small>
            </button>
          ))}
        </div>
        <p className="note">
          Running at <b>{preset.name.toUpperCase()}</b> — {preset.trees.toLocaleString()} trees,
          {' '}{preset.shadows ? 'shadows on' : 'shadows off'}, {preset.post ? 'effects on' : 'effects off'}.
        </p>

        <h3>Time of day</h3>
        <div className="chips">
          {TIMES.map((t) => (
            <button key={t.label} className="chip" onClick={() => setTimeOfDay(t.at)}>
              {t.label}
              <small>{t.note}</small>
            </button>
          ))}
        </div>
        <p className="note">
          A full day runs for about {(DAY_LENGTH_SECONDS / 3600).toFixed(1)} hours, so the light
          changes slowly. Jump the clock to see the world at another hour.
        </p>

        <h3>Renderer</h3>
        {gpu ? (
          <>
            <label className="toggle">
              <input
                type="checkbox"
                checked={settings.renderer === 'webgpu'}
                onChange={(e) => update({ renderer: e.target.checked ? 'webgpu' : 'webgl' })}
              />
              <span>Use WebGPU (experimental)</span>
              <small>Newer graphics path. Post-processing is WebGL-only, so effects turn off.</small>
            </label>
            <p className="note">Anything unexpected drops straight back to WebGL.</p>
          </>
        ) : (
          <p className="note">WebGL — this browser doesn&rsquo;t offer WebGPU.</p>
        )}

        <h3>Accessibility</h3>
        <label className="toggle">
          <input
            type="checkbox"
            checked={settings.reducedMotion}
            onChange={(e) => update({ reducedMotion: e.target.checked })}
          />
          <span>Reduced motion</span>
          <small>Calms wind, particles and camera movement</small>
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={settings.skipCinematics}
            onChange={(e) => update({ skipCinematics: e.target.checked })}
          />
          <span>Skip cinematics</span>
          <small>Never take the camera off you</small>
        </label>

        <h3>Sound</h3>
        <label className="toggle">
          <input type="checkbox" checked={settings.sound} onChange={(e) => update({ sound: e.target.checked })} />
          <span>Ambience and effects</span>
          <small>Wind, birds, water, footsteps</small>
        </label>
        <label className="toggle">
          <input type="checkbox" checked={settings.music} onChange={(e) => update({ music: e.target.checked })} />
          <span>Music</span>
          <small>A quiet score that builds with the journey</small>
        </label>

        <h3>Prefer to read?</h3>
        <button className="btn" onClick={() => setPhase('classic')}>Open the traditional website</button>
      </div>
    </div>
  )
}
