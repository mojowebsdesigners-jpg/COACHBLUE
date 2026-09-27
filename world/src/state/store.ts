import { create } from 'zustand'
import { Vector3 } from 'three'
import type { LocationId } from '../data/journey'
import { journeySteps } from '../data/journey'
import { PRESETS, prefersReducedMotion, resolveTier, type Preset, type ResolvedTier, type Tier } from '../lib/quality'

export type Phase = 'loading' | 'enter' | 'mode' | 'world' | 'classic' | 'unsupported'
export type Mode = 'free' | 'guided'
export type PanelKind =
  | 'coach' | 'challenge' | 'camp-item' | 'pillar' | 'hundred'
  | 'hub' | 'process' | 'campfire' | 'faq' | 'goal' | 'summit'
  | 'secret' | 'timeline' | 'mirror' | 'notebook'

export type Panel = { kind: PanelKind; index?: number; id?: string } | null

export type Settings = {
  tier: Tier
  /** 'auto' uses WebGL; WebGPU is opt-in and falls back on any failure */
  renderer: 'webgl' | 'webgpu'
  reducedMotion: boolean
  skipCinematics: boolean
  sound: boolean
  music: boolean
}

type Prefs = Settings & { mode: Mode; visited: boolean }

const PREF_KEY = 'coachblue.prefs'
const DEFAULTS: Prefs = {
  tier: 'auto',
  renderer: 'webgl',
  reducedMotion: false,
  skipCinematics: false,
  sound: true,
  music: true,
  mode: 'guided',
  visited: false,
}

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREF_KEY)
    const saved: Prefs = raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS }
    if (raw === null && prefersReducedMotion()) saved.reducedMotion = true
    return saved
  } catch {
    return { ...DEFAULTS }
  }
}
function savePrefs(p: Partial<Prefs>) {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify({ ...loadPrefs(), ...p }))
  } catch {
    /* private mode — preferences just don't persist */
  }
}

export type Verb =
  | 'INTERACT' | 'VIEW' | 'TALK' | 'READ' | 'OPEN' | 'ENTER' | 'LIGHT' | 'START' | 'LOOK' | 'INSPECT'
  | 'TRAIN' | 'LIFT' | 'DROP'

export type Interactable = {
  id: string
  label: string
  verb?: Verb
  position: Vector3
  radius: number
  panel: Panel
  /** used instead of a panel, e.g. photo frames opening the lightbox */
  action?: () => void
  /** camera framing while the panel is open */
  focus?: { dist: number; height: number }
  /** name of a one-off cinematic to play the first time it is used */
  cinematic?: string
}

type State = {
  phase: Phase
  mode: Mode
  view: 'third' | 'first'
  settings: Settings
  preset: Preset
  visited: boolean

  panel: Panel
  photoIndex: number | null
  mapOpen: boolean
  journalOpen: boolean
  settingsOpen: boolean
  bookingOpen: boolean
  photoMode: boolean

  nearest: Interactable | null
  discovered: LocationId[]
  secrets: { id: string; name: string }[]
  toast: { title: string; sub?: string; key: number } | null
  journeyIndex: number
  journeyBanner: { label: string; line: string; index: number; key: number } | null
  offPathHint: boolean
  campPrompt: boolean
  finale: boolean
  cinematic: string | null
  seenCinematics: string[]
  timeOfDay: number          // 0..1, 0 = midnight
  timeScale: number          // how fast the clock runs
  lightsOn: boolean
  /** true once assets are fetched and every shader is compiled */
  worldReady: boolean

  setPhase: (p: Phase) => void
  setMode: (m: Mode, persist?: boolean) => void
  toggleView: () => void
  updateSettings: (s: Partial<Settings>) => void
  /**
   * Step the resolved quality down without touching the player's chosen tier.
   * Their setting stays AUTO; only what AUTO resolves to changes.
   */
  setAutoTier: (t: ResolvedTier) => void
  openPanel: (p: Panel) => void
  closePanel: () => void
  openPhoto: (i: number | null) => void
  setMap: (o: boolean) => void
  setJournal: (o: boolean) => void
  setSettingsOpen: (o: boolean) => void
  setBooking: (o: boolean) => void
  /** what the booking form opens pre-filled with (the goal, and why it was opened) */
  bookingContext: { goal?: string; reason?: string } | null
  openBooking: (ctx?: { goal?: string; reason?: string }) => void
  /** what Coach Blue is wearing */
  outfit: 'shirt' | 'shirtless'
  setOutfit: (o: 'shirt' | 'shirtless') => void
  /** a short conversation with someone in the world */
  dialog: { name: string; lines: { who: 'them' | 'you'; text: string }[]; index: number; key: number } | null
  setDialog: (d: { name: string; lines: { who: 'them' | 'you'; text: string }[] } | null) => void
  advanceDialog: () => void
  /** the gentle "want Coach Blue's help with this?" card */
  nudge: { title: string; body: string; goal?: string; reason?: string; key: number } | null
  setNudge: (n: { title: string; body: string; goal?: string; reason?: string } | null) => void
  setPhotoMode: (o: boolean) => void
  setNearest: (i: Interactable | null) => void
  discover: (id: LocationId, name: string) => void
  findSecret: (id: string, name: string) => void
  showToast: (title: string, sub?: string) => void
  advanceJourney: (to?: number) => void
  setOffPathHint: (v: boolean) => void
  setCampPrompt: (v: boolean) => void
  setFinale: (v: boolean) => void
  playCinematic: (name: string | null) => void
  setTimeOfDay: (t: number) => void
  setTimeScale: (s: number) => void
  setLightsOn: (on: boolean) => void
  setWorldReady: (ready: boolean) => void
}

