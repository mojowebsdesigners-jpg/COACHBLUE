import { Object3D } from 'three'

/**
 * Only rebuild an object's matrix when it has actually moved.
 *
 * three.js recomposes every auto-updating object's local matrix each frame and
 * flags its world matrix dirty, and a dirty parent forces every descendant to
 * recompute too. The scene root is auto-updating, so in practice every object
 * in the world multiplied its world matrix every frame whether anything moved
 * or not — and with every area kept mounted that was thousands of matrices a
 * frame, the single largest CPU cost on a phone.
 *
 * Here each object remembers the position, rotation and scale it last
 * composed from. If they are unchanged the matrix is left as it is and nothing
 * is flagged, so a static subtree costs a handful of comparisons and the
 * forcing stops at whatever really moved. Moving things behave exactly as
 * before. Objects with a pivot use the stock path.
 */
type Cached = Object3D & { _mc?: Float64Array }

const stock = Object3D.prototype.updateMatrix

Object3D.prototype.updateMatrix = function (this: Cached) {
  if (this.pivot !== null) {
    this._mc = undefined
    stock.call(this)
    return
  }
  const p = this.position, q = this.quaternion, s = this.scale
  let c = this._mc
  if (
    c !== undefined &&
    c[0] === p.x && c[1] === p.y && c[2] === p.z &&
    c[3] === q.x && c[4] === q.y && c[5] === q.z && c[6] === q.w &&
    c[7] === s.x && c[8] === s.y && c[9] === s.z
  ) return
  if (c === undefined) c = this._mc = new Float64Array(10)
  c[0] = p.x; c[1] = p.y; c[2] = p.z
  c[3] = q.x; c[4] = q.y; c[5] = q.z; c[6] = q.w
  c[7] = s.x; c[8] = s.y; c[9] = s.z
  this.matrix.compose(p, q, s)
  this.matrixWorldNeedsUpdate = true
}

/**
 * The other half. `getWorldPosition` and friends refresh one object's world
 * matrix through `updateWorldMatrix(parents, children = false)`, which clears
 * its dirty flag without touching its children. Stock three.js never noticed:
 * every object re-flagged itself every frame. Here an object only flags itself
 * when it moves, so a move picked up mid-frame by that path (the car's body,
 * read for the driver and the door prompt) would never reach its children,
 * and the car's model was left behind. Note it, and push it down on the next
 * full pass.
 */
type Pending = Cached & { _mcChildren?: boolean }
const _before = new Float64Array(16)
const stockWorld = Object3D.prototype.updateWorldMatrix
const stockMatrixWorld = Object3D.prototype.updateMatrixWorld

Object3D.prototype.updateWorldMatrix = function (this: Pending, updateParents: boolean, updateChildren: boolean, force?: boolean) {
  if (updateChildren === true || this.children.length === 0) {
    stockWorld.call(this, updateParents, updateChildren, force)
    return
  }
  // only when its world matrix really changed do the children need it
  const e = this.matrixWorld.elements
  _before.set(e)
  stockWorld.call(this, updateParents, updateChildren, force)
  for (let i = 0; i < 16; i++) if (e[i] !== _before[i]) { this._mcChildren = true; break }
}

Object3D.prototype.updateMatrixWorld = function (this: Pending, force?: boolean) {
  if (this._mcChildren) {
    this._mcChildren = false
    force = true
  }
  stockMatrixWorld.call(this, force)
}
