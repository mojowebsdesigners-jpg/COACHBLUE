import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Text } from '@react-three/drei'
import {
  BufferGeometry, CatmullRomCurve3, Color, DynamicDrawUsage, ExtrudeGeometry, Float32BufferAttribute,
  MeshStandardMaterial, Shape, TubeGeometry, Vector3,
} from 'three'
import { addCollider, groundHeight } from '../../lib/terrain'
import { scannedTexture } from '../../lib/materials'
import { DISPLAY_FONT } from './Props'
import { registerSeat } from './Seats'

/**
 * The outdoor fitness park round the training floor, built like the real
 * thing: heavy-gauge steel in a dark green powder coat on round bolt-down
 * bases, black rubber-coated plates on the plate-loaded machines, black vinyl
 * pads, yellow instruction plates and warning stickers, a curved manual
 * treadmill, a wood-chip border round the rubber, and a picnic table.
 *
 * Everything takes the gym's own `place` (local slab coordinates to world) and
 * `angle`, so it moves with the compound.
 */
type Place = (lx: number, lz: number) => [number, number]

export function useKitMaterials() {
  return useMemo(() => {
    const steel = new MeshStandardMaterial({ color: '#1d4a36', roughness: 0.42, metalness: 0.45 })
    const rubber = new MeshStandardMaterial({ color: '#111214', roughness: 0.85, metalness: 0 })
    const vinyl = new MeshStandardMaterial({ color: '#0f1011', roughness: 0.55, metalness: 0 })
    const chrome = new MeshStandardMaterial({ color: '#c9ced4', roughness: 0.18, metalness: 1 })
    const plate = new MeshStandardMaterial({ color: '#141416', roughness: 0.7, metalness: 0.2 })
    const yellow = new MeshStandardMaterial({ color: '#e8c21a', roughness: 0.5 })
    const white = new MeshStandardMaterial({ color: '#f2f2ee', roughness: 0.5 })
    const wood = new MeshStandardMaterial({
      map: scannedTexture('timber_diff', 1, true), normalMap: scannedTexture('timber_nor', 1),
      roughness: 0.85, color: new Color('#c9a883'),
    })
    return { steel, rubber, vinyl, chrome, plate, yellow, white, wood }
  }, [])
}
type Mats = ReturnType<typeof useKitMaterials>

// ------------------------------------------------------------------ parts
function Post({ at, h, r = 0.057, m }: { at: [number, number, number]; h: number; r?: number; m: Mats }) {
  return (
    <group position={at}>
      <mesh position={[0, h / 2, 0]} material={m.steel} castShadow receiveShadow>
        <cylinderGeometry args={[r, r, h, 20]} />
      </mesh>
      {/* bolt-down base plate with a cap on top */}
      <mesh position={[0, 0.012, 0]} material={m.steel} receiveShadow>
        <cylinderGeometry args={[0.2, 0.21, 0.024, 28]} />
      </mesh>
      <mesh position={[0, h + 0.01, 0]} material={m.steel}>
        <sphereGeometry args={[r * 1.05, 16, 10]} />
      </mesh>
    </group>
  )
}

function Bar({ from, to, r = 0.019, m, mat }: {
  from: [number, number, number]; to: [number, number, number]; r?: number; m: Mats; mat?: MeshStandardMaterial
}) {
  const geo = useMemo(() => {
    const a = new Vector3(...from), b = new Vector3(...to)
    return new TubeGeometry(new CatmullRomCurve3([a, b]), 1, r, 14, false)
  }, [from, to, r])
  return <mesh geometry={geo} material={mat ?? m.steel} castShadow />
}

function Plates({ at, axis, count, m }: { at: [number, number, number]; axis: 'x' | 'z'; count: number; m: Mats }) {
  const rot: [number, number, number] = axis === 'x' ? [0, 0, Math.PI / 2] : [Math.PI / 2, 0, 0]
  return (
    <group position={at}>
      {/* the loading horn */}
      <mesh rotation={rot} material={m.chrome}>
        <cylinderGeometry args={[0.025, 0.025, 0.34, 16]} />
      </mesh>
      {Array.from({ length: count }, (_, i) => {
        const d = -0.1 + i * 0.045
        const p: [number, number, number] = axis === 'x' ? [d, 0, 0] : [0, 0, d]
        const r = i === 0 ? 0.225 : 0.18
        return (
          <mesh key={i} position={p} rotation={rot} material={m.plate} castShadow>
            <cylinderGeometry args={[r, r, 0.036, 36]} />
          </mesh>
        )
      })}
    </group>
  )
}

