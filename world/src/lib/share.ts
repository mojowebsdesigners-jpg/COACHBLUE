// Builds a branded image from whatever is on screen: the view, the brand mark,
// and how much of the world the visitor found. Nothing personal is included.

const WIDTH = 1200
const HEIGHT = 675
const MINT = '#1de9b6'

function loadImage(src: string) {
  return new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}

export async function buildShareCard(opts: { found: number; total: number }) {
  const source = document.querySelector('canvas')
  if (!source) return null

  const card = document.createElement('canvas')
  card.width = WIDTH
  card.height = HEIGHT
  const ctx = card.getContext('2d')
  if (!ctx) return null

  // the view, cropped to fill
  const scale = Math.max(WIDTH / source.width, HEIGHT / source.height)
  const w = source.width * scale
  const h = source.height * scale
  try {
    ctx.drawImage(source, (WIDTH - w) / 2, (HEIGHT - h) / 2, w, h)
  } catch {
    return null    // tainted or lost context — skip rather than fail loudly
  }

  // darken from the bottom so the type always reads
  const shade = ctx.createLinearGradient(0, HEIGHT * 0.25, 0, HEIGHT)
  shade.addColorStop(0, 'rgba(6, 10, 9, 0)')
  shade.addColorStop(1, 'rgba(6, 10, 9, 0.88)')
  ctx.fillStyle = shade
  ctx.fillRect(0, 0, WIDTH, HEIGHT)

  const logo = await loadImage('/img/logo.webp')
  if (logo) ctx.drawImage(logo, 54, 44, 52, 54)

  ctx.fillStyle = '#ffffff'
  ctx.font = '600 22px "Barlow Condensed", Arial Narrow, sans-serif'
  ctx.letterSpacing = '6px'
  ctx.fillText('COACH BLUE', 122, 80)

  ctx.font = '700 84px "Barlow Condensed", Arial Narrow, sans-serif'
  ctx.letterSpacing = '2px'
  ctx.fillText('I WALKED THE JOURNEY', 54, HEIGHT - 150)

  ctx.fillStyle = MINT
  ctx.font = '600 26px "Barlow Condensed", Arial Narrow, sans-serif'
  ctx.letterSpacing = '5px'
  ctx.fillText(`${opts.found} OF ${opts.total} PLACES FOUND`, 56, HEIGHT - 104)

  ctx.fillStyle = 'rgba(255, 255, 255, 0.75)'
  ctx.font = '400 22px Inter, system-ui, sans-serif'
  ctx.letterSpacing = '1px'
  ctx.fillText('coach-blue.com', 56, HEIGHT - 60)

  ctx.strokeStyle = 'rgba(29, 233, 182, 0.55)'
  ctx.lineWidth = 2
  ctx.strokeRect(20, 20, WIDTH - 40, HEIGHT - 40)

  return card.toDataURL('image/png')
}

export function downloadDataUrl(dataUrl: string, filename = 'coach-blue-journey.png') {
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
}
