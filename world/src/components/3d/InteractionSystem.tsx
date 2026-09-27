import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Vector3 } from 'three'
import { locations, journeySteps, locationById } from '../../data/journey'
import { POOL, pathDistance, pathProgress, streamDistanceAt } from '../../lib/terrain'
import { cue, setMusicIntensity, setProximity } from '../../lib/audio'
import { player, useStore, type Interactable } from '../../state/store'
import { focusOn, releaseFocus } from './CameraController'
import { stopWorkout, workout } from '../../systems/Workout'

// ---------------------------------------------------------------- registry
const registry = new Map<string, Interactable>()

export function registerInteractable(item: Interactable) {
  registry.set(item.id, item)
  return () => {
    registry.delete(item.id)
  }
}

/**
 * Fire one interactable by id, without having to walk to it and press E. This
 * exists so a headless screenshot can exercise things that need input — sitting
 * in the car, starting a set — which no amount of camera placement can reach.
 */
export function triggerById(id: string) {
  const item = registry.get(id)
  if (!item) return false
  if (item.action) item.action()
  else useStore.getState().openPanel(item.panel)
  return true
}

/** An interactable by id, for tooling (tests place the player beside it). */
export const findInteractable = (id: string) => registry.get(id) ?? null

export function triggerNearest() {
  const state = useStore.getState()
  const { nearest, openPanel, panel } = state
  if (panel) return
  if (!nearest) return
  cue('interact')
  if (nearest.cinematic) state.playCinematic(nearest.cinematic)
  if (nearest.action) {
    nearest.action()
    return
  }
  openPanel(nearest.panel)
  focusOn(nearest.position, nearest.focus?.dist ?? 4.6, nearest.focus?.height ?? 1.9)
  player.frozen = true
}

export function closeInteraction() {
  cue('close')
  useStore.getState().closePanel()
  releaseFocus()
  player.frozen = false
}

/**
 * Whatever the station — a bench press, a pull-up bar, a park bench — E is how
 * you get off it. The prompt is one object per label, so it only re-renders
 * when the label actually changes (a rep lands).
 */
let stopItem: Interactable | null = null
function stopPrompt() {
  const st = workout.station!
  const label = st.def.category === 'rest'
    ? 'STAND UP'
    : st.def.pose === 'run' ? 'STEP OFF' : `FINISH SET · ${workout.reps} REPS`
  if (!stopItem || stopItem.label !== label) {
    stopItem = {
      id: 'station-stop', label, verb: 'TRAIN', position: player.pos, radius: 99, panel: null,
      action: () => { stopWorkout() },
    }
  }
  return stopItem
}

// ---------------------------------------------------------------- system
const _p = new Vector3()

/** Locations that get a one-off camera move the first time you arrive. */
const ARRIVAL_SHOTS = new Set(['coach', 'camp', 'hundred', 'gallery', 'hub'])

export function InteractionSystem() {
  const setNearest = useStore((s) => s.setNearest)
  const discover = useStore((s) => s.discover)
  const offTimer = useRef(0)
  const stepTimer = useRef(0)
  const audioTimer = useRef(0)

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05)
    const store = useStore.getState()

    // nearest interactable — or, while on a station, the way off it
    let best: Interactable | null = null
    let bestD = Infinity
    _p.copy(player.pos)
    if (workout.station) {
      best = workout.leaving ? null : stopPrompt()
    } else {
      for (const item of registry.values()) {
        const d = _p.distanceTo(item.position)
        if (d < item.radius && d < bestD) {
          bestD = d
          best = item
        }
      }
    }
    // by identity: a re-registered item (a new label, say) must refresh the prompt
    if (best !== store.nearest) setNearest(best)

    // discovery, and the arrival cinematic that goes with it
    for (const l of locations) {
      const d = Math.hypot(player.pos.x - l.pos[0], player.pos.z - l.pos[1])
      if (d < l.discoverRadius) {
        const isNew = !store.discovered.includes(l.id)
        discover(l.id, l.name)
        if (isNew) {
          cue('discover')
          if (ARRIVAL_SHOTS.has(l.id)) store.playCinematic(l.id)
        }
      }
    }

    // the pool is not a journey stop, but arriving at it still gets its shot
    if (!store.seenCinematics.includes('pool') && Math.hypot(player.pos.x - POOL.x, player.pos.z - POOL.z) < 13) {
      store.playCinematic('pool')
    }

    // sound that follows the world: water, fire, and a score that builds
    audioTimer.current += dt
    if (audioTimer.current > 0.25) {
      audioTimer.current = 0
      const water = 1 - Math.min(1, streamDistanceAt(player.pos.x, player.pos.z) / 22)
      const fire = 1 - Math.min(1, Math.hypot(
        player.pos.x - locationById.campfire.pos[0],
        player.pos.z - locationById.campfire.pos[1],
      ) / 18)
      setProximity(water, fire)
      setMusicIntensity(pathProgress(player.pos.x, player.pos.z))
    }

    if (store.mode !== 'guided' || store.panel || store.photoMode) {
      offTimer.current = 0
      return
    }

    // guided journey: arriving at the current stop advances the story
    const step = journeySteps[store.journeyIndex]
    const target = locationById[step.id]
    const dist = Math.hypot(player.pos.x - target.pos[0], player.pos.z - target.pos[1])

    if (step.id === 'camp') {
      if (dist < target.pad + 4) {
        stepTimer.current += dt
        if (stepTimer.current > 14 && !store.campPrompt) useStore.getState().setCampPrompt(true)
      }
    } else if (dist < target.discoverRadius * 0.62) {
      // reached it — move the story on once they've had a moment to look
      stepTimer.current += dt
      if (stepTimer.current > 3.5) {
        stepTimer.current = 0
        useStore.getState().advanceJourney()
      }
    } else {
      stepTimer.current = 0
    }

    // gentle nudge if they wander far from the trail
    if (pathDistance(player.pos.x, player.pos.z) > 26) {
      offTimer.current += dt
      if (offTimer.current > 6 && !store.offPathHint) useStore.getState().setOffPathHint(true)
    } else {
      offTimer.current = 0
      if (store.offPathHint) useStore.getState().setOffPathHint(false)
    }
  })

  return null
}