function Sticker({ at, rot, w, h, m }: { at: [number, number, number]; rot: [number, number, number]; w: number; h: number; m: Mats }) {
  return (
    <mesh position={at} rotation={rot} material={m.yellow}>
      <planeGeometry args={[w, h]} />
    </mesh>
  )
}

// ------------------------------------------------------------------ calisthenics rig
/**
 * A multi-station rig: four posts carrying a monkey-bar ladder, a high and a
 * low pull-up bar on the long sides, stall bars up one end and a pair of dip
 * bars beside it.
 */
export const RIG = { lx: -2.8, lz: -3.2, w: 3.6, d: 1.5, h: 2.6, barHigh: 2.4, barLow: 2.1 }

export function CalisthenicsRig({ place, angle, y, m }: { place: Place; angle: number; y: number; m: Mats }) {
  const [x, z] = place(RIG.lx, RIG.lz)
  const hw = RIG.w / 2, hd = RIG.d / 2, H = RIG.h
  useEffect(() => {
    for (const [px, pz] of [[-hw, -hd], [hw, -hd], [-hw, hd], [hw, hd]]) {
      const [wx, wz] = place(RIG.lx + px, RIG.lz + pz)
      addCollider({ x: wx, z: wz, r: 0.12 })
    }
    for (const dx of [-0.3, 0.3]) {
      const [wx, wz] = place(RIG.lx - hw - 1.1, RIG.lz + dx)
      addCollider({ x: wx, z: wz, r: 0.08 })
    }
  }, [place, hw, hd])
  return (
    <group position={[x, y, z]} rotation={[0, angle, 0]}>
      {[[-hw, -hd], [hw, -hd], [-hw, hd], [hw, hd]].map(([px, pz], i) => (
        <Post key={i} at={[px, 0, pz]} h={H} m={m} />
      ))}
      {/* top rails and the monkey-bar rungs */}
      <Bar from={[-hw, H - 0.05, -hd]} to={[hw, H - 0.05, -hd]} r={0.03} m={m} />
      <Bar from={[-hw, H - 0.05, hd]} to={[hw, H - 0.05, hd]} r={0.03} m={m} />
      {Array.from({ length: 9 }, (_, i) => -hw + 0.3 + i * ((RIG.w - 0.6) / 8)).map((px) => (
        <Bar key={px} from={[px, H - 0.05, -hd]} to={[px, H - 0.05, hd]} r={0.018} m={m} />
      ))}
      {/* pull-up bars: high on the front, low on the back */}
      <Bar from={[-hw, RIG.barHigh, -hd]} to={[hw, RIG.barHigh, -hd]} r={0.016} m={m} mat={m.chrome} />
      <Bar from={[-hw, RIG.barLow, hd]} to={[hw, RIG.barLow, hd]} r={0.016} m={m} mat={m.chrome} />
      {/* stall bars up the far end */}
      {Array.from({ length: 8 }, (_, i) => 0.35 + i * 0.28).map((py) => (
        <Bar key={py} from={[hw, py, -hd]} to={[hw, py, hd]} r={0.016} m={m} />
      ))}
      {/* dip bars beside the near end */}
      {[-0.3, 0.3].map((pz) => (
        <group key={pz}>
          <Post at={[-hw - 1.1, 0, pz]} h={1.3} r={0.045} m={m} />
          <Bar from={[-hw - 1.6, 1.28, pz]} to={[-hw - 0.6, 1.28, pz]} r={0.022} m={m} />
        </group>
      ))}
      <Post at={[-hw - 1.55, 0, 0.3]} h={1.28} r={0.035} m={m} />
      <Post at={[-hw - 1.55, 0, -0.3]} h={1.28} r={0.035} m={m} />
      <Post at={[-hw - 0.65, 0, 0.3]} h={1.28} r={0.035} m={m} />
      <Post at={[-hw - 0.65, 0, -0.3]} h={1.28} r={0.035} m={m} />
      {/* the instruction plate on the front left post */}
      <Sticker at={[-hw + 0.001, 1.4, -hd - 0.061]} rot={[0, Math.PI, 0]} w={0.24} h={0.34} m={m} />
      <Text font={DISPLAY_FONT} position={[0, H + 0.14, -hd - 0.035]} rotation={[0, Math.PI, 0]} fontSize={0.13}
        color="#f2f2ee" anchorX="center" letterSpacing={0.18}>
        COACH BLUE · OUTDOOR
      </Text>
    </group>
  )
}

