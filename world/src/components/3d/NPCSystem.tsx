import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Vector3 } from 'three'
import { player } from '../../state/store'
import { Walker } from './Townsfolk'

/**
 * The people training around the camp. Each one looks up when the player comes
 * close, then goes back to work.
 */
export function CampNPCs({ centre }: { centre: [number, number] }) {
  const [x, z] = centre
  const look = useMemo(() => new Vector3(), [])
  const nearRef = useRef(false)

  useFrame(() => {
    const d = Math.hypot(player.pos.x - x, player.pos.z - z)
    nearRef.current = d < 14
    look.set(player.pos.x, player.pos.y + 1.55, player.pos.z)
  })

  return (
    <>
      {/* The compound itself now carries four people working on the equipment,
          so the camp only adds someone arriving on foot. The floor exercises
          that used to sit here landed inside the gym's slab once it was laid. */}
      <Walker
        name="Leo"
        model="/models/client-c.glb"
        waypoints={[[x - 14, z + 12], [x + 2, z + 15], [x + 13, z + 6]]}
        speed={1.25}
        tint={{ shirt: '#3a3f47' }}
      />
    </>
  )
}
