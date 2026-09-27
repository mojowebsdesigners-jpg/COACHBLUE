import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  BoxGeometry, Group, Matrix4, MeshStandardMaterial, Quaternion, Vector2, Vector3,
} from 'three'
import { scannedTexture } from '../../lib/materials'
import { addDynamicCollider, groundHeight, pathCurve } from '../../lib/terrain'
import { player, useStore } from '../../state/store'
import { registerInteractable } from './InteractionSystem'
import { CROSS, carry } from '../../systems/Carry'

/** Where it lies: on the verge a little way down the road from the entrance. */
function restingSpot() {
  const t = 0.045
  const p = pathCurve.getPoint(t)
  const tan = pathCurve.getTangent(t)
  const off = 6.2
  const x = p.x - tan.z * off, z = p.z + tan.x * off
  return { x, z, y: groundHeight(x, z), yaw: Math.atan2(tan.x, tan.z) + 0.35 }
}

/**
 * A square-hewn timber beam with UVs in true metres, so the grain runs along
 * its length at the same scale on every face whatever the beam's size.
 */
function beam(w: number, h: number, len: number) {
  const g = new BoxGeometry(w, h, len)
  const pos = g.attributes.position
  const nrm = g.attributes.normal
  const uv = g.attributes.uv
  const TILE = 1.25          // the wood scan covers 1.25 m
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i)
    const ax = Math.abs(nrm.getX(i)), ay = Math.abs(nrm.getY(i))
    // grain along z; across is whichever axis lies in the face
    const across = ax > 0.5 ? y : ay > 0.5 ? x : x
    const along = ax > 0.5 || ay > 0.5 ? z : y
    uv.setXY(i, across / TILE + 0.4, along / TILE)
  }
  return g
}

const _m = new Matrix4()
const _q = new Quaternion()
const _z = new Vector3(0, 0, 1)
const _y = new Vector3()

/**
 * The cross on the road. Press E to lift it and carry it like a landmine bar;
 * Space presses it up and out; E again sets it down where you stand.
 */
export function Cross() {
  const ref = useRef<Group>(null)
  const [held, setHeld] = useState(false)
  const toast = useStore((s) => s.showToast)
  const spot = useRef(restingSpot())

  const { upright, bar, material, iron } = useMemo(() => {
    const m = new MeshStandardMaterial({
      map: scannedTexture('timber_diff', 1, true),
      normalMap: scannedTexture('timber_nor', 1),
      roughnessMap: scannedTexture('timber_rough', 1),
      normalScale: new Vector2(1.2, 1.2),
      roughness: 1, metalness: 0,
    })
    return {
      upright: beam(CROSS.beam, CROSS.beam, CROSS.length),
      bar: beam(CROSS.beam * 0.94, CROSS.beam * 0.94, CROSS.arm),
      material: m,
      iron: new MeshStandardMaterial({ color: '#2b2622', roughness: 0.55, metalness: 0.8 }),
    }
  }, [])

  // lying on the verge it is solid ground clutter: step round it
  useEffect(() => addDynamicCollider(() => {
    if (carry.active) return null
    const s = spot.current
    return { x: s.x, z: s.z, hx: CROSS.arm / 2, hz: CROSS.length / 2, angle: s.yaw }
  }), [])

  const promptAt = useRef(new Vector3())
  useEffect(() => {
    const s = spot.current
    promptAt.current.set(s.x, s.y + 0.8, s.z)
    return registerInteractable({
      id: 'cross',
      label: held ? 'SET DOWN THE CROSS' : 'LIFT THE CROSS',
      verb: held ? 'DROP' : 'LIFT',
      position: promptAt.current,
      radius: held ? 200 : 3.2,
      panel: null,
      action: () => {
        setHeld((h) => {
          const next = !h
          carry.active = next
          carry.pressT = -1
          carry.press = 0
          if (next) {
            carry.reps = 0
            toast('THE CROSS', 'Carry it. SPACE to press it up · E to set it down')
          } else {
            // laid down across his path, just ahead of where he stands
            const x = player.pos.x + Math.sin(player.yaw) * 1.3
            const z = player.pos.z + Math.cos(player.yaw) * 1.3
            spot.current = { x, z, y: groundHeight(x, z), yaw: player.yaw }
            if (carry.reps > 0) toast('THE CROSS', `${carry.reps} press${carry.reps === 1 ? '' : 'es'}. Set down.`)
          }
          return next
        })
      },
      focus: { dist: 5, height: 2 },
    })
  }, [held, toast])

  useFrame(() => {
    const g = ref.current
    if (!g) return
    if (held) {
      // follow the hands: the upright runs along carry.axis from carry.base
      const len = CROSS.length
      _y.crossVectors(carry.axis, carry.side).normalize()
      _m.makeBasis(carry.side, _y, carry.axis)
      _q.setFromRotationMatrix(_m)
      g.quaternion.copy(_q)
      g.position.copy(carry.base).addScaledVector(carry.axis, len / 2)
      promptAt.current.copy(player.pos)
    } else {
      const s = spot.current
      // lying flat on its back on the grass, beams resting on the ground
      // its own frame already lies flat (length along z, thickness along y)
      g.quaternion.setFromAxisAngle(_z.set(0, 1, 0), s.yaw)
      g.position.set(s.x, s.y + CROSS.beam / 2, s.z)
      promptAt.current.set(s.x, s.y + 0.8, s.z)
    }
  })

  // in its own frame: the upright runs along z, head end at +z; the crossbar
  // sits CROSS.crossAt from the head, half-lapped into the upright
  const barZ = CROSS.length / 2 - CROSS.crossAt
  return (
    <group ref={ref}>
      <mesh geometry={upright} material={material} castShadow receiveShadow />
      <mesh geometry={bar} material={material} position={[0, 0, barZ]} rotation={[0, Math.PI / 2, 0]} castShadow receiveShadow />
      {/* iron bolts through the joint, and a strap round the foot */}
      {[-1, 1].map((s) => (
        <mesh key={s} material={iron} position={[0, CROSS.beam / 2 + 0.005, barZ + s * 0.04]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.02, 0.02, 0.012, 10]} />
        </mesh>
      ))}
      <mesh material={iron} position={[0, 0, -CROSS.length / 2 + 0.18]}>
        <boxGeometry args={[CROSS.beam + 0.012, CROSS.beam + 0.012, 0.05]} />
      </mesh>
    </group>
  )
}
