import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  AdditiveBlending, BackSide, BufferGeometry, Color, Float32BufferAttribute, Mesh,
  Points, PointsMaterial, ShaderMaterial, SphereGeometry, Vector3,
} from 'three'
import type { DayState } from '../../lib/dayCycle'
import { rand } from '../../lib/terrain'
import { player, useStore } from '../../state/store'

/**
 * Sky dome: a physically-flavoured gradient, a sun with glow, drifting cloud
 * banks and stars that come out at night. All of it takes its colours from the
 * day cycle, so the horizon, fog and sunlight always agree.
 */
const SKY_VERT = `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const SKY_FRAG = `
  uniform vec3 uHorizon;
  uniform vec3 uZenith;
  uniform vec3 uSunColor;
  uniform vec3 uSunDir;
  uniform vec3 uMoonDir;
  uniform float uTime;
  uniform float uCloud;      // cloud cover 0..1
  uniform float uNight;      // 0 day .. 1 night
  varying vec3 vDir;

  // value noise + fbm, enough for soft cloud banks
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.02; a *= 0.5; }
    return v;
  }

  void main() {
    vec3 d = normalize(vDir);
    float h = clamp(d.y * 1.1 + 0.06, 0.0, 1.0);

    // base gradient, deeper overhead, hazier at the horizon
    vec3 col = mix(uHorizon, uZenith, pow(h, 0.42));

    float sun = max(dot(d, normalize(uSunDir)), 0.0);
    col += uSunColor * pow(sun, 900.0) * 6.0;                 // disc
    col += uSunColor * pow(sun, 12.0) * 0.35;                 // tight glow
    col += uSunColor * pow(sun, 3.0) * 0.12;                  // wide scatter
    col += uSunColor * pow(1.0 - h, 8.0) * 0.20;              // horizon warmth

    // the moon: a soft disc with a faint halo, only once it is dark
    float moon = max(dot(d, normalize(uMoonDir)), 0.0);
    float moonDisc = smoothstep(0.9982, 0.9993, moon);
    col += vec3(0.86, 0.90, 1.0) * moonDisc * 2.6 * uNight;
    col += vec3(0.42, 0.48, 0.62) * pow(moon, 90.0) * 0.5 * uNight;

    // clouds: projected onto the dome, drifting, lit from the sun side
    if (d.y > 0.01) {
      // project onto a plane above the viewer; clamped so the horizon doesn't smear
      vec2 uv = clamp(d.xz / max(d.y + 0.30, 0.22), -14.0, 14.0);
      vec2 drift = vec2(uTime * 0.0045, uTime * 0.0022);
      float bank = fbm(uv * 0.45 + drift);
      bank = smoothstep(0.52 - uCloud * 0.28, 0.92, bank + uCloud * 0.16);
      float detail = fbm(uv * 1.6 - drift * 1.7);
      float mask = bank * (0.55 + 0.45 * detail) * smoothstep(0.02, 0.34, d.y);
      vec3 lit = mix(vec3(0.72, 0.75, 0.78), uSunColor * 1.25, pow(sun, 2.0) * 0.8 + 0.18);
      vec3 shade = mix(vec3(0.34, 0.36, 0.40), uZenith * 0.9, 0.5);
      vec3 cloud = mix(shade, lit, 0.45 + 0.55 * pow(sun, 1.5));
      col = mix(col, cloud * (1.0 - uNight * 0.75), clamp(mask, 0.0, 0.92));
    }

    gl_FragColor = vec4(col, 1.0);
  }
`

export function SkyDome({ state }: { state: DayState }) {
  const dome = useRef<Mesh>(null)
  const stars = useRef<Points>(null)
  const zenith = useMemo(() => new Color(), [])
  const reduced = useStore((s) => s.settings.reducedMotion)

  const geometry = useMemo(() => new SphereGeometry(1800, 48, 28), [])
  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: SKY_VERT,
        fragmentShader: SKY_FRAG,
        side: BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          uHorizon: { value: new Color('#cfdbdc') },
          uZenith: { value: new Color('#3c6d9e') },
          uSunColor: { value: new Color('#ffe6c2') },
          uSunDir: { value: new Vector3(0.4, 0.52, 0.86) },
          uMoonDir: { value: new Vector3(-0.4, -0.52, -0.86) },
          uTime: { value: 0 },
          uCloud: { value: 0.45 },
          uNight: { value: 0 },
        },
      }),
    [],
  )

  const starField = useMemo(() => {
    const g = new BufferGeometry()
    const n = 700
    const pos = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      const u = rand() * Math.PI * 2
      const v = Math.acos(rand() * 0.9)     // upper hemisphere only
      const r = 1500
      pos[i * 3] = Math.sin(v) * Math.cos(u) * r
      pos[i * 3 + 1] = Math.cos(v) * r
      pos[i * 3 + 2] = Math.sin(v) * Math.sin(u) * r
    }
    g.setAttribute('position', new Float32BufferAttribute(pos, 3))
    return g
  }, [])

  const starMat = useMemo(
    () => new PointsMaterial({
      color: '#eaf2ff', size: 3.2, sizeAttenuation: false, transparent: true,
      opacity: 0, depthWrite: false, blending: AdditiveBlending, fog: false,
    }),
    [],
  )

  useFrame((_, dt) => {
    const u = material.uniforms
    u.uTime.value += reduced ? dt * 0.15 : dt
    ;(u.uHorizon.value as Color).copy(state.fog)
    ;(u.uZenith.value as Color).copy(zenith.copy(state.zenith))
    ;(u.uSunColor.value as Color).copy(state.sunColor)
    ;(u.uSunDir.value as Vector3).copy(state.sun)
    ;(u.uMoonDir.value as Vector3).copy(state.moon)
    u.uCloud.value = state.cloud
    const night = state.night
    u.uNight.value = night

    if (dome.current) dome.current.position.copy(player.pos)
    if (stars.current) {
      stars.current.position.copy(player.pos)
      starMat.opacity = Math.max(0, night - 0.35) * 1.4
      stars.current.rotation.y += dt * 0.002
    }
  })

  return (
    <>
      <mesh ref={dome} geometry={geometry} material={material} frustumCulled={false} renderOrder={-2} />
      <points ref={stars} geometry={starField} material={starMat} frustumCulled={false} renderOrder={-1} />
    </>
  )
}
