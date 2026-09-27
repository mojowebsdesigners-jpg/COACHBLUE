import { glideToTimeOfDay } from '../components/3d/Lighting'
import { useStore } from '../state/store'

/**
 * Typed commands for the people who build the world. Nothing announces them
 * and no menu lists them: press ` (backquote), type the word, press Enter.
 * While a command is being typed the keys are swallowed, so spelling it out
 * does not also summon the car or toggle the headset. Only a hash of each
 * word is kept here.
 */
const hash = (s: string) => {
  let x = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 0x01000193) >>> 0 }
  return x
}

const COMMANDS: { len: number; hash: number; run: () => void }[] = [
  // straight into the night: sunset, blue hour, lamps, stars, crickets
  { len: 14, hash: 3698382445, run: () => glideToTimeOfDay(0.97, 7) },
  // and back to a bright morning
  { len: 12, hash: 281491577, run: () => glideToTimeOfDay(0.38, 7) },
]

let typed = ''
let listening = false
let idle = 0

function stop() {
  listening = false
  typed = ''
  window.clearTimeout(idle)
}

window.addEventListener('keydown', (e) => {
  const target = e.target as HTMLElement | null
  if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
  if (useStore.getState().phase !== 'world') return
  if (!listening) {
    if (e.code === 'Backquote') {
      listening = true
      typed = ''
      idle = window.setTimeout(stop, 8000)
      e.preventDefault()
    }
    return
  }
  // capturing: nothing reaches the game until Enter or Escape
  e.preventDefault()
  e.stopImmediatePropagation()
  window.clearTimeout(idle)
  idle = window.setTimeout(stop, 8000)
  if (e.key === 'Escape') { stop(); return }
  if (e.key === 'Enter') {
    for (const c of COMMANDS) {
      if (typed.length >= c.len && hash(typed.slice(-c.len)) === c.hash) {
        c.run()
        break
      }
    }
    stop()
    return
  }
  if (e.key.length === 1 && /[a-z]/i.test(e.key)) typed = (typed + e.key.toLowerCase()).slice(-32)
}, true)
