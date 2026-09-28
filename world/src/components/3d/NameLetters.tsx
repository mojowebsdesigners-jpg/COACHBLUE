import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Text, useGLTF } from '@react-three/drei'
import { Box3, Color, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, Quaternion, Vector3 } from 'three'
import { addDynamicCollider, groundHeight, pathSamples, roadBase, terrainNormalY } from '../../lib/terrain'
import { locationById } from '../../data/journey'
import { player } from '../../state/store'
import { vehicle } from '../../systems/VehicleController'
import { cue } from '../../lib/audio'
import { DISPLAY_FONT } from './Props'

/**
 * COACH BLUE, in letters you can drive through.
 *
 * Big bevelled letters (tools/letters/build.py) stand by the road at the
 * entrance, each a step along a gradient from mint through turquoise and sky
 * blue to royal blue and violet, lighter at the top. Hit them with the car
 * and they fly: each is a small rigid body with its own velocity and spin,
 * falling, bouncing and tumbling until it lies on one of its faces. Walking
 * into one just stops you. Once you have gone and nobody is looking, they
 * stand themselves back up for the next person.
 *
 * The same name is painted across the tarmac a little way up the road.
 */
const WORD = 'COACHBLUE'
const PALETTE = ['#2ee6c4', '#27d6d6', '#22bfe6', '#2aa3ef', '#3386f2', '#436ef0', '#575fea', '#6c55e4', '#8650de']
const SCALE = 1.3
const G = 9.8

type Body = {
  home: Vector3
  homeQ: Quaternion
  p: Vector3
  q: Quaternion
  v: Vector3
  w: Vector3
  half: Vector3          // half extents; the origin is at the middle of the base
  awake: boolean
  still: number
  away: number
}

const _v = new Vector3()
const _c = new Vector3()
const _q = new Quaternion()
const _up = new Vector3()
const _axis = new Vector3()
const _low = new Vector3()

/** Where the letters stand: beside the road at the entrance, facing it. */
function layout() {
  const [ex, ez] = locationById.entrance.pos
  let best = 0, bd = Infinity
  pathSamples.forEach((s, i) => { const d = (s.x - ex) ** 2 + (s.z - ez) ** 2; if (d < bd) { bd = d; best = i } })
  const a = pathSamples[Math.max(0, best - 4)], b = pathSamples[Math.min(pathSamples.length - 1, best + 4)]
  const tx = b.x - a.x, tz = b.z - a.z, len = Math.hypot(tx, tz) || 1
  const dir = new Vector3(tx / len, 0, tz / len)
  const side = new Vector3(-dir.z, 0, dir.x)                 // to the left of the road
  const base = new Vector3(pathSamples[best].x, 0, pathSamples[best].z).addScaledVector(side, -8.2).addScaledVector(dir, 7)
  // facing the road
  const yaw = Math.atan2(side.x, side.z)
  const spacing = 1.18 * SCALE
  const total = (WORD.length - 1) * spacing + 0.8
  return WORD.split('').map((_, i) => {
    const gap = i >= 5 ? 0.9 : 0                             // a space between the two words
    const along = -total / 2 + i * spacing + gap - 0.45
    // read left to right from the road
    const p = base.clone().addScaledVector(dir, along)
    p.y = groundHeight(p.x, p.z)
    return { p, yaw }
  })
}

