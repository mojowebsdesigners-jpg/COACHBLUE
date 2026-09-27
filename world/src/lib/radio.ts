import { audioBus, setWorldMuffled } from './audio'

/**
 * Coach Blue's headset radio.
 *
 * Two kinds of track share one playlist:
 *
 *  - Original R&B instrumentals, played live by a small synth band in the
 *    browser: a swung, laid-back drum kit (soft kick, a snare with room on it,
 *    shuffled hats, the odd rim), an electric piano voicing extended chords
 *    (7ths, 9ths, 11ths, 13ths) with a slow tremolo, a warm sub bass that
 *    walks the roots with syncopated pushes, and a breathy lead that answers
 *    the chords now and then. Nothing is downloaded and nothing is borrowed:
 *    every progression here is written for this project.
 *  - The audio files in /music (and its subfolders), which open the playlist
 *    and play through the same output (see music/README.md).
 *
 * Everything is scheduled on the audio clock with a short look-ahead, so the
 * groove stays tight however busy the render loop gets.
 */

type Chord = { root: number; tones: number[] }      // root midi, voicing as semitones from root
export type Track =
  | { kind: 'synth'; title: string; artist: string; bpm: number; swing: number; bars: Chord[]; seed: number }
  | { kind: 'file'; title: string; artist: string; url: string }

// maj9 = [0,4,7,11,14]  m9 = [0,3,7,10,14]  13 = [0,4,10,14,21]  m11 = [0,3,10,14,17]
const maj9 = [0, 4, 7, 11, 14], m9 = [0, 3, 7, 10, 14], m11 = [0, 3, 7, 10, 17]
const dom13 = [0, 4, 10, 14, 21], dom9 = [0, 4, 10, 14], m7 = [0, 3, 7, 10], maj7s11 = [0, 4, 7, 11, 18]
const sus13 = [0, 5, 10, 14, 21], dom7b9 = [0, 4, 10, 13]

const SYNTH: Track[] = [
  { kind: 'synth', title: 'Late Night Reps', artist: 'Coach Blue Radio', bpm: 72, swing: 0.62, seed: 1,
    bars: [{ root: 44, tones: maj9 }, { root: 43, tones: m9 }, { root: 41, tones: m11 }, { root: 46, tones: dom13 }] },
  { kind: 'synth', title: 'Discipline', artist: 'Coach Blue Radio', bpm: 84, swing: 0.58, seed: 2,
    bars: [{ root: 41, tones: m9 }, { root: 37, tones: maj7s11 }, { root: 39, tones: sus13 }, { root: 36, tones: dom7b9 }] },
  { kind: 'synth', title: 'Hundred Days', artist: 'Coach Blue Radio', bpm: 78, swing: 0.6, seed: 3,
    bars: [{ root: 43, tones: maj9 }, { root: 42, tones: m7 }, { root: 40, tones: m9 }, { root: 45, tones: dom13 }] },
  { kind: 'synth', title: 'Summit Glow', artist: 'Coach Blue Radio', bpm: 90, swing: 0.56, seed: 4,
    bars: [{ root: 36, tones: m9 }, { root: 44, tones: maj9 }, { root: 41, tones: m11 }, { root: 43, tones: dom9 }] },
  { kind: 'synth', title: 'Slow Burn', artist: 'Coach Blue Radio', bpm: 68, swing: 0.64, seed: 5,
    bars: [{ root: 38, tones: m11 }, { root: 43, tones: dom13 }, { root: 36, tones: maj9 }, { root: 45, tones: sus13 }] },
]

// files anywhere under /music (subfolders too) — the file name is the title
// ("Artist - Title.mp3"). A copy saved twice ("… (1).mp3") plays once.
const seen = new Set<string>()
const FILES: Track[] = Object.entries(
  import.meta.glob('/music/**/*.{mp3,m4a,ogg,wav}', { query: '?url', import: 'default', eager: true }) as Record<string, string>,
).sort(([a], [b]) => a.localeCompare(b)).flatMap(([path, url]): Track[] => {
  const raw = decodeURIComponent(path.split('/').pop()!.replace(/\.[^.]+$/, ''))
  // the free-music library asks for a credit: keep it, on the artist line
  const credit = /\(freetouse\.com\)/i.test(raw) ? ' · freetouse.com' : ''
  const name = raw.replace(/\s*\(freetouse\.com\)/i, '').replace(/\s*\(\d+\)$/, '')
  const [artist, title] = name.includes(' - ') ? name.split(' - ', 2) : ['Your music', name]
  const key = `${artist.trim()}|${title.trim()}`.toLowerCase()
  if (seen.has(key)) return []
  seen.add(key)
  return [{ kind: 'file', title: title.trim(), artist: artist.trim() + credit, url }]
})

