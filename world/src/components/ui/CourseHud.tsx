import { useEffect, useState } from 'react'
import { course, onCourseChange } from '../../systems/Course'

/**
 * The clock for a timed run: a big count-in, then the running time and how
 * many gates are left. Polled at ten frames a second while a run is on —
 * never per frame, never while there is no run.
 */
export function CourseHud() {
  const [, tick] = useState(0)
  const [on, setOn] = useState(!!course.def)
  useEffect(() => onCourseChange(() => setOn(!!course.def)), [])
  useEffect(() => {
    if (!on) return
    const id = setInterval(() => tick((n) => n + 1), 100)
    return () => clearInterval(id)
  }, [on])
  const def = course.def
  if (!def) return null
  if (!course.running) {
    const n = Math.ceil(-course.clock)
    return <div className="course-count" key={n}>{n > 0 ? n : 'GO'}</div>
  }
  return (
    <div className="course-clock" role="timer">
      <span>{def.name}</span>
      <b>{course.clock.toFixed(1)}<i>s</i></b>
      <em>Gate {Math.min(course.next, def.gates.length - 1)} / {def.gates.length - 1}
        {course.best[def.id] !== undefined && ` · best ${course.best[def.id].toFixed(1)} s`}</em>
    </div>
  )
}
