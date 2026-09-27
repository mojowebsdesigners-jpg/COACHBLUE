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