export function NameLetters() {
  const { scene } = useGLTF('/models/letters.glb')
  const group = useRef<Group>(null)
  const place = useMemo(layout, [])
  const letters = useMemo(() => WORD.split('').map((ch, i) => {
    const src = scene.getObjectByName(`Letter_${i}_${ch}`) as Mesh
    // the node carries the export's orientation: bake it (not its place) in
    src.updateWorldMatrix(true, false)
    const orient = src.matrixWorld.clone().setPosition(0, 0, 0)
    // the file stores positions as quantised integers (-1..1, restored by the
    // node's scale); scaling those in place clips them, so unpack to floats
    const geo = src.geometry.clone()
    for (const name of ['position', 'normal'] as const) {
      const at = geo.getAttribute(name)
      if (!at) continue
      const f = new Float32Array(at.count * 3)
      for (let k = 0; k < at.count; k++) { f[k * 3] = at.getX(k); f[k * 3 + 1] = at.getY(k); f[k * 3 + 2] = at.getZ(k) }
      geo.setAttribute(name, new Float32BufferAttribute(f, 3))
    }
    geo.applyMatrix4(orient)
    geo.scale(SCALE, SCALE, SCALE)
    // stand it on its base, centred
    geo.computeBoundingBox()
    const b0 = geo.boundingBox as Box3
    geo.translate(-(b0.min.x + b0.max.x) / 2, -b0.min.y, -(b0.min.z + b0.max.z) / 2)
    geo.computeBoundingBox()
    const bb = geo.boundingBox as Box3
    const colour = new Color(PALETTE[i])
    const mat = new MeshStandardMaterial({
      color: colour, roughness: 0.38, metalness: 0.05, emissive: colour, emissiveIntensity: 0.12,
    })
    // lighter towards the top, deeper at the foot: the gradient reads as shine
    const top = bb.max.y
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying float vH;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>\nvH = position.y / ${top.toFixed(3)};`)
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vH;')
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= mix(0.72, 1.22, smoothstep(0.0, 1.0, vH));')
    }
    mat.customProgramCacheKey = () => 'name-letter'
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), place[i].yaw)
    const body: Body = {
      home: place[i].p.clone(), homeQ: q.clone(), p: place[i].p.clone(), q: q.clone(),
      v: new Vector3(), w: new Vector3(),
      half: new Vector3((bb.max.x - bb.min.x) / 2, (bb.max.y - bb.min.y) / 2, (bb.max.z - bb.min.z) / 2),
      awake: false, still: 0, away: 0,
    }
    return { geo, mat, body }
  }), [scene, place])

  // standing letters stop you walking through them (the car hits them instead)
  useEffect(() => {
    const offs = letters.map(({ body }) => addDynamicCollider(() =>
      vehicle.occupied ? null : { x: body.p.x, z: body.p.z, r: Math.max(body.half.x, body.half.z) * 0.8 }))
    return () => offs.forEach((o) => o && o())
  }, [letters])

  useFrame((_, delta) => {
    const g = group.current
    if (!g) return
    const dt = Math.min(delta, 1 / 30)
    const nearHome = Math.hypot(player.pos.x - place[4].p.x, player.pos.z - place[4].p.z)
    if (nearHome > 160) return
    const carSpeed = Math.abs(vehicle.speed)
    const cy = Math.cos(vehicle.yaw), sy = Math.sin(vehicle.yaw)
    letters.forEach(({ body: b }, i) => {
      // ---- struck by the car
      if (vehicle.occupied && carSpeed > 1.2) {
        _v.copy(b.p).setY(b.p.y + b.half.y).sub(vehicle.pos)
        const lx = _v.x * cy - _v.z * sy, lz = _v.x * sy + _v.z * cy
        if (Math.abs(lx) < 1.05 + b.half.x && Math.abs(lz) < 2.35 + b.half.z && _v.y < 2.5) {
          const dir = Math.sign(vehicle.speed)
          const fx = Math.sin(vehicle.yaw) * dir, fz = Math.cos(vehicle.yaw) * dir
          // thrown forward and a little aside, up, and spinning
          const k = 1.05 + Math.random() * 0.35
          b.v.set(fx * carSpeed * k + (Math.random() - 0.5) * 2, 1.8 + carSpeed * 0.22, fz * carSpeed * k + (Math.random() - 0.5) * 2)
          b.w.set((Math.random() - 0.5) * carSpeed * 0.8, (Math.random() - 0.5) * carSpeed * 0.6, (Math.random() - 0.5) * carSpeed * 0.8)
          // step it clear of the car so it is not hit again next frame
          b.p.x += fx * 0.4; b.p.z += fz * 0.4
          if (!b.awake) cue('interact')
          b.awake = true
          b.still = 0
          vehicle.speed *= 0.93
        }
      }
      if (!b.awake) return
      // ---- fly
      b.v.y -= G * dt
      b.p.addScaledVector(b.v, dt)
      const wl = b.w.length()
      if (wl > 1e-5) {
        _q.setFromAxisAngle(_axis.copy(b.w).divideScalar(wl), wl * dt)
        b.q.premultiply(_q)
      }
      // ---- the ground: find the lowest corner of the letter's box
      let pen = 0
      _low.set(0, 1e9, 0)
      for (let c = 0; c < 8; c++) {
        _c.set(c & 1 ? b.half.x : -b.half.x, c & 2 ? b.half.y * 2 : 0, c & 4 ? b.half.z : -b.half.z)
          .applyQuaternion(b.q).add(b.p)
        const d = _c.y - groundHeight(_c.x, _c.z)
        if (d < pen) { pen = d; _low.copy(_c) }
      }
      if (pen < 0) {
        b.p.y -= pen
        if (b.v.y < 0) b.v.y = -b.v.y * 0.22
        const fr = Math.min(1, dt * 5)
        b.v.x *= 1 - fr; b.v.z *= 1 - fr
        b.w.multiplyScalar(1 - Math.min(1, dt * 2.5))
        // settle onto whichever face is nearest to lying flat: turn the
        // letter's closest local axis towards the world's down
        _up.set(0, 1, 0).applyQuaternion(_q.copy(b.q).invert())
        const ax = Math.abs(_up.x), ay = Math.abs(_up.y), az = Math.abs(_up.z)
        const want = ax > ay && ax > az ? new Vector3(Math.sign(_up.x), 0, 0)
          : ay > az ? new Vector3(0, Math.sign(_up.y), 0) : new Vector3(0, 0, Math.sign(_up.z))
        const tip = _axis.crossVectors(_up, want).applyQuaternion(b.q)
        b.w.addScaledVector(tip, dt * 14)
        if (b.v.length() < 0.08 && b.w.length() < 0.08) b.still += dt
        else b.still = 0
        if (b.still > 0.6) { b.awake = false; b.v.set(0, 0, 0); b.w.set(0, 0, 0) }
      }
      // never lost through the floor or into the far hills
      if (b.p.y < groundHeight(b.p.x, b.p.z) - 3) { b.p.copy(b.home); b.q.copy(b.homeQ); b.awake = false }
      void i
    })
    // ---- stand them back up once you have gone
    letters.forEach(({ body: b }) => {
      const displaced = b.p.distanceToSquared(b.home) > 0.05 || b.q.angleTo(b.homeQ) > 0.02
      if (!displaced || b.awake) { b.away = 0; return }
      b.away += dt
      if (b.away > 20 && nearHome > 45) { b.p.copy(b.home); b.q.copy(b.homeQ); b.away = 0 }
    })
    g.children.forEach((m, i) => {
      const b = letters[i]?.body
      if (!b) return
      m.position.copy(b.p)
      m.quaternion.copy(b.q)
    })
  })

  return (
    <group>
      <group ref={group} userData={{ noCollide: true }}>
        {letters.map(({ geo, mat }, i) => (
          <mesh key={i} geometry={geo} material={mat} castShadow receiveShadow />
        ))}
      </group>
      <RoadName />
    </group>
  )
}

/** COACH BLUE painted across the tarmac on the flattest stretch near the start. */
function RoadName() {
  const at = useMemo(() => {
    const [ex, ez] = locationById.entrance.pos
    let best = { i: 0, score: Infinity }
    pathSamples.forEach((s, i) => {
      const d = Math.hypot(s.x - ex, s.z - ez)
      if (d < 18 || d > 70 || i < 4 || i > pathSamples.length - 5) return
      const slope = terrainNormalY(s.x, s.z).slope
      const score = slope * 60 + d * 0.05
      if (score < best.score) best = { i, score }
    })
    const s = pathSamples[best.i]
    const a = pathSamples[best.i - 3], b = pathSamples[best.i + 3]
    return { x: s.x, z: s.z, y: roadBase(s.x, s.z) + 0.135, yaw: Math.atan2(b.x - a.x, b.z - a.z) }
  }, [])
  const mat = useMemo(() => new MeshBasicMaterial({
    color: '#bff7ea', transparent: true, opacity: 0.82, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8,
  }), [])
  return (
    <Text font={DISPLAY_FONT} position={[at.x, at.y, at.z]} rotation={[-Math.PI / 2, 0, at.yaw + Math.PI / 2]}
      fontSize={2.1} letterSpacing={0.12} anchorX="center" anchorY="middle" material={mat}>
      COACH BLUE
    </Text>
  )
}

useGLTF.preload('/models/letters.glb')
