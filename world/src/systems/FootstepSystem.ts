import { MathUtils } from 'three'
import { footstep } from '../lib/audio'
import { MOVE, type MoveState } from './PlayerController'

/**
 * Footsteps, paced by ground covered rather than by a timer.
 *
 * One step per stride, and a stride is longer when you run — driving it off
 * elapsed time makes a sprint sound like a fast walk and lets the sound drift
 * away from where the feet actually land.
 */
const STRIDE_WALK = 0.72
const STRIDE_SPRINT = 1.55

export class FootstepSystem {
  private phase = 0.5

  /** Call once per frame with the current movement state. */
  update(dt: number, move: MoveState, enabled: boolean) {
    if (!enabled) return

    if (move.justLanded) {
      footstep(move.surface, 1)
      this.phase = 0.5
      return
    }
    if (move.airborne || move.speed <= 0.35) return

    const stride = MathUtils.lerp(STRIDE_WALK, STRIDE_SPRINT, Math.min(1, move.speed / MOVE.sprint))
    this.phase += (move.speed * dt) / stride
    if (this.phase >= 1) {
      this.phase -= 1
      // a run lands heavier than a walk
      footstep(move.surface, Math.min(1, 0.45 + (move.speed / MOVE.sprint) * 0.55))
    }
  }

  reset() {
    this.phase = 0.5
  }
}