// ------------------------------------------------------------------ plate-loaded machines
function Machine({ place, lx, lz, yaw, y, collider, children }: {
  place: Place; lx: number; lz: number; yaw: number; y: number; collider: [number, number]; children: React.ReactNode
}) {
  const [x, z] = place(lx, lz)
  useEffect(() => {
    addCollider({ x, z, hx: collider[0], hz: collider[1], angle: yaw })
  }, [x, z, yaw, collider])
  return <group position={[x, y, z]} rotation={[0, yaw, 0]}>{children}</group>
}

/** A 45-degree plate-loaded leg press: sled on rails, reclined seat, big footplate. */
export function LegPress({ place, angle, y, m }: { place: Place; angle: number; y: number; m: Mats }) {
  const rail = (s: number) => (
    <Bar from={[s * 0.32, 0.25, -0.9]} to={[s * 0.32, 1.35, 0.4]} r={0.04} m={m} />
  )
  return (
    <Machine place={place} lx={7.4} lz={-2.6} yaw={angle + Math.PI / 2} y={y} collider={[0.55, 1.3]}>
      {/* base frame */}
      <mesh position={[0, 0.07, -0.2]} material={m.steel} castShadow receiveShadow>
        <boxGeometry args={[0.8, 0.12, 2.2]} />
      </mesh>
      {rail(1)}{rail(-1)}
      {/* the seat and back pad, reclined */}
      <mesh position={[0, 0.48, -0.85]} rotation={[-0.25, 0, 0]} material={m.vinyl} castShadow>
        <boxGeometry args={[0.52, 0.09, 0.5]} />
      </mesh>
      <mesh position={[0, 0.82, -1.1]} rotation={[-1.05, 0, 0]} material={m.vinyl} castShadow>
        <boxGeometry args={[0.52, 0.09, 0.72]} />
      </mesh>
      {/* the sled with its footplate, and the plate horns */}
      <group position={[0, 1.05, 0.12]} rotation={[-0.785, 0, 0]}>
        <mesh material={m.steel} castShadow>
          <boxGeometry args={[0.7, 0.08, 0.45]} />
        </mesh>
        <mesh position={[0, 0.32, 0.2]} rotation={[0.785, 0, 0]} material={m.rubber} castShadow>
          <boxGeometry args={[0.66, 0.62, 0.04]} />
        </mesh>
        <Plates at={[0.5, 0, 0]} axis="x" count={3} m={m} />
        <Plates at={[-0.5, 0, 0]} axis="x" count={3} m={m} />
      </group>
      {/* grab handles by the seat */}
      {[-1, 1].map((s) => (
        <Bar key={s} from={[s * 0.36, 0.45, -0.75]} to={[s * 0.42, 0.62, -0.55]} r={0.016} m={m} mat={m.rubber} />
      ))}
      <Sticker at={[0.401, 0.1, -0.4]} rot={[0, Math.PI / 2, 0]} w={0.5} h={0.09} m={m} />
    </Machine>
  )
}

