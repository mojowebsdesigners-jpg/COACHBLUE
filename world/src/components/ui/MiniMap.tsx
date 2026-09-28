import { useEffect, useMemo, useRef, useState } from 'react'
import { locations } from '../../data/journey'
import {
  GYM, GYM_SLAB_D, GYM_SLAB_W, LAKE, POOL, lakeRadius, pathSamples, streamDistanceAt, terrainHeight,
} from '../../lib/terrain'
import { player, useStore } from '../../state/store'
import { vehicle } from '../../systems/VehicleController'
import { travelTo } from '../../systems/FastTravel'
import { GROUP_ZOOM, MAP_ICON, mapPoints, onMapPoints, type MapPoint } from '../../systems/MapPoints'

/**
 * The map, GTA-style: the whole valley laid out flat, big, and alive.
 *
 * Scroll to zoom, drag to pan. Every place and activity has an icon; hover it
 * to read what it is. Click an icon — or any open ground — and you travel
 * there (the skycam in systems/FastTravel lifts you out of the world and
 * drops you in). Your arrow and the car are on it too.
 */
const RES = 1024           // the baked relief, in pixels
const EXTENT = 215         // world metres from the centre to each edge

/** Baked once: relief shading, water, the road, the gym slab. */
let baseCanvas: HTMLCanvasElement | null = null
function buildBase() {
  if (baseCanvas) return baseCanvas
  const c = document.createElement('canvas')
  c.width = c.height = RES
  const ctx = c.getContext('2d')!
  const img = ctx.createImageData(RES, RES)
  const step = 2
  const toW = (p: number) => (p / RES) * EXTENT * 2 - EXTENT
  const sun = [-0.55, 0.62, -0.56]
  for (let py = 0; py < RES; py += step) {
    for (let px = 0; px < RES; px += step) {
      const x = toW(px), z = toW(py)
      const h = terrainHeight(x, z)
      // hill shading from a low sun in the north-west, like a real relief map
      const e = 1.5
      const hx = terrainHeight(x + e, z) - terrainHeight(x - e, z)
      const hz = terrainHeight(x, z + e) - terrainHeight(x, z - e)
      const nl = Math.hypot(hx, 2 * e, hz)
      const shade = Math.max(0.35, (-hx * sun[0] + 2 * e * sun[1] - hz * sun[2]) / nl)
      const t = Math.min(1, Math.max(0, (h + 2) / 50))
      // grass low down, olive and then stone higher up, with contour lines
      let r = 88 + t * 110, g = 128 + t * 70, b = 72 + t * 80
      const contour = Math.abs((h % 5) - 2.5) < 0.18 ? 0.86 : 1
      r *= shade * contour; g *= shade * contour; b *= shade * contour
      if (streamDistanceAt(x, z) < 2.4) { r = 70; g = 150; b = 200 }
      const out = Math.hypot(x, z) > EXTENT - 4
      for (let dy = 0; dy < step; dy++) for (let dx = 0; dx < step; dx++) {
        const i = ((py + dy) * RES + px + dx) * 4
        img.data[i] = out ? 12 : r
        img.data[i + 1] = out ? 16 : g
        img.data[i + 2] = out ? 18 : b
        img.data[i + 3] = 255
      }
    }
  }
  ctx.putImageData(img, 0, 0)
  const P = (x: number, z: number): [number, number] => [((x + EXTENT) / (EXTENT * 2)) * RES, ((z + EXTENT) / (EXTENT * 2)) * RES]
  const scale = RES / (EXTENT * 2)
  // the lake
  ctx.beginPath()
  for (let k = 0; k <= 64; k++) {
    const a = (k / 64) * Math.PI * 2
    const [px, py] = P(LAKE.x + Math.cos(a) * lakeRadius(a), LAKE.z + Math.sin(a) * lakeRadius(a))
    if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py)
  }
  ctx.fillStyle = '#3aa7c9'
  ctx.fill()
  ctx.strokeStyle = '#f1e4c2'
  ctx.lineWidth = 3
  ctx.stroke()
  // the pool and the gym slab, as rotated rectangles
  const rect = (cx: number, cz: number, hw: number, hd: number, angle: number, fill: string) => {
    const [px, py] = P(cx, cz)
    ctx.save()
    ctx.translate(px, py)
    ctx.rotate(-angle)
    ctx.fillStyle = fill
    ctx.fillRect(-hw * scale, -hd * scale, hw * 2 * scale, hd * 2 * scale)
    ctx.restore()
  }
  rect(POOL.x, POOL.z, POOL.hx + POOL.deck, POOL.hz + POOL.deck, POOL.angle, '#e8e1d0')
  rect(POOL.x, POOL.z, POOL.hx, POOL.hz, POOL.angle, '#57c7e3')
  rect(GYM.cx, GYM.cz, GYM_SLAB_W / 2, GYM_SLAB_D / 2, GYM.angle, '#8c1d2a')
  // the road: a dark casing and a pale centre, like a real road map
  for (const [w, col] of [[9, '#2b2b2e'], [6, '#f4f1ea']] as const) {
    ctx.strokeStyle = col
    ctx.lineWidth = w
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.beginPath()
    pathSamples.forEach((s, i) => {
      const [px, py] = P(s.x, s.z)
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py)
    })
    ctx.stroke()
  }
  baseCanvas = c
  return c
}