// the uploaded tracks are the station; the synth originals follow them
export const PLAYLIST: Track[] = [...FILES, ...SYNTH]

// ---------------------------------------------------------------- state
type Listener = () => void
const listeners = new Set<Listener>()
export const radio = {
  playing: false,
  index: 0,
  subscribe(fn: Listener) { listeners.add(fn); return () => { listeners.delete(fn) } },
}
const emit = () => listeners.forEach((f) => f())

let out: GainNode | null = null
let room: ConvolverNode | null = null
let roomSend: GainNode | null = null
let timer: number | null = null
let fileEl: HTMLAudioElement | null = null
let fileNode: MediaElementAudioSourceNode | null = null
let step = 0
let nextTime = 0
let rng = 1

const rand = () => {
  // small deterministic generator so each track humanises the same way
  rng = (rng * 16807) % 2147483647
  return (rng - 1) / 2147483646
}
const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12)

function ensureGraph() {
  const bus = audioBus()
  if (!bus) return null
  const { ctx } = bus
  if (!out) {
    out = ctx.createGain()
    out.gain.value = 0
    // gentle warmth: roll the top off and glue it with a soft compressor
    const tone = ctx.createBiquadFilter()
    tone.type = 'lowpass'
    tone.frequency.value = 9500
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -18
    comp.ratio.value = 3
    comp.attack.value = 0.01
    comp.release.value = 0.25
    out.connect(tone).connect(comp).connect(bus.out)
    // a small room: a generated impulse, short and dark
    room = ctx.createConvolver()
    const len = ctx.sampleRate * 1.8
    const ir = ctx.createBuffer(2, len, ctx.sampleRate)
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch)
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2)
    }
    room.buffer = ir
    roomSend = ctx.createGain()
    roomSend.gain.value = 0.28
    roomSend.connect(room).connect(out)
  }
  return ctx
}

// ---------------------------------------------------------------- instruments
function voice(ctx: AudioContext, t: number, dur: number, peak: number, send = 0.3) {
  const g = ctx.createGain()
  g.gain.setValueAtTime(0.0001, t)
  g.connect(out!)
  if (send > 0) {
    const s = ctx.createGain()
    s.gain.value = send
    g.connect(s).connect(roomSend!)
  }
  return { g, peak, dur }
}

/** Electric piano: a sine with a quiet octave and a bell-ish partial, tremolo on top. */
function ep(ctx: AudioContext, t: number, midi: number, dur: number, vel: number) {
  const { g } = voice(ctx, t, dur, vel, 0.35)
  const f = mtof(midi)
  const parts: [number, OscillatorType, number][] = [[1, 'sine', 1], [2, 'sine', 0.22], [4.01, 'sine', 0.05]]
  for (const [mul, type, amp] of parts) {
    const o = ctx.createOscillator()
    o.type = type
    o.frequency.value = f * mul
    o.detune.value = (rand() - 0.5) * 6
    const a = ctx.createGain()
    a.gain.value = amp
    o.connect(a).connect(g)
    o.start(t)
    o.stop(t + dur + 0.6)
  }
  const trem = ctx.createOscillator()
  const tg = ctx.createGain()
  trem.frequency.value = 4.2
  tg.gain.value = vel * 0.18
  trem.connect(tg).connect(g.gain)
  trem.start(t)
  trem.stop(t + dur + 0.6)
  g.gain.exponentialRampToValueAtTime(vel, t + 0.012)
  g.gain.exponentialRampToValueAtTime(vel * 0.35, t + 0.5)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.5)
}

function bass(ctx: AudioContext, t: number, midi: number, dur: number, vel: number) {
  const { g } = voice(ctx, t, dur, vel, 0)
  const o = ctx.createOscillator()
  o.type = 'sine'
  o.frequency.value = mtof(midi)
  const o2 = ctx.createOscillator()
  o2.type = 'triangle'
  o2.frequency.value = mtof(midi + 12)
  const a2 = ctx.createGain()
  a2.gain.value = 0.18
  o.connect(g)
  o2.connect(a2).connect(g)
  for (const x of [o, o2]) { x.start(t); x.stop(t + dur + 0.2) }
  g.gain.exponentialRampToValueAtTime(vel, t + 0.02)
  g.gain.setTargetAtTime(vel * 0.6, t + 0.05, 0.2)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.15)
}

