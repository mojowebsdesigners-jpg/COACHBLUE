import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import { Box3, Group, Mesh, MeshStandardMaterial, Object3D, Quaternion, Vector3 } from 'three'
import { hand } from '../../systems/HandAction'
import { raiseAmount } from '../../systems/HandPose'
import { mushroomGeometry } from './Vegetation'

/**
 * Whatever is in his right hand, drawn in the hand: placed at the palm each
 * frame after the pose is solved, so it moves with the fingers rather than
 * floating near them. A bottle is held upright and tips towards the mouth as
 * he drinks; a mushroom sits between the fingers until it is eaten.
 */
const _p = new Vector3()
const _q = new Quaternion()
const _side = new Vector3()
const _up = new Vector3(0, 1, 0)
const _fwd = new Vector3()

export function HeldItem({ hand: bone }: { hand: Object3D }) {
  const { scene } = useGLTF('/models/gym_bottle.glb')
  const bottle = useMemo(() => {
    const c = scene.clone(true)
    c.traverse((o) => { const m = o as Mesh; if (m.isMesh) m.castShadow = true })
    // stand it on its base with the grip at the origin
    const box = new Box3().setFromObject(c)
    const size = box.getSize(new Vector3())
    const centre = box.getCenter(new Vector3())
    c.position.set(-centre.x, -box.min.y - size.y * 0.42, -centre.z)
    const g = new Group()
    g.add(c)
    return g
  }, [scene])
  const mushroom = useMemo(() => {
    const m = new Mesh(mushroomGeometry(), new MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }))
    m.scale.setScalar(1.3)
    m.position.y = -0.06
    const g = new Group()
    g.add(m)
    return g
  }, [])
  const root = useRef<Group>(null)

  useFrame(() => {
    const g = root.current
    if (!g) return
    const item = hand.held
    bottle.visible = item === 'bottle'
    mushroom.visible = item === 'mushroom'
    g.visible = !!item
    if (!item) return
    bone.updateWorldMatrix(true, false)
    bone.getWorldPosition(_p)
    bone.getWorldQuaternion(_q)
    // the palm is a few centimetres out from the wrist joint, along the hand
    _fwd.set(0, 1, 0).applyQuaternion(_q)
    g.position.copy(_p).addScaledVector(_fwd, 0.085)
    // held upright, turned with the hand; tipped to the lips while drinking
    const a = hand.action
    const tip = a && a.kind === 'consume' && item === 'bottle' ? raiseAmount(a.t / a.dur) : 0
    _side.set(1, 0, 0).applyQuaternion(_q)
    _side.y = 0
    if (_side.lengthSq() < 1e-4) _side.set(1, 0, 0)
    _side.normalize()
    g.quaternion.setFromAxisAngle(_up, Math.atan2(_side.x, _side.z))
    g.rotateX(-1.9 * tip)
  }, 3)

  return (
    <group ref={root}>
      <primitive object={bottle} />
      <primitive object={mushroom} />
    </group>
  )
}
