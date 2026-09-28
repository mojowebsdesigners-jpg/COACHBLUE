import { Object3D, Quaternion, Vector3 } from 'three'
import { twoBoneIK, aimBone, rotateBoneWorld } from '../lib/ik'

/**
 * The exercise poses, solved with IK so hands land on the actual bar rather
 * than near it. This lives apart from any component because both the training
 * NPCs and the player use it — the player working out has to look exactly like
 * the coach working out, or the gym reads as scenery you happen to stand in.
 *
 * Every pose is built the way the lift is coached, from the character's own
 * measured proportions, in the athlete's own frame of forward / left / up:
 *
 *   pull-up          overhand, a little wider than the shoulders, chin to the
 *                    bar, elbows driving down and out, legs long
 *   push-up          a rigid plank pivoting on the toes, hands under the
 *                    shoulders, elbows back at about 45 degrees
 *   air squat        hips back and down, chest forward, knees over the toes,
 *                    arms reaching forward for balance
 *   back squat       the bar across the upper back, hands just outside the
 *                    shoulders, elbows down and back, a forward lean
 *   bench press      on the back, feet planted, the bar touching the lower
 *                    chest and pressing up over the shoulders
 *   curl             elbows pinned to the ribs, alternating arms
 *   kettlebell swing a hip hinge: the bell from between the legs to chest
 *                    height on straight arms
 */
export type Exercise =
  | 'idle' | 'pullup' | 'pushup' | 'squat'
  | 'bench' | 'curl' | 'run' | 'kettlebell' | 'rackSquat' | 'coach'
  | 'sit' | 'lounge' | 'push' | 'climb' | 'crawl' | 'wall' | 'tyres'
  | 'punch' | 'skip' | 'jacks' | 'burpee' | 'boxjump' | 'situp' | 'plank' | 'ropes' | 'tyreflip'
  | 'hammer' | 'hula' | 'meditate' | 'yoga' | 'dance' | 'swing' | 'bounce' | 'kickups'
  | 'shoot' | 'kick' | 'putt' | 'dart' | 'skim' | 'fish' | 'cannon' | 'flex'

/** Where a piece of equipment offers its grip, in metres above the floor. */
export type Grip = {
  height?: number
  spread?: number
  forward?: number
}

export type Bones = {
  hips: Object3D; spine: Object3D; spine2: Object3D; head: Object3D
  lArm: Object3D; lFore: Object3D; lHand: Object3D
  rArm: Object3D; rFore: Object3D; rHand: Object3D
  lUpLeg: Object3D; lLeg: Object3D; lFoot: Object3D
  rUpLeg: Object3D; rLeg: Object3D; rFoot: Object3D
}

/** How many complete repetitions a given exercise has done by this phase. */
export function repsAt(exercise: Exercise, phase: number) {
  const rate = RATE[exercise] ?? 0
  return rate ? Math.floor((phase * rate) / (Math.PI * 2)) : 0
}

/** Radians of phase per second of an exercise's rep cycle (0 if it has none). */
export const repRate = (exercise: Exercise) => RATE[exercise] ?? 0

const RATE: Partial<Record<Exercise, number>> = {
  pullup: 1.5, pushup: 1.9, squat: 1.4, rackSquat: 1.3,
  bench: 1.3, curl: 1.7, kettlebell: 2.1,
  // the fun park (radians per second: 2*PI / seconds per rep)
  punch: 7, skip: 8.5, jacks: 5.5, burpee: 1.35, boxjump: 1.6, situp: 2.4, ropes: 11,
  tyreflip: 1.0, hammer: 1.9, hula: 7, dance: 6.5, kickups: 5.2,
}

export type PoseArgs = {
  bones: Bones
  /** the group carrying the character, which this positions and rotates */
  group: Object3D
  exercise: Exercise
  /** world x/z of the spot the exercise is performed on */
  position: [number, number]
  /** which way the athlete faces */
  rotation: number
  /** floor height under them */
  ground: number
  /** drives the rep cycle */
  phase: number
  grip?: Grip
  barHeight?: number
  /** how far through a moving activity (metres crawled, moves up a wall) */
  progress?: number
  /** live state for meter- and physics-driven moves */
  extra?: FunExtra
}

// ------------------------------------------------------------ proportions
/**
 * The character's own proportions, measured once from the skeleton rather
 * than assumed: every body that uses these poses is built differently, and a
 * hang height tuned for one person folds another's arms or stretches them.
 */
type Proportions = {
  shoulderY: number      // shoulder joint above the group origin
  shoulderHalf: number   // half the distance between the shoulder joints
  upperArm: number
  foreArm: number
  armLen: number         // shoulder to wrist, arm straight
  hipY: number
  hipHalf: number
  legLen: number         // hip to ankle, leg straight
}
const measured = new WeakMap<Object3D, Proportions>()
const _a = new Vector3()
const _b = new Vector3()
const _c = new Vector3()

function proportions(bones: Bones, g: Object3D): Proportions {
  const hit = measured.get(bones.hips)
  if (hit) return hit
  g.updateMatrixWorld(true)
  const inv = g.matrixWorld.clone().invert()
  const local = (o: Object3D, out: Vector3) => o.getWorldPosition(out).applyMatrix4(inv)
  const seg = (x: Object3D, y: Object3D) => local(x, _a).distanceTo(local(y, _b))
  local(bones.lArm, _a)
  local(bones.rArm, _c)
  const shoulderY = (_a.y + _c.y) / 2
  const shoulderHalf = _a.distanceTo(_c) / 2
  local(bones.lUpLeg, _a)
  local(bones.rUpLeg, _c)
  const hipY = (_a.y + _c.y) / 2
  const hipHalf = _a.distanceTo(_c) / 2
  const upperArm = seg(bones.lArm, bones.lFore)
  const foreArm = seg(bones.lFore, bones.lHand)
  const p: Proportions = {
    shoulderY, shoulderHalf, upperArm, foreArm, armLen: upperArm + foreArm,
    hipY, hipHalf, legLen: seg(bones.lUpLeg, bones.lLeg) + seg(bones.lLeg, bones.lFoot),
  }
  measured.set(bones.hips, p)
  return p
}

// ------------------------------------------------------------ frame
/** The athlete's own axes: forward, their left, and up. */
const F = new Vector3()
const L = new Vector3()
const U = new Vector3(0, 1, 0)
const _t = new Vector3()
const _pole = new Vector3()
const _o = new Vector3()
const _s = new Vector3()

function frame(rotation: number) {
  F.set(Math.sin(rotation), 0, Math.cos(rotation))
  // up x forward: for someone facing +Z that is +X, which is their left
  L.crossVectors(U, F).normalize()
}

const ease = (x: number) => x * x * (3 - 2 * x)