function lead(ctx: AudioContext, t: number, midi: number, dur: number, vel: number) {
  const { g } = voice(ctx, t, dur, vel, 0.55)
  const o = ctx.createOscillator()
  o.type = 'sawtooth'
  o.frequency.value = mtof(midi)
  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 1400
  lp.Q.value = 0.8
  const vib = ctx.createOscillator()
  const vg = ctx.createGain()
  vib.frequency.value = 5.2
  vg.gain.value = 4
  vib.connect(vg).connect(o.detune)
  o.connect(lp).connect(g)
  for (const x of [o, vib]) { x.start(t); x.stop(t + dur + 0.4) }
  g.gain.exponentialRampToValueAtTime(vel, t + 0.12)
  g.gain.setTargetAtTime(vel * 0.7, t + 0.2, 0.3)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.35)
}

let noise: AudioBuffer | null = null
function noiseBuf(ctx: AudioContext) {
  if (!noise) {
    noise = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate)
    const d = noise.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  }
  return noise
}

function kick(ctx: AudioContext, t: number, vel: number) {
  const { g } = voice(ctx, t, 0.4, vel, 0.05)
  const o = ctx.createOscillator()
  o.type = 'sine'
  o.frequency.setValueAtTime(120, t)
  o.frequency.exponentialRampToValueAtTime(46, t + 0.12)
  o.connect(g)
  o.start(t)
  o.stop(t + 0.45)
  g.gain.exponentialRampToValueAtTime(vel, t + 0.005)
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.38)
}

function snare(ctx: AudioContext, t: number, vel: number) {
  const { g } = voice(ctx, t, 0.25, vel, 0.6)
  const n = ctx.createBufferSource()
  n.buffer = noiseBuf(ctx)
  const bp = ctx.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = 2100
  bp.Q.value = 0.7
  n.connect(bp).connect(g)
  const body = ctx.createOscillator()
  body.type = 'triangle'
  body.frequency.setValueAtTime(210, t)
  body.frequency.exponentialRampToValueAtTime(160, t + 0.08)
  const bg = ctx.createGain()
  bg.gain.value = 0.35
  body.connect(bg).connect(g)
  n.start(t)
  n.stop(t + 0.3)
  body.start(t)
  body.stop(t + 0.15)
  g.gain.exponentialRampToValueAtTime(vel, t + 0.004)
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22)
}

function hat(ctx: AudioContext, t: number, vel: number, open = false) {
  const { g } = voice(ctx, t, 0.1, vel, 0.1)
  const n = ctx.createBufferSource()
  n.buffer = noiseBuf(ctx)
  const hp = ctx.createBiquadFilter()
  hp.type = 'highpass'
  hp.frequency.value = 7800
  n.connect(hp).connect(g)
  n.start(t)
  n.stop(t + (open ? 0.35 : 0.08))
  g.gain.exponentialRampToValueAtTime(vel, t + 0.002)
  g.gain.exponentialRampToValueAtTime(0.0001, t + (open ? 0.3 : 0.05))
}

function rim(ctx: AudioContext, t: number, vel: number) {
  const { g } = voice(ctx, t, 0.08, vel, 0.4)
  const o = ctx.createOscillator()
  o.type = 'square'
  o.frequency.value = 1750
  const bp = ctx.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = 1750
  o.connect(bp).connect(g)
  o.start(t)
  o.stop(t + 0.06)
  g.gain.exponentialRampToValueAtTime(vel, t + 0.002)
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05)
}

// ---------------------------------------------------------------- the band
/**
 * One sixteenth-note step. Bars are four beats; every chord lasts a bar and
 * the four-bar loop repeats with small variations so it never sounds looped.
 */