function usePoints() {
  const [, bump] = useState(0)
  useEffect(() => onMapPoints(() => bump((n) => n + 1)), [])
  const discovered = useStore((s) => s.discovered)
  // the journey's places are always there; everything else registers itself
  const fixed: MapPoint[] = useMemo(() => locations.map((l) => ({
    id: `loc-${l.id}`, name: l.name, x: l.pos[0], z: l.pos[1],
    kind: l.id === 'coach' ? 'coach' : l.id === 'bootcamp' ? 'sport' : l.id === 'funpark' ? 'fun' : l.id === 'stunts' ? 'car' : 'place',
    blurb: l.id === 'funpark' ? 'Nineteen things to play — zoom in' : l.id === 'stunts' ? 'Ramp, donuts, car bowling — zoom in' : undefined,
  } as MapPoint)), [])
  return { points: [...fixed, ...mapPoints()], discovered }
}

export function MiniMap() {
  const open = useStore((s) => s.mapOpen)
  const setMap = useStore((s) => s.setMap)
  const canvas = useRef<HTMLCanvasElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const view = useRef({ zoom: 1, cx: 0, cz: 0 })
  const drag = useRef<{ x: number; y: number; cx: number; cz: number; moved: boolean } | null>(null)
  const [hover, setHover] = useState<MapPoint | null>(null)
  const [cursor, setCursor] = useState<{ x: number; z: number } | null>(null)
  const { points, discovered } = usePoints()

  // open centred on you
  useEffect(() => {
    if (!open) return
    view.current = { zoom: 1.35, cx: player.pos.x, cz: player.pos.z }
    clampView()
  }, [open])

  /** keep the view over the valley: never scroll off into the dark */
  function clampView() {
    const v = view.current
    const half = EXTENT / v.zoom
    const lim = Math.max(0, EXTENT - half - 8)
    v.cx = Math.min(lim, Math.max(-lim, v.cx))
    v.cz = Math.min(lim, Math.max(-lim, v.cz))
  }

  // screen <-> world
  const size = () => canvas.current?.clientWidth ?? 800
  const toScreen = (x: number, z: number) => {
    const v = view.current, S = size()
    const k = (S / (EXTENT * 2)) * v.zoom
    return { sx: S / 2 + (x - v.cx) * k, sy: S / 2 + (z - v.cz) * k }
  }
  const toWorld = (sx: number, sy: number) => {
    const v = view.current, S = size()
    const k = (S / (EXTENT * 2)) * v.zoom
    return { x: v.cx + (sx - S / 2) / k, z: v.cz + (sy - S / 2) / k }
  }

  useEffect(() => {
    if (!open) return
    let raf = 0
    const draw = () => {
      const c = canvas.current
      if (!c) return
      const S = c.clientWidth
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      if (c.width !== S * dpr) { c.width = S * dpr; c.height = S * dpr }
      const ctx = c.getContext('2d')!
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.fillStyle = '#0c1012'
      ctx.fillRect(0, 0, S, S)
      // the baked relief, placed by the view
      const a = toScreen(-EXTENT, -EXTENT), b = toScreen(EXTENT, EXTENT)
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(buildBase(), a.sx, a.sy, b.sx - a.sx, b.sy - a.sy)

      // icons
      const t = performance.now() / 1000
      for (const p of points) {
        if (p.group && view.current.zoom < GROUP_ZOOM) continue
        const { sx, sy } = toScreen(p.x, p.z)
        if (sx < -20 || sy < -20 || sx > S + 20 || sy > S + 20) continue
        const icon = MAP_ICON[p.kind]
        const found = !p.id.startsWith('loc-') || discovered.includes(p.id.slice(4) as never)
        const hot = hover?.id === p.id
        const r = hot ? 15 : 12
        ctx.beginPath()
        ctx.arc(sx, sy, r, 0, Math.PI * 2)
        ctx.fillStyle = found ? 'rgba(10,14,16,0.88)' : 'rgba(10,14,16,0.55)'
        ctx.fill()
        ctx.lineWidth = hot ? 3 : 2
        ctx.strokeStyle = found ? icon.colour : 'rgba(255,255,255,0.35)'
        ctx.stroke()
        ctx.font = `${hot ? 15 : 12}px system-ui, "Segoe UI Emoji", sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillStyle = found ? icon.colour : 'rgba(255,255,255,0.55)'
        ctx.fillText(found ? icon.glyph : '?', sx, sy + 1)
      }

      // the car
      if (!vehicle.occupied) {
        const { sx, sy } = toScreen(vehicle.pos.x, vehicle.pos.z)
        ctx.font = '16px system-ui, "Segoe UI Emoji", sans-serif'
        ctx.fillText('🚗', sx, sy)
      }
      // you: a pulsing ring and an arrow
      const me = toScreen(player.pos.x, player.pos.z)
      ctx.beginPath()
      ctx.arc(me.sx, me.sy, 14 + Math.sin(t * 3) * 3, 0, Math.PI * 2)
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'
      ctx.lineWidth = 2
      ctx.stroke()
      ctx.save()
      ctx.translate(me.sx, me.sy)
      ctx.rotate(Math.PI - player.yaw)
      ctx.beginPath()
      ctx.moveTo(0, -11); ctx.lineTo(8, 9); ctx.lineTo(0, 4); ctx.lineTo(-8, 9); ctx.closePath()
      ctx.fillStyle = '#ffffff'
      ctx.fill()
      ctx.strokeStyle = '#0c1012'
      ctx.lineWidth = 1.5
      ctx.stroke()
      ctx.restore()
      // where a click on open ground would take you
      if (cursor && !hover) {
        const { sx, sy } = toScreen(cursor.x, cursor.z)
        ctx.strokeStyle = 'rgba(29,233,182,0.9)'
        ctx.lineWidth = 2
        ctx.beginPath(); ctx.arc(sx, sy, 8, 0, Math.PI * 2); ctx.stroke()
        ctx.beginPath(); ctx.moveTo(sx - 13, sy); ctx.lineTo(sx + 13, sy); ctx.moveTo(sx, sy - 13); ctx.lineTo(sx, sy + 13); ctx.stroke()
      }
      raf = requestAnimationFrame(draw)
    }
    draw()
    return () => cancelAnimationFrame(raf)
  })

  if (!open) return null

  const pick = (sx: number, sy: number) => {
    let best: MapPoint | null = null, bd = 18 * 18
    for (const p of points) {
      if (p.group && view.current.zoom < GROUP_ZOOM) continue
      const s = toScreen(p.x, p.z)
      const d = (s.sx - sx) ** 2 + (s.sy - sy) ** 2
      if (d < bd) { bd = d; best = p }
    }
    return best
  }
  const local = (e: React.PointerEvent | React.WheelEvent) => {
    const r = canvas.current!.getBoundingClientRect()
    return { sx: e.clientX - r.left, sy: e.clientY - r.top }
  }
  const go = (x: number, z: number, name: string) => {
    setMap(false)
    // give the map a moment to close before the camera lifts
    window.setTimeout(() => travelTo(x, z, name), 60)
  }

  return (
    <div className="map-wrap" onClick={() => setMap(false)}>
      <div className="map-inner big" onClick={(e) => e.stopPropagation()} ref={box}>
        <div className="map-head">
          <span className="eyebrow">Coach Blue's valley</span>
          <span className="map-help">Scroll to zoom · drag to move · click anywhere to go there</span>
          <button className="btn" onClick={() => setMap(false)}>Close <kbd>M</kbd></button>
        </div>
        <div className="map-stage flat">
          <canvas
            ref={canvas}
            className="map-canvas big"
            onWheel={(e) => {
              const v = view.current
              const { sx, sy } = local(e)
              const before = toWorld(sx, sy)
              v.zoom = Math.min(6, Math.max(1, v.zoom * (e.deltaY < 0 ? 1.18 : 1 / 1.18)))
              // zoom about the pointer
              const after = toWorld(sx, sy)
              v.cx += before.x - after.x
              v.cz += before.z - after.z
              clampView()
            }}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId)
              drag.current = { x: e.clientX, y: e.clientY, cx: view.current.cx, cz: view.current.cz, moved: false }
            }}
            onPointerMove={(e) => {
              const { sx, sy } = local(e)
              const d = drag.current
              if (d) {
                const dx = e.clientX - d.x, dy = e.clientY - d.y
                if (Math.hypot(dx, dy) > 4) d.moved = true
                if (d.moved) {
                  const k = (size() / (EXTENT * 2)) * view.current.zoom
                  view.current.cx = d.cx - dx / k
                  view.current.cz = d.cz - dy / k
                  clampView()
                }
              }
              setHover(pick(sx, sy))
              setCursor(toWorld(sx, sy))
            }}
            onPointerLeave={() => { setHover(null); setCursor(null) }}
            onPointerUp={(e) => {
              const d = drag.current
              drag.current = null
              if (d?.moved) return
              const { sx, sy } = local(e)
              const p = pick(sx, sy)
              if (p) go(p.x, p.z, p.name)
              else {
                const w = toWorld(sx, sy)
                if (Math.hypot(w.x, w.z) < EXTENT - 12) go(w.x, w.z, 'Dropping you in')
              }
            }}
          />
          {hover && (
            <div className="map-tip" style={{ left: toScreen(hover.x, hover.z).sx, top: toScreen(hover.x, hover.z).sy }}>
              <b>{hover.name}</b>
              {hover.blurb && <span>{hover.blurb}</span>}
              <i>Click to go</i>
            </div>
          )}
        </div>
        <div className="map-key">
          {(['place', 'gym', 'sport', 'fun', 'water', 'rest', 'food'] as const).map((k) => (
            <span key={k}><b style={{ color: MAP_ICON[k].colour }}>{MAP_ICON[k].glyph}</b>{
              { place: 'Journey', gym: 'Training', sport: 'Sport & drills', fun: 'Just for fun', water: 'Water', rest: 'Take a break', food: 'Forage' }[k]
            }</span>
          ))}
        </div>
      </div>
    </div>
  )
}