/** Seated chest press: upright frame, press arms swinging forward, plates on the arms. */
export function ChestPress({ place, angle, y, m }: { place: Place; angle: number; y: number; m: Mats }) {
  return (
    <Machine place={place} lx={-8.3} lz={-4.3} yaw={angle} y={y} collider={[0.7, 0.8]}>
      <mesh position={[0, 0.06, 0]} material={m.steel} receiveShadow>
        <boxGeometry args={[1.1, 0.1, 1.4]} />
      </mesh>
      <Post at={[0, 0, -0.45]} h={1.6} r={0.06} m={m} />
      <mesh position={[0, 0.5, 0.1]} material={m.vinyl} castShadow>
        <boxGeometry args={[0.46, 0.09, 0.44]} />
      </mesh>
      <mesh position={[0, 0.95, -0.3]} rotation={[0.12, 0, 0]} material={m.vinyl} castShadow>
        <boxGeometry args={[0.46, 0.7, 0.09]} />
      </mesh>
      {[-1, 1].map((s) => (
        <group key={s}>
          <Bar from={[s * 0.05, 1.55, -0.45]} to={[s * 0.45, 1.25, 0.45]} r={0.035} m={m} />
          <Bar from={[s * 0.45, 1.25, 0.45]} to={[s * 0.45, 1.0, 0.45]} r={0.018} m={m} mat={m.rubber} />
          <Plates at={[s * 0.62, 1.32, 0.25]} axis="x" count={2} m={m} />
        </group>
      ))}
      <Sticker at={[0, 1.2, -0.51]} rot={[0, Math.PI, 0]} w={0.22} h={0.32} m={m} />
    </Machine>
  )
}

/** Lat pulldown: a tall A-frame with a lever arm and plate horn, thigh pads over the seat. */
export function LatPulldown({ place, angle, y, m }: { place: Place; angle: number; y: number; m: Mats }) {
  return (
    <Machine place={place} lx={-5.4} lz={-5.1} yaw={angle} y={y} collider={[0.7, 0.7]}>
      <mesh position={[0, 0.06, 0]} material={m.steel} receiveShadow>
        <boxGeometry args={[1.2, 0.1, 1.2]} />
      </mesh>
      <Post at={[-0.45, 0, -0.35]} h={2.3} r={0.055} m={m} />
      <Post at={[0.45, 0, -0.35]} h={2.3} r={0.055} m={m} />
      <Bar from={[-0.45, 2.28, -0.35]} to={[0.45, 2.28, -0.35]} r={0.05} m={m} />
      {/* the lever arm reaching over the seat, with its wide handle */}
      <Bar from={[0, 2.25, -0.35]} to={[0, 2.05, 0.55]} r={0.04} m={m} />
      <Bar from={[-0.55, 1.95, 0.55]} to={[0.55, 1.95, 0.55]} r={0.018} m={m} mat={m.rubber} />
      <Plates at={[0, 2.3, -0.75]} axis="x" count={2} m={m} />
      <mesh position={[0, 0.5, 0.35]} material={m.vinyl} castShadow>
        <boxGeometry args={[0.44, 0.09, 0.4]} />
      </mesh>
      <mesh position={[0, 0.78, 0.55]} rotation={[0, 0, Math.PI / 2]} material={m.vinyl} castShadow>
        <cylinderGeometry args={[0.07, 0.07, 0.5, 16]} />
      </mesh>
    </Machine>
  )
}

// ------------------------------------------------------------------ curved treadmill
/**
 * A curved manual treadmill: slatted belt in a shallow U, so running up the
 * front of the curve drives it, black side frames following the curve, and a
 * front handle frame. The belt's lowest point is at `belt` above the floor.
 */
/**
 * A curved, self-powered treadmill (the kind the coach runs on in his own
 * videos). A solid side frame runs from the curved deck down to the floor, so
 * the belt is carried by something rather than hanging in the air, with a
 * roller at each end. The slats travel at whatever speed the belt is running:
 * the player's when they are on it, the client's jog when the client is, and
 * still when nobody is.
 */