function scheduleStep(ctx: AudioContext, tr: Extract<Track, { kind: 'synth' }>, t: number, s: number) {
  const beat16 = s % 16
  const bar = Math.floor(s / 16)
  const chord = tr.bars[bar % tr.bars.length]
  const phrase = Math.floor(bar / tr.bars.length)
  const hum = () => (rand() - 0.5) * 0.012          // a hair off the grid, like a player
  const beat = 60 / tr.bpm / 4

  // drums: kick on 1 and the "a" of 2 (and sometimes 3), snare 2 & 4 laid back
  if (beat16 === 0 || beat16 === 7 || (beat16 === 10 && rand() > 0.55)) kick(ctx, t + hum(), beat16 === 0 ? 0.85 : 0.6)
  if (beat16 === 4 || beat16 === 12) snare(ctx, t + 0.018 + hum(), 0.42)
  if (beat16 % 2 === 0) hat(ctx, t + hum(), beat16 % 4 === 0 ? 0.07 : 0.045, beat16 === 14 && rand() > 0.6)
  else if (rand() > 0.55) hat(ctx, t + hum(), 0.025)
  if (beat16 === 15 && rand() > 0.7) rim(ctx, t + hum(), 0.08)

  // keys: the chord on 1, a softer re-strike pushed ahead of beat 3
  if (beat16 === 0 || beat16 === 7) {
    const vel = beat16 === 0 ? 0.075 : 0.05
    const top = 60 + (chord.root % 12)
    chord.tones.forEach((st, i) => {
      // close voicing round middle C, spread a touch
      let m = top + st
      while (m > 76) m -= 12
      ep(ctx, t + i * 0.012 + hum(), m, beat * (beat16 === 0 ? 7 : 8.5), vel)
    })
  }

  // bass: root on 1, a push on the "and" of 2, the fifth or approach note late
  if (beat16 === 0) bass(ctx, t + hum(), chord.root, beat * 5, 0.3)
  if (beat16 === 6) bass(ctx, t + hum(), chord.root + (rand() > 0.5 ? 12 : 7), beat * 2.5, 0.2)
  if (beat16 === 11) {
    const nextRoot = tr.bars[(bar + 1) % tr.bars.length].root
    bass(ctx, t + hum(), nextRoot + (rand() > 0.5 ? -1 : 2), beat * 3, 0.18)
  }

  // lead: a short answering phrase on the second half of every other phrase
  if (phrase % 2 === 1 && bar % tr.bars.length >= 2 && (beat16 === 2 || beat16 === 6 || beat16 === 9)) {
    if (rand() > 0.35) {
      const scale = [0, 3, 5, 7, 10, 12, 15]       // minor pentatonic-ish over the root
      const m = 72 + (chord.root % 12) + scale[Math.floor(rand() * scale.length)] - 12
      lead(ctx, t + hum(), m, beat * (2 + Math.floor(rand() * 3)), 0.04)
    }
  }
}

function tick() {
  const ctx = ensureGraph()
  const tr = PLAYLIST[radio.index]
  if (!ctx || !tr || tr.kind !== 'synth') return
  const beat = 60 / tr.bpm / 4
  while (nextTime < ctx.currentTime + 0.15) {
    // swing: every second sixteenth lands late
    const sw = step % 2 === 1 ? (tr.swing - 0.5) * 2 * beat : 0
    scheduleStep(ctx, tr, nextTime + sw, step)
    nextTime += beat
    step++
    // each original runs about three minutes, then the next one starts
    if (step >= 16 * Math.round((180 / (60 / tr.bpm * 4)))) { next(); return }
  }
}

// ---------------------------------------------------------------- control
function stopAll() {
  if (timer !== null) { window.clearInterval(timer); timer = null }
  if (fileEl) { fileEl.pause(); fileEl.onended = null }
}

function start() {
  const ctx = ensureGraph()
  if (!ctx || !out) return
  void ctx.resume()
  stopAll()
  const tr = PLAYLIST[radio.index]
  out.gain.cancelScheduledValues(ctx.currentTime)
  out.gain.setTargetAtTime(0.9, ctx.currentTime, 0.3)
  if (tr.kind === 'synth') {
    rng = tr.seed * 9973
    step = 0
    nextTime = ctx.currentTime + 0.08
    timer = window.setInterval(tick, 25)
  } else {
    if (!fileEl) {
      fileEl = new Audio()
      fileEl.crossOrigin = 'anonymous'
      fileNode = ctx.createMediaElementSource(fileEl)
      fileNode.connect(out)
    }
    fileEl.src = tr.url
    fileEl.onended = () => next()
    void fileEl.play().catch(() => next())
  }
}

export function play() {
  radio.playing = true
  setWorldMuffled(true)
  start()
  emit()
}

export function pause() {
  radio.playing = false
  stopAll()
  const bus = audioBus()
  if (bus && out) out.gain.setTargetAtTime(0, bus.ctx.currentTime, 0.15)
  setWorldMuffled(false)
  emit()
}

export function toggle() {
  if (radio.playing) pause()
  else play()
  // a short confirmation in the world, so the switch reads as intentional
  const tr = currentTrack()
  void import('../state/store').then(({ useStore }) => useStore.getState().showToast(
    radio.playing ? 'HEADSET · AUDIO ON' : 'HEADSET · AUDIO OFF',
    radio.playing ? `${tr.title} — ${tr.artist}` : 'The world comes back in',
  ))
}

export function next() {
  radio.index = (radio.index + 1) % PLAYLIST.length
  if (radio.playing) start()
  emit()
}

export function prev() {
  radio.index = (radio.index - 1 + PLAYLIST.length) % PLAYLIST.length
  if (radio.playing) start()
  emit()
}

export const currentTrack = () => PLAYLIST[radio.index]