/** 0..1..0 over one rep: a quicker concentric, a pause, a slower eccentric. */
function repCurve(phase: number, rate: number) {
  const t = (((phase * rate) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) / (Math.PI * 2)
  const up = t < 0.4 ? t / 0.4 : t < 0.5 ? 1 : 1 - (t - 0.5) / 0.5
  return ease(up)
}

/** Point in world space: origin + forward*f + left*l + up*u. */
function at(origin: Vector3, f: number, l: number, u: number, out = _t) {
  return out.copy(origin).addScaledVector(F, f).addScaledVector(L, l).addScaledVector(U, u)
}

function placeStanding(g: Object3D, x: number, z: number, y: number, rotation: number) {
  g.position.set(x, y, z)
  g.rotation.set(0, rotation, 0)
  g.updateMatrixWorld(true)
}

/** Plant both feet at a stance, knees pushed out over the toes. */
function plantFeet(bones: Bones, base: Vector3, half: number, ground: number, out = 0.3) {
  for (const side of [1, -1]) {
    const upper = side > 0 ? bones.lUpLeg : bones.rUpLeg
    const lower = side > 0 ? bones.lLeg : bones.rLeg
    const foot = side > 0 ? bones.lFoot : bones.rFoot
    at(base, 0.02, side * half, 0, _t)
    _t.y = ground + 0.08
    _pole.copy(F).addScaledVector(L, side * out).addScaledVector(U, 0.1).normalize()
    twoBoneIK(upper, lower, foot, _t, _pole)
  }
}

/** Lean the torso forward from the hips (positive) or back (negative). */
function leanTorso(bones: Bones, amount: number, head = 0.7) {
  rotateBoneWorld(bones.hips, L, amount * 0.45)
  rotateBoneWorld(bones.spine, L, amount * 0.35)
  rotateBoneWorld(bones.spine2, L, amount * 0.2)
  // keep the eyes up: the head comes back most of the way
  rotateBoneWorld(bones.head, L, -amount * head)
}

function midpoint(a: Object3D, b: Object3D, out: Vector3) {
  a.getWorldPosition(_a)
  b.getWorldPosition(_c)
  return out.addVectors(_a, _c).multiplyScalar(0.5)
}

// ------------------------------------------------------------ grip
type Finger = Object3D[]
const fingerCache = new WeakMap<Object3D, { fingers: Finger[]; thumb: Finger }>()
const _pa = new Vector3()
const _pb = new Vector3()
const _pc = new Vector3()
const _palm = new Vector3()
const _dir = new Vector3()

function fingersOf(hand: Object3D) {
  const hit = fingerCache.get(hand)
  if (hit) return hit
  const find = (key: string) => {
    const chain: Object3D[] = []
    for (let j = 1; j <= 3; j++) {
      let found: Object3D | undefined
      hand.traverse((o) => { if (!found && o.name.includes(`${key}${j}`)) found = o })
      if (found) chain.push(found)
    }
    return chain
  }
  const out = {
    fingers: ['Index', 'Middle', 'Ring', 'Pinky'].map((k) => find(`Hand${k}`)),
    thumb: find('HandThumb'),
  }
  fingerCache.set(hand, out)
  return out
}

/**
 * Close the hand round a bar or handle: each finger joint bends toward the
 * palm, most at the middle knuckle, the thumb wrapping over. The palm side is
 * found from the hand itself — the thumb sits on it — so this works on any rig
 * without knowing its bone axes.
 */
const gripCache = new WeakMap<Object3D, Quaternion[]>()

export function gripHand(hand: Object3D, amount = 1) {
  const { fingers, thumb } = fingersOf(hand)
  // The curl is the same relative to the hand every frame, so it is worked out
  // once (in world space, below) and then simply re-applied to each finger
  // joint's local rotation: no per-frame matrix walks for 15 joints per hand.
  const bonesInHand = [...fingers.flat(), ...thumb]
  const cached = gripCache.get(hand)
  if (cached && amount === 1) {
    bonesInHand.forEach((b, i) => b.quaternion.copy(cached[i]))
    return
  }
  gripHandSolve(hand, fingers, thumb, amount)
  if (amount === 1) gripCache.set(hand, bonesInHand.map((b) => b.quaternion.clone()))
}

function gripHandSolve(hand: Object3D, fingers: Finger[], thumb: Finger, amount: number) {
  const index = fingers[0][0], pinky = fingers[3][0], middle = fingers[1][0]
  if (!index || !pinky || !middle) return
  hand.getWorldPosition(_pa)
  middle.getWorldPosition(_pb)
  const along = _pb.sub(_pa).normalize().clone()
  index.getWorldPosition(_pc)
  pinky.getWorldPosition(_dir)
  const across = _pc.sub(_dir).normalize()
  _palm.crossVectors(along, across).normalize()
  if (thumb[1]) {
    thumb[1].getWorldPosition(_dir).sub(_pa)
    if (_palm.dot(_dir) < 0) _palm.negate()
  }
  const bend = [0.95, 1.35, 0.95]
  const curlChain = (chain: Object3D[], amounts: number[]) => {
    chain.forEach((bone, j) => {
      const next = chain[j + 1] ?? bone.children[0]
      if (!next || !amounts[j]) return
      bone.getWorldPosition(_pc)
      next.getWorldPosition(_dir)
      const d = _dir.sub(_pc).normalize()
      // rotating d about (d x palm) turns it toward the palm
      const axis = _pb.crossVectors(d, _palm).normalize()
      rotateBoneWorld(bone, axis, amounts[j] * amount)
    })
  }
  for (const chain of fingers) curlChain(chain, bend)
  // the thumb closes over the fingers from its middle joint
  curlChain(thumb, [0, 0.55, 0.45])
}

function gripBoth(bones: Bones, amount = 1) {
  gripHand(bones.lHand, amount)
  gripHand(bones.rHand, amount)
}

// ------------------------------------------------------------ solver
/**
 * Poses the skeleton for one frame. Call after the mixer has written the clip,
 * so this lands on top of it rather than being overwritten.
 */
export function solveExercise({
  bones, group: g, exercise, position, rotation, ground, phase, grip, barHeight = 2.35, progress = 0, extra,
}: PoseArgs) {
  frame(rotation)
  const [px, pz] = position

  // measure in the idle pose the clip left us in, before anything moves
  placeStanding(g, px, pz, ground, rotation)
  const prop = proportions(bones, g)

  switch (exercise) {
    case 'pullup': return pullup(bones, g, px, pz, rotation, ground, phase, barHeight, prop, grip)
    case 'pushup': return pushup(bones, g, px, pz, rotation, ground, phase, prop)
    case 'squat': return airSquat(bones, g, px, pz, rotation, ground, phase, prop)
    case 'rackSquat': return backSquat(bones, g, px, pz, rotation, ground, phase, prop, grip)
    case 'bench': return bench(bones, g, px, pz, rotation, ground, phase, prop, grip)
    case 'curl': return curl(bones, g, px, pz, rotation, ground, phase, prop)
    case 'kettlebell': return swing(bones, g, px, pz, rotation, ground, phase, prop)
    case 'sit': return sit(bones, g, px, pz, rotation, ground, phase, prop, grip)
    case 'lounge': return lounge(bones, g, px, pz, rotation, ground, phase, prop, grip)
    case 'push': return push(bones, g, px, pz, rotation, ground, phase, prop, grip)
    case 'climb': return climb(bones, g, px, pz, rotation, ground, phase, prop, barHeight)
    case 'crawl': return crawl(bones, g, px, pz, rotation, ground, progress, prop)
    case 'wall': return wall(bones, g, px, pz, rotation, ground, progress, prop, barHeight)
    case 'tyres': return tyres(bones, g, px, pz, rotation, ground, progress, prop)
    case 'punch': return punch(bones, g, px, pz, rotation, ground, phase, prop)
    case 'skip': return skip(bones, g, px, pz, rotation, ground, phase, prop)
    case 'jacks': return jacks(bones, g, px, pz, rotation, ground, phase, prop)
    case 'burpee': return burpee(bones, g, px, pz, rotation, ground, phase, prop)
    case 'boxjump': return boxjump(bones, g, px, pz, rotation, ground, phase, prop)
    case 'situp': return situp(bones, g, px, pz, rotation, ground, phase, prop)
    case 'plank': return plank(bones, g, px, pz, rotation, ground, phase, prop, extra)
    case 'ropes': return ropes(bones, g, px, pz, rotation, ground, phase, prop)
    case 'tyreflip': return tyreflip(bones, g, px, pz, rotation, ground, phase, prop)
    case 'hammer': return hammer(bones, g, px, pz, rotation, ground, phase, prop, extra)
    case 'hula': return hula(bones, g, px, pz, rotation, ground, phase, prop, extra)
    case 'meditate': return meditate(bones, g, px, pz, rotation, ground, phase, prop)
    case 'yoga': return yoga(bones, g, px, pz, rotation, ground, phase, prop, extra)
    case 'dance': return dance(bones, g, px, pz, rotation, ground, phase, prop, extra)
    case 'swing': return swingPose(bones, g, px, pz, rotation, ground, phase, prop, extra)
    case 'bounce': return bouncePose(bones, g, px, pz, rotation, ground, phase, prop, extra)
    case 'kickups': return kickups(bones, g, px, pz, rotation, ground, phase, prop)
    case 'shoot': return shoot(bones, g, px, pz, rotation, ground, phase, prop, extra)
    case 'kick': return kick(bones, g, px, pz, rotation, ground, phase, prop, extra)
    case 'putt': return putt(bones, g, px, pz, rotation, ground, phase, prop, extra)
    case 'dart': return dart(bones, g, px, pz, rotation, ground, phase, prop, extra)
    case 'skim': return skim(bones, g, px, pz, rotation, ground, phase, prop, extra)
    case 'fish': return fish(bones, g, px, pz, rotation, ground, phase, prop, extra)
    case 'cannon': return cannon(bones, g, px, pz, rotation, ground, phase, prop, extra)
    case 'flex': return flex(bones, g, px, pz, rotation, ground, phase, prop, extra)
    default:
      // idle / coach / run are clip-driven: the body is already placed
      return
  }
}

// ------------------------------------------------------------ pull-up
function pullup(
  bones: Bones, g: Object3D, px: number, pz: number, rotation: number, ground: number,
  phase: number, barHeight: number, prop: Proportions, grip?: Grip,
) {
  const barY = ground + barHeight
  const e = repCurve(phase, RATE.pullup!)
  // bottom: a dead hang, shoulders set, arms long but not locked
  // top: chin at the bar, the shoulder joints about a forearm below it
  const bottom = barY - prop.armLen * 0.95
  const top = barY - prop.foreArm * 1.05
  const shoulderY = bottom + (top - bottom) * e
  // the body hangs slightly behind the bar at the bottom and comes to it at the top
  _o.set(px, 0, pz).addScaledVector(F, -0.06 + 0.05 * e)
  placeStanding(g, _o.x, _o.z, shoulderY - prop.shoulderY, rotation)
  // chest up to the bar: a small lean back through the upper spine
  rotateBoneWorld(bones.spine2, L, -0.12 * e)
  rotateBoneWorld(bones.head, L, -0.18 * e)
  g.updateMatrixWorld(true)

  const half = grip?.spread ?? prop.shoulderHalf * 1.6
  _s.set(px, barY - 0.02, pz)
  for (const side of [1, -1]) {
    const upper = side > 0 ? bones.lArm : bones.rArm
    const lower = side > 0 ? bones.lFore : bones.rFore
    const hand = side > 0 ? bones.lHand : bones.rHand
    at(_s, 0, side * half, 0, _t)
    // elbows out to the side and slightly forward, driving down as he pulls
    _pole.copy(L).multiplyScalar(side).addScaledVector(F, 0.25).addScaledVector(U, -0.3 - 0.5 * e).normalize()
    twoBoneIK(upper, lower, hand, _t, _pole)
  }

  // legs: long, knees soft, ankles crossed a touch behind the body
  const hipY = g.position.y + prop.hipY
  for (const side of [1, -1]) {
    const upper = side > 0 ? bones.lUpLeg : bones.rUpLeg
    const lower = side > 0 ? bones.lLeg : bones.rLeg
    const foot = side > 0 ? bones.lFoot : bones.rFoot
    _t.set(g.position.x, hipY - prop.legLen * 0.94, g.position.z)
      .addScaledVector(L, -side * 0.03)
      .addScaledVector(F, -(0.12 + (side > 0 ? 0.05 : 0) + 0.05 * e))
    _pole.copy(F).addScaledVector(U, -0.1).normalize()
    twoBoneIK(upper, lower, foot, _t, _pole)
  }
  gripBoth(bones)
}

// ------------------------------------------------------------ push-up
function pushup(
  bones: Bones, g: Object3D, px: number, pz: number, rotation: number, ground: number,
  phase: number, prop: Proportions,
) {
  const e = repCurve(phase, RATE.pushup!)
  // A rigid line from the toes to the shoulders, pivoting on the toes: arms
  // straight at the top, chest a fist's height off the floor at the bottom.
  const bodyLen = prop.shoulderY
  const topH = prop.armLen * 0.97 + 0.04
  const bottomH = 0.2
  const h = bottomH + (topH - bottomH) * e
  // how far the body tips forward from upright
  const pitch = Math.PI / 2 - Math.asin(Math.min(0.95, h / bodyLen))
  const reach = bodyLen * Math.sin(pitch)
  // centre the body on the spot; the model's origin is at the feet
  _o.set(px, 0, pz).addScaledVector(F, -reach * 0.5)
  g.position.set(_o.x, ground + 0.05, _o.z)
  // x rotation after the yaw tips the body forward about the feet, face down
  g.rotation.set(pitch, rotation, 0, 'YXZ')
  g.updateMatrixWorld(true)
  // a neutral neck: eyes just ahead of the hands, not at the horizon
  rotateBoneWorld(bones.head, L, -0.35)

  for (const side of [1, -1]) {
    const upper = side > 0 ? bones.lArm : bones.rArm
    const lower = side > 0 ? bones.lFore : bones.rFore
    const hand = side > 0 ? bones.lHand : bones.rHand
    upper.getWorldPosition(_s)
    // hands flat on the floor just outside and under the shoulders
    _t.copy(_s).addScaledVector(L, side * 0.07).addScaledVector(F, 0.03)
    _t.y = ground + 0.05
    // elbows back along the body at about 45 degrees, not flared
    _pole.copy(F).multiplyScalar(-0.7).addScaledVector(L, side * 0.6).addScaledVector(U, 0.2).normalize()
    twoBoneIK(upper, lower, hand, _t, _pole)
  }
}

// ------------------------------------------------------------ air squat
function airSquat(
  bones: Bones, g: Object3D, px: number, pz: number, rotation: number, ground: number,
  phase: number, prop: Proportions,
) {
  const down = 1 - repCurve(phase, RATE.squat!)     // 0 standing, 1 at depth
  // hips travel down and back; the torso leans to keep the weight mid-foot
  _o.set(px, 0, pz).addScaledVector(F, -0.2 * down)
  placeStanding(g, _o.x, _o.z, ground - prop.legLen * 0.44 * down, rotation)
  leanTorso(bones, 0.62 * down)
  g.updateMatrixWorld(true)
  // feet stay planted where he started, shoulder width, knees out over toes
  _s.set(px, ground, pz)
  plantFeet(bones, _s, prop.hipHalf * 1.6, ground, 0.35)

  // arms reach forward to shoulder height as he sits down, for balance
  for (const [upper, lower, hand] of [
    [bones.lArm, bones.lFore, bones.lHand], [bones.rArm, bones.rFore, bones.rHand],
  ] as const) {
    aimBone(upper, lower, _t.copy(F).addScaledVector(U, -0.9 + 0.95 * down).normalize())
    aimBone(lower, hand, _t.copy(F).addScaledVector(U, -0.8 + 0.85 * down).normalize())
  }
}

// ------------------------------------------------------------ sitting
/**
 * Sat on a seat: the hip joints over the seat's own surface (grip.height is
 * the top of the seat above the floor), thighs forward along it, shins down
 * to feet planted on the floor, hands resting on the thighs. The chest rises
 * and falls and the head looks slowly about, so a seated body is not a
 * statue.
 */
const SEAT_TO_HIP = 0.1   // the hip joint sits this far above the seat surface
function sit(
  bones: Bones, g: Object3D, px: number, pz: number, rotation: number, ground: number,
  phase: number, prop: Proportions, grip?: Grip,
) {
  const seat = grip?.height ?? 0.45
  const hipY = ground + seat + SEAT_TO_HIP
  placeStanding(g, px, pz, hipY - prop.hipY, rotation)
  const breath = Math.sin(phase * 1.3) * 0.012
  leanTorso(bones, -0.05 + breath, 0.9)
  rotateBoneWorld(bones.head, U, Math.sin(phase * 0.23) * 0.45 + Math.sin(phase * 0.61) * 0.08)
  g.updateMatrixWorld(true)

  const thigh = prop.legLen * 0.5
  for (const side of [1, -1]) {
    const upper = side > 0 ? bones.lUpLeg : bones.rUpLeg
    const lower = side > 0 ? bones.lLeg : bones.rLeg
    const foot = side > 0 ? bones.lFoot : bones.rFoot
    // feet a little apart and just in front of the knees
    _s.set(px, 0, pz)
    at(_s, thigh + 0.08, side * prop.hipHalf * 1.25, 0, _t)
    _t.y = ground + ANKLE
    _pole.copy(F).addScaledVector(U, 0.6).addScaledVector(L, side * 0.15).normalize()
    twoBoneIK(upper, lower, foot, _t, _pole)
  }
  // hands resting on the thighs, near the knees; elbows soft at the sides
  for (const side of [1, -1]) {
    const upper = side > 0 ? bones.lArm : bones.rArm
    const lower = side > 0 ? bones.lFore : bones.rFore
    const hand = side > 0 ? bones.lHand : bones.rHand
    _s.set(px, hipY, pz)
    at(_s, thigh * 0.7, side * prop.hipHalf * 1.15, 0.1, _t)
    _pole.copy(L).multiplyScalar(side).addScaledVector(F, -0.4).addScaledVector(U, -0.3).normalize()
    twoBoneIK(upper, lower, hand, _t, _pole)
  }
}

/**
 * Stretched out on a lounger: hips on the seat, back reclined against the
 * raised backrest, legs long down the cushion, one hand on the stomach and
 * the other resting by the side.
 */
function lounge(
  bones: Bones, g: Object3D, px: number, pz: number, rotation: number, ground: number,
  phase: number, prop: Proportions, grip?: Grip,
) {
  const seat = grip?.height ?? 0.34
  const hipY = ground + seat + SEAT_TO_HIP
  placeStanding(g, px, pz, hipY - prop.hipY, rotation)
  // lie back from the hips; the breath shows in the chest
  const breath = Math.sin(phase * 1.1) * 0.015
  rotateBoneWorld(bones.hips, L, -0.95)
  rotateBoneWorld(bones.spine, L, 0.12 + breath)
  rotateBoneWorld(bones.spine2, L, 0.08)
  rotateBoneWorld(bones.head, L, 0.45)
  rotateBoneWorld(bones.head, U, Math.sin(phase * 0.2) * 0.25)
  g.updateMatrixWorld(true)
  for (const side of [1, -1]) {
    const upper = side > 0 ? bones.lUpLeg : bones.rUpLeg
    const lower = side > 0 ? bones.lLeg : bones.rLeg
    const foot = side > 0 ? bones.lFoot : bones.rFoot
    _s.set(px, 0, pz)
    at(_s, prop.legLen * 0.97, side * prop.hipHalf * (side > 0 ? 1.1 : 1.5), 0, _t)
    _t.y = ground + seat + ANKLE * 0.9 + (side > 0 ? 0 : 0.12)
    _pole.copy(U).addScaledVector(F, 0.3).normalize()
    twoBoneIK(upper, lower, foot, _t, _pole)
  }
  // left hand on the stomach, right arm resting along the side
  bones.hips.getWorldPosition(_s)
  at(_s, 0.14, 0.02, 0.2, _t)
  _pole.copy(L).addScaledVector(U, -0.2).normalize()
  twoBoneIK(bones.lArm, bones.lFore, bones.lHand, _t, _pole)
  at(_s, 0.16, -(prop.hipHalf + 0.16), 0.02, _t)
  _pole.copy(L).multiplyScalar(-1).addScaledVector(U, 0.2).normalize()
  twoBoneIK(bones.rArm, bones.rFore, bones.rHand, _t, _pole)
}

// ------------------------------------------------------------ pushing
/**
 * Driving a heavy object: the body leaning hard into it from the ankles, arms
 * locked out with both palms flat on its face at chest height, the legs doing
 * the work (the run clip under this, at the pace the object is moving).
 * grip.forward is how far ahead of the hips the face of the object is.
 */
function push(
  bones: Bones, g: Object3D, px: number, pz: number, rotation: number, ground: number,
  phase: number, prop: Proportions, grip?: Grip,
) {
  const reach = grip?.forward ?? 0.75
  // the whole body tips forward about the feet: move the hips back so the
  // feet stay under where the player is, then lean
  const lean = 0.62 + Math.sin(phase * 6) * 0.03
  placeStanding(g, px, pz, ground - 0.1, rotation)
  rotateBoneWorld(bones.hips, L, lean * 0.7)
  rotateBoneWorld(bones.spine, L, lean * 0.2)
  rotateBoneWorld(bones.head, L, -lean * 0.6)
  g.updateMatrixWorld(true)
  _s.set(px, 0, pz)
  for (const side of [1, -1]) {
    const upper = side > 0 ? bones.lArm : bones.rArm
    const lower = side > 0 ? bones.lFore : bones.rFore
    const hand = side > 0 ? bones.lHand : bones.rHand
    at(_s, reach, side * (prop.shoulderHalf + 0.05), 0, _t)
    _t.y = ground + prop.shoulderY * 0.78
    _pole.copy(L).multiplyScalar(side).addScaledVector(U, -0.6).addScaledVector(F, -0.2).normalize()
    twoBoneIK(upper, lower, hand, _t, _pole)
  }
}

// ------------------------------------------------------------ rope climb
/**
 * Hand over hand up a rope: the body hangs below the hands, one hand high
 * and one low, swapping each pull; knees drawn up with the feet clamped on
 * the rope below. barHeight is how far up the rope the hands are.
 */
function climb(
  bones: Bones, g: Object3D, px: number, pz: number, rotation: number, ground: number,
  phase: number, prop: Proportions, barHeight = 2.2,
) {
  const hands = ground + barHeight
  const swap = Math.sin(phase * Math.PI)            // -1..1: which hand is high
  const body = hands - prop.armLen * 0.72 - prop.shoulderY
  // hang just behind the rope, the rope running up the front of the body
  _o.set(px, 0, pz).addScaledVector(F, -0.16)
  placeStanding(g, _o.x, _o.z, body, rotation)
  leanTorso(bones, -0.08, 0.3)
  rotateBoneWorld(bones.head, L, -0.25)
  g.updateMatrixWorld(true)
  _s.set(px, 0, pz)
  for (const side of [1, -1]) {
    const upper = side > 0 ? bones.lArm : bones.rArm
    const lower = side > 0 ? bones.lFore : bones.rFore
    const hand = side > 0 ? bones.lHand : bones.rHand
    const high = side * swap
    at(_s, 0, side * 0.03, 0, _t)
    _t.y = hands + high * 0.22
    _pole.copy(L).multiplyScalar(side).addScaledVector(F, 0.3).addScaledVector(U, -0.4).normalize()
    twoBoneIK(upper, lower, hand, _t, _pole)
  }
  // knees up, feet pinching the rope below the body
  const hipY = g.position.y + prop.hipY
  for (const side of [1, -1]) {
    const upper = side > 0 ? bones.lUpLeg : bones.rUpLeg
    const lower = side > 0 ? bones.lLeg : bones.rLeg
    const foot = side > 0 ? bones.lFoot : bones.rFoot
    at(_s, 0.02, side * 0.05, 0, _t)
    _t.y = hipY - prop.legLen * 0.62
    _pole.copy(F).addScaledVector(U, 0.4).normalize()
    twoBoneIK(upper, lower, foot, _t, _pole)
  }
  gripBoth(bones)
}

// ------------------------------------------------------------ army crawl
/**
 * Flat on the ground under the net: body prone along the lane, forearms
 * reaching forward in turn and dragging, the opposite knee drawn up to push.
 * (px, pz) is where the hips are; `p` is metres crawled.
 */
function crawl(
  bones: Bones, g: Object3D, px: number, pz: number, rotation: number, ground: number,
  p: number, prop: Proportions,
) {
  const cyc = (p * Math.PI * 2) / 0.9            // one full cycle per 0.9 m
  // lie down: hips a hand off the dirt, the body pitched forward flat
  g.position.set(px, ground + 0.2 - prop.hipY * Math.cos(1.42), pz)
  g.rotation.set(1.42, rotation, 0, 'YXZ')
  g.updateMatrixWorld(true)
  rotateBoneWorld(bones.head, L, -0.9)            // chin up, eyes ahead
  g.updateMatrixWorld(true)
  _s.set(px, ground, pz)
  for (const side of [1, -1]) {
    const k = Math.sin(cyc + (side > 0 ? 0 : Math.PI))
    const upper = side > 0 ? bones.lArm : bones.rArm
    const lower = side > 0 ? bones.lFore : bones.rFore
    const hand = side > 0 ? bones.lHand : bones.rHand
    at(_s, prop.legLen * 0.95 + 0.25 * k, side * 0.3, 0.06 + Math.max(0, k) * 0.06, _t)
    _pole.copy(L).multiplyScalar(side).addScaledVector(U, 0.8).addScaledVector(F, -0.3).normalize()
    twoBoneIK(upper, lower, hand, _t, _pole)
    const ul = side > 0 ? bones.lUpLeg : bones.rUpLeg
    const ll = side > 0 ? bones.lLeg : bones.rLeg
    const ft = side > 0 ? bones.lFoot : bones.rFoot
    const knee = Math.max(0, -k)
    at(_s, -prop.legLen * (0.95 - knee * 0.35), side * (0.18 + knee * 0.2), 0.1, _t)
    _pole.copy(L).multiplyScalar(side).addScaledVector(U, -0.3).normalize()
    twoBoneIK(ul, ll, ft, _t, _pole)
  }
}

// ------------------------------------------------------------ over a wall
/**
 * Over a vertical wall, one move per stage of `p` (0..4): jump and catch the
 * top, pull up, swing the body over, lower down the far side. The wall face
 * is 0.55 m in front of (px, pz); barHeight is its height.
 */
const smoothK = (x: number) => { const c = Math.min(1, Math.max(0, x)); return c * c * (3 - 2 * c) }
function wall(
  bones: Bones, g: Object3D, px: number, pz: number, rotation: number, ground: number,
  p: number, prop: Proportions, H = 2.3,
) {
  const FACE = 0.55, THICK = 0.2
  const top = ground + H
  // hips (forward of the spot, height), body pitch, per stage
  const keys: [number, number, number][] = [
    [0, prop.hipY, 0],
    [FACE - 0.32, H - prop.armLen * 0.9 - (prop.shoulderY - prop.hipY), 0.05],
    [FACE - 0.22, H - 0.25, 0.35],
    [FACE + THICK / 2, H + 0.25, 1.2],
    [FACE + THICK + 0.55, prop.hipY, 0],
  ]
  const i = Math.min(3, Math.floor(p))
  const k = smoothK(p - i)
  const a = keys[i], b = keys[i + 1]
  const f = a[0] + (b[0] - a[0]) * k
  const hy = a[1] + (b[1] - a[1]) * k
  const pitch = a[2] + (b[2] - a[2]) * k
  const hands = i === 0 ? smoothK((p - 0.3) / 0.6) : i === 3 ? 1 - smoothK((p - 3.1) / 0.6) : 1
  _o.set(px, 0, pz).addScaledVector(F, f)
  g.position.set(_o.x, ground + hy - prop.hipY, _o.z)
  g.rotation.set(pitch, rotation, 0, 'YXZ')
  g.updateMatrixWorld(true)
  _s.set(px, 0, pz).addScaledVector(F, FACE + THICK / 2)
  if (hands > 0.01) {
    for (const side of [1, -1]) {
      const upper = side > 0 ? bones.lArm : bones.rArm
      const lower = side > 0 ? bones.lFore : bones.rFore
      const hand = side > 0 ? bones.lHand : bones.rHand
      hand.getWorldPosition(_a)
      at(_s, 0, side * (prop.shoulderHalf + 0.08), 0, _t)
      _t.y = top + 0.02
      _t.lerpVectors(_a, _t, hands)
      _pole.copy(L).multiplyScalar(side).addScaledVector(U, -0.5).addScaledVector(F, -0.3).normalize()
      twoBoneIK(upper, lower, hand, _t, _pole)
    }
    gripBoth(bones, hands)
  }
  // feet: walking up the face while pulling, tucked going over
  for (const side of [1, -1]) {
    const upper = side > 0 ? bones.lUpLeg : bones.rUpLeg
    const lower = side > 0 ? bones.lLeg : bones.rLeg
    const foot = side > 0 ? bones.lFoot : bones.rFoot
    if (i === 1 || (i === 2 && k < 0.6)) {
      _o.set(px, 0, pz).addScaledVector(F, FACE - 0.08).addScaledVector(L, side * 0.15)
      _t.set(_o.x, Math.max(ground + ANKLE, g.position.y + prop.hipY - prop.legLen * 0.6), _o.z)
      _pole.copy(F).addScaledVector(U, 0.3).normalize()
      twoBoneIK(upper, lower, foot, _t, _pole)
    } else if (i === 2 || i === 3) {
      _o.set(g.position.x, 0, g.position.z).addScaledVector(F, side > 0 ? 0.2 : -0.1).addScaledVector(L, side * 0.15)
      _t.set(_o.x, g.position.y + prop.hipY - prop.legLen * 0.45, _o.z)
      _pole.copy(F).addScaledVector(U, 0.5).normalize()
      twoBoneIK(upper, lower, foot, _t, _pole)
    }
  }
}

// ------------------------------------------------------------ tyre run
/**
 * High knees through two rows of tyres: each foot lands in the middle of the
 * next tyre on its own side, knee driven high between them. `p` is metres
 * along the lane from (px, pz); tyres are 0.6 m apart, alternating sides.
 */
function tyres(
  bones: Bones, g: Object3D, px: number, pz: number, rotation: number, ground: number,
  p: number, prop: Proportions,
) {
  const STEP = 0.6
  const bob = Math.abs(Math.sin((p / STEP) * Math.PI)) * 0.06
  _o.set(px, 0, pz).addScaledVector(F, p)
  placeStanding(g, _o.x, _o.z, ground + bob - 0.04, rotation)
  leanTorso(bones, 0.18, 0.6)
  g.updateMatrixWorld(true)
  _s.set(px, ground, pz)
  for (const side of [1, -1]) {
    // left foot uses the even tyres, right the odd ones
    const off = side > 0 ? 0 : STEP
    const cycle = (p + off) / (STEP * 2)
    const n = Math.floor(cycle)
    const u = cycle - n
    const flying = u < 0.5
    const from = n * STEP * 2 - off, to = from + STEP * 2
    const k = flying ? smoothK(u / 0.5) : 1
    const along = from + (to - from) * k
    const upper = side > 0 ? bones.lUpLeg : bones.rUpLeg
    const lower = side > 0 ? bones.lLeg : bones.rLeg
    const foot = side > 0 ? bones.lFoot : bones.rFoot
    at(_s, Math.max(-0.2, along), side * 0.28, 0, _t)
    _t.y = ground + ANKLE + 0.02 + (flying ? Math.sin((u / 0.5) * Math.PI) * 0.45 : 0)
    _pole.copy(F).addScaledVector(U, 0.4).addScaledVector(L, side * 0.1).normalize()
    twoBoneIK(upper, lower, foot, _t, _pole)
  }
  void prop
}


// ================================================================ fun park
/**
 * The fun park's moves. Same method as the lifts: the body is placed, the
 * torso is bent through the spine, and hands and feet are put exactly where
 * the move needs them with two-bone IK, so a fist meets the bag, a foot lands
 * in the box, a hand holds the rope. `x` carries the live state of the move
 * for the ones driven by a meter or by their own physics.
 */
export type FunExtra = { charge?: number; action?: number; belt?: number; custom?: number; custom2?: number; credits?: number }

type LimbSet = [Object3D, Object3D, Object3D]
const armOf = (b: Bones, side: number): LimbSet => side > 0 ? [b.lArm, b.lFore, b.lHand] : [b.rArm, b.rFore, b.rHand]
const legOf = (b: Bones, side: number): LimbSet => side > 0 ? [b.lUpLeg, b.lLeg, b.lFoot] : [b.rUpLeg, b.rLeg, b.rFoot]
const _f1 = new Vector3()
const _f2 = new Vector3()

/** Put a hand at (f, l, u) from `base`, elbow towards the given pole. */
function handAt(b: Bones, side: number, base: Vector3, f: number, l: number, u: number, pf: number, pl: number, pu: number) {
  const [a, c, h] = armOf(b, side)
  at(base, f, l, u, _f1)
  _pole.copy(F).multiplyScalar(pf).addScaledVector(L, pl * side).addScaledVector(U, pu).normalize()
  twoBoneIK(a, c, h, _f1, _pole)
}
/** Put a foot at (f, l, u) from `base`, knee towards the given pole. */
function footAt(b: Bones, side: number, base: Vector3, f: number, l: number, u: number, pf = 1, pl = 0.1, pu = 0.1) {
  const [a, c, h] = legOf(b, side)
  at(base, f, l, u, _f1)
  _pole.copy(F).multiplyScalar(pf).addScaledVector(L, pl * side).addScaledVector(U, pu).normalize()
  twoBoneIK(a, c, h, _f1, _pole)
}
/** Aim an arm (both joints) along a world direction. */
function armDir(b: Bones, side: number, dir: Vector3, bend = 0) {
  const [a, c, h] = armOf(b, side)
  aimBone(a, c, dir)
  if (bend) rotateBoneWorld(c, L, -bend)
  void h
}
/** Place the body so its hip joint is at `hip`, pitched forward by `pitch`. */
function placeHip(g: Object3D, prop: Proportions, hip: Vector3, rotation: number, pitch: number) {
  g.rotation.set(pitch, rotation, 0, 'YXZ')
  g.position.set(
    hip.x - F.x * Math.sin(pitch) * prop.hipY,
    hip.y - Math.cos(pitch) * prop.hipY,
    hip.z - F.z * Math.sin(pitch) * prop.hipY,
  )
  g.updateMatrixWorld(true)
}
const fr = (x: number) => x - Math.floor(x)
const sm = (a: number, b: number, t: number) => { const k = Math.min(1, Math.max(0, (t - a) / (b - a))); return k * k * (3 - 2 * k) }
const lerpN = (a: number, b: number, t: number) => a + (b - a) * t

// ---------------------------------------------------------------- boxing
function punch(bones: Bones, g: Object3D, px: number, pz: number, rot: number, ground: number, phase: number, prop: Proportions) {
  const cyc = (phase * RATE.punch!) / (Math.PI * 2)
  const n = Math.floor(cyc), t = fr(cyc)
  const side = n % 2 === 0 ? 1 : -1                 // jab (lead, left), then cross
  const ext = t < 0.35 ? sm(0, 0.35, t) : 1 - sm(0.35, 1, t)
  const bob = Math.sin(phase * 2.1) * 0.02
  placeStanding(g, px, pz, ground - 0.07 + bob, rot)
  // the torso turns into the punch, the chin tucked behind the lead shoulder
  rotateBoneWorld(bones.spine, U, -side * 0.35 * ext + 0.15)
  rotateBoneWorld(bones.spine2, L, 0.08)
  g.updateMatrixWorld(true)
  _s.set(px, ground, pz)
  footAt(bones, 1, _s, 0.18, 0.16, ANKLE, 1, 0.3)
  footAt(bones, -1, _s, -0.22, -0.16, ANKLE, 1, 0.3)
  const sh = ground + prop.shoulderY - 0.1 + bob
  for (const s of [1, -1]) {
    const punching = s === side ? ext : 0
    // guard at the chin; the punch goes out straight to the bag at shoulder height
    _o.set(px, sh, pz)
    handAt(bones, s, _o, lerpN(0.22, prop.armLen * 0.97, punching), s * lerpN(0.12, 0.02, punching), lerpN(0.12, 0.02, punching),
      -0.2, 1, -0.6)
  }
  gripBoth(bones)
}

// ---------------------------------------------------------------- skipping
function skip(bones: Bones, g: Object3D, px: number, pz: number, rot: number, ground: number, phase: number, prop: Proportions) {
  const cyc = (phase * RATE.skip!) / (Math.PI * 2)
  const t = fr(cyc)
  const hop = Math.max(0, Math.sin(t * Math.PI * 2)) * 0.11
  placeStanding(g, px, pz, ground + hop - 0.02, rot)
  rotateBoneWorld(bones.spine, L, 0.06)
  g.updateMatrixWorld(true)
  _s.set(px, ground + hop, pz)
  // feet together, toes pointed a touch in the air
  footAt(bones, 1, _s, 0.02, 0.08, ANKLE + 0.02, 1, 0.1, 0.2)
  footAt(bones, -1, _s, 0.02, -0.08, ANKLE + 0.02, 1, 0.1, 0.2)
  // hands low and out, wrists turning small circles
  const a = t * Math.PI * 2
  _o.set(px, ground + hop + prop.hipY, pz)
  for (const s of [1, -1]) handAt(bones, s, _o, 0.12 + Math.cos(a) * 0.05, s * 0.3, 0.02 + Math.sin(a) * 0.05, -0.5, 1, -0.3)
  gripBoth(bones)
}

// ---------------------------------------------------------------- jumping jacks
function jacks(bones: Bones, g: Object3D, px: number, pz: number, rot: number, ground: number, phase: number, _prop: Proportions) {
  const cyc = (phase * RATE.jacks!) / (Math.PI * 2)
  const k = 0.5 - 0.5 * Math.cos(fr(cyc) * Math.PI * 2)
  const hop = Math.abs(Math.sin(fr(cyc) * Math.PI * 2)) * 0.07
  placeStanding(g, px, pz, ground + hop - 0.03, rot)
  g.updateMatrixWorld(true)
  _s.set(px, ground + hop, pz)
  footAt(bones, 1, _s, 0, lerpN(0.1, 0.42, k), ANKLE, 1, 0.4)
  footAt(bones, -1, _s, 0, -lerpN(0.1, 0.42, k), ANKLE, 1, 0.4)
  const ang = lerpN(0.12, Math.PI - 0.15, k)
  for (const s of [1, -1]) {
    _f2.copy(U).multiplyScalar(-Math.cos(ang)).addScaledVector(L, s * Math.sin(ang)).addScaledVector(F, 0.08).normalize()
    armDir(bones, s, _f2, 0.15)
  }
}

// ---------------------------------------------------------------- burpee
/** Stand, drop, kick back to a plank, push up, feet in, jump. */
function burpee(bones: Bones, g: Object3D, px: number, pz: number, rot: number, ground: number, phase: number, prop: Proportions) {
  const t = fr((phase * RATE.burpee!) / (Math.PI * 2))
  // key poses: [hip forward, hip height, body pitch, hands on floor, arms up, feet back]
  type K = [number, number, number, number, number, number]
  const stand: K = [0, prop.hipY, 0, 0, 0, 0]
  const squat: K = [-0.12, prop.hipY * 0.45, 0.75, 1, 0, 0]
  const plank: K = [-0.1, 0.42, 1.28, 1, 0, 1]
  const down: K = [-0.1, 0.24, 1.42, 1, 0, 1]
  const jump: K = [0, prop.hipY + 0.28, -0.05, 0, 1, 0]
  const keys: [number, K][] = [[0, stand], [0.14, squat], [0.26, plank], [0.36, down], [0.46, plank], [0.58, squat], [0.72, jump], [0.86, stand], [1, stand]]
  let i = 0
  while (i < keys.length - 2 && t > keys[i + 1][0]) i++
  const [ta, a] = keys[i], [tb, b] = keys[i + 1]
  const k = sm(ta, tb, t)
  const v = a.map((x, j) => lerpN(x, b[j], k)) as K
  _o.set(px, 0, pz).addScaledVector(F, v[0])
  _o.y = ground + v[1]
  placeHip(g, prop, _o, rot, v[2])
  rotateBoneWorld(bones.head, L, -v[2] * 0.6)
  g.updateMatrixWorld(true)
  _s.set(px, ground, pz)
  // feet: under him, or back on the toes for the plank; in the air on the jump
  const air = Math.max(0, v[1] - prop.hipY) * 0.9
  for (const s of [1, -1]) footAt(bones, s, _s, lerpN(0, -prop.legLen * 1.05, v[5]), s * 0.14, ANKLE + air + v[5] * 0.03, 1, 0.1, lerpN(0.1, -0.8, v[5]))
  for (const s of [1, -1]) {
    if (v[3] > 0.02) {
      // hands flat on the floor under the shoulders
      g.updateMatrixWorld(true)
      ;(s > 0 ? bones.lArm : bones.rArm).getWorldPosition(_f2)
      const fx = (_f2.x - px) * F.x + (_f2.z - pz) * F.z
      handAt(bones, s, _s, Math.max(0.25, fx), s * (prop.shoulderHalf + 0.05), 0.05, -0.3, 0.8, 0.2)
    } else {
      _f2.copy(U).multiplyScalar(lerpN(-1, 1, v[4])).addScaledVector(L, s * lerpN(0.15, 0.25, v[4])).normalize()
      armDir(bones, s, _f2, 0.1)
    }
  }
}

// ---------------------------------------------------------------- box jump
const BOX_H = 0.55, BOX_F = 0.7
function boxjump(bones: Bones, g: Object3D, px: number, pz: number, rot: number, ground: number, phase: number, prop: Proportions) {
  const t = fr((phase * RATE.boxjump!) / (Math.PI * 2))
  // dip, fly, land on the box, stand tall, step back down
  const dip = sm(0, 0.18, t) * (1 - sm(0.18, 0.3, t))
  const fly = sm(0.2, 0.42, t)
  const back = sm(0.72, 0.95, t)
  const onBox = fly * (1 - back)
  const f = lerpN(0, BOX_F, onBox)
  const floor = ground + BOX_H * onBox
  const arc = Math.sin(Math.PI * sm(0.2, 0.42, t)) * 0.35 * (1 - back)
  const land = Math.max(0, 1 - Math.abs(t - 0.46) / 0.1) * 0.22
  const hipY = floor + prop.hipY - dip * 0.28 - land + arc
  _o.set(px, 0, pz).addScaledVector(F, f)
  _o.y = hipY
  placeHip(g, prop, _o, rot, dip * 0.45 + land * 1.2)
  g.updateMatrixWorld(true)
  _s.set(px, 0, pz).addScaledVector(F, f)
  const tuck = arc > 0.05 ? Math.min(1, arc * 3) : 0
  for (const s of [1, -1]) {
    const fy = tuck > 0 ? hipY - prop.legLen * (0.95 - tuck * 0.4) : floor + ANKLE
    footAt(bones, s, _s, 0.04 + tuck * 0.1, s * 0.15, fy - _s.y, 1, 0.2, 0.3)
  }
  // arms swing back in the dip and up through the jump
  const swing = lerpN(-0.7, 1.1, sm(0.12, 0.35, t)) * (1 - sm(0.5, 0.7, t))
  for (const s of [1, -1]) {
    _f2.copy(U).multiplyScalar(-Math.cos(swing)).addScaledVector(F, Math.sin(swing)).addScaledVector(L, s * 0.15).normalize()
    armDir(bones, s, _f2, 0.25)
  }
}

// ---------------------------------------------------------------- sit-ups
function situp(bones: Bones, g: Object3D, px: number, pz: number, rot: number, ground: number, phase: number, prop: Proportions) {
  const e = repCurve(phase, RATE.situp!)
  // lying back, head away from +F; he curls up to about 60 degrees
  const pitch = lerpN(-1.5, -0.45, e)
  _o.set(px, ground + 0.11, pz)
  placeHip(g, prop, _o, rot, pitch)
  rotateBoneWorld(bones.spine2, L, 0.2 * e)
  rotateBoneWorld(bones.head, L, 0.35)
  g.updateMatrixWorld(true)
  _s.set(px, ground, pz)
  // knees up, feet flat on the mat
  for (const s of [1, -1]) footAt(bones, s, _s, prop.legLen * 0.62, s * 0.14, ANKLE, 0.4, 0.1, 1)
  // hands crossed on the chest
  bones.spine2.getWorldPosition(_f2)
  for (const s of [1, -1]) {
    const [a, c, h] = armOf(bones, s)
    _f1.copy(_f2).addScaledVector(L, -s * 0.1).addScaledVector(U, 0.05)
    // the chest faces up-and-forward as he curls: nudge the hands off it
    _f1.addScaledVector(F, 0.06 + 0.1 * e)
    _pole.copy(L).multiplyScalar(s).addScaledVector(U, -0.3).normalize()
    twoBoneIK(a, c, h, _f1, _pole)
  }
}

// ---------------------------------------------------------------- plank
function plank(bones: Bones, g: Object3D, px: number, pz: number, rot: number, ground: number, phase: number, prop: Proportions, x?: FunExtra) {
  const hold = x?.belt ?? 1
  const shake = Math.sin(phase * 31) * 0.004 * hold
  // on the forearms, the body a straight line from heels to head; let go and
  // the knees drop to the mat
  const pitch = lerpN(1.25, 1.39, hold)
  _o.set(px, ground + lerpN(0.34, 0.42, hold) + shake, pz).addScaledVector(F, -0.15)
  placeHip(g, prop, _o, rot, pitch)
  rotateBoneWorld(bones.head, L, -0.9)
  g.updateMatrixWorld(true)
  _s.set(px, ground, pz)
  for (const s of [1, -1]) {
    const knees = 1 - hold
    footAt(bones, s, _s, -prop.legLen * lerpN(1.05, 0.8, knees), s * 0.12, lerpN(ANKLE + 0.03, 0.08, knees), 1, 0, -0.6)
  }
  // forearms flat, elbows under the shoulders
  for (const s of [1, -1]) {
    ;(s > 0 ? bones.lArm : bones.rArm).getWorldPosition(_f2)
    const fx = (_f2.x - px) * F.x + (_f2.z - pz) * F.z
    handAt(bones, s, _s, fx + 0.32, s * 0.12, 0.05, 0.2, 0.3, -1)
  }
}

// ---------------------------------------------------------------- battle ropes
function ropes(bones: Bones, g: Object3D, px: number, pz: number, rot: number, ground: number, phase: number, prop: Proportions) {
  const a = phase * RATE.ropes!
  placeStanding(g, px, pz, ground - 0.22, rot)
  leanTorso(bones, 0.35, 0.8)
  g.updateMatrixWorld(true)
  _s.set(px, ground, pz)
  footAt(bones, 1, _s, 0.05, 0.28, ANKLE, 1, 0.5)
  footAt(bones, -1, _s, -0.05, -0.28, ANKLE, 1, 0.5)
  _o.set(px, ground + prop.hipY * 0.95, pz)
  for (const s of [1, -1]) {
    const w = Math.sin(a + (s > 0 ? 0 : Math.PI))
    handAt(bones, s, _o, 0.45, s * 0.22, 0.05 + w * 0.22, -0.3, 1, -0.5)
  }
  gripBoth(bones)
}

// ---------------------------------------------------------------- tyre flip
/** Squat, grip under the tyre, drive it up, push it over, walk to it. */
export const TYRE_FLIP_STEP = 1.55
function tyreflip(bones: Bones, g: Object3D, px: number, pz: number, rot: number, ground: number, phase: number, prop: Proportions) {
  const t = fr((phase * RATE.tyreflip!) / (Math.PI * 2))
  const down = sm(0, 0.2, t) * (1 - sm(0.28, 0.5, t))
  const drive = sm(0.28, 0.5, t)
  const push = sm(0.5, 0.66, t) * (1 - sm(0.7, 0.8, t))
  const walk = sm(0.78, 1, t)
  const f = walk * TYRE_FLIP_STEP
  const hipY = ground + prop.hipY - down * 0.5 + drive * 0.05
  _o.set(px, 0, pz).addScaledVector(F, f + push * 0.25)
  _o.y = hipY
  placeHip(g, prop, _o, rot, down * 0.75 + push * 0.25)
  rotateBoneWorld(bones.head, L, -down * 0.5)
  g.updateMatrixWorld(true)
  _s.set(px, ground, pz).addScaledVector(F, f)
  const stride = Math.sin(walk * Math.PI * 3) * 0.2 * (walk > 0 && walk < 1 ? 1 : 0)
  footAt(bones, 1, _s, 0.05 + stride + push * 0.3, 0.2, ANKLE, 1, 0.4)
  footAt(bones, -1, _s, -0.1 - stride, -0.2, ANKLE, 1, 0.4)
  // hands: under the near edge, up with it to the hips, then out pushing it over
  for (const s of [1, -1]) {
    const hy = lerpN(0.12, prop.hipY + 0.05, drive) + push * 0.35
    const hf = lerpN(0.42, 0.5, drive) + push * 0.3
    if (walk > 0.05) {
      _f2.copy(U).multiplyScalar(-1).addScaledVector(L, s * 0.15).normalize()
      armDir(bones, s, _f2, 0.2)
    } else {
      _o.set(px, ground, pz).addScaledVector(F, f)
      handAt(bones, s, _o, hf, s * 0.3, hy, -0.5, 1, -0.4)
    }
  }
  gripBoth(bones, walk > 0.05 ? 0 : 1)
}

// ---------------------------------------------------------------- sledgehammer
/** Hands on the handle; overhead, then down onto the tyre in front. */
export function hammerHands(t: number, prop: Proportions) {
  // the lead hand's height (above the hips) and reach over the swing
  const up = t < 0.45 ? sm(0, 0.45, t) : t < 0.6 ? 1 - sm(0.45, 0.6, t) : 0
  return { u: lerpN(-0.1, prop.shoulderY - prop.hipY + 0.55, up), f: lerpN(0.45, 0.05, up) }
}
function hammer(bones: Bones, g: Object3D, px: number, pz: number, rot: number, ground: number, phase: number, prop: Proportions, x?: FunExtra) {
  // driven by a power meter (high striker) or by reps (tyre)
  const t = x?.action !== undefined && x.action >= 0 ? x.action : fr((phase * RATE.hammer!) / (Math.PI * 2))
  const h = hammerHands(t, prop)
  const strike = t > 0.45 && t < 0.62 ? 1 : 0
  placeStanding(g, px, pz, ground - 0.1 - strike * 0.12, rot)
  leanTorso(bones, lerpN(-0.15, 0.55, 1 - Math.min(1, (h.u + 0.1) / (prop.shoulderY - prop.hipY + 0.65))), 0.6)
  g.updateMatrixWorld(true)
  _s.set(px, ground, pz)
  footAt(bones, 1, _s, 0.1, 0.3, ANKLE, 1, 0.4)
  footAt(bones, -1, _s, -0.1, -0.3, ANKLE, 1, 0.4)
  _o.set(px, ground + prop.hipY, pz)
  // lead (right) hand high on the handle, left at the end
  handAt(bones, -1, _o, h.f + 0.05, -0.02, h.u + 0.06, -0.5, 1, -0.4)
  handAt(bones, 1, _o, h.f - 0.05, 0.03, h.u - 0.12, -0.5, 1, -0.4)
  gripBoth(bones)
}

// ---------------------------------------------------------------- hula hoop
function hula(bones: Bones, g: Object3D, px: number, pz: number, rot: number, ground: number, phase: number, _prop: Proportions, x?: FunExtra) {
  const go = x?.belt ?? 1
  const a = phase * RATE.hula!
  // hips circle; the shoulders stay quiet over them
  const r = 0.045 * go
  _o.set(px, 0, pz).addScaledVector(F, Math.cos(a) * r).addScaledVector(L, Math.sin(a) * r)
  placeStanding(g, _o.x, _o.z, ground - 0.03, rot)
  rotateBoneWorld(bones.spine, F, Math.sin(a) * 0.08 * go)
  rotateBoneWorld(bones.spine, L, -Math.cos(a) * 0.06 * go)
  g.updateMatrixWorld(true)
  _s.set(px, ground, pz)
  footAt(bones, 1, _s, 0.08, 0.17, ANKLE, 1, 0.3)
  footAt(bones, -1, _s, -0.08, -0.17, ANKLE, 1, 0.3)
  // arms up, hands behind the head: out of the hoop's way
  bones.head.getWorldPosition(_f2)
  for (const s of [1, -1]) {
    const [a1, c, h] = armOf(bones, s)
    _f1.copy(_f2).addScaledVector(L, s * 0.12).addScaledVector(F, -0.08).addScaledVector(U, 0.05)
    _pole.copy(L).multiplyScalar(s).addScaledVector(U, 0.6).normalize()
    twoBoneIK(a1, c, h, _f1, _pole)
  }
}

// ---------------------------------------------------------------- meditation
function meditate(bones: Bones, g: Object3D, px: number, pz: number, rot: number, ground: number, phase: number, prop: Proportions) {
  const breath = Math.sin(phase * 0.9)
  // sat cross-legged: hips on a cushion just off the ground
  _o.set(px, ground + 0.16, pz)
  placeHip(g, prop, _o, rot, 0)
  rotateBoneWorld(bones.spine2, L, -0.03 + breath * 0.025)
  rotateBoneWorld(bones.head, L, 0.18)
  g.updateMatrixWorld(true)
  _s.set(px, ground, pz)
  // each foot tucked under the opposite knee, knees wide and low
  for (const s of [1, -1]) footAt(bones, s, _s, 0.28, -s * 0.16, 0.08, 0.5, 1.4, 0.2)
  // hands resting palm up on the knees
  for (const s of [1, -1]) handAt(bones, s, _s, 0.34, s * 0.3, 0.22, -0.2, 1, -0.3)
}

// ---------------------------------------------------------------- yoga
/** Four held poses, blended from one to the next: mountain, tree, warrior II, downward dog. */
function yoga(bones: Bones, g: Object3D, px: number, pz: number, rot: number, ground: number, phase: number, prop: Proportions, x?: FunExtra) {
  const p = x?.custom ?? 0
  const i = Math.floor(p) % 4, k = sm(0, 1, p - Math.floor(p))
  const breath = Math.sin(phase * 0.8) * 0.01
  const pose = (n: number) => {
    // [hip f, hip y, pitch, feet: lf,ll,lu, rf,rl,ru, arm dirs L(u,l,f) R(u,l,f)]
    switch (n) {
      case 0: return [0, prop.hipY, 0, 0, 0.12, ANKLE, 0, -0.12, ANKLE, 1, 0.1, 0, 1, 0.1, 0]
      case 1: return [0, prop.hipY, 0, 0, 0.08, ANKLE, 0.05, -0.02, prop.hipY * 0.62, 1, 0.08, 0.05, 1, 0.08, 0.05]
      case 2: return [0, prop.hipY - 0.2, 0, 0.55, 0.05, ANKLE, -0.5, -0.05, ANKLE, 0, 1, 0, 0, 1, 0]
      default: return [-0.45, prop.hipY + 0.25, 1.9, -0.55, 0.14, ANKLE, -0.55, -0.14, ANKLE, 0, 0.12, 1, 0, 0.12, 1]
    }
  }
  const A = pose(i), B = pose((i + 1) % 4)
  const v = A.map((a, j) => lerpN(a, B[j], k))
  // warrior II faces side-on: the stance runs along F, so turn the body a quarter
  const turn = (i === 2 ? 1 - k : 0) + (i === 1 ? k : 0)
  _o.set(px, 0, pz).addScaledVector(F, v[0])
  _o.y = ground + v[1] + breath
  placeHip(g, prop, _o, rot + turn * 0.9, v[2])
  g.updateMatrixWorld(true)
  _s.set(px, ground, pz)
  footAt(bones, 1, _s, v[3], v[4], v[5] - (v[5] > 0.3 ? 0 : 0), 1, 0.3 + (i === 1 ? 1.5 : 0) * (1 - k), 0.2)
  footAt(bones, -1, _s, v[6], v[7], v[8], 1, i === 1 || (i === 0 && k > 0) ? 2 : 0.3, 0.2)
  for (const s of [1, -1]) {
    const o = s > 0 ? 9 : 12
    _f2.copy(U).multiplyScalar(v[o]).addScaledVector(L, s * v[o + 1]).addScaledVector(F, v[o + 2] * (s > 0 ? 1 : 1)).normalize()
    if (i === 3 || (i === 2 && k > 0.5)) {
      // hands flat on the floor for the dog
      handAt(bones, s, _s, 0.35, s * 0.28, 0.04, 0.3, 1, 0.4)
    } else armDir(bones, s, _f2, 0)
  }
}

// ---------------------------------------------------------------- dance
function dance(bones: Bones, g: Object3D, px: number, pz: number, rot: number, ground: number, phase: number, prop: Proportions, x?: FunExtra) {
  const beat = (phase * RATE.dance!) / (Math.PI * 2)
  const t = fr(beat), n = Math.floor(beat)
  const move = Math.floor(n / 8 + (x?.credits ?? 0)) % 4
  const bounce = Math.abs(Math.sin(t * Math.PI)) * 0.06
  const side = n % 2 ? 1 : -1
  const step = 0.18 * Math.sin(beat * Math.PI)
  _o.set(px, 0, pz).addScaledVector(L, step)
  placeStanding(g, _o.x, _o.z, ground - 0.06 + bounce, rot + Math.sin(beat * Math.PI * 0.5) * 0.25)
  rotateBoneWorld(bones.hips, F, side * 0.08)
  rotateBoneWorld(bones.spine2, F, -side * 0.06)
  rotateBoneWorld(bones.head, F, side * 0.08)
  g.updateMatrixWorld(true)
  _s.set(_o.x, ground, _o.z)
  footAt(bones, 1, _s, 0, 0.16 + (side > 0 ? 0.08 : 0), ANKLE + (side > 0 ? bounce * 0.6 : 0), 1, 0.4)
  footAt(bones, -1, _s, 0, -0.16 - (side < 0 ? 0.08 : 0), ANKLE + (side < 0 ? bounce * 0.6 : 0), 1, 0.4)
  _o.set(_o.x, ground + prop.shoulderY, _o.z)
  for (const s of [1, -1]) {
    const on = s === side ? 1 : 0
    switch (move) {
      case 0: // point to the sky, then down across
        _f2.copy(U).multiplyScalar(on ? 0.9 : -0.6).addScaledVector(L, s * 0.5).addScaledVector(F, 0.3).normalize(); armDir(bones, s, _f2, on ? 0 : 0.8); break
      case 1: // arms rolling in front of the chest
        handAt(bones, s, _o, 0.3 + Math.cos(beat * Math.PI * 2 + s) * 0.08, s * 0.1, -0.2 + Math.sin(beat * Math.PI * 2 + s) * 0.08, -0.3, 1, -0.3); break
      case 2: // hands up, waving side to side
        _f2.copy(U).addScaledVector(L, s * 0.3 + Math.sin(beat * Math.PI) * 0.4).normalize(); armDir(bones, s, _f2, 0.3); break
      default: // the robot
        handAt(bones, s, _o, 0.25, s * 0.3, on ? 0.05 : -0.25, 0, 1, -0.8); break
    }
  }
}

// ---------------------------------------------------------------- swing
/** Sat on a playground swing: `custom` is the swing angle; he pumps his legs. */
export const SWING_LEN = 2.1
function swingPose(bones: Bones, g: Object3D, px: number, pz: number, rot: number, ground: number, _phase: number, prop: Proportions, x?: FunExtra) {
  const th = x?.custom ?? 0
  const top = ground + SWING_LEN + 0.45
  // the seat on its arc (px, pz is under the beam)
  const sf = Math.sin(th) * SWING_LEN, sy = top - Math.cos(th) * SWING_LEN
  _o.set(px, 0, pz).addScaledVector(F, sf)
  _o.y = sy + 0.1
  placeHip(g, prop, _o, rot, -th * 0.85)
  rotateBoneWorld(bones.spine, L, -th * 0.3)
  g.updateMatrixWorld(true)
  // legs out going forward, tucked under going back
  const pump = Math.max(-1, Math.min(1, th * 2.2))
  for (const s of [1, -1]) {
    const [a, c, h] = legOf(bones, s)
    _f1.set(px, 0, pz).addScaledVector(F, sf + lerpN(0.1, 0.75, (pump + 1) / 2)).addScaledVector(L, s * 0.12)
    _f1.y = sy + lerpN(-0.55, -0.12, (pump + 1) / 2)
    _pole.copy(F).addScaledVector(U, 0.5).normalize()
    twoBoneIK(a, c, h, _f1, _pole)
  }
  // hands on the chains, at head height
  for (const s of [1, -1]) {
    const [a, c, h] = armOf(bones, s)
    _f1.set(px, 0, pz).addScaledVector(F, Math.sin(th) * (SWING_LEN - 0.75)).addScaledVector(L, s * 0.24)
    _f1.y = top - Math.cos(th) * (SWING_LEN - 0.75)
    _pole.copy(L).multiplyScalar(s).addScaledVector(U, -0.5).normalize()
    twoBoneIK(a, c, h, _f1, _pole)
  }
  gripBoth(bones)
}

// ---------------------------------------------------------------- trampoline
/** `custom` is his height above the bed; `custom2` the flip angle. */
function bouncePose(bones: Bones, g: Object3D, px: number, pz: number, rot: number, ground: number, _phase: number, prop: Proportions, x?: FunExtra) {
  const h = x?.custom ?? 0, flip = x?.custom2 ?? 0
  const squash = h < 0.08 ? (0.08 - h) * 2.5 : 0
  _o.set(px, ground + prop.hipY + h - squash, pz)
  placeHip(g, prop, _o, rot, -flip)
  g.updateMatrixWorld(true)
  const tuck = Math.sin(Math.min(Math.PI, Math.abs(flip))) * 0.8
  _s.set(px, ground + h, pz)
  for (const s of [1, -1]) {
    const [a, c, f] = legOf(bones, s)
    // legs straight in the air, knees to the chest in a flip
    _f1.copy(_o).addScaledVector(U, -prop.legLen * (0.98 - tuck * 0.55)).addScaledVector(L, s * 0.12).addScaledVector(F, tuck * 0.2)
    if (flip) _f1.sub(_o).applyAxisAngle(L, -flip).add(_o)
    _pole.copy(F).addScaledVector(U, 0.2).normalize()
    twoBoneIK(a, c, f, _f1, _pole)
    // arms up at the top, out for balance on the bed
    const up = Math.min(1, h / 0.8)
    _f2.copy(U).multiplyScalar(lerpN(-0.3, 1, up)).addScaledVector(L, s * lerpN(0.8, 0.25, up)).normalize()
    if (flip) _f2.applyAxisAngle(L, -flip)
    armDir(bones, s, _f2, tuck * 0.6)
  }
}

// ---------------------------------------------------------------- keepy-uppy
/** Ball bouncing off alternate feet; returns where the ball is for the prop. */
export function kickupsBall(phase: number): { h: number; side: number } {
  const cyc = (phase * RATE.kickups!) / (Math.PI * 2)
  const t = fr(cyc)
  return { h: 0.45 + Math.sin(t * Math.PI) * 0.75, side: Math.floor(cyc) % 2 ? 1 : -1 }
}
function kickups(bones: Bones, g: Object3D, px: number, pz: number, rot: number, ground: number, phase: number, _prop: Proportions) {
  const cyc = (phase * RATE.kickups!) / (Math.PI * 2)
  const t = fr(cyc), side = Math.floor(cyc) % 2 ? 1 : -1
  placeStanding(g, px, pz, ground - 0.04, rot)
  leanTorso(bones, 0.1, 0.9)
  rotateBoneWorld(bones.head, L, 0.3)                // eyes on the ball
  g.updateMatrixWorld(true)
  _s.set(px, ground, pz)
  for (const s of [1, -1]) {
    // the kicking foot comes up to meet the ball at the start and end of its arc
    const lift = s === side ? Math.max(0, 1 - Math.min(t, 1 - t) * 6) : 0
    footAt(bones, s, _s, 0.1 + lift * 0.25, s * 0.14, ANKLE + lift * 0.3, 1, 0.1, 0.3)
    _f2.copy(U).multiplyScalar(-0.8).addScaledVector(L, s * 0.55).normalize()
    armDir(bones, s, _f2, 0.2)
  }
}

// ---------------------------------------------------------------- power moves
/** A set shot: dip, ball up in front of the face, extend and flick. */
function shoot(bones: Bones, g: Object3D, px: number, pz: number, rot: number, ground: number, phase: number, prop: Proportions, x?: FunExtra) {
  const t = x?.action !== undefined && x.action >= 0 ? x.action : 0
  const dip = sm(0, 0.3, t) * (1 - sm(0.3, 0.55, t))
  const rise = sm(0.35, 0.55, t) * (1 - sm(0.8, 1, t))
  placeStanding(g, px, pz, ground - dip * 0.18 + rise * 0.06, rot)
  g.updateMatrixWorld(true)
  _s.set(px, ground, pz)
  footAt(bones, 1, _s, 0.05, 0.15, ANKLE + rise * 0.04, 1, 0.3)
  footAt(bones, -1, _s, 0.12, -0.15, ANKLE + rise * 0.04, 1, 0.3)
  _o.set(px, ground + prop.shoulderY, pz)
  // shooting hand behind the ball, guide hand at its side
  const ext = sm(0.4, 0.58, t)
  handAt(bones, -1, _o, lerpN(0.22, 0.45, ext), -0.06, lerpN(0.15, 0.62, ext), -0.2, 0.6, -0.7)
  handAt(bones, 1, _o, lerpN(0.28, 0.35, ext), 0.08, lerpN(0.18, 0.5, ext), -0.2, 0.8, -0.5)
  void phase
}

/** The run-up and the kick: three steps in, plant, swing through. */
function kick(bones: Bones, g: Object3D, px: number, pz: number, rot: number, ground: number, phase: number, prop: Proportions, x?: FunExtra) {
  const t = x?.action !== undefined && x.action >= 0 ? x.action : 0
  const run = sm(0, 0.55, t)
  const f = lerpN(-2.4, -0.25, run)
  const stride = run < 1 ? Math.sin(run * Math.PI * 3) : 0
  const swing = t < 0.55 ? 0 : t < 0.68 ? -sm(0.55, 0.68, t) : sm(0.68, 0.78, t) * 1.6 - 1
  _o.set(px, 0, pz).addScaledVector(F, f).addScaledVector(L, 0.3)
  placeStanding(g, _o.x, _o.z, ground - 0.04 - Math.abs(stride) * 0.03, rot)
  leanTorso(bones, 0.15 - Math.max(0, swing) * 0.25, 0.6)
  g.updateMatrixWorld(true)
  _s.set(_o.x, ground, _o.z)
  // standing (left) foot plants beside the ball; the right leg swings through
  footAt(bones, 1, _s, t < 0.55 ? stride * 0.3 : 0.12, 0.12, ANKLE + (t < 0.55 ? Math.max(0, stride) * 0.12 : 0), 1, 0.3)
  if (t < 0.55) footAt(bones, -1, _s, -stride * 0.3, -0.12, ANKLE + Math.max(0, -stride) * 0.12, 1, 0.3)
  else footAt(bones, -1, _s, swing * 0.7, -0.14, ANKLE + 0.05 + Math.abs(swing) * 0.35, 1, 0.1, swing > 0 ? 1 : -0.3)
  for (const s of [1, -1]) {
    _f2.copy(U).multiplyScalar(-0.5).addScaledVector(L, s * 0.8).addScaledVector(F, s * swing * 0.3).normalize()
    armDir(bones, s, _f2, 0.3)
  }
  void phase; void prop
}

/** Golf putt, side-on: the ball goes off to his left. A pendulum from the shoulders. */
function putt(bones: Bones, g: Object3D, px: number, pz: number, rot: number, ground: number, phase: number, prop: Proportions, x?: FunExtra) {
  const t = x?.action !== undefined && x.action >= 0 ? x.action : 0
  const charge = x?.charge ?? 0
  const back = t < 0 ? charge * 0.25 : t < 0.5 ? lerpN(0.25 * (x?.charge ?? 0.5), 0.3, sm(0, 0.5, t)) : 0
  const through = t >= 0.5 ? sm(0.5, 0.7, t) * 0.35 : 0
  placeStanding(g, px, pz, ground - 0.1, rot)
  leanTorso(bones, 0.6, 0.2)
  rotateBoneWorld(bones.head, L, 0.5)
  g.updateMatrixWorld(true)
  _s.set(px, ground, pz)
  footAt(bones, 1, _s, 0, 0.22, ANKLE, 1, 0.3)
  footAt(bones, -1, _s, 0, -0.22, ANKLE, 1, 0.3)
  _o.set(px, ground + prop.hipY - 0.15, pz)
  const sweep = through - back
  for (const s of [1, -1]) handAt(bones, s, _o, 0.32, sweep + s * 0.03, -0.15, 0, 1, -0.6)
  gripBoth(bones)
  void phase
}

/** A dart: upper arm up in front, forearm cocked, then the flick. */
function dart(bones: Bones, g: Object3D, px: number, pz: number, rot: number, ground: number, phase: number, prop: Proportions, x?: FunExtra) {
  const t = x?.action !== undefined && x.action >= 0 ? x.action : 0
  const cock = sm(0, 0.35, t) * (1 - sm(0.4, 0.5, t))
  const release = sm(0.4, 0.52, t)
  placeStanding(g, px, pz, ground, rot)
  g.updateMatrixWorld(true)
  _s.set(px, ground, pz)
  footAt(bones, 1, _s, -0.15, 0.15, ANKLE, 1, 0.3)
  footAt(bones, -1, _s, 0.12, -0.12, ANKLE, 1, 0.3)
  _o.set(px, ground + prop.shoulderY, pz)
  // right hand at the eye, pulled back, then thrown out towards the board
  handAt(bones, -1, _o, lerpN(0.28, 0.1, cock) + release * 0.35, -0.12, 0.18 + release * 0.05, 0, 0.5, -1)
  _f2.copy(U).multiplyScalar(-1).addScaledVector(L, 0.3).normalize()
  armDir(bones, 1, _f2, 0.3)
  void phase
}

/** A skimming stone: crouched low and side-on, a whip of the arm across the water. */
function skim(bones: Bones, g: Object3D, px: number, pz: number, rot: number, ground: number, phase: number, prop: Proportions, x?: FunExtra) {
  const t = x?.action !== undefined && x.action >= 0 ? x.action : 0
  const wind = sm(0, 0.35, t) * (1 - sm(0.4, 0.5, t))
  const whip = sm(0.4, 0.55, t)
  placeStanding(g, px, pz, ground - 0.25, rot)
  rotateBoneWorld(bones.spine, U, wind * 0.7 - whip * 0.6)
  leanTorso(bones, 0.35, 0.7)
  g.updateMatrixWorld(true)
  _s.set(px, ground, pz)
  footAt(bones, 1, _s, 0.35, 0.2, ANKLE, 1, 0.4)
  footAt(bones, -1, _s, -0.2, -0.25, ANKLE, 1, 0.4)
  _o.set(px, ground + prop.hipY, pz)
  // throwing hand low and back, then flat and fast out across the front
  handAt(bones, -1, _o, lerpN(-0.25, 0.55, whip), lerpN(-0.55, 0.1, whip), -0.1, 0, 1, -0.2)
  _f2.copy(U).multiplyScalar(-0.3).addScaledVector(L, 0.8).addScaledVector(F, 0.3).normalize()
  armDir(bones, 1, _f2, 0.4)
  void phase
}

/** Fishing: rod in both hands; cast overhead, then hold it out, then reel. */
function fish(bones: Bones, g: Object3D, px: number, pz: number, rot: number, ground: number, phase: number, prop: Proportions, x?: FunExtra) {
  const t = x?.action !== undefined && x.action >= 0 ? x.action : 1
  const back = sm(0, 0.35, t) * (1 - sm(0.4, 0.55, t))
  const reel = x?.custom2 ?? 0
  placeStanding(g, px, pz, ground - 0.03, rot)
  g.updateMatrixWorld(true)
  _s.set(px, ground, pz)
  footAt(bones, 1, _s, 0.12, 0.16, ANKLE, 1, 0.3)
  footAt(bones, -1, _s, -0.1, -0.16, ANKLE, 1, 0.3)
  _o.set(px, ground + prop.hipY, pz)
  // rod butt at the belly (left hand), right hand up the handle; cast lifts
  // both over the shoulder
  const up = back * 0.75
  handAt(bones, 1, _o, 0.25 - up * 0.25, 0.05, 0.1 + up * 0.6, -0.4, 1, -0.4)
  handAt(bones, -1, _o, 0.4 - up * 0.3, -0.08, 0.25 + up * 0.7 + Math.sin(phase * 14) * 0.02 * reel, -0.4, 1, -0.4)
  gripBoth(bones)
  void prop
}

/** A cannonball off the board: bounce, leap, tuck; `custom` is the flight (0..1). */
function cannon(bones: Bones, g: Object3D, px: number, pz: number, rot: number, ground: number, phase: number, prop: Proportions, x?: FunExtra) {
  const t = x?.action !== undefined && x.action >= 0 ? x.action : 0
  const bounce = sm(0, 0.18, t) * (1 - sm(0.18, 0.32, t))
  const air = sm(0.32, 1, t)
  const tuck = sm(0.38, 0.55, t)
  const reach = x?.custom ?? 2.5        // how far out over the water he lands
  const drop = x?.custom2 ?? 2.4        // board to water
  const f = air * reach
  const y = ground + bounce * -0.15 + Math.sin(air * Math.PI) * (0.6 + (x?.charge ?? 0.5) * 0.9) - air * air * drop
  _o.set(px, 0, pz).addScaledVector(F, f)
  _o.y = y + prop.hipY - tuck * 0.35
  placeHip(g, prop, _o, rot, tuck * 0.4)
  g.updateMatrixWorld(true)
  // knees to the chest, arms wrapped round the shins
  for (const s of [1, -1]) {
    const [a, c, ft] = legOf(bones, s)
    _f1.copy(_o).addScaledVector(U, -prop.legLen * lerpN(0.98, 0.35, tuck)).addScaledVector(F, tuck * 0.3).addScaledVector(L, s * 0.12)
    if (air === 0) { _f1.y = ground + ANKLE; }
    _pole.copy(F).addScaledVector(U, 0.6).normalize()
    twoBoneIK(a, c, ft, _f1, _pole)
    if (tuck > 0.05) {
      const [aa, cc, hh] = armOf(bones, s)
      _f2.copy(_o).addScaledVector(F, 0.35).addScaledVector(L, -s * 0.05).addScaledVector(U, -0.15)
      _pole.copy(L).multiplyScalar(s).normalize()
      twoBoneIK(aa, cc, hh, _f2, _pole)
    } else {
      _f2.copy(U).multiplyScalar(lerpN(-1, 0.6, bounce)).addScaledVector(L, s * 0.3).normalize()
      armDir(bones, s, _f2, 0.2)
    }
  }
  void phase
}

/** For the photo spot: a bodybuilder's double biceps, a most-muscular, a thumbs up. */
function flex(bones: Bones, g: Object3D, px: number, pz: number, rot: number, ground: number, phase: number, prop: Proportions, x?: FunExtra) {
  const p = x?.custom ?? 0
  const i = Math.floor(p) % 3, k = sm(0, 1, p - Math.floor(p))
  const breath = Math.sin(phase * 1.5) * 0.008
  placeStanding(g, px, pz, ground - 0.02 + breath, rot)
  g.updateMatrixWorld(true)
  _s.set(px, ground, pz)
  footAt(bones, 1, _s, 0.05, 0.2, ANKLE, 1, 0.4)
  footAt(bones, -1, _s, -0.03, -0.2, ANKLE, 1, 0.4)
  const shape = (n: number, s: number): [number, number, number] => {
    switch (n) {
      case 0: return [0.02, s * 0.55, prop.shoulderY - prop.hipY + 0.28]        // double biceps: fists by the ears
      case 1: return [0.3, s * 0.08, prop.shoulderY - prop.hipY - 0.32]         // most muscular: fists together at the belly
      default: return s > 0 ? [0.4, 0.2, prop.shoulderY - prop.hipY - 0.05] : [0.05, -0.3, -0.2]   // thumbs up
    }
  }
  _o.set(px, ground + prop.hipY, pz)
  for (const s of [1, -1]) {
    const a = shape(i, s), b = shape((i + 1) % 3, s)
    const pf = i === 0 ? -0.3 : 0.2
    handAt(bones, s, _o, lerpN(a[0], b[0], k), lerpN(a[1], b[1], k), lerpN(a[2], b[2], k), pf, 1, i === 0 ? -0.2 : -0.6)
    if (i === 1) { rotateBoneWorld(bones.spine2, L, 0.12 * (1 - k)) }
  }
  gripBoth(bones)
}

// ------------------------------------------------------------ back squat
function backSquat(
  bones: Bones, g: Object3D, px: number, pz: number, rotation: number, ground: number,
  phase: number, prop: Proportions, grip?: Grip,
) {
  const down = 1 - repCurve(phase, RATE.rackSquat!)
  _o.set(px, 0, pz).addScaledVector(F, -0.17 * down)
  placeStanding(g, _o.x, _o.z, ground - prop.legLen * 0.4 * down, rotation)
  // the bar on the back makes the lean a little deeper than an air squat's
  leanTorso(bones, 0.1 + 0.62 * down, 0.8)
  g.updateMatrixWorld(true)
  _s.set(px, ground, pz)
  plantFeet(bones, _s, prop.hipHalf * 1.9, ground, 0.45)

  // the bar sits across the traps, just behind and below the neck
  midpoint(bones.lArm, bones.rArm, _s)
  _s.addScaledVector(F, -0.09 - 0.05 * down).addScaledVector(U, 0.03)
  const half = grip?.spread ?? prop.shoulderHalf * 1.75
  for (const side of [1, -1]) {
    const upper = side > 0 ? bones.lArm : bones.rArm
    const lower = side > 0 ? bones.lFore : bones.rFore
    const hand = side > 0 ? bones.lHand : bones.rHand
    at(_s, 0, side * half, 0, _t)
    // elbows down and back, under the bar
    _pole.copy(U).multiplyScalar(-1).addScaledVector(F, -0.5).addScaledVector(L, side * 0.3).normalize()
    twoBoneIK(upper, lower, hand, _t, _pole)
  }
  gripBoth(bones)
}

// ------------------------------------------------------------ bench press
function bench(
  bones: Bones, g: Object3D, px: number, pz: number, rotation: number, ground: number,
  phase: number, prop: Proportions, grip?: Grip,
) {
  const e = repCurve(phase, RATE.bench!)
  const padTop = grip?.height ?? 0.5
  // Face up with the head toward F: yaw half a turn, then tip back, so the
  // body's up axis runs along F and the face looks at the sky. Shoulders sit
  // near the head end of the pad, hips on it, knees off the far end.
  _o.set(px, 0, pz).addScaledVector(F, 0.4 - prop.shoulderY)
  g.position.set(_o.x, ground + padTop + 0.12, _o.z)
  g.rotation.set(-Math.PI / 2, rotation + Math.PI, 0, 'YXZ')
  g.updateMatrixWorld(true)
  // a slight arch, chest up, head resting on the pad
  rotateBoneWorld(bones.spine2, L, 0.08)

  // the bar: over the shoulders at lockout, touching the lower chest below
  midpoint(bones.lArm, bones.rArm, _s)
  _s.addScaledVector(F, -0.13 * (1 - e)).addScaledVector(U, 0.1 + (prop.armLen * 0.94 - 0.1) * e)
  const half = grip?.spread ?? prop.shoulderHalf * 1.65
  for (const side of [1, -1]) {
    const upper = side > 0 ? bones.lArm : bones.rArm
    const lower = side > 0 ? bones.lFore : bones.rFore
    const hand = side > 0 ? bones.lHand : bones.rHand
    // turned half round, his left is the frame's -L
    at(_s, 0, -side * half, 0, _t)
    // elbows about 45 degrees from the torso, dropping toward the floor
    _pole.copy(L).multiplyScalar(-side * 0.7).addScaledVector(F, -0.45).addScaledVector(U, -0.4).normalize()
    twoBoneIK(upper, lower, hand, _t, _pole)
  }

  // feet flat on the floor either side of the bench end, knees bent
  midpoint(bones.lUpLeg, bones.rUpLeg, _s)
  for (const side of [1, -1]) {
    const upper = side > 0 ? bones.lUpLeg : bones.rUpLeg
    const lower = side > 0 ? bones.lLeg : bones.rLeg
    const foot = side > 0 ? bones.lFoot : bones.rFoot
    _t.copy(_s).addScaledVector(F, -0.52).addScaledVector(L, -side * 0.3)
    _t.y = ground + 0.08
    _pole.copy(U).addScaledVector(F, -0.3).normalize()
    twoBoneIK(upper, lower, foot, _t, _pole)
  }
  gripBoth(bones)
}

// ------------------------------------------------------------ curl
function curl(
  bones: Bones, g: Object3D, px: number, pz: number, rotation: number, ground: number,
  phase: number, prop: Proportions,
) {
  placeStanding(g, px, pz, ground, rotation)
  // chest proud, shoulders back
  rotateBoneWorld(bones.spine2, L, -0.05)
  g.updateMatrixWorld(true)
  for (const side of [1, -1]) {
    const upper = side > 0 ? bones.lArm : bones.rArm
    const lower = side > 0 ? bones.lFore : bones.rFore
    const hand = side > 0 ? bones.lHand : bones.rHand
    // alternating arms, the way most people curl with dumbbells
    const e = repCurve(phase + (side > 0 ? 0 : Math.PI / RATE.curl!), RATE.curl!)
    // the elbow stays pinned at the ribs, just in front of the hip line
    upper.getWorldPosition(_s)
    const elbow = _b.copy(_s).addScaledVector(U, -prop.upperArm * 0.98).addScaledVector(F, 0.04)
      .addScaledVector(L, side * 0.02)
    // the forearm sweeps from hanging (10 deg) to fully curled (140 deg)
    const ang = (10 + 130 * e) * Math.PI / 180
    _t.copy(elbow).addScaledVector(U, -Math.cos(ang) * prop.foreArm)
      .addScaledVector(F, Math.sin(ang) * prop.foreArm)
    _pole.copy(F).multiplyScalar(-1).addScaledVector(L, side * 0.15).normalize()
    twoBoneIK(upper, lower, hand, _t, _pole)
  }
  gripBoth(bones)
}

// ------------------------------------------------------------ kettlebell swing
function swing(
  bones: Bones, g: Object3D, px: number, pz: number, rotation: number, ground: number,
  phase: number, prop: Proportions,
) {
  const up = (Math.sin(phase * RATE.kettlebell!) + 1) / 2   // 1 at the float, 0 in the hinge
  const hinge = 1 - up
  // a hinge, not a squat: hips go back, knees only soften
  _o.set(px, 0, pz).addScaledVector(F, -0.16 * hinge)
  placeStanding(g, _o.x, _o.z, ground - 0.07 * hinge, rotation)
  leanTorso(bones, 0.95 * hinge, 0.75)
  g.updateMatrixWorld(true)
  _s.set(px, ground, pz)
  plantFeet(bones, _s, prop.hipHalf * 2.0, ground, 0.3)

  // straight arms from the shoulders: down and back between the legs in the
  // hinge, out to chest height at the float
  midpoint(bones.lArm, bones.rArm, _s)
  const beta = -0.05 + 1.95 * hinge                 // radians below horizontal
  _b.copy(F).multiplyScalar(Math.cos(beta)).addScaledVector(U, -Math.sin(beta))
  for (const side of [1, -1]) {
    const upper = side > 0 ? bones.lArm : bones.rArm
    const lower = side > 0 ? bones.lFore : bones.rFore
    const hand = side > 0 ? bones.lHand : bones.rHand
    // both hands on the one handle
    _t.copy(_s).addScaledVector(_b, prop.armLen * 0.97).addScaledVector(L, side * 0.05)
    _pole.copy(F).multiplyScalar(-0.3).addScaledVector(L, side * 0.5).addScaledVector(U, -0.8).normalize()
    twoBoneIK(upper, lower, hand, _t, _pole)
  }
  gripBoth(bones)
}

// ------------------------------------------------------------ posture
const _pf = new Vector3()
const _pl = new Vector3()

/**
 * A posture correction laid over the stock locomotion clips.
 *
 * Those clips were authored on a slim mannequin. On a heavily muscled body
 * the same arm angles hold the arms out from the lats like a lat spread, and
 * the clip's slight stoop reads as a hunch. This brings the arms in to hang
 * beside the body and lifts the chest, by `amount` (1 = standing, less while
 * moving so the arm swing keeps its range).
 */
export function relaxPosture(bones: Bones, root: Object3D, amount = 1) {
  root.getWorldDirection(_pf)
  _pf.y = 0
  if (_pf.lengthSq() < 1e-6) return
  _pf.normalize()
  _pl.crossVectors(U, _pf).normalize()
  // arms in: about the forward axis, left arm one way, right arm the other
  rotateBoneWorld(bones.lArm, _pf, -0.2 * amount)
  rotateBoneWorld(bones.rArm, _pf, 0.2 * amount)
  // chest up, shoulders back, chin level
  rotateBoneWorld(bones.spine2, _pl, -0.07 * amount)
  rotateBoneWorld(bones.head, _pl, 0.03 * amount)
}

// ------------------------------------------------------------ foot planting
const _fl = new Vector3()
const _fr = new Vector3()
const ANKLE = 0.111            // ankle joint above the sole, measured off the rig

/**
 * Stand on the ground that is actually there. Each foot finds the terrain
 * under it; the body drops by whatever the lower foot needs, and the other
 * leg bends to meet its own ground, so on a slope or a kerb neither foot
 * floats and neither sinks.
 */
export function plantOnGround(
  bones: Bones, root: Object3D, heightAt: (x: number, z: number) => number, weight = 1,
) {
  if (weight <= 0.001) return
  bones.lFoot.getWorldPosition(_fl)
  bones.rFoot.getWorldPosition(_fr)
  const gl = heightAt(_fl.x, _fl.z) + ANKLE
  const gr = heightAt(_fr.x, _fr.z) + ANKLE
  // how far each ankle is above where it should be
  const dl = _fl.y - gl
  const dr = _fr.y - gr
  const drop = Math.max(dl, dr) > 0 ? Math.min(Math.max(dl, dr), 0.25) * weight : 0
  if (drop > 0.002) {
    root.position.y -= drop
    root.updateMatrixWorld(true)
  }
  for (const [upper, lower, foot, g] of [
    [bones.lUpLeg, bones.lLeg, bones.lFoot, gl], [bones.rUpLeg, bones.rLeg, bones.rFoot, gr],
  ] as const) {
    foot.getWorldPosition(_t)
    const want = _t.y + (g - _t.y) * weight
    if (Math.abs(want - _t.y) < 0.004) continue
    root.getWorldDirection(_pole)
    _pole.y = 0.15
    _pole.normalize()
    _t.y = want
    twoBoneIK(upper, lower, foot, _t, _pole)
  }
}

/**
 * Feet on the real ground while moving, for any character.
 *
 * `plantOnGround` pins both ankles to the ground, which is right for standing
 * and wrong for a stride: it would drag the swinging foot down too. So it used
 * to fade out as soon as the character walked, and on any slope a walk or a
 * run was then played on flat ground that was not there — the uphill foot went
 * into the hill and the downhill one trod on air. Here each foot keeps the
 * lift its clip gives it, measured from the ground under that foot instead of
 * the ground under the hips; the hips come down (smoothly, never with a pop)
 * as far as the lower foot needs to reach, and the knees take up the rest.
 */
const _pelvis = new WeakMap<Object3D, { drop: number }>()
const _fa = new Vector3()
export function alignFeet(
  bones: Bones, root: Object3D, heightAt: (x: number, z: number) => number, dt: number, weight = 1,
) {
  let st = _pelvis.get(root)
  if (!st) { st = { drop: 0 }; _pelvis.set(root, st) }
  const baseY = root.position.y
  const legs = [
    [bones.lUpLeg, bones.lLeg, bones.lFoot], [bones.rUpLeg, bones.rLeg, bones.rFoot],
  ] as const
  const want = [0, 0]
  let lowest = 0
  for (let i = 0; i < 2; i++) {
    legs[i][2].getWorldPosition(_fa)
    // how high the clip holds this ankle over flat ground at the feet
    const lift = Math.max(0, _fa.y - (baseY + ANKLE))
    const g = heightAt(_fa.x, _fa.z)
    want[i] = g + ANKLE + lift
    lowest = Math.min(lowest, want[i] - _fa.y)
  }
  // bring the hips down for the downhill foot; ease both ways so a stride
  // across a kerb does not jolt the whole body
  const target = Math.max(-0.32, lowest) * weight
  const k = 1 - Math.exp(-(target < st.drop ? 18 : 9) * dt)
  st.drop += (target - st.drop) * k
  if (Math.abs(st.drop) > 0.002) {
    root.position.y = baseY + st.drop
    root.updateMatrixWorld(true)
  }
  root.getWorldDirection(_pole)
  _pole.y = 0.15
  _pole.normalize()
  for (let i = 0; i < 2; i++) {
    const [upper, lower, foot] = legs[i]
    foot.getWorldPosition(_t)
    const y = _t.y + (want[i] - _t.y) * weight
    if (Math.abs(y - _t.y) < 0.004) continue
    _t.y = y
    twoBoneIK(upper, lower, foot, _t, _pole)
  }
}

/**
 * Getting in and out of a car: the hip joint at `hip`, facing `yaw`, seated
 * by `sit` (0 standing .. 1 sat), each foot's ankle at its own target (lifted
 * over the sill as it swings in, `lift` 0..1 raising the knee), hands on the
 * thighs once sat. The car's own seat, sill and footwell positions come from
 * the caller, so the body lands on the car rather than near it.
 */
export function carTransfer(
  bones: Bones, g: Object3D, hip: Vector3, yaw: number, sit: number,
  feet: [Vector3, Vector3], lift: [number, number],
) {
  frame(yaw)
  const prop = proportions(bones, g)
  placeStanding(g, hip.x, hip.z, hip.y - prop.hipY, yaw)
  leanTorso(bones, 0.12 * sit * (1 - sit) * 4 - 0.06 * sit, 0.8)
  g.updateMatrixWorld(true)
  for (const side of [1, -1]) {
    const i = side > 0 ? 0 : 1
    const upper = side > 0 ? bones.lUpLeg : bones.rUpLeg
    const lower = side > 0 ? bones.lLeg : bones.rLeg
    const foot = side > 0 ? bones.lFoot : bones.rFoot
    _pole.copy(F).addScaledVector(U, 0.35 + lift[i] * 1.2).addScaledVector(L, side * 0.15).normalize()
    twoBoneIK(upper, lower, foot, feet[i], _pole)
  }
  if (sit > 0.4) {
    const k = Math.min(1, (sit - 0.4) / 0.4)
    for (const side of [1, -1]) {
      const upper = side > 0 ? bones.lArm : bones.rArm
      const lower = side > 0 ? bones.lFore : bones.rFore
      const hand = side > 0 ? bones.lHand : bones.rHand
      hand.getWorldPosition(_s)
      at(hip, prop.legLen * 0.3, side * prop.hipHalf * 1.3, 0.06, _t)
      _t.lerpVectors(_s, _t, k)
      _pole.copy(L).multiplyScalar(side).addScaledVector(F, -0.4).addScaledVector(U, -0.3).normalize()
      twoBoneIK(upper, lower, hand, _t, _pole)
    }
  }
}
