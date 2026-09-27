import { splash } from '../lib/audio'
import { SWIM } from './Swim'

/** Paces a splash to each arm entering the water, softer when treading. */
export class SwimSound {
  private t = 0
  update(dt: number, speed: number, blend: number, enabled: boolean) {
    if (!enabled) return
    // two arm entries per stroke cycle when swimming, a gentle lap when treading
    const rate = blend > 0.5 ? SWIM.strokeRate * 2 * Math.max(0.5, speed / SWIM.speed) : 0.7
    this.t += dt * rate
    if (this.t >= 1) {
      this.t -= 1
      splash(blend > 0.5 ? 0.6 + Math.random() * 0.4 : 0.25)
    }
  }
}
