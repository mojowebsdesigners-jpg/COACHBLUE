import { audioBus } from './audio'
import { useStore } from '../state/store'

/**
 * The GT's engine, synthesised: a V8 burble whose pitch follows the revs
 * through the gears, an intake roar that opens up under throttle, and the
 * starter motor turning it over before it catches.
 *
 * A V8 fires four times a revolution, so the note is rpm / 60 * 4: a lumpy
 * ~57 Hz at idle, climbing towards ~470 Hz at the limiter. Two sawtooths an
 * octave apart (slightly detuned, for the uneven firing), a square an octave
 * down for the chest, all through a low-pass that opens with throttle, and a
 * band of filtered noise for the air rushing in. Nothing is downloaded.
 */
type Engine = {
  out: GainNode
  a: OscillatorNode
  b: OscillatorNode
  sub: OscillatorNode
  lp: BiquadFilterNode
  roar: GainNode
  roarBp: BiquadFilterNode
  lumpy: GainNode
}

let eng: Engine | null = null
let running = false
let rpm = 0
const IDLE = 850
const LIMIT = 6900

function noise(ctx: AudioContext) {
  const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  const src = ctx.createBufferSource()
  src.buffer = buf
  src.loop = true
  return src
}

function build(): Engine | null {
  const bus = audioBus()
  if (!bus) return null
  const { ctx, out: master } = bus
  const out = ctx.createGain()
  out.gain.value = 0
  // a touch of saturation: an engine note is not a clean waveform
  const shaper = ctx.createWaveShaper()
  const curve = new Float32Array(1024)
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1
    curve[i] = Math.tanh(x * 2.4)
  }
  shaper.curve = curve
  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 500
  lp.Q.value = 1.4
  const mix = ctx.createGain()
  mix.gain.value = 0.5
  const a = ctx.createOscillator()
  a.type = 'sawtooth'
  const b = ctx.createOscillator()
  b.type = 'sawtooth'
  b.detune.value = 9
  const sub = ctx.createOscillator()
  sub.type = 'square'
  const ga = ctx.createGain(); ga.gain.value = 0.5
  const gb = ctx.createGain(); gb.gain.value = 0.22
  const gs = ctx.createGain(); gs.gain.value = 0.35
  a.connect(ga).connect(mix)
  b.connect(gb).connect(mix)
  sub.connect(gs).connect(mix)
  // the lope: the whole note pulses a little at the firing rate / 8
  const lumpy = ctx.createGain()
  lumpy.gain.value = 1
  const lfo = ctx.createOscillator()
  lfo.frequency.value = 7
  const lfoAmt = ctx.createGain()
  lfoAmt.gain.value = 0.18
  lfo.connect(lfoAmt).connect(lumpy.gain)
  mix.connect(shaper).connect(lp).connect(lumpy).connect(out)
  // intake and exhaust roar
  const n = noise(ctx)
  const roarBp = ctx.createBiquadFilter()
  roarBp.type = 'bandpass'
  roarBp.frequency.value = 400
  roarBp.Q.value = 0.8
  const roar = ctx.createGain()
  roar.gain.value = 0
  n.connect(roarBp).connect(roar).connect(out)
  out.connect(master)
  for (const o of [a, b, sub, lfo]) o.start()
  n.start()
  return { out, a, b, sub, lp, roar, roarBp, lumpy }
}

function soundOn() {
  const s = useStore.getState().settings
  return s.sound
}

/** Turn the key: the starter cranks, the engine catches, blips, and settles. */
export function ignition() {
  if (!soundOn()) { running = true; rpm = IDLE; return }
  eng = eng ?? build()
  const bus = audioBus()
  if (!eng || !bus) return
  const { ctx, out: master } = bus
  const t = ctx.currentTime
  // the starter motor: a whirring grind, pulsing as it turns the engine over
  const st = ctx.createOscillator()
  st.type = 'sawtooth'
  st.frequency.setValueAtTime(95, t)
  st.frequency.linearRampToValueAtTime(140, t + 0.8)
  const stLp = ctx.createBiquadFilter()
  stLp.type = 'lowpass'
  stLp.frequency.value = 900
  const stG = ctx.createGain()
  stG.gain.setValueAtTime(0.0001, t)
  stG.gain.exponentialRampToValueAtTime(0.16, t + 0.05)
  stG.gain.setValueAtTime(0.16, t + 0.8)
  stG.gain.exponentialRampToValueAtTime(0.0001, t + 0.95)
  const puls = ctx.createOscillator()
  puls.frequency.value = 11
  const pulsG = ctx.createGain()
  pulsG.gain.value = 0.08
  puls.connect(pulsG).connect(stG.gain)
  st.connect(stLp).connect(stG).connect(master)
  st.start(t); puls.start(t)
  st.stop(t + 1); puls.stop(t + 1)
  // then it catches
  window.setTimeout(() => {
    running = true
    rpm = 2600            // the blip as it fires
  }, 820)
}

export function engineOff() {
  running = false
  const bus = audioBus()
  if (!eng || !bus) return
  eng.out.gain.setTargetAtTime(0, bus.ctx.currentTime, 0.25)
}

/**
 * Called every frame while the car exists. `speed` m/s, `throttle` -1..1.
 * The revs follow road speed through six gears; lifting drops them towards
 * idle; the note, the filter and the roar all follow the revs and the load.
 */
const GEARS = [0, 9, 16, 24, 31, 38, 60]      // top speed of each gear, m/s
export function engineStep(dt: number, speed: number, throttle: number) {
  if (!running) return
  const v = Math.abs(speed)
  let g = 1
  while (g < GEARS.length - 1 && v > GEARS[g]) g++
  const lo = GEARS[g - 1], hi = GEARS[g]
  const inGear = g === 1 ? v / hi : (v - lo) / (hi - lo)
  const target = v < 0.3 && throttle <= 0
    ? IDLE
    : Math.min(LIMIT, 1300 + inGear * 5200 + (throttle > 0 ? 400 : 0))
  // revs rise quickly under load and fall back more slowly
  const k = 1 - Math.exp(-(target > rpm ? 6 : 3) * dt)
  rpm += (target - rpm) * k
  if (!eng || !soundOn()) return
  const bus = audioBus()
  if (!bus) return
  const t = bus.ctx.currentTime
  const f = (rpm / 60) * 4
  const load = Math.max(0, throttle)
  eng.a.frequency.setTargetAtTime(f, t, 0.03)
  eng.b.frequency.setTargetAtTime(f * 2, t, 0.03)
  eng.sub.frequency.setTargetAtTime(f / 2, t, 0.03)
  eng.lp.frequency.setTargetAtTime(300 + rpm * 0.35 + load * 1600, t, 0.05)
  eng.roarBp.frequency.setTargetAtTime(200 + rpm * 0.12, t, 0.08)
  eng.roar.gain.setTargetAtTime(0.02 + load * 0.12 * (rpm / LIMIT + 0.3), t, 0.08)
  eng.out.gain.setTargetAtTime(0.11 + load * 0.08 + (rpm / LIMIT) * 0.06, t, 0.05)
}

export const engineRunning = () => running
