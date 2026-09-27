import { useStore } from '../state/store'
import { onWorkoutFinished } from './Workout'
import type { ExerciseDef } from '../data/exercises'

/**
 * The world's way of putting Coach Blue within reach.
 *
 * After something meaningful — a finished set, a swim, a run up the hill —
 * a small card offers his help with exactly that, and one press opens his
 * inquiry form with the goal already chosen. It is deliberately rationed: at
 * most one offer every couple of minutes, never over an open panel or a
 * cinematic, and never twice for the same thing in a row, so it reads as a
 * coach noticing what you did rather than an advert following you around.
 */
const COOLDOWN = 110_000
let last = 0
let lastTopic = ''

export type Offer = { topic: string; title: string; body: string; goal?: string }

export function offerCoaching(offer: Offer, force = false) {
  const s = useStore.getState()
  const now = Date.now()
  if (!force) {
    if (now - last < COOLDOWN || offer.topic === lastTopic) return false
    if (s.phase !== 'world' || s.panel || s.bookingOpen || s.cinematic || s.photoMode || s.mapOpen) return false
  }
  last = now
  lastTopic = offer.topic
  s.setNudge({ title: offer.title, body: offer.body, goal: offer.goal, reason: offer.topic })
  return true
}

// what each kind of session is really about, in the goals the form offers
const GOAL_FOR: Record<ExerciseDef['category'], string> = {
  chest: 'Gain Muscle', back: 'Gain Muscle', arms: 'Gain Muscle', shoulders: 'Gain Muscle',
  legs: 'Get Toned', functional: 'Lose Weight', cardio: 'Lose Weight', rest: 'Better Lifestyle',
}

// every finished workout is a moment to offer the real thing
onWorkoutFinished((done) => {
  if (done.def.category === 'rest' || done.reps < 3) return
  const goal = GOAL_FOR[done.def.category]
  offerCoaching({
    topic: `workout:${done.def.id}`,
    title: `${done.def.name} · ${done.reps} reps`,
    body: `Want Coach Blue to build your ${done.def.name.toLowerCase()} into a real plan?`,
    goal,
  })
})
