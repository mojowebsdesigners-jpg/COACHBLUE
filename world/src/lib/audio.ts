// Everything you hear is synthesised in the browser — wind, birds, water, fire,
// footsteps per surface and a simple evolving score. No audio files to download,
// and it can all follow the player's position.

type Layer = { gain: GainNode; stop?: () => void }

let ctx: AudioContext | null = null
let master: GainNode | null = null
let sfxBus: GainNode | null = null
let musicBus: GainNode | null = null
let birdTimer: number | null = null
let muffle: BiquadFilterNode | null = null
let nightTimer: number | null = null
/** 0 by day .. 1 in full night: shapes the whole soundscape */
let nightAmount = 0
const layers: Record<string, Layer> = {}

const now = () => ctx?.currentTime ?? 0

function noiseBuffer(context: AudioContext, seconds = 4, brown = true) {
  const buffer = context.createBuffer(1, context.sampleRate * seconds, context.sampleRate)
  const data = buffer.getChannelData(0)
  let last = 0
  for (let i = 0; i < data.length; i++) {
    const white = Math.random() * 2 - 1
    if (brown) {
      last = (last + 0.02 * white) / 1.02
      data[i] = last * 3.2
    } else {
      data[i] = white
    }
  }
  return buffer
}

function loopNoise(context: AudioContext, out: GainNode, opts: {
  type: BiquadFilterType; frequency: number; gain: number; brown?: boolean; q?: number
}) {
  const src = context.createBufferSource()
  src.buffer = noiseBuffer(context, 4, opts.brown ?? true)
  src.loop = true
  const filter = context.createBiquadFilter()
  filter.type = opts.type
  filter.frequency.value = opts.frequency
  if (opts.q) filter.Q.value = opts.q
  const gain = context.createGain()
  gain.gain.value = opts.gain
  src.connect(filter).connect(gain).connect(out)
  src.start()
  return { gain, stop: () => src.stop() }
}

function chirp(context: AudioContext, out: GainNode) {
  const t = context.currentTime
  const osc = context.createOscillator()
  const gain = context.createGain()
  const base = 1800 + Math.random() * 1600
  osc.type = 'sine'
  osc.frequency.setValueAtTime(base, t)
  osc.frequency.exponentialRampToValueAtTime(base * (1.25 + Math.random() * 0.5), t + 0.08)
  osc.frequency.exponentialRampToValueAtTime(base * 0.85, t + 0.16)
  gain.gain.setValueAtTime(0.0001, t)
  gain.gain.exponentialRampToValueAtTime(0.045, t + 0.02)
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22)
  osc.connect(gain).connect(out)
  osc.start(t)
  osc.stop(t + 0.3)
}

/**
 * A cricket: a short train of bright pulses at the insect's own pitch, the
 * way a real one rubs its wings. Each call picks a voice from a small chorus
 * spread across the stereo field, so the grass sounds full, not looped.
 */
const CRICKETS = [4300, 4650, 5050, 4480]
function cricket(context: AudioContext, out: GainNode) {
  const t0 = context.currentTime + Math.random() * 0.2
  const f = CRICKETS[Math.floor(Math.random() * CRICKETS.length)] * (0.99 + Math.random() * 0.02)
  const osc = context.createOscillator()
  osc.type = 'sine'
  osc.frequency.value = f
  const gain = context.createGain()
  gain.gain.value = 0
  const pan = context.createStereoPanner()
  pan.pan.value = Math.random() * 1.6 - 0.8
  osc.connect(gain).connect(pan).connect(out)
  const pulses = 3 + Math.floor(Math.random() * 3)
  const level = 0.012 + Math.random() * 0.01
  for (let i = 0; i < pulses; i++) {
    const t = t0 + i * 0.055
    gain.gain.setValueAtTime(0, t)
    gain.gain.linearRampToValueAtTime(level, t + 0.008)
    gain.gain.linearRampToValueAtTime(0, t + 0.038)
  }
  osc.start(t0)
  osc.stop(t0 + pulses * 0.055 + 0.05)
}

