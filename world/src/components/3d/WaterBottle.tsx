import {
  BufferGeometry, CanvasTexture, CylinderGeometry, DoubleSide, Group, LatheGeometry, Mesh, MeshPhysicalMaterial, MeshStandardMaterial,
  Material, SRGBColorSpace, Vector2,
} from 'three'

/**
 * A 500 ml bottle of still water, modelled to the real thing: 20.5 cm tall,
 * 6.6 cm across, a moulded base, three grip ridges at the waist, a wrapped
 * label, a shoulder narrowing to a threaded neck and a ribbed blue cap. The
 * plastic is clear and glossy; the water inside fills it to the shoulder.
 *
 * The origin is at the middle of its base. Everything is shared, so a
 * bottle costs a handful of draw calls however many there are.
 */
export const BOTTLE_HEIGHT = 0.205
const R = 0.033

// the outline, base to lip: [radius, height]
const PROFILE: [number, number][] = [
  [0, 0.002], [0.018, 0.0], [0.028, 0.003], [0.032, 0.009], [R, 0.018],
  [R, 0.058], [0.0305, 0.064], [R, 0.07], [0.0305, 0.076], [R, 0.082], [0.0305, 0.088], [R, 0.094],
  [R, 0.138], [0.031, 0.15], [0.025, 0.163], [0.018, 0.172], [0.0135, 0.178], [0.0135, 0.19],
]
const FILL = 0.148

let shared: ReturnType<typeof build> | null = null

function labelTexture() {
  const c = document.createElement('canvas')
  c.width = 512
  c.height = 128
  const x = c.getContext('2d')!
  const g = x.createLinearGradient(0, 0, 0, 128)
  g.addColorStop(0, '#1d4f9c')
  g.addColorStop(1, '#2f7fd6')
  x.fillStyle = g
  x.fillRect(0, 0, 512, 128)
  x.fillStyle = '#ffffff'
  x.fillRect(0, 10, 512, 3)
  x.fillRect(0, 115, 512, 3)
  x.textAlign = 'center'
  x.font = 'bold 44px "Barlow Condensed", Arial Narrow, sans-serif'
  x.fillText('COACH BLUE', 128, 66)
  x.fillText('COACH BLUE', 384, 66)
  x.font = '600 17px Arial, sans-serif'
  x.fillStyle = '#cfe6ff'
  x.fillText('NATURAL SPRING WATER · 500 ml', 128, 96)
  x.fillText('NATURAL SPRING WATER · 500 ml', 384, 96)
  const t = new CanvasTexture(c)
  t.colorSpace = SRGBColorSpace
  t.anisotropy = 4
  return t
}

function build() {
  const pts = PROFILE.map(([r, y]) => new Vector2(r, y))
  const shell = new LatheGeometry(pts, 36)
  // the water: the same outline pulled in by the wall, cut off at the fill line
  const inner: Vector2[] = [new Vector2(0, 0.004)]
  for (let i = 1; i < PROFILE.length; i++) {
    const [r, y] = PROFILE[i]
    if (y > FILL) break
    inner.push(new Vector2(Math.max(0, r - 0.0018), Math.max(0.004, y)))
  }
  const last = inner[inner.length - 1]
  inner.push(new Vector2(last.x, FILL), new Vector2(0, FILL))
  const water = new LatheGeometry(inner, 32)
  const label = new CylinderGeometry(R + 0.0006, R + 0.0006, 0.042, 36, 1, true)
  label.translate(0, 0.116, 0)
  const cap = new CylinderGeometry(0.0152, 0.0152, 0.019, 28)
  cap.translate(0, 0.19 + 0.0085, 0)
  const ring = new CylinderGeometry(0.0158, 0.0158, 0.003, 28)
  ring.translate(0, 0.1885, 0)

  const plastic = new MeshPhysicalMaterial({
    color: '#f4fbff', transparent: true, opacity: 0.13, roughness: 0.04, metalness: 0,
    clearcoat: 1, clearcoatRoughness: 0.03, specularIntensity: 1, ior: 1.46,
    side: DoubleSide, depthWrite: false,
  })
  const waterMat = new MeshPhysicalMaterial({
    color: '#aee0f2', transparent: true, opacity: 0.2, roughness: 0.02, metalness: 0,
    clearcoat: 1, ior: 1.33, depthWrite: false,
  })
  const labelMat = new MeshStandardMaterial({ map: labelTexture(), roughness: 0.35, metalness: 0.05 })
  const capMat = new MeshStandardMaterial({ color: '#1f5fc4', roughness: 0.45 })
  return { shell, water, label, cap, ring, plastic, waterMat, labelMat, capMat }
}

/** A new bottle object (sharing geometry and materials with every other). */
export function makeWaterBottle() {
  shared ??= build()
  const s = shared
  const g = new Group()
  const add = (geo: BufferGeometry, mat: Material, order = 0, shadow = true) => {
    const m = new Mesh(geo, mat)
    m.castShadow = shadow
    m.renderOrder = order
    g.add(m)
    return m
  }
  add(s.water, s.waterMat, 1, false)
  add(s.label, s.labelMat)
  add(s.cap, s.capMat)
  add(s.ring, s.capMat)
  add(s.shell, s.plastic, 2, false)       // clear plastic throws next to no shadow
  return g
}
