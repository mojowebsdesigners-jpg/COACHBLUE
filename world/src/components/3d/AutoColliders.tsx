import { useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Box3, Euler, Material, Mesh, Object3D, Quaternion, Vector3 } from 'three'
import { addCollider, groundHeight } from '../../lib/terrain'

/**
 * Nothing solid can be walked or driven through.
 *
 * Colliders used to be added by hand, object by object, and whatever was
 * missed — a gate post, a podium, a bin, a sign's legs — you passed straight
 * through. This watches the scene instead: every static, opaque, shadow-
 * casting mesh that stands on the ground and is at least knee-high gets a box
 * matching its footprint and turn. Walkable floors (anything much bigger
 * than a room), things up in the air (sign boards, lamps' heads), and
 * anything that moves (the car, the letters, what is in someone's hands:
 * marked `userData.noCollide`, or seen to move between scans) are left alone.
 * When a place unloads, its boxes go with it.
 */
const SCAN = 0.75         // seconds between scans
const MIN_H = 0.45        // knee-high: anything lower is stepped over
const MAX_SIDE = 7        // bigger than this is a floor or a merged batch, not an obstacle

type Seen = { at: Vector3; stable: number; done: boolean; off: (() => void) | null }

const _box = new Box3()
const _p = new Vector3()
const _q = new Quaternion()
const _s = new Vector3()
const _e = new Euler()

function excluded(o: Object3D) {
  // (not visibility: the distance culler hides far things, and a merged
  // batch hides its sources, but they are just as solid)
  for (let p: Object3D | null = o; p; p = p.parent) {
    if (p.userData.noCollide || p.userData.dynamic) return true
  }
  return false
}

export function AutoColliders() {
  const scene = useThree((s) => s.scene)
  const seen = useRef(new Map<Mesh, Seen>())
  const clock = useRef(0)

  useFrame((_, dt) => {
    clock.current += dt
    if (clock.current < SCAN) return
    clock.current = 0
    const live = new Set<Mesh>()
    scene.traverse((o) => {
      const m = o as Mesh & { isInstancedMesh?: boolean; isSkinnedMesh?: boolean }
      if (!m.isMesh || m.isInstancedMesh || m.isSkinnedMesh || !m.castShadow) return
      const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as Material
      if (!mat || mat.transparent) return
      live.add(m)
      m.getWorldPosition(_p)
      let rec = seen.current.get(m)
      if (!rec) {
        seen.current.set(m, { at: _p.clone(), stable: 0, done: false, off: null })
        return
      }
      if (rec.done) return
      // it has to hold still for two scans before it counts as fixed
      if (rec.at.distanceToSquared(_p) > 1e-4) { rec.at.copy(_p); rec.stable = 0; return }
      if (++rec.stable < 2) return
      rec.done = true
      if (excluded(m)) return
      const g = m.geometry
      if (!g.boundingBox) g.computeBoundingBox()
      // footprint in the mesh's own frame, turned by its own yaw
      m.matrixWorld.decompose(_p, _q, _s)
      _e.setFromQuaternion(_q, 'YXZ')
      // only upright things: a tipped-over mesh's local box is not its footprint
      if (Math.abs(_e.x) > 0.3 || Math.abs(_e.z) > 0.3) return
      const bb = g.boundingBox!
      const hx = ((bb.max.x - bb.min.x) / 2) * Math.abs(_s.x)
      const hz = ((bb.max.z - bb.min.z) / 2) * Math.abs(_s.z)
      if (hx * 2 > MAX_SIDE || hz * 2 > MAX_SIDE || hx * hz * 4 > 24) return
      if (Math.max(hx, hz) < 0.1) return
      _box.copy(bb).applyMatrix4(m.matrixWorld)
      const cx = (_box.min.x + _box.max.x) / 2, cz = (_box.min.z + _box.max.z) / 2
      const ground = groundHeight(cx, cz)
      if (_box.max.y - _box.min.y < MIN_H) return
      if (_box.min.y > ground + 1.2) return             // up in the air
      if (_box.max.y < ground + MIN_H) return            // buried / below the ground
      rec.off = addCollider({ x: cx, z: cz, hx: hx + 0.04, hz: hz + 0.04, angle: _e.y })
    })
    // places that unloaded take their boxes with them
    for (const [m, rec] of seen.current) {
      if (live.has(m)) continue
      rec.off?.()
      seen.current.delete(m)
    }
    if (import.meta.env.DEV) {
      const w = window as unknown as { __auto?: { scans: number; boxes: number; seen: number } }
      w.__auto = { scans: (w.__auto?.scans ?? 0) + 1, boxes: [...seen.current.values()].filter((r) => r.off).length, seen: seen.current.size }
    }
  })
  return null
}