/** A tawny owl far off in the trees: two soft, falling hoots. */
function owl(context: AudioContext, out: GainNode) {
  const t0 = context.currentTime
  const pan = context.createStereoPanner()
  pan.pan.value = Math.random() * 1.4 - 0.7
  const lp = context.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 900
  lp.connect(pan).connect(out)
  for (const [dt, dur, f] of [[0, 0.42, 410], [0.7, 0.9, 390]] as const) {
    const osc = context.createOscillator()
    osc.type = 'sine'
    const g = context.createGain()
    const t = t0 + dt
    osc.frequency.setValueAtTime(f, t)
    osc.frequency.exponentialRampToValueAtTime(f * 0.9, t + dur)
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.03, t + 0.08)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    osc.connect(g).connect(lp)
    osc.start(t)
    osc.stop(t + dur + 0.05)
  }
}

/**
 * How dark it is, 0..1, from the day cycle. Night is quieter overall: the
 * wind drops, the birds stop, and the crickets and the odd owl take over.
 */
export function setNightAmount(n: number) {
  nightAmount = Math.min(1, Math.max(0, n))
  const w = layers.wind
  if (w && ctx) w.gain.gain.setTargetAtTime(0.34 * (1 - nightAmount * 0.45), now(), 1.5)
}

// ---------------------------------------------------------------- music
// Three sparse layers that fade in as the journey goes on: a low drone, a slow
// pulse, and a high pad. Restrained on purpose — it sits under the world.
const SCALE = [110, 146.83, 164.81, 196, 220, 293.66]

function startMusic(context: AudioContext, out: GainNode) {
  const make = (freq: number, type: OscillatorType, gainValue: number) => {
    const osc = context.createOscillator()
    const gain = context.createGain()
    osc.type = type
    osc.frequency.value = freq
    gain.gain.value = gainValue
    osc.connect(gain).connect(out)
    osc.start()
    return { osc, gain }
  }
  const drone = make(SCALE[0], 'sine', 0.06)
  const fifth = make(SCALE[3], 'sine', 0.03)
  const pad = make(SCALE[4] * 2, 'triangle', 0.012)

  // slow tremolo so the drone breathes
  const lfo = context.createOscillator()
  const lfoGain = context.createGain()
  lfo.frequency.value = 0.08
  lfoGain.gain.value = 0.03
  lfo.connect(lfoGain).connect(drone.gain.gain)
  lfo.start()

  let step = 0
  const pulse = () => {
    if (!ctx || !musicBus) return
    const t = context.currentTime
    const osc = context.createOscillator()
    const gain = context.createGain()
    osc.type = 'sine'
    osc.frequency.value = SCALE[step % SCALE.length] * 2
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(0.03, t + 0.4)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 2.6)
    osc.connect(gain).connect(out)
    osc.start(t)
    osc.stop(t + 2.8)
    step++
    window.setTimeout(pulse, 3400 + Math.random() * 2600)
  }
  window.setTimeout(pulse, 4000)

  return { drone, fifth, pad }
}

let music: ReturnType<typeof startMusic> | null = null

// birds sing by day and fall quiet as it gets dark
function birdTick() {
  if (ctx && sfxBus && sfxBus.gain.value > 0.01 && Math.random() > 0.35 + nightAmount * 0.62) chirp(ctx, sfxBus)
  birdTimer = window.setTimeout(birdTick, 2400 + Math.random() * 6000)
}
// and the night has its own voices: crickets in the grass, an owl
function nightTick() {
  if (ctx && sfxBus && sfxBus.gain.value > 0.01 && nightAmount > 0.35) {
    if (Math.random() < nightAmount) cricket(ctx, sfxBus)
    if (Math.random() < 0.05 * nightAmount) owl(ctx, sfxBus)
  }
  nightTimer = window.setTimeout(nightTick, 700 + Math.random() * 1400)
}

