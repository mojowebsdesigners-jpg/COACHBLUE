import { useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Sphere, Vector3, type Mesh, type Object3D } from 'three'
import { updateInstanceCulling } from '../../lib/instanceCull'
import { detail } from '../../lib/detail'

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
const SMALL_RADIUS = 3

type Entry = { o: Object3D; r: number; range: number; caster: boolean }
/** parts smaller than this never cast a shadow (bolts, handles, trim) */
const TINY = 0.35
/** people beyond this cast no shadow (the sun's shadow covers ~30 m round him) */
const PEOPLE_SHADOW = 25
const _p = new Vector3()

export function DistanceCull() {
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)
  const list = useRef<Entry[]>([])
  const people = useRef<Mesh[]>([])
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
      const folk: Mesh[] = []
      scene.traverse((o) => {
        const m = o as Mesh & { text?: unknown; isInstancedMesh?: boolean; isSkinnedMesh?: boolean }
        if (m.isSkinnedMesh && !m.userData.noCull && (m.visible || hidden.current.has(m))) { folk.push(m); return }
        if (!m.isMesh || m.isInstancedMesh || m.isSkinnedMesh || m.userData.noCull) return
        if (!m.visible && !hidden.current.has(m)) return
        if (m.text !== undefined) { out.push({ o: m, r: 0, range: TEXT_RANGE, caster: false }); return }
        const g = m.geometry
        if (!g.boundingSphere) g.computeBoundingSphere()
        const r = g.boundingSphere ? g.boundingSphere.radius * m.matrixWorld.getMaxScaleOnAxis() : 99
        // remember who was meant to cast, so a shadow switched off for
        // distance can be switched back on; tiny parts never cast at all
        const caster = m.castShadow || !!m.userData.castsShadow
        if (caster) m.userData.castsShadow = true
        if (caster && r < TINY) m.castShadow = false
        if (r < SMALL_RADIUS) out.push({ o: m, r, range: -1, caster: caster && r >= TINY })
        else if (caster && r < 40) out.push({ o: m, r, range: Infinity, caster: true })
      })
      list.current = out
      people.current = folk
    }
    if (tm.cull > 0) return
    tm.cull = 0.25
    camera.getWorldPosition(_c)
    // People: a character is ten-odd skinned meshes and ~40k triangles,
    // drawn again for the shadow. Past a few dozen metres they are a few
    // pixels tall, so they are not drawn at all, and only those close to him
    // cast a shadow. (Never the player: his meshes are marked noCull.)
    for (const m of people.current) {
      _p.setFromMatrixPosition(m.matrixWorld)
      const d = _p.distanceTo(_c)
      m.castShadow = d < PEOPLE_SHADOW
      const far = d > detail.peopleRange
      if (far && m.visible) { m.visible = false; hidden.current.add(m) }
      else if (!far && hidden.current.has(m)) { m.visible = true; hidden.current.delete(m) }
    }
    for (const e of list.current) {
      const m = e.o as Mesh
      const g = m.geometry
      if (g.boundingSphere) _s.copy(g.boundingSphere).applyMatrix4(m.matrixWorld)
      else _s.center.setFromMatrixPosition(m.matrixWorld)
      // small things follow the detail level; labels keep their own range
      const range = e.range < 0 ? detail.smallRange : e.range
      const d = _s.center.distanceTo(_c) - e.r
      // the sun's shadow only covers a few dozen metres round him: further
      // off, an object's shadow pass is drawn for nothing
      if (e.caster) m.castShadow = d < detail.shadowRange
      const far = d > range
      if (far && m.visible) { m.visible = false; hidden.current.add(m) }
      else if (!far && hidden.current.has(m)) { m.visible = true; hidden.current.delete(m) }
    }
  })
  return null
}
