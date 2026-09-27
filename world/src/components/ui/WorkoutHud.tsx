import { useEffect, useRef, useState } from 'react'
import { lastRep, onWorkoutChange, stopWorkout, workout } from '../../systems/Workout'

/**
 * The set read-out. It exists only while a set is running: no score follows
 * you around the world, and nothing about points is on screen until you have
 * actually lifted something.
 *
 * The number counts up to its new value rather than jumping, because a total
 * that snaps reads as a counter and a total that climbs reads as a reward.
 */
export function WorkoutHud() {
  const [, force] = useState(0)
  const [shown, setShown] = useState(0)
  const [flash, setFlash] = useState<{ id: number; gained: number } | null>(null)
  const raf = useRef(0)

  useEffect(() => onWorkoutChange(() => force((n) => n + 1)), [])

  // ease the displayed total towards the real one
  const target = workout.points
  useEffect(() => {
    cancelAnimationFrame(raf.current)
    const from = shown
    if (from === target) return
    const start = performance.now()
    const dur = 340
    const tick = () => {
      const t = Math.min(1, (performance.now() - start) / dur)
      const e = 1 - Math.pow(1 - t, 3)
      setShown(Math.round(from + (target - from) * e))
      if (t < 1) raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
    // `shown` deliberately omitted: including it would restart the ease on
    // every animated frame and the number would never arrive
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target])

  // a brief +N by the counter each time a rep lands
  useEffect(() => {
    if (!lastRep.stamp) return
    setFlash({ id: lastRep.stamp, gained: lastRep.gained })
    const t = setTimeout(() => setFlash(null), 900)
    return () => clearTimeout(t)
  }, [workout.reps, workout.points])

  // the belt speed and the timing call change between reps, so poll them
  // gently while a session runs (a few times a second, never per frame)
  const [, tick] = useState(0)
  useEffect(() => {
    if (!workout.station) return
    const id = setInterval(() => tick((n) => n + 1), 150)
    return () => clearInterval(id)
  })

  const st = workout.station
  if (!st) return null
  if (st.def.category === 'rest') {
    return (
      <div className="workout workout--rest" role="status">
        <div className="workout__name">{st.def.name}</div>
        <p className="workout__how">Take a breather. <kbd>E</kbd> stand up</p>
      </div>
    )
  }
  const tread = st.def.pose === 'run'
  const call = workout.grade && performance.now() - workout.gradeStamp < 700 ? workout.grade : ''

  return (
    <div className="workout" role="status" aria-live="polite">
      <div className="workout__name">{st.def.name}</div>
      {call && (
        <div className={`workout__call is-${call}`} key={workout.gradeStamp}>
          {call === 'perfect' ? `Perfect${workout.streak > 1 ? ` ×${workout.streak}` : ''}` : 'Good'}
        </div>
      )}
      {tread ? (
        <div className="workout__belt">
          <span>Belt</span>
          <b>{(workout.belt * 3.6).toFixed(1)}<i> km/h</i></b>
          <em>{workout.belt < 2 ? 'Walking' : workout.belt < 3.6 ? 'Jogging' : workout.belt < 5.4 ? 'Running' : 'Sprinting'}</em>
          <div className="workout__meter"><i style={{ width: `${(workout.belt / 6.8) * 100}%` }} /></div>
        </div>
      ) : null}
      <p className="workout__how">
        {tread
          ? <><kbd>W</kbd> faster · <kbd>S</kbd> slower</>
          : st.def.pose === 'push'
            ? <>Hold <kbd>W</kbd> (or <kbd>Space</kbd>) to drive it · let go to rest</>
            : st.def.pose === 'crawl' || st.def.pose === 'tyres'
              ? <>Hold <kbd>W</kbd> to go · let go to stop · <kbd>E</kbd> get up</>
            : st.def.pose === 'wall'
              ? <><kbd>Space</kbd> for each move: jump, pull up, over, down</>
            : st.def.pose === 'climb'
              ? <><kbd>Space</kbd> one pull, hand over hand · ring the bell · <kbd>E</kbd> slide down</>
              : <><kbd>Space</kbd> one rep · hold to keep going · tap as the rep lands for a bonus</>}
      </p>
      <div className="workout__grid">
        <div>
          <span>Rep</span>
          <b>{String(workout.reps).padStart(2, '0')}<i>/{st.def.repsPerSet}</i></b>
        </div>
        <div>
          <span>Set</span>
          <b>{String(workout.set).padStart(2, '0')}</b>
        </div>
        <div className="workout__points">
          <span>Points</span>
          <b>
            {shown}
            {flash && <em key={flash.id}>+{flash.gained}</em>}
          </b>
        </div>
      </div>
      <button className="workout__stop" onClick={() => stopWorkout()}>
        <kbd>Esc</kbd> Finish set
      </button>
    </div>
  )
}