const prefs = loadPrefs()
const autoCache: { auto?: ResolvedTier } = {}

export const useStore = create<State>((set, get) => ({
  phase: 'loading',
  mode: prefs.mode,
  view: 'third',
  settings: {
    tier: prefs.tier,
    renderer: prefs.renderer,
    reducedMotion: prefs.reducedMotion,
    skipCinematics: prefs.skipCinematics,
    sound: prefs.sound,
    music: prefs.music,
  },
  preset: resolveTier(prefs.tier, autoCache),
  visited: prefs.visited,

  panel: null,
  photoIndex: null,
  mapOpen: false,
  journalOpen: false,
  settingsOpen: false,
  bookingOpen: false,
  bookingContext: null,
  nudge: null,
  dialog: null,
  outfit: 'shirt',
  photoMode: false,

  nearest: null,
  discovered: [],
  secrets: [],
  toast: null,
  journeyIndex: 0,
  journeyBanner: null,
  offPathHint: false,
  campPrompt: false,
  finale: false,
  cinematic: null,
  seenCinematics: [],
  timeOfDay: 0.36,           // mid-morning when you arrive
  timeScale: 1,
  lightsOn: false,
  worldReady: false,

  setPhase: (phase) => {
    if (phase === 'world') savePrefs({ visited: true })
    set({ phase })
  },
  setMode: (mode, persist = true) => {
    if (persist) savePrefs({ mode })
    const banner =
      mode === 'guided'
        ? { ...journeySteps[get().journeyIndex], index: get().journeyIndex, key: Date.now() }
        : null
    set({ mode, journeyBanner: banner, offPathHint: false })
  },
  toggleView: () => set((s) => ({ view: s.view === 'third' ? 'first' : 'third' })),

  setAutoTier: (t) => {
    autoCache.auto = t
    set({ preset: PRESETS[t] })
  },
  updateSettings: (partial) => {
    const settings = { ...get().settings, ...partial }
    savePrefs(settings)
    set({ settings, preset: resolveTier(settings.tier, autoCache) })
  },

  openPanel: (panel) => set({ panel, mapOpen: false, journalOpen: false, settingsOpen: false }),
  closePanel: () => set({ panel: null }),
  openPhoto: (photoIndex) => set({ photoIndex }),
  setMap: (mapOpen) => set({ mapOpen, journalOpen: false, settingsOpen: false }),
  setJournal: (journalOpen) => set({ journalOpen, mapOpen: false, settingsOpen: false }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen, mapOpen: false, journalOpen: false }),
  setBooking: (bookingOpen) => set(bookingOpen ? { bookingOpen } : { bookingOpen, bookingContext: null }),
  openBooking: (ctx) => set({ bookingOpen: true, bookingContext: ctx ?? null, nudge: null }),
  setNudge: (n) => set({ nudge: n ? { ...n, key: Date.now() } : null }),
  setDialog: (d) => set({ dialog: d ? { ...d, index: 0, key: Date.now() } : null }),
  setOutfit: (outfit) => set({ outfit }),
  advanceDialog: () => {
    const d = get().dialog
    if (!d) return
    if (d.index + 1 >= d.lines.length) set({ dialog: null })
    else set({ dialog: { ...d, index: d.index + 1 } })
  },
  setPhotoMode: (photoMode) =>
    set({ photoMode, mapOpen: false, journalOpen: false, settingsOpen: false, panel: null }),
  setNearest: (nearest) => set({ nearest }),

  discover: (id, name) => {
    if (get().discovered.includes(id)) return
    set((s) => ({
      discovered: [...s.discovered, id],
      toast: { title: 'DISCOVERED', sub: name, key: Date.now() },
    }))
  },
  findSecret: (id, name) => {
    if (get().secrets.some((s) => s.id === id)) return
    set((s) => ({
      secrets: [...s.secrets, { id, name }],
      toast: { title: 'FOUND', sub: name, key: Date.now() },
    }))
  },
  showToast: (title, sub) => set({ toast: { title, sub, key: Date.now() } }),

  advanceJourney: (to) => {
    const next = to ?? get().journeyIndex + 1
    if (next >= journeySteps.length) {
      set({ journeyIndex: journeySteps.length - 1 })
      return
    }
    set({
      journeyIndex: next,
      journeyBanner: { ...journeySteps[next], index: next, key: Date.now() },
      offPathHint: false,
      campPrompt: false,
    })
  },
  setOffPathHint: (offPathHint) => set({ offPathHint }),
  setCampPrompt: (campPrompt) => set({ campPrompt }),
  setFinale: (finale) => set({ finale }),

  setTimeOfDay: (timeOfDay) => {
    // written every frame by the lighting rig; only publish on a visible step
    if (Math.abs(timeOfDay - get().timeOfDay) > 0.002) set({ timeOfDay })
  },
  setTimeScale: (timeScale) => set({ timeScale }),
  setLightsOn: (lightsOn) => set({ lightsOn }),
  setWorldReady: (worldReady) => set({ worldReady }),

  playCinematic: (cinematic) => {
    if (cinematic === null) {
      set({ cinematic: null })
      return
    }
    const s = get()
    if (s.settings.skipCinematics || s.settings.reducedMotion) return
    if (s.seenCinematics.includes(cinematic)) return
    // never take the camera away mid-drive or mid-set, or over something open:
    // that is what used to leave the car frozen in the road
    if (s.panel || s.bookingOpen || s.dialog || s.mapOpen) return
    if (cinematicBlocked()) return
    set({ cinematic, seenCinematics: [...s.seenCinematics, cinematic] })
  },
}))

/** Set by the vehicle and workout systems (kept out of the store's imports). */
let cinematicBlocked: () => boolean = () => false
export function setCinematicBlock(fn: () => boolean) {
  cinematicBlocked = fn
}

/** Per-frame data that must not trigger React renders. */
export const player = {
  pos: new Vector3(0, 0, 162),
  yaw: Math.PI,          // facing -z, into the forest
  speed: 0,
  moveDir: 1,            // 1 walking forward, -1 backing up
  grounded: true,
  surface: 'grass' as 'grass' | 'dirt' | 'wood' | 'stone' | 'asphalt' | 'rubber' | 'water',
  /** in water deep enough to swim, and the height of its surface */
  swimming: false,
  waterSurface: 0,
  /** 0 treading water .. 1 swimming flat out, eased */
  swimBlend: 0,
  /** metres below the surface (0 = at the surface) and how fast that is changing */
  dive: 0,
  diveVel: 0,
  /** lungful of air, 1 full .. 0 empty */
  breath: 1,
  camYaw: Math.PI,
  camPitch: 0.22,
  camDist: 4.8,
  camDistMax: 11,
  frozen: false,
}
