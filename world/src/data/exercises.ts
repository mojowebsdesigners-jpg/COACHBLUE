import type { Exercise } from '../systems/ExercisePose'

/**
 * Every exercise the gym offers, as data. Adding one is an entry here plus a
 * station placed on the floor — no new components, no new branches.
 *
 * Points are earned per completed repetition and scale with how much of the
 * body the movement asks for: a curl is one joint, a squat is the whole
 * posterior chain under load. The numbers are a game economy rather than a
 * claim about training, so nothing here is presented as fitness advice.
 */
export type Difficulty = 'light' | 'moderate' | 'hard' | 'heavy'

export type ExerciseDef = {
  id: string
  name: string
  category: 'chest' | 'back' | 'legs' | 'shoulders' | 'arms' | 'cardio' | 'functional' | 'rest'
  /** which pose solver drives the body */
  pose: Exercise
  difficulty: Difficulty
  pointsPerRep: number
  /** repetitions in one set */
  repsPerSet: number
  /** how close you have to stand for the prompt to appear, in metres */
  reach: number
  /** what the hands are holding, if anything */
  holds?: 'dumbbells' | 'barbell' | 'kettlebell' | null
  /**
   * How the player drives it (default 'reps': Space for each rep):
   *  hold   hold Space (or W) to keep going; a rep every `every` seconds
   *  free   just do it; a rep every `every` seconds; Space changes the move
   *  steps  each Space moves on to the next of `steps` moves, looping
   *  power  Space starts a charge meter, Space again releases at that power;
   *         the move then plays over `actionTime` s, releasing at `releaseAt`
   *  custom the station steps itself (a swing, a trampoline, a fishing line)
   */
  mode?: 'reps' | 'hold' | 'free' | 'steps' | 'power' | 'custom'
  every?: number
  steps?: number
  actionTime?: number
  releaseAt?: number
  /** a line of how-to for the set card */
  how?: string
}

export const POINTS: Record<Difficulty, number> = {
  light: 5,
  moderate: 10,
  hard: 15,
  heavy: 20,
}