export function startAmbience() {
  if (ctx) {
    void ctx.resume()
    return
  }
  try {
    ctx = new AudioContext()
    master = ctx.createGain()
    master.gain.value = 0.55
    // everything passes a low-pass that stays wide open until you go under
    muffle = ctx.createBiquadFilter()
    muffle.type = 'lowpass'
    muffle.frequency.value = 20000
    master.connect(muffle).connect(ctx.destination)

    sfxBus = ctx.createGain()
    sfxBus.gain.value = 1
    sfxBus.connect(master)

    musicBus = ctx.createGain()
    musicBus.gain.value = 0
    musicBus.connect(master)

    // wind is always there; water and fire are faded in by proximity
    layers.wind = loopNoise(ctx, sfxBus, { type: 'lowpass', frequency: 420, gain: 0.34 })
    layers.water = loopNoise(ctx, sfxBus, { type: 'bandpass', frequency: 900, gain: 0, brown: false, q: 0.7 })
    layers.fire = loopNoise(ctx, sfxBus, { type: 'lowpass', frequency: 1500, gain: 0, brown: false })
    layers.rain = loopNoise(ctx, sfxBus, { type: 'highpass', frequency: 1800, gain: 0, brown: false })

    const gust = ctx.createOscillator()
    const gustGain = ctx.createGain()
    gust.frequency.value = 0.06
    gustGain.gain.value = 0.2
    gust.connect(gustGain).connect(layers.wind.gain.gain)
    gust.start()

    music = startMusic(ctx, musicBus)

    birdTick()
    nightTick()
  } catch {
    /* audio unavailable — the world just stays quiet */
  }
}

export function setAmbienceEnabled(on: boolean) {
  if (!ctx || !sfxBus) return
  sfxBus.gain.setTargetAtTime(on ? 1 : 0, now(), 0.4)
  if (on) {
    if (birdTimer === null) birdTick()
    if (nightTimer === null) nightTick()
    return
  }
  if (!on && nightTimer) {
    clearTimeout(nightTimer)
    nightTimer = null
  }
  if (!on && birdTimer) {
    clearTimeout(birdTimer)
    birdTimer = null
  }
}

export function setMusicEnabled(on: boolean) {
  if (!ctx || !musicBus) return
  musicBus.gain.setTargetAtTime(on ? 0.5 : 0, now(), 1.2)
}

/** Journey progress (0..1) opens up the score as the story builds. */
export function setMusicIntensity(t: number) {
  if (!music || !ctx) return
  const k = Math.min(1, Math.max(0, t))
  music.fifth.gain.gain.setTargetAtTime(0.012 + k * 0.05, now(), 2)
  music.pad.gain.gain.setTargetAtTime(0.004 + k * 0.03, now(), 2)
}

/** Distance-based beds: how close the player is to water and to fire (0..1). */
export function setProximity(water: number, fire: number) {
  if (!ctx) return
  layers.water?.gain.gain.setTargetAtTime(Math.min(1, Math.max(0, water)) * 0.22, now(), 0.35)
  layers.fire?.gain.gain.setTargetAtTime(Math.min(1, Math.max(0, fire)) * 0.16, now(), 0.35)
}

/** How hard it is raining, 0..1. */
export function setRain(amount: number) {
  if (!ctx) return
  layers.rain?.gain.gain.setTargetAtTime(Math.min(1, Math.max(0, amount)) * 0.13, now(), 0.6)
}

/**
 * A footstep is shaped by what is under it: soft grass is a brief hiss with no
 * body, a hard pavement is a short bright slap, rubber gym flooring is a dull
 * thud that dies immediately. Filter, decay and level are all that is needed
 * to tell them apart by ear.
 */
