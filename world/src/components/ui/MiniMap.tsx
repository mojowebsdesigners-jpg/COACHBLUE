import { useEffect, useRef } from 'react'
import { locations } from '../../data/journey'
import { pathSamples, terrainHeight } from '../../lib/terrain'
import { player, useStore } from '../../state/store'
import { nav, setDestination } from '../../systems/Navigation'

const SIZE = 460
const EXTENT = 210     // world units covered by the map

const toPx = (x: number, z: number) => ({
  px: ((x + EXTENT) / (EXTENT * 2)) * SIZE,
  py: ((z + EXTENT) / (EXTENT * 2)) * SIZE,
})

/** Baked once: a stylised relief of the forest floor. */
let baseCanvas: HTMLCanvasElement | null = null
function buildBase() {
  if (baseCanvas) return baseCanvas
  const c = document.createElement('canvas')
  c.width = SIZE
  c.height = SIZE
  const ctx = c.getContext('2d')!
  const img = ctx.createImageData(SIZE, SIZE)
  const step = 2
  for (let py = 0; py < SIZE; py += step) {
    for (let px = 0; px < SIZE; px += step) {
      const x = (px / SIZE) * EXTENT * 2 - EXTENT
      const z = (py / SIZE) * EXTENT * 2 - EXTENT
      const h = terrainHeight(x, z)
      const t = Math.min(1, Math.max(0, (h + 4) / 44))
      // dark forest floor -> pale summit, with contour banding
      const band = Math.abs((h % 4) - 2) / 2
      const r = 18 + t * 150 + band * 12
      const g = 30 + t * 150 + band * 14
      const b = 26 + t * 140 + band * 12
      const inside = Math.hypot(x, z) < EXTENT - 6
      for (let dy = 0; dy < step; dy++) {
        for (let dx = 0; dx < step; dx++) {
          const i = ((py + dy) * SIZE + px + dx) * 4
          img.data[i] = inside ? r : 8
          img.data[i + 1] = inside ? g : 10
          img.data[i + 2] = inside ? b : 10
          img.data[i + 3] = inside ? 235 : 90
        }
      }
    }
  }
  ctx.putImageData(img, 0, 0)

  // the trail
  ctx.strokeStyle = 'rgba(232, 222, 196, 0.85)'
  ctx.lineWidth = 2.4
  ctx.beginPath()
  pathSamples.forEach((s, i) => {
    const { px, py } = toPx(s.x, s.z)
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  })
  ctx.stroke()
  baseCanvas = c
  return c
}

export function MiniMap() {
  const open = useStore((s) => s.mapOpen)
  const setMap = useStore((s) => s.setMap)
  const discovered = useStore((s) => s.discovered)
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!open) return
    let raf = 0
    const draw = () => {
      const c = canvas.current
      if (!c) return
      const ctx = c.getContext('2d')!
      ctx.clearRect(0, 0, SIZE, SIZE)
      ctx.drawImage(buildBase(), 0, 0)

      for (const l of locations) {
        const { px, py } = toPx(l.pos[0], l.pos[1])
        const found = discovered.includes(l.id)
        ctx.beginPath()
        ctx.arc(px, py, found ? 6 : 4.5, 0, Math.PI * 2)
        ctx.fillStyle = found ? '#1de9b6' : 'rgba(255,255,255,0.28)'
        ctx.fill()
        if (found) {
          ctx.font = '600 11px "Barlow Condensed", sans-serif'
          ctx.fillStyle = 'rgba(255,255,255,0.9)'
          ctx.fillText(l.name.toUpperCase(), px + 9, py + 4)
        }
      }

      // player arrow
      const { px, py } = toPx(player.pos.x, player.pos.z)
      ctx.save()
      ctx.translate(px, py)
      ctx.rotate(-player.yaw)
      ctx.beginPath()
      ctx.moveTo(0, -9)
      ctx.lineTo(6, 7)
      ctx.lineTo(0, 3)
      ctx.lineTo(-6, 7)
      ctx.closePath()
      ctx.fillStyle = '#fff'
      ctx.fill()
      ctx.restore()

      raf = requestAnimationFrame(draw)
    }
    draw()
    return () => cancelAnimationFrame(raf)
  }, [open, discovered])

  if (!open) return null

  return (
    <div className="map-wrap" onClick={() => setMap(false)}>
      <div className="map-inner" onClick={(e) => e.stopPropagation()}>
        <span className="eyebrow">The forest</span>
        <div className="map-stage">
          {/* tilt inline so it can't be lost to a stylesheet — a miniature of the valley */}
          <canvas
            ref={canvas}
            className="map-canvas"
            width={SIZE}
            height={SIZE}
            style={{ transform: 'rotateX(46deg) rotateZ(0deg) translateZ(0)' }}
          />
        </div>
        <div className="map-legend">
          {locations.map((l) => (
            <button
              key={l.id}
              className={`map-place ${discovered.includes(l.id) ? 'found' : ''} ${nav.destination === l.id ? 'routed' : ''}`}
              onClick={() => {
                // picking a place sets a heading, never a rail: movement is
                // untouched and wandering off simply grows the distance
                setDestination(nav.destination === l.id ? null : l.id)
                setMap(false)
              }}
              title={nav.destination === l.id ? 'Clear route' : `Route to ${l.name}`}
            >
              <b>{discovered.includes(l.id) ? '✓' : '○'}</b>
              <span>{l.name}</span>
              <i>{nav.destination === l.id ? 'Routed' : 'Route'}</i>
            </button>
          ))}
        </div>
        <br />
        <button className="btn" onClick={() => setMap(false)}>Close map</button>
      </div>
    </div>
  )
}
