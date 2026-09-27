import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { player } from '../../state/store'
import { moveState } from '../../systems/PlayerController'
import { vehicle } from '../../systems/VehicleController'
import { workout } from '../../systems/Workout'
import { day } from '../3d/Lighting'
import { useStore } from '../../state/store'
import { formatClock } from '../../systems/TimeSystem'

/**
 * Development read-out, behind ?debug=1. Never shown to visitors.
 *
 * This exists because diagnosing the character by taking screenshots and
 * reasoning backwards from the pose was costing hours and getting it wrong.
 * Frame cost, draw calls and the actual animation weights on screen answer in
 * one look what a render can only hint at.
 */
export type ClipProbe = () => Record<string, number>

const probes = new Map<string, ClipProbe>()

/** Let a character publish its clip weights to the read-out. */
export function registerClipProbe(id: string, probe: ClipProbe) {
  probes.set(id, probe)
  return () => { probes.delete(id) }
}

export const debugEnabled = () =>
  typeof location !== 'undefined' && new URLSearchParams(location.search).has('debug')

export function DebugHud() {
  const gl = useThree((s) => s.gl)
  const box = useRef<HTMLDivElement | null>(null)
  const frames = useRef(0)
  const acc = useRef(0)
  const worst = useRef(0)

  // three resets its counters at the start of every render by default, so
  // reading them from a frame callback gives one draw call and no triangles
  useEffect(() => {
    gl.info.autoReset = false
    return () => { gl.info.autoReset = true }
  }, [gl])

  useEffect(() => {
    const el = document.createElement('div')
    el.style.cssText = [
      'position:fixed', 'left:12px', 'bottom:64px', 'z-index:60',
      'font:11px/1.45 ui-monospace,Menlo,Consolas,monospace',
      'color:#cfe9e2', 'background:rgba(6,10,12,.76)', 'padding:8px 10px',
      'border:1px solid rgba(29,233,182,.28)', 'border-radius:6px',
      'white-space:pre', 'pointer-events:none', 'letter-spacing:.02em',
    ].join(';')
    document.body.appendChild(el)
    box.current = el
    return () => { el.remove() }
  }, [])

  useFrame((_, delta) => {
    frames.current += 1
    acc.current += delta
    worst.current = Math.max(worst.current, delta)
    if (acc.current < 0.5 || !box.current) return

    const fps = frames.current / acc.current
    const info = gl.info
    const clips = [...probes.entries()]
      .map(([id, p]) => {
        const w = p()
        const parts = Object.entries(w)
          .map(([k, v]) => `${k} ${v.toFixed(2)}`)
          .join('  ')
        return `  ${id}: ${parts}`
      })
      .join('\n')

    box.current.textContent = [
      `fps ${fps.toFixed(0)}   worst ${(worst.current * 1000).toFixed(1)}ms`,
      `draws ${info.render.calls}  tris ${(info.render.triangles / 1000).toFixed(0)}k`,
      `geom ${info.memory.geometries}  tex ${info.memory.textures}  prog ${info.programs?.length ?? 0}`,
      `pos ${player.pos.x.toFixed(1)},${player.pos.y.toFixed(1)},${player.pos.z.toFixed(1)}`,
      `yaw ${player.yaw.toFixed(2)}  spd ${moveState.speed.toFixed(2)}  ` +
        `${moveState.airborne ? 'AIR' : 'ground'}${player.frozen ? ' FROZEN' : ''}`,
      `car ${vehicle.occupied ? 'driving' : 'parked'}  ` +
        `workout ${workout.station?.def.id ?? 'none'}`,
      `clock ${formatClock(useStore.getState().timeOfDay)}  ` +
        `night ${day.night.toFixed(2)}  sun ${day.sunIntensity.toFixed(2)}`,
      `lightsOn day=${day.lightsOn ? 'Y' : 'N'} store=${useStore.getState().lightsOn ? 'Y' : 'N'}`,
      clips || '  (no clip probes)',
    ].join('\n')

    frames.current = 0
    acc.current = 0
    worst.current = 0
    gl.info.reset()
  })

  return null
}
