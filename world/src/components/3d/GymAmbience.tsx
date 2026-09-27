import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { gymSound, setTreadmillHum } from '../../lib/audio'
import { player, useStore } from '../../state/store'

/**
 * The sound of a gym in use, placed at the training floor: plates, the rig's
 * chain, a lifter breathing out, a dumbbell set down, and the treadmill's
 * slats under a runner. Louder as you come in, gone by 45 m.
 */
export function GymAmbience({ at, tread }: { at: [number, number]; tread: [number, number] }) {
  const sound = useStore((s) => s.settings.sound)
  const next = useRef(1.5)
  useFrame((_, dt) => {
    if (!sound) { setTreadmillHum(0); return }
    const d = Math.hypot(player.pos.x - at[0], player.pos.z - at[1])
    const level = Math.max(0, 1 - d / 45) ** 1.6
    const dt2 = Math.hypot(player.pos.x - tread[0], player.pos.z - tread[1])
    setTreadmillHum(Math.max(0, 1 - dt2 / 25) ** 1.5)
    next.current -= dt
    if (next.current <= 0 && level > 0.02) {
      const r = Math.random()
      gymSound(r < 0.4 ? 'clank' : r < 0.6 ? 'exhale' : r < 0.8 ? 'drop' : 'chain', level)
      next.current = 1.2 + Math.random() * 3.4
    }
  })
  return null
}
