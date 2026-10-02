import { Frustum, Matrix4, Sphere, Vector3, type Camera, type InstancedMesh } from 'three'

/**
 * Per-instance culling for instanced meshes that are scattered over the whole
 * valley (trees, bushes, rocks).
 *
 * One instanced mesh per tree species covers the entire world, so its bounding
 * sphere always touches the view and three.js draws every instance, every
 * frame — and again in the shadow pass. That was over a million triangles
 * behind the camera. A few times a second this compacts each mesh's instance
 * buffer down to the instances that can matter: inside the view frustum, or
 * close enough to throw a shadow into it. The GPU then never sees the rest.
 *
 * Instance order is not stable across updates, so nothing may rely on an
 * instance index once a mesh is registered here (none of the scattered
 * vegetation does).
 */
type Entry = {
  mesh: InstancedMesh
  matrices: Float32Array
  colors: Float32Array | null
  /** world-space bounding sphere per instance: x, y, z, r */
  spheres: Float32Array
  total: number
  near: number
  /** a cheaper stand-in drawn for the instances beyond `from` metres */
  lod: { mesh: InstancedMesh; from: number } | null
}

const entries = new Set<Entry>()
const _m = new Matrix4()
const _c = new Vector3()
const _s = new Sphere()
const _f = new Frustum()
const _pv = new Matrix4()
const _last = new Vector3(1e9, 0, 0)
const _lastDir = new Vector3()
const _dir = new Vector3()
let clock = 0
/**
 * Beyond this, an instance is lost in the fog and not drawn at all. Trees a
 * quarter of a mile off are a few hazy pixels each but still cost their full
 * two thousand vertices and an alpha-tested leaf pass; at the camp that was
 * half the frame. Set from the fog, so the cut lands where the haze is
 * already all but opaque.
 */
let far = Infinity
export function setInstanceFar(d: number) {
  if (d !== far) { far = d; _last.set(1e9, 0, 0) }
}

/**
 * Take over culling for a mesh whose instance matrices (and colours) are
 * already set. `near`: instances this close to the camera are always kept,
 * for the shadows they cast into view.
 */
export function registerInstanceCull(
  mesh: InstancedMesh, near = 45, lod: { mesh: InstancedMesh; from: number } | null = null,
) {
  const total = mesh.count
  const matrices = new Float32Array(mesh.instanceMatrix.array.slice(0, total * 16))
  const colors = mesh.instanceColor ? new Float32Array(mesh.instanceColor.array.slice(0, total * 3)) : null
  const g = mesh.geometry
  if (!g.boundingSphere) g.computeBoundingSphere()
  const local = g.boundingSphere!
  const spheres = new Float32Array(total * 4)
  for (let i = 0; i < total; i++) {
    _m.fromArray(matrices, i * 16)
    _s.copy(local).applyMatrix4(_m)
    spheres.set([_s.center.x, _s.center.y, _s.center.z, _s.radius], i * 4)
  }
  const e: Entry = { mesh, matrices, colors, spheres, total, near, lod }
  entries.add(e)
  // the compacted buffer is re-uploaded often; say so
  mesh.instanceMatrix.setUsage(35048)   // DynamicDrawUsage
  mesh.frustumCulled = false            // we do it per instance now
  if (lod) {
    lod.mesh.instanceMatrix.setUsage(35048)
    lod.mesh.frustumCulled = false
    lod.mesh.count = 0
  }
  _last.set(1e9, 0, 0)                  // force a pass next frame
  return () => {
    entries.delete(e)
    // hand back the full set
    mesh.instanceMatrix.array.set(matrices)
    if (colors && mesh.instanceColor) mesh.instanceColor.array.set(colors)
    mesh.count = total
    mesh.instanceMatrix.needsUpdate = true
    if (lod) lod.mesh.count = 0
  }
}

/**
 * Take one instance out of the world for good (a mushroom picked, say). Its
 * sphere is collapsed so it is never drawn again, whatever the camera does.
 */
export function hideInstance(mesh: InstancedMesh, index: number) {
  for (const e of entries) {
    if (e.mesh !== mesh || index >= e.total) continue
    e.spheres[index * 4 + 3] = -1e6
    // scale it to nothing too, in case the mesh is ever drawn uncompacted
    _m.fromArray(e.matrices, index * 16)
    _m.scale(_c.set(0, 0, 0))
    _m.toArray(e.matrices, index * 16)
    _last.set(1e9, 0, 0)     // re-cull on the next frame
    return
  }
  _m.makeScale(0, 0, 0)
  mesh.setMatrixAt(index, _m)
  mesh.instanceMatrix.needsUpdate = true
}

/** Run from the render loop. Cheap: a few thousand sphere tests, a few times a second. */
export function updateInstanceCulling(camera: Camera, dt: number) {
  if (!entries.size) return
  clock += dt
  camera.getWorldPosition(_c)
  camera.getWorldDirection(_dir)
  const moved = _c.distanceToSquared(_last) > 1.5 * 1.5 || _dir.dot(_lastDir) < 0.995
  if (!moved && clock < 0.5) return
  if (clock < 0.08) return
  clock = 0
  _last.copy(_c)
  _lastDir.copy(_dir)
  camera.updateMatrixWorld()
  _pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
  _f.setFromProjectionMatrix(_pv)
  // widen the side planes a touch so a turn of the head never reveals a gap
  for (const p of _f.planes) p.constant += 6

  for (const e of entries) {
    const out = e.mesh.instanceMatrix.array as Float32Array
    const outC = e.mesh.instanceColor?.array as Float32Array | undefined
    const outL = e.lod?.mesh.instanceMatrix.array as Float32Array | undefined
    const lodFrom = e.lod ? e.lod.from : Infinity
    let n = 0, nl = 0
    for (let i = 0; i < e.total; i++) {
      const k = i * 4
      _s.center.set(e.spheres[k], e.spheres[k + 1], e.spheres[k + 2])
      _s.radius = e.spheres[k + 3]
      const d = _s.center.distanceTo(_c) - _s.radius
      if (d > far) continue
      if (d > e.near && !_f.intersectsSphere(_s)) continue
      if (outL && d > lodFrom) {
        outL.set(e.matrices.subarray(i * 16, i * 16 + 16), nl * 16)
        nl++
        continue
      }
      out.set(e.matrices.subarray(i * 16, i * 16 + 16), n * 16)
      if (outC && e.colors) outC.set(e.colors.subarray(i * 3, i * 3 + 3), n * 3)
      n++
    }
    e.mesh.count = n
    if (e.lod) {
      const lm = e.lod.mesh
      lm.count = nl
      lm.instanceMatrix.clearUpdateRanges()
      lm.instanceMatrix.addUpdateRange(0, Math.max(16, nl * 16))
      lm.instanceMatrix.needsUpdate = true
    }
    // upload only the part of the buffer in use
    const im = e.mesh.instanceMatrix
    im.clearUpdateRanges()
    im.addUpdateRange(0, Math.max(16, n * 16))
    im.needsUpdate = true
    if (outC) {
      const ic = e.mesh.instanceColor!
      ic.clearUpdateRanges()
      ic.addUpdateRange(0, Math.max(3, n * 3))
      ic.needsUpdate = true
    }
  }
}
