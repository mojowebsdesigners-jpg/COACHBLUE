import { useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Sphere, Vector3, type Mesh, type Object3D } from 'three'
import { updateInstanceCulling } from '../../lib/instanceCull'

/**
 * Past a certain distance, small things are a few pixels and not worth a draw.
 *
 * Every few seconds this collects the scene's small meshes (bounding radius
 * under 3 m) and its text labels; several times a second it hides the ones
 * beyond their range from the camera and shows them again as you approach.
 * It only ever restores what it hid itself, so anything hidden for another
 * reason (a batched source, an off prop) stays hidden.
 */
const TEXT_RANGE = 45
const SMALL_RANGE = 90
const SMALL_RADIUS = 3

type Entry = { o: Object3D; r: number; range: number }

export function DistanceCull() {
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)
  const list = useRef<Entry[]>([])
  const hidden = useRef(new Set<Object3D>())
  const t = useRef({ collect: 0, cull: 0 })
  const _c = new Vector3()
  const _s = new Sphere()

  useFrame((_, dt) => {
    // scattered vegetation: keep only instances that can be seen
    updateInstanceCulling(camera, dt)
    const tm = t.current
    tm.collect -= dt
    tm.cull -= dt
    if (tm.collect <= 0) {
      tm.collect = 4
      const out: Entry[] = []
      scene.traverse((o) => {
        const m = o as Mesh & { text?: unknown; isInstancedMesh?: boolean; isSkinnedMesh?: boolean }
        if (!m.isMesh || m.isInstancedMesh || m.isSkinnedMesh || m.userData.noCull) return
        if (!m.visible && !hidden.current.has(m)) return
        if (m.text !== undefined) { out.push({ o: m, r: 0, range: TEXT_RANGE }); return }
        const g = m.geometry
        if (!g.boundingSphere) g.computeBoundingSphere()
        const r = g.boundingSphere ? g.boundingSphere.radius * m.matrixWorld.getMaxScaleOnAxis() : 99
        if (r < SMALL_RADIUS) out.push({ o: m, r, range: SMALL_RANGE })
      })
      list.current = out
    }
    if (tm.cull > 0) return
    tm.cull = 0.25
    camera.getWorldPosition(_c)
    for (const e of list.current) {
      const m = e.o as Mesh
      const g = m.geometry
      if (g.boundingSphere) _s.copy(g.boundingSphere).applyMatrix4(m.matrixWorld)
      else _s.center.setFromMatrixPosition(m.matrixWorld)
      const far = _s.center.distanceTo(_c) - e.r > e.range
      if (far && m.visible) { m.visible = false; hidden.current.add(m) }
      else if (!far && hidden.current.has(m)) { m.visible = true; hidden.current.delete(m) }
    }
  })
  return null
}