const SURFACE: Record<string, { freq: number; decay: number; type: BiquadFilterType; gain: number }> = {
  grass: { freq: 2400, decay: 0.09, type: 'highpass', gain: 0.1 },
  dirt: { freq: 900, decay: 0.11, type: 'lowpass', gain: 0.13 },
  wood: { freq: 320, decay: 0.16, type: 'lowpass', gain: 0.17 },
  stone: { freq: 1600, decay: 0.08, type: 'bandpass', gain: 0.14 },
  asphalt: { freq: 1250, decay: 0.07, type: 'bandpass', gain: 0.16 },
  rubber: { freq: 420, decay: 0.055, type: 'lowpass', gain: 0.15 },
}

/** One footstep. Called by the player controller in time with the walk cycle. */
export function footstep(surface: keyof typeof SURFACE, strength = 1) {
  if (!ctx || !sfxBus) return
  const cfg = SURFACE[surface] ?? SURFACE.grass
  const t = ctx.currentTime
  const src = ctx.createBufferSource()
  src.buffer = noiseBuffer(ctx, 0.25, surface === 'wood')
  const filter = ctx.createBiquadFilter()
  filter.type = cfg.type
  filter.frequency.value = cfg.freq * (0.85 + Math.random() * 0.3)
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(cfg.gain * strength, t)
  gain.gain.exponentialRampToValueAtTime(0.0001, t + cfg.decay)
  src.connect(filter).connect(gain).connect(sfxBus)
  src.start(t)
  src.stop(t + cfg.decay + 0.05)
}

/** Short UI blip for discoveries and interactions. */
export function cue(kind: 'discover' | 'interact' | 'close' = 'interact') {
  if (!ctx || !sfxBus) return
  const t = ctx.currentTime
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  const base = kind === 'discover' ? 660 : kind === 'close' ? 320 : 440
  osc.type = 'sine'
  osc.frequency.setValueAtTime(base, t)
  osc.frequency.exponentialRampToValueAtTime(kind === 'close' ? base * 0.7 : base * 1.5, t + 0.18)
  gain.gain.setValueAtTime(0.0001, t)
  gain.gain.exponentialRampToValueAtTime(0.05, t + 0.02)
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.4)
  osc.connect(gain).connect(sfxBus)
  osc.start(t)
  osc.stop(t + 0.45)
}

/**
 * A stroke entering the water: a soft broadband "shh" that swells and dies,
 * with a low body for the hand catching. `strength` 0..1.
 */
export function splash(strength = 1) {
  if (!ctx || !sfxBus) return
  const t = ctx.currentTime
  const src = ctx.createBufferSource()
  src.buffer = noiseBuffer(ctx, 0.6, false)
  const hp = ctx.createBiquadFilter()
  hp.type = 'bandpass'
  hp.frequency.value = 1400 + Math.random() * 900
  hp.Q.value = 0.6
  const gain = ctx.createGain()
  const peak = 0.09 * strength
  gain.gain.setValueAtTime(0.0001, t)
  gain.gain.exponentialRampToValueAtTime(peak, t + 0.05)
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.45)
  src.connect(hp).connect(gain).connect(sfxBus)
  src.start(t)
  src.stop(t + 0.55)
}

/**
 * The shared context and master bus, for systems with their own voice (the
 * headset radio, the gym ambience). Starts the engine if it isn't running.
 */
export function audioBus() {
  if (!ctx) startAmbience()
  return ctx && master ? { ctx, out: master } : null
}

/** Duck the world while the headset is on: over-ears muffle what's outside. */
export function setWorldMuffled(on: boolean) {
  if (!ctx || !sfxBus || !musicBus) return
  sfxBus.gain.setTargetAtTime(on ? 0.35 : 1, ctx.currentTime, 0.4)
  if (on) musicBus.gain.setTargetAtTime(0, ctx.currentTime, 0.6)
}

