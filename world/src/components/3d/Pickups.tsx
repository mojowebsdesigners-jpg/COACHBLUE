import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import { Box3, Mesh, Vector3, type Object3D } from 'three'
import { groundHeight, POOL, poolDeckHeight } from '../../lib/terrain'
import { hideInstance } from '../../lib/instanceCull'
import { locationById } from '../../data/journey'
import { player, useStore } from '../../state/store'
import { consume, hand, pickUp, putDown } from '../../systems/HandAction'
import { registerInteractable } from './InteractionSystem'
import { mushrooms } from './Vegetation'
import { LIFT, gymPlacement } from './Gym'

/**
 * Everything small enough to pick up: mushrooms on the woodland floor and
 * bottles of water around the camp. Only the nearest one within reach offers
 * itself, so the prompt follows what is actually at your feet; while
 * something is in hand, E uses it (eat, drink) or puts it down.
 */
type Bottle = { id: number; x: number; y: number; z: number }

function initialBottles(): Bottle[] {
  const { cx, cz, angle } = gymPlacement(locationById.camp.pos)
  const c = Math.cos(angle), s = Math.sin(angle)
  const place = (lx: number, lz: number) => [cx + lx * c + lz * s, cz - lx * s + lz * c] as const
  const out: Bottle[] = []
  let id = 0
  // on the rubber floor by the bench, where someone left it between sets
  {
    const [x, z] = place(0.6, 3.0)
    out.push({ id: id++, x, z, y: groundHeight(cx, cz) + LIFT })
  }
  // a water station: three on the picnic table
  for (const dx of [-0.35, 0, 0.35]) {
    const [x, z] = place(6.2 + dx, 9.6)
    out.push({ id: id++, x, z, y: groundHeight(x, z) + 0.785 })
  }
  // one by the loungers at the pool
  {
    const pc = Math.cos(POOL.angle), ps = Math.sin(POOL.angle)
    const lx = -1.6, lz = POOL.hz + POOL.deck * 0.55
    out.push({ id: id++, x: POOL.x + lx * pc + lz * ps, z: POOL.z - lx * ps + lz * pc, y: poolDeckHeight() + 0.02 })
  }
  return out
}

function BottleModel({ b }: { b: Bottle }) {
  const { scene } = useGLTF('/models/gym_bottle.glb')
  const model = useMemo(() => {
    const m = scene.clone(true)
    m.traverse((o) => { const mm = o as Mesh; if (mm.isMesh) { mm.castShadow = true; mm.receiveShadow = true } })
    const box = new Box3().setFromObject(m)
    const centre = box.getCenter(new Vector3())
    m.position.set(-centre.x, -box.min.y, -centre.z)
    return m
  }, [scene])
  return <group position={[b.x, b.y, b.z]}><primitive object={model as Object3D} /></group>
}

export function Pickups() {
  const [bottles, setBottles] = useState<Bottle[]>(initialBottles)
  const nextId = useRef(100)
  const offForage = useRef<(() => void) | null>(null)
  const forageIdx = useRef(-1)
  const offUse = useRef<(() => void) | null>(null)
  const useLabel = useRef('')
  const found = useRef(false)
  const clock = useRef(0)

  // each bottle in the world offers itself to be picked up
  useEffect(() => {
    const offs = bottles.map((b) => registerInteractable({
      id: `bottle-${b.id}`,
      label: 'PICK UP WATER',
      verb: 'LIFT',
      position: new Vector3(b.x, b.y + 0.3, b.z),
      radius: 1.6,
      panel: null,
      action: () => {
        if (hand.held || hand.action) return
        pickUp('bottle', new Vector3(b.x, b.y + 0.12, b.z), () => {
          setBottles((list) => list.filter((x) => x.id !== b.id))
        })
      },
    }))
    return () => offs.forEach((o) => o())
  }, [bottles])

  useFrame((_, dt) => {
    clock.current += dt
    if (clock.current < 0.2) return
    clock.current = 0

    // ---- what is in hand: eat, drink, or put down
    const label = hand.action || !hand.held ? ''
      : hand.held === 'mushroom' ? 'EAT MUSHROOM'
      : hand.empty ? 'PUT THE BOTTLE DOWN' : 'DRINK WATER'
    if (label !== useLabel.current) {
      useLabel.current = label
      offUse.current?.()
      offUse.current = label ? registerInteractable({
        id: 'hand-use', label, verb: 'LIFT', position: player.pos, radius: 99, panel: null,
        action: () => {
          if (hand.held === 'mushroom' || !hand.empty) consume()
          else putDown((at) => setBottles((list) => [...list, { id: nextId.current++, x: at.x, y: groundHeight(at.x, at.z), z: at.z }]))
        },
      }) : null
    }

    // ---- the nearest mushroom within reach, if hands are free
    let best = -1
    let bd = 2.2 * 2.2
    const { spots, picked } = mushrooms
    if (!hand.held && !hand.action && mushrooms.mesh) {
      for (let i = 0; i < spots.length; i++) {
        const s = spots[i]
        const d = (s.x - player.pos.x) ** 2 + (s.z - player.pos.z) ** 2
        if (d < bd && !picked.has(i)) { bd = d; best = i }
      }
    }
    // only touch the registry when the offer actually changes
    if (best === forageIdx.current) return
    forageIdx.current = best
    offForage.current?.()
    offForage.current = null
    if (best < 0) return
    const s = spots[best]
    const at = new Vector3(s.x, s.y + 0.06 * s.s, s.z)
    offForage.current = registerInteractable({
      id: 'forage', label: 'PICK UP MUSHROOM', verb: 'LIFT',
      position: at, radius: 2.2, panel: null,
      action: () => {
        if (!found.current) {
          found.current = true
          useStore.getState().showToast('NEW ACTIVITY · FORAGING', 'The woods are full of them — pick one, eat it')
        }
        pickUp('mushroom', at, () => {
          forageIdx.current = -1
          mushrooms.picked.add(best)
          if (mushrooms.mesh) hideInstance(mushrooms.mesh, best)
        })
      },
    })
  })

  useEffect(() => () => { offForage.current?.(); offUse.current?.() }, [])

  return <group>{bottles.map((b) => <BottleModel key={b.id} b={b} />)}</group>
}

useGLTF.preload('/models/gym_bottle.glb')
