import { useLayoutEffect, type RefObject } from 'react'
import type { Object3D } from 'three'
import { BufferGeometry, DoubleSide, Material, Matrix4, Mesh } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'


/**
 * Stop three.js recomputing the transforms of things that never move.
 *
 * By default every object's local and world matrices are rebuilt every frame.
 * For a world with thousands of static pieces — gym kit, billboards, lamps,
 * houses, the pool — that bookkeeping alone was costing more than the
 * drawing. Frozen, each piece's matrices are computed once and then left.
 * Anything marked `userData.dynamic` (and everything under it) is skipped.
 */
export function freeze(root: Object3D) {
  root.updateMatrixWorld(true)
  root.traverse((o) => {
    o.matrixAutoUpdate = false
  })
  // re-enable under dynamic subtrees
  root.traverse((o) => {
    if (o.userData.dynamic) o.traverse((c) => { c.matrixAutoUpdate = true })
  })
}

export function useFreeze(ref: RefObject<Object3D | null>, deps: unknown[] = []) {
  useLayoutEffect(() => {
    const o = ref.current
    if (!o) return
    // after children have mounted and been placed
    const id = requestAnimationFrame(() => freeze(o))
    return () => cancelAnimationFrame(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}

// ---------------------------------------------------------------- static batching

const _m = new Matrix4()

/**
 * Merge the static meshes under `root` that share a material into one mesh
 * per material. A frozen section of the world (the gym kit, the pool, the
 * billboards' steel) is dozens of small pieces; each piece is a draw call,
 * twice over with shadows. Batched, a whole section costs a handful.
 *
 * Skipped: skinned, instanced and text meshes, anything marked dynamic, and
 * geometry whose attributes don't match the rest of its batch.
 */
export function batchStatic(root: Object3D) {
  root.updateMatrixWorld(true)
  const inv = new Matrix4().copy(root.matrixWorld).invert()
  const groups = new Map<string, { mat: Material; meshes: Mesh[] }>()
  root.traverse((o) => {
    const m = o as Mesh & { text?: unknown; isInstancedMesh?: boolean; isSkinnedMesh?: boolean }
    if (!m.isMesh || m.isInstancedMesh || m.isSkinnedMesh || m.text !== undefined) return
    if (m.userData.batched || Array.isArray(m.material)) return
    let dyn = false
    for (let p: Object3D | null = m; p && p !== root; p = p.parent) if (p.userData.dynamic) dyn = true
    if (dyn || !m.visible || m.morphTargetInfluences) return
    const g = m.geometry as BufferGeometry
    const sig = Object.keys(g.attributes).sort().join(',') + (g.index ? '|i' : '|n')
    // grouped by 80 m cell as well as material: one merge spanning the whole
    // road is always partly in view, so every vertex of it was drawn every
    // frame; per cell, the parts out of view are skipped as before
    const cell = `${Math.floor(m.matrixWorld.elements[12] / 80)},${Math.floor(m.matrixWorld.elements[14] / 80)}`
    const key = `${(m.material as Material).uuid}|${sig}|${m.castShadow ? 1 : 0}${m.receiveShadow ? 1 : 0}|${m.renderOrder}|${cell}`
    let e = groups.get(key)
    if (!e) groups.set(key, (e = { mat: m.material as Material, meshes: [] }))
    e.meshes.push(m)
  })
  let saved = 0
  for (const { mat, meshes } of groups.values()) {
    if (meshes.length < 2) continue
    const geos = meshes.map((m) => {
      const g = (m.geometry as BufferGeometry).clone()
      g.applyMatrix4(_m.multiplyMatrices(inv, m.matrixWorld))
      return g
    })
    const merged = mergeGeometries(geos, false)
    geos.forEach((g) => g.dispose())
    if (!merged) continue
    const out = new Mesh(merged, mat)
    out.castShadow = meshes[0].castShadow
    out.receiveShadow = meshes[0].receiveShadow
    out.renderOrder = meshes[0].renderOrder
    out.userData.batched = true
    out.matrixAutoUpdate = false
    root.add(out)
    out.updateMatrixWorld(true)
    for (const m of meshes) m.visible = false
    saved += meshes.length - 1
  }
  return saved
}

/**
 * Make every mesh sharing a material agree on the flags that pick its shader
 * variant (receives shadows, skinned, instanced, vertex colours). When they
 * disagree, three.js switches program on every such draw — the single
 * largest cost in a busy frame. Shadow receiving is unified (it is harmless
 * to receive); the rest get their own copy of the material.
 */
export function harmonizeMaterials(root: Object3D) {
  const users = new Map<Material, Mesh[]>()
  root.traverse((o) => {
    const m = o as Mesh
    if (!m.isMesh) return
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      let list = users.get(mat)
      if (!list) users.set(mat, (list = []))
      list.push(m)
    }
  })
  let fixed = 0
  // A transparent, double-sided material is drawn twice a frame by three.js
  // (back faces, then front), flagging itself for a shader re-check on each
  // pass. For the flat glows, rings, sprites and water here that ordering is
  // invisible, so they are drawn once.
  for (const mat of users.keys()) {
    const m = mat as Material & { forceSinglePass?: boolean }
    if (m.transparent && m.side === DoubleSide && !m.forceSinglePass) { m.forceSinglePass = true; fixed++ }
  }
  for (const [mat, meshes] of users) {
    if (meshes.length < 2) continue
    if (meshes.some((m) => m.receiveShadow) && meshes.some((m) => !m.receiveShadow)) {
      meshes.forEach((m) => { m.receiveShadow = true })
      fixed++
    }
    const sig = (m: Mesh) => `${(m as { isSkinnedMesh?: boolean }).isSkinnedMesh ? 1 : 0}${(m as { isInstancedMesh?: boolean }).isInstancedMesh ? 1 : 0}${m.geometry.attributes.color ? 1 : 0}`
    const kinds = new Map<string, Mesh[]>()
    meshes.forEach((m) => { const k = sig(m); if (!kinds.has(k)) kinds.set(k, []); kinds.get(k)!.push(m) })
    if (kinds.size > 1) {
      let first = true
      for (const group of kinds.values()) {
        if (first) { first = false; continue }
        const copy = mat.clone()
        group.forEach((m) => {
          if (Array.isArray(m.material)) m.material = m.material.map((x) => (x === mat ? copy : x))
          else m.material = copy
        })
        fixed++
      }
    }
  }
  return fixed
}