// ---------------------------------------------------------------- gym ambience
/**
 * One sound from the training floor, at `level` (0..1, from distance):
 *  clank   a plate settling on a horn: inharmonic metal partials, short ring
 *  chain   the rig's chain: a quick run of tiny metallic ticks
 *  exhale  a lifter breathing out through a rep: breathy formant noise
 *  drop    a dumbbell set down on rubber: a dull thud with a little rattle
 */
export function gymSound(kind: 'clank' | 'chain' | 'exhale' | 'drop', level: number) {
  if (!ctx || !sfxBus || level < 0.02) return
  const t = ctx.currentTime
  const out = ctx.createGain()
  out.gain.value = level
  // a touch of stereo placement so the floor has width
  const pan = ctx.createStereoPanner()
  pan.pan.value = (Math.random() - 0.5) * 1.2
  out.connect(pan).connect(sfxBus)
  const tone = (f: number, amp: number, decay: number, at = t) => {
    const o = ctx!.createOscillator()
    const g = ctx!.createGain()
    o.frequency.value = f
    g.gain.setValueAtTime(amp, at)
    g.gain.exponentialRampToValueAtTime(0.0001, at + decay)
    o.connect(g).connect(out)
    o.start(at)
    o.stop(at + decay + 0.02)
  }
  const burst = (type: BiquadFilterType, f: number, q: number, amp: number, decay: number, at = t) => {
    const src = ctx!.createBufferSource()
    src.buffer = noiseBuffer(ctx!, decay + 0.05, false)
    const fl = ctx!.createBiquadFilter()
    fl.type = type
    fl.frequency.value = f
    fl.Q.value = q
    const g = ctx!.createGain()
    g.gain.setValueAtTime(amp, at)
    g.gain.exponentialRampToValueAtTime(0.0001, at + decay)
    src.connect(fl).connect(g).connect(out)
    src.start(at)
    src.stop(at + decay + 0.05)
  }
  if (kind === 'clank') {
    const base = 380 + Math.random() * 180
    for (const [mul, amp, dec] of [[1, 0.05, 0.5], [2.76, 0.035, 0.35], [5.4, 0.022, 0.22], [8.9, 0.012, 0.12]]) {
      tone(base * mul, amp, dec)
    }
    burst('highpass', 3000, 0.7, 0.05, 0.04)
    // the second plate a beat later, sometimes
    if (Math.random() > 0.5) for (const [mul, amp, dec] of [[1.07, 0.03, 0.4], [2.9, 0.02, 0.25]]) tone(base * mul, amp, dec, t + 0.14)
  } else if (kind === 'chain') {
    for (let i = 0; i < 9; i++) tone(2600 + Math.random() * 2400, 0.012, 0.05, t + i * 0.035 + Math.random() * 0.02)
  } else if (kind === 'exhale') {
    burst('bandpass', 700 + Math.random() * 300, 1.2, 0.07, 0.55)
    burst('bandpass', 1600, 2, 0.03, 0.4)
  } else {
    burst('lowpass', 220, 0.8, 0.14, 0.18)
    tone(95, 0.08, 0.16)
    tone(1400, 0.01, 0.1, t + 0.05)
  }
}

let treadLayer: Layer | null = null
/** The curved treadmill's slats, rumbling while someone runs on it. */
export function setTreadmillHum(level: number) {
  if (!ctx || !sfxBus) return
  if (!treadLayer) treadLayer = loopNoise(ctx, sfxBus, { type: 'bandpass', frequency: 160, gain: 0, q: 1.4 })
  treadLayer.gain.gain.setTargetAtTime(level * 0.12, ctx.currentTime, 0.4)
}

/** Under water, the world goes dull and close: everything above ~500 Hz falls away. */
export function setUnderwater(on: boolean) {
  if (!ctx || !muffle) return
  muffle.frequency.setTargetAtTime(on ? 480 : 20000, ctx.currentTime, on ? 0.08 : 0.2)
  if (on) splash(0.5)
}
