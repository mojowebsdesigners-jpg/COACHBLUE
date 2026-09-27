import {
  MeshStandardMaterial, RepeatWrapping, SRGBColorSpace, TextureLoader, Vector2,
  type Texture,
} from 'three'

/**
 * Photoscanned CC0 materials (Poly Haven) shared across the world. Everything
 * is loaded once, tiled, and handed out as ready-made materials so the same
 * asphalt, bark or grass is never decoded twice.
 */
const loader = new TextureLoader()
const cache = new Map<string, Texture>()

function tex(name: string, repeat: number, srgb = false) {
  const key = `${name}:${repeat}:${srgb}`
  const hit = cache.get(key)
  if (hit) return hit
  const t = loader.load(`/tex/${name}.webp`)
  t.wrapS = t.wrapT = RepeatWrapping
  t.repeat.set(repeat, repeat)
  t.anisotropy = 8
  if (srgb) t.colorSpace = SRGBColorSpace
  cache.set(key, t)
  return t
}

export type ScannedName = 'grass' | 'forest' | 'dirt' | 'asphalt' | 'bark' | 'rock' | 'concrete'

/** A full PBR set: colour, normal and roughness, tiled to world scale. */
export function scanned(name: ScannedName, repeat = 1, opts: Partial<MeshStandardMaterial> = {}) {
  return new MeshStandardMaterial({
    map: tex(`${name}_diff`, repeat, true),
    normalMap: tex(`${name}_nor`, repeat),
    roughnessMap: tex(`${name}_rough`, repeat),
    normalScale: new Vector2(1, 1),
    roughness: 1,
    metalness: 0,
    ...opts,
  })
}

export const scannedTexture = tex

/** Alpha-mapped foliage card — leaves for canopies, tufts for ground cover. */
export function foliage(file: 'leaves' | 'grass_card' | 'leafcluster' | 'fern', opts: Partial<MeshStandardMaterial> = {}) {
  const map = loader.load(`/tex/${file}.webp`)
  map.colorSpace = SRGBColorSpace
  map.anisotropy = 4
  return new MeshStandardMaterial({
    map,
    // no alphaMap: that samples the green channel, which would cut green leaves
    // away. alphaTest uses the map's own alpha, which is what the card has.
    transparent: false,
    alphaTest: 0.35,
    depthWrite: true,
    roughness: 0.92,
    metalness: 0,
    ...opts,
  })
}