export function CurveTreadmill({ at, yaw, y, belt, m, speed }: {
  at: [number, number]; yaw: number; y: number; belt: number; m: Mats
  /** belt speed in m/s, read every frame */
  speed?: () => number
}) {
  const L = 1.9, W = 0.62
  const N = 46
  const curve = (t: number) => belt + 0.13 * t * t        // t in -1..1 along the deck
  const slats = useMemo(() => {
    const g = new BufferGeometry()
    const pos = new Float32BufferAttribute(new Float32Array(N * 4 * 3), 3)
    pos.setUsage(DynamicDrawUsage)
    g.setAttribute('position', pos)
    const idx: number[] = []
    for (let i = 0; i < N; i++) {
      const b = i * 4
      idx.push(b, b + 2, b + 1, b, b + 3, b + 2)
    }
    g.setIndex(idx)
    return g
  }, [])
  const travel = useRef(0)
  // lay the slats along the curve, shifted by how far the belt has moved
  const lay = (offset: number) => {
    const pos = slats.attributes.position as Float32BufferAttribute
    for (let i = 0; i < N; i++) {
      const k = (i + offset) % N
      const t0 = -1 + (k / N) * 2
      const t1 = Math.min(1, -1 + ((k + 0.82) / N) * 2)
      const x0 = t0 * L / 2, x1 = t1 * L / 2
      const y0 = curve(t0), y1 = curve(t1)
      pos.setXYZ(i * 4, x0, y0, -W / 2)
      pos.setXYZ(i * 4 + 1, x1, y1, -W / 2)
      pos.setXYZ(i * 4 + 2, x1, y1, W / 2)
      pos.setXYZ(i * 4 + 3, x0, y0, W / 2)
    }
    pos.needsUpdate = true
    slats.computeVertexNormals()
  }
  useMemo(() => lay(0), [slats, belt])   // eslint-disable-line react-hooks/exhaustive-deps
  useFrame((_, dt) => {
    const v = speed?.() ?? 0
    if (v < 0.01) return
    // slats move from the console end towards the back, at the belt speed
    const spacing = L / N
    travel.current = (travel.current + (v * Math.min(dt, 0.05)) / spacing) % N
    lay(N - travel.current)
  })

  // the side frame: a plate from the deck's curve down to the floor
  const skirt = useMemo(() => {
    const sh = new Shape()
    const pts = 24
    sh.moveTo(-L / 2 - 0.06, 0.03)
    for (let i = 0; i <= pts; i++) {
      const t = -1.06 + (i / pts) * 2.12
      sh.lineTo(t * L / 2, curve(Math.max(-1, Math.min(1, t))) - 0.02)
    }
    sh.lineTo(L / 2 + 0.06, 0.03)
    sh.closePath()
    const g = new ExtrudeGeometry(sh, { depth: 0.05, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 2 })
    g.translate(0, 0, -0.025)
    return g
  }, [belt])  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    addCollider({ x: at[0], z: at[1], hx: 1.0, hz: 0.42, angle: yaw })
  }, [at, yaw])
  return (
    <group position={[at[0], y, at[1]]} rotation={[0, yaw, 0]} userData={{ dynamic: true }}>
      <mesh geometry={slats} material={m.rubber} receiveShadow castShadow />
      {[-1, 1].map((s) => (
        <mesh key={s} geometry={skirt} material={m.vinyl} position={[0, 0, s * (W / 2 + 0.05)]} castShadow receiveShadow />
      ))}
      {/* a floor rail under each side, and a roller at each end of the deck */}
      {[-1, 1].map((s) => (
        <mesh key={`r${s}`} position={[0, 0.025, s * (W / 2 + 0.05)]} material={m.rubber} receiveShadow>
          <boxGeometry args={[L + 0.2, 0.05, 0.1]} />
        </mesh>
      ))}
      {[-1, 1].map((e) => (
        <mesh key={`e${e}`} position={[e * L / 2, curve(e) - 0.04, 0]} rotation={[Math.PI / 2, 0, 0]} material={m.vinyl} castShadow>
          <cylinderGeometry args={[0.045, 0.045, W + 0.08, 16]} />
        </mesh>
      ))}
      {/* a cross member under the middle of the deck, to the floor */}
      <mesh position={[0, (belt - 0.03) / 2, 0]} material={m.vinyl}>
        <boxGeometry args={[0.12, belt - 0.03, W]} />
      </mesh>
      {[-1, 1].map((s) => (
        <Bar key={s} from={[L / 2 - 0.05, curve(1), s * (W / 2 + 0.05)]} to={[L / 2 - 0.2, 1.15, s * 0.3]} r={0.03} m={m} mat={m.vinyl} />
      ))}
      <Bar from={[L / 2 - 0.2, 1.15, -0.3]} to={[L / 2 - 0.2, 1.15, 0.3]} r={0.022} m={m} mat={m.rubber} />
      <mesh position={[L / 2 - 0.18, 1.22, 0]} rotation={[0, 0, 0.3]} material={m.vinyl}>
        <boxGeometry args={[0.04, 0.16, 0.26]} />
      </mesh>
      <Text font={DISPLAY_FONT} position={[0, belt - 0.06, W / 2 + 0.115]} fontSize={0.09} color="#f2f2ee"
        anchorX="center" letterSpacing={0.2}>
        COACH BLUE
      </Text>
    </group>
  )
}

