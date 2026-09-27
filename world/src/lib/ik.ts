import { Object3D, Quaternion, Vector3 } from 'three'

// Small world-space IK helpers used to pose the rigged character into exercises
// the Mixamo clip set doesn't cover (pull-ups, push-ups, squats).

const _a = new Vector3()
const _b = new Vector3()
const _c = new Vector3()
const _pq = new Quaternion()
const _q = new Quaternion()

/** Rotate `bone` so the direction bone->child points along `dir` (world space). */
export function aimBone(bone: Object3D, child: Object3D, dir: Vector3) {
  bone.updateWorldMatrix(true, false)
  child.updateWorldMatrix(true, false)
  const from = _a.setFromMatrixPosition(child.matrixWorld).sub(_b.setFromMatrixPosition(bone.matrixWorld))
  if (from.lengthSq() < 1e-8) return
  from.normalize()
  _q.setFromUnitVectors(from, _c.copy(dir).normalize())
  bone.parent?.getWorldQuaternion(_pq)
  const local = _pq.clone().invert().multiply(_q).multiply(_pq)
  bone.quaternion.premultiply(local)
  bone.updateWorldMatrix(false, true)
}

const _root = new Vector3()
const _mid = new Vector3()
const _end = new Vector3()
const _fwd = new Vector3()
const _pole = new Vector3()
const _target = new Vector3()

/**
 * Two-bone IK. Places `end` at `target` by bending at `mid`, with the joint
 * pushed towards `poleDir`. Bone lengths are measured from the current pose.
 */
export function twoBoneIK(
  upper: Object3D,
  lower: Object3D,
  end: Object3D,
  target: Vector3,
  poleDir: Vector3,
) {
  upper.updateWorldMatrix(true, false)
  lower.updateWorldMatrix(true, false)
  end.updateWorldMatrix(true, false)
  _root.setFromMatrixPosition(upper.matrixWorld)
  _mid.setFromMatrixPosition(lower.matrixWorld)
  _end.setFromMatrixPosition(end.matrixWorld)

  const l1 = _root.distanceTo(_mid)
  const l2 = _mid.distanceTo(_end)
  _target.copy(target)
  let d = _root.distanceTo(_target)
  const max = (l1 + l2) * 0.999
  if (d > max) {
    _target.sub(_root).multiplyScalar(max / d).add(_root)
    d = max
  }
  d = Math.max(d, Math.abs(l1 - l2) + 1e-4)

  _fwd.copy(_target).sub(_root).normalize()
  // orthogonalise the pole hint against the root->target axis
  _pole.copy(poleDir).addScaledVector(_fwd, -poleDir.dot(_fwd))
  if (_pole.lengthSq() < 1e-6) _pole.set(0, 0, 1).addScaledVector(_fwd, -_fwd.z)
  _pole.normalize()

  const cos = Math.min(1, Math.max(-1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d)))
  const sin = Math.sqrt(1 - cos * cos)
  const joint = _root.clone().addScaledVector(_fwd, l1 * cos).addScaledVector(_pole, l1 * sin)

  aimBone(upper, lower, joint.clone().sub(_root))
  aimBone(lower, end, _target.clone().sub(joint))
}

/** Rotate a bone around a world axis by an angle, on top of its current pose. */
export function rotateBoneWorld(bone: Object3D, axis: Vector3, angle: number) {
  bone.updateWorldMatrix(true, false)
  _q.setFromAxisAngle(axis, angle)
  bone.parent?.getWorldQuaternion(_pq)
  bone.quaternion.premultiply(_pq.clone().invert().multiply(_q).multiply(_pq))
  bone.updateWorldMatrix(false, true)
}