export const EXERCISES: ExerciseDef[] = [
  {
    id: 'bench_press', name: 'Bench Press', category: 'chest', pose: 'bench',
    difficulty: 'hard', pointsPerRep: POINTS.hard, repsPerSet: 10, reach: 3.0, holds: 'barbell',
  },
  {
    id: 'back_squat', name: 'Back Squat', category: 'legs', pose: 'rackSquat',
    difficulty: 'heavy', pointsPerRep: POINTS.heavy, repsPerSet: 8, reach: 3.0, holds: 'barbell',
  },
  {
    id: 'pull_up', name: 'Pull-Ups', category: 'back', pose: 'pullup',
    difficulty: 'hard', pointsPerRep: POINTS.hard, repsPerSet: 8, reach: 2.6, holds: null,
  },
  {
    id: 'dumbbell_curl', name: 'Dumbbell Curls', category: 'arms', pose: 'curl',
    difficulty: 'moderate', pointsPerRep: POINTS.moderate, repsPerSet: 12, reach: 2.6, holds: 'dumbbells',
  },
  {
    id: 'kettlebell_swing', name: 'Kettlebell Swings', category: 'functional', pose: 'kettlebell',
    difficulty: 'moderate', pointsPerRep: POINTS.moderate, repsPerSet: 15, reach: 2.4, holds: 'kettlebell',
  },
  {
    id: 'push_up', name: 'Push-Ups', category: 'chest', pose: 'pushup',
    difficulty: 'light', pointsPerRep: POINTS.light, repsPerSet: 15, reach: 2.4, holds: null,
  },
  {
    id: 'air_squat', name: 'Bodyweight Squats', category: 'legs', pose: 'squat',
    difficulty: 'light', pointsPerRep: POINTS.light, repsPerSet: 15, reach: 2.4, holds: null,
  },
  {
    id: 'treadmill_run', name: 'Treadmill', category: 'cardio', pose: 'run',
    difficulty: 'moderate', pointsPerRep: POINTS.moderate, repsPerSet: 20, reach: 2.4, holds: null,
  },
  // the boot camp: things you move with your whole body
  {
    id: 'boulder_push', name: 'Boulder Push', category: 'functional', pose: 'push',
    difficulty: 'heavy', pointsPerRep: POINTS.heavy, repsPerSet: 6, reach: 2.2, holds: null,
  },
  {
    id: 'rope_climb', name: 'Rope Climb', category: 'back', pose: 'climb',
    difficulty: 'hard', pointsPerRep: POINTS.hard, repsPerSet: 3, reach: 2.2, holds: null,
  },
  {
    id: 'crawl_net', name: 'Crawl Net', category: 'functional', pose: 'crawl',
    difficulty: 'hard', pointsPerRep: POINTS.hard, repsPerSet: 4, reach: 2.2, holds: null,
  },
  {
    id: 'wall_climb', name: 'Wall Climb', category: 'back', pose: 'wall',
    difficulty: 'hard', pointsPerRep: POINTS.hard, repsPerSet: 1, reach: 2.2, holds: null,
  },
  {
    id: 'tyre_run', name: 'Tyre Run', category: 'cardio', pose: 'tyres',
    difficulty: 'moderate', pointsPerRep: POINTS.moderate, repsPerSet: 3, reach: 2.2, holds: null,
  },
  // ---- the fun park: workouts you drive with Space
  { id: 'punch_bag', name: 'Heavy Bag', category: 'arms', pose: 'punch', difficulty: 'moderate', pointsPerRep: 6, repsPerSet: 20, reach: 2.2,
    how: 'Space for each punch: jab, cross, jab. Tap on the beat for combos' },
  { id: 'skip_rope', name: 'Skipping Rope', category: 'cardio', pose: 'skip', difficulty: 'light', pointsPerRep: 3, repsPerSet: 50, reach: 2,
    how: 'Space for every jump. Keep the rhythm' },
  { id: 'jumping_jacks', name: 'Jumping Jacks', category: 'cardio', pose: 'jacks', difficulty: 'light', pointsPerRep: 3, repsPerSet: 30, reach: 2,
    how: 'Space for each jack' },
  { id: 'burpees', name: 'Burpees', category: 'functional', pose: 'burpee', difficulty: 'hard', pointsPerRep: 15, repsPerSet: 10, reach: 2,
    how: 'Space for each burpee: down, plank, push, up, jump' },
  { id: 'box_jump', name: 'Box Jumps', category: 'legs', pose: 'boxjump', difficulty: 'moderate', pointsPerRep: 10, repsPerSet: 10, reach: 2,
    how: 'Space to jump up onto the box' },
  { id: 'sit_ups', name: 'Sit-Ups', category: 'functional', pose: 'situp', difficulty: 'light', pointsPerRep: 5, repsPerSet: 20, reach: 2,
    how: 'Space for each sit-up' },
  { id: 'plank_hold', name: 'Plank', category: 'functional', pose: 'plank', difficulty: 'moderate', pointsPerRep: 10, repsPerSet: 12, reach: 2,
    mode: 'hold', every: 5, how: 'Hold Space to hold the plank. Every 5 seconds counts' },
  { id: 'battle_ropes', name: 'Battle Ropes', category: 'cardio', pose: 'ropes', difficulty: 'hard', pointsPerRep: 4, repsPerSet: 40, reach: 2,
    how: 'Space (or hold it) to whip the ropes' },
  { id: 'tyre_flip', name: 'Tyre Flip', category: 'legs', pose: 'tyreflip', difficulty: 'heavy', pointsPerRep: 25, repsPerSet: 6, reach: 2.4,
    how: 'Space for each flip: squat, grip, drive it over' },
  { id: 'sledgehammer', name: 'Sledgehammer', category: 'functional', pose: 'hammer', difficulty: 'hard', pointsPerRep: 12, repsPerSet: 15, reach: 2.2,
    how: 'Space for each swing onto the tyre' },
  { id: 'high_striker', name: 'High Striker', category: 'functional', pose: 'hammer', difficulty: 'hard', pointsPerRep: 0, repsPerSet: 99, reach: 2.2,
    mode: 'power', actionTime: 1.3, releaseAt: 0.55, how: 'Space to start the swing meter, Space again at the top. Ring the bell' },
  { id: 'hula_hoop', name: 'Hula Hoop', category: 'functional', pose: 'hula', difficulty: 'light', pointsPerRep: 5, repsPerSet: 20, reach: 2,
    mode: 'hold', every: 3, how: 'Hold Space to keep the hoop spinning. Let go and it drops' },
  { id: 'dance_floor', name: 'Dance Floor', category: 'cardio', pose: 'dance', difficulty: 'light', pointsPerRep: 4, repsPerSet: 32, reach: 3,
    how: 'Space on the beat. Hit it right and the floor lights up' },
  { id: 'yoga_flow', name: 'Yoga Flow', category: 'rest', pose: 'yoga', difficulty: 'light', pointsPerRep: 5, repsPerSet: 99, reach: 2,
    mode: 'steps', steps: 4, how: 'Space for the next pose: mountain, tree, warrior, downward dog' },
  { id: 'meditation', name: 'Meditation', category: 'rest', pose: 'meditate', difficulty: 'light', pointsPerRep: 3, repsPerSet: 99, reach: 2,
    mode: 'free', every: 8, how: 'Breathe. Just stay a while' },
  { id: 'swing_set', name: 'Swing', category: 'rest', pose: 'swing', difficulty: 'light', pointsPerRep: 2, repsPerSet: 99, reach: 2,
    mode: 'custom', how: 'Tap Space at the back of each swing to go higher' },
  { id: 'trampoline', name: 'Trampoline', category: 'cardio', pose: 'bounce', difficulty: 'light', pointsPerRep: 5, repsPerSet: 99, reach: 2.6,
    mode: 'custom', how: 'Tap Space as you land to bounce higher. Go high enough for a flip' },
  { id: 'keepy_uppy', name: 'Keepy-Uppy', category: 'cardio', pose: 'kickups', difficulty: 'moderate', pointsPerRep: 4, repsPerSet: 50, reach: 2,
    how: 'Space for each touch. Keep it off the ground' },
  { id: 'basketball', name: 'Free Throws', category: 'arms', pose: 'shoot', difficulty: 'light', pointsPerRep: 0, repsPerSet: 99, reach: 2,
    mode: 'power', actionTime: 1.2, releaseAt: 0.56, how: 'Space to start the meter, Space again in the green to sink it' },
  { id: 'penalty', name: 'Penalty Kick', category: 'legs', pose: 'kick', difficulty: 'light', pointsPerRep: 0, repsPerSet: 99, reach: 2.6,
    mode: 'power', actionTime: 1.6, releaseAt: 0.7, how: 'A / D to aim, Space for the meter, Space to strike' },
  { id: 'mini_golf', name: 'Mini Golf', category: 'rest', pose: 'putt', difficulty: 'light', pointsPerRep: 0, repsPerSet: 99, reach: 2,
    mode: 'power', actionTime: 1.1, releaseAt: 0.55, how: 'Space for the backswing meter, Space to putt. Gentle!' },
  { id: 'darts', name: 'Darts', category: 'rest', pose: 'dart', difficulty: 'light', pointsPerRep: 0, repsPerSet: 99, reach: 2,
    mode: 'power', actionTime: 0.9, releaseAt: 0.48, how: 'Space for the meter, Space in the middle for the bull' },
  { id: 'stone_skim', name: 'Skim Stones', category: 'rest', pose: 'skim', difficulty: 'light', pointsPerRep: 0, repsPerSet: 99, reach: 2.4,
    mode: 'power', actionTime: 1.0, releaseAt: 0.5, how: 'Space for the meter, Space to throw: flat and fast skips furthest' },
  { id: 'fishing', name: 'Fishing', category: 'rest', pose: 'fish', difficulty: 'light', pointsPerRep: 0, repsPerSet: 99, reach: 2,
    mode: 'custom', how: 'Space to cast. When the float dips, Space fast, then tap to reel in' },
  { id: 'cannonball', name: 'Cannonball!', category: 'rest', pose: 'cannon', difficulty: 'light', pointsPerRep: 0, repsPerSet: 99, reach: 2,
    mode: 'power', actionTime: 1.9, releaseAt: 0.32, how: 'Space for the bounce meter, Space to leap. Biggest splash wins' },
  { id: 'photo_spot', name: 'Photo Spot', category: 'rest', pose: 'flex', difficulty: 'light', pointsPerRep: 2, repsPerSet: 99, reach: 2.2,
    mode: 'steps', steps: 3, how: 'Space to change pose: double biceps, most muscular, thumbs up' },
  // not exercise at all: somewhere to sit down (the same station system gets
  // him onto a seat as onto a bench press, with the same walk-in and blend)
  {
    id: 'sit', name: 'Take a seat', category: 'rest', pose: 'sit',
    difficulty: 'light', pointsPerRep: 0, repsPerSet: 1, reach: 1.9, holds: null,
  },
  {
    id: 'lounge', name: 'Stretch out', category: 'rest', pose: 'lounge',
    difficulty: 'light', pointsPerRep: 0, repsPerSet: 1, reach: 1.9, holds: null,
  },
]

export const exerciseById = Object.fromEntries(EXERCISES.map((e) => [e.id, e])) as Record<string, ExerciseDef>