// ------------------------------------------------------------------ surroundings
/** A wood-chip bed round the rubber floor, as outdoor gyms are finished. */
export function ChipBorder({ cx, cz, angle, y, w, d }: { cx: number; cz: number; angle: number; y: number; w: number; d: number }) {
  const mat = useMemo(() => {
    const map = scannedTexture('woodchip_diff', 1, true).clone()
    const nor = scannedTexture('woodchip_nor', 1).clone()
    map.repeat.set(3, 3); nor.repeat.set(3, 3)
    map.needsUpdate = true; nor.needsUpdate = true
    return new MeshStandardMaterial({ map, normalMap: nor, roughness: 1, color: new Color('#b89f84') })
  }, [])
  const B = 1.8
  const strips: [number, number, number, number][] = [
    [w + B * 2, B, 0, -(d / 2 + B / 2)], [w + B * 2, B, 0, d / 2 + B / 2],
    [B, d, -(w / 2 + B / 2), 0], [B, d, w / 2 + B / 2, 0],
  ]
  return (
    <group position={[cx, y, cz]} rotation={[0, angle, 0]}>
      {strips.map(([sw, sd, x, z], i) => (
        <mesh key={i} position={[x, -0.36, z]} material={mat} receiveShadow>
          <boxGeometry args={[sw, 0.6, sd]} />
        </mesh>
      ))}
    </group>
  )
}

export function PicnicTable({ place, angle, m }: { place: Place; angle: number; m: Mats }) {
  const [x, z] = place(6.2, 9.6)
  const y = groundHeight(x, z)
  useEffect(() => {
    addCollider({ x, z, hx: 0.95, hz: 0.85, angle })
    // a place on each bench, facing the table
    const c = Math.cos(angle), s = Math.sin(angle)
    const offs = ([[-0.4, 0.66, angle + Math.PI], [0.4, -0.66, angle]] as const).map(([lx, lz, yaw], i) =>
      registerSeat({
        id: `picnic-${i}`, at: [x + lx * c + lz * s, z - lx * s + lz * c], ground: y, yaw, height: 0.47,
      }))
    return () => offs.forEach((o) => o())
  }, [x, z, y, angle])
  return (
    <group position={[x, y, z]} rotation={[0, angle, 0]}>
      {/* the top and the two benches, planks with gaps */}
      {[-0.22, 0, 0.22].map((pz) => (
        <mesh key={pz} position={[0, 0.76, pz]} material={m.wood} castShadow receiveShadow>
          <boxGeometry args={[1.8, 0.045, 0.2]} />
        </mesh>
      ))}
      {[-0.62, 0.62].map((pz) => (
        <mesh key={pz} position={[0, 0.45, pz]} material={m.wood} castShadow receiveShadow>
          <boxGeometry args={[1.8, 0.045, 0.26]} />
        </mesh>
      ))}
      {/* A-frame legs, steel */}
      {[-0.7, 0.7].map((px) => (
        <group key={px}>
          <Bar from={[px, 0, -0.75]} to={[px, 0.74, 0.1]} r={0.022} m={m} />
          <Bar from={[px, 0, 0.75]} to={[px, 0.74, -0.1]} r={0.022} m={m} />
          <Bar from={[px, 0.43, -0.78]} to={[px, 0.43, 0.78]} r={0.02} m={m} />
        </group>
      ))}
    </group>
  )
}
