import { useEffect, useMemo } from 'react'
import {
  CylinderGeometry, Group, Matrix4, Mesh, MeshStandardMaterial, Object3D, SkinnedMesh,
  TorusGeometry, Vector3,
} from 'three'

/**
 * Over-ear headphones, sized to Coach Blue's head: cups centred on the ears
 * (measured off the model, 8 cm either side of the midline and 6.5 cm above
 * the head joint), a padded band that clears the top of the hair, and
 * aluminium sliders between them. Matte black with a mint status light.
 *
 * Mounted on the head bone in its bind pose, so it follows every turn, nod
 * and stride of the head without any per-frame work.
 */
const EAR_OUT = 0.103       // cup centre, from the midline (ear skin at 0.081 + cup)
const EAR_UP = 0.066        // above the head joint
const EAR_FWD = -0.012      // a touch behind the joint, where the ear sits
const BAND_R = 0.118

function buildHeadset() {
  const g = new Group()
  const shell = new MeshStandardMaterial({ color: '#141518', roughness: 0.45, metalness: 0.15 })
  const pad = new MeshStandardMaterial({ color: '#0b0b0c', roughness: 0.9, metalness: 0 })
  const alu = new MeshStandardMaterial({ color: '#8e949b', roughness: 0.25, metalness: 1 })
  const led = new MeshStandardMaterial({ color: '#2fd6a5', emissive: '#2fd6a5', emissiveIntensity: 2 })

  for (const s of [1, -1]) {
    // the cup: a rounded shell with a soft cushion against the head
    const cup = new Mesh(new CylinderGeometry(0.047, 0.05, 0.03, 32), shell)
    cup.rotation.z = Math.PI / 2
    cup.position.set(s * (EAR_OUT + 0.006), EAR_UP, EAR_FWD)
    const cushion = new Mesh(new TorusGeometry(0.036, 0.013, 12, 32), pad)
    cushion.rotation.y = Math.PI / 2
    cushion.position.set(s * (EAR_OUT - 0.012), EAR_UP, EAR_FWD)
    const cap = new Mesh(new CylinderGeometry(0.03, 0.03, 0.006, 32), alu)
    cap.rotation.z = Math.PI / 2
    cap.position.set(s * (EAR_OUT + 0.023), EAR_UP, EAR_FWD)
    // the yoke: a slim fork from the band down to the cup
    const slider = new Mesh(new CylinderGeometry(0.0045, 0.0045, 0.06, 10), alu)
    slider.position.set(s * (EAR_OUT + 0.004), EAR_UP + 0.06, EAR_FWD)
    g.add(cup, cushion, cap, slider)
    if (s > 0) {
      const light = new Mesh(new CylinderGeometry(0.003, 0.003, 0.002, 10), led)
      light.rotation.z = Math.PI / 2
      light.position.set(EAR_OUT + 0.027, EAR_UP - 0.02, EAR_FWD + 0.012)
      g.add(light)
    }
  }
  // the band: an arc over the crown, padded underneath
  const band = new Mesh(new TorusGeometry(BAND_R, 0.009, 12, 48, Math.PI), shell)
  band.position.set(0, EAR_UP + 0.028, EAR_FWD)
  band.scale.set(0.93, 0.97, 1.6)
  const bandPad = new Mesh(new TorusGeometry(BAND_R - 0.012, 0.007, 10, 40, Math.PI * 0.7), pad)
  bandPad.position.set(0, EAR_UP + 0.028, EAR_FWD)
  bandPad.rotation.z = Math.PI * 0.15
  bandPad.scale.set(0.93, 0.97, 1.6)
  g.add(band, bandPad)
  g.traverse((o) => { if ((o as Mesh).isMesh) (o as Mesh).castShadow = true })
  return g
}

/** Puts the headset on (or takes it off) a rigged character. */
export function useHeadset(character: Object3D, on: boolean) {
  const headset = useMemo(buildHeadset, [])
  useEffect(() => {
    let head: Object3D | undefined
    let skinned: SkinnedMesh | undefined
    character.traverse((o) => {
      if (!head && /Head$/.test(o.name) && !/HeadTop/.test(o.name)) head = o
      if (!skinned && (o as SkinnedMesh).isSkinnedMesh) skinned = o as SkinnedMesh
    })
    if (!head) return
    // from the skeleton's bind pose: where the head joint sat when the
    // character stood upright facing +Z, so the headset's own frame (built
    // upright facing +Z) maps onto the bone exactly
    let bind = new Matrix4()
    if (skinned) {
      const i = skinned.skeleton.bones.indexOf(head as never)
      if (i >= 0) bind = skinned.skeleton.boneInverses[i].clone().invert()
    }
    const pos = new Vector3().setFromMatrixPosition(bind)
    const local = bind.clone().invert().multiply(new Matrix4().makeTranslation(pos.x, pos.y, pos.z))
    headset.matrixAutoUpdate = false
    headset.matrix.copy(local)
    head.add(headset)
    return () => { head?.remove(headset) }
  }, [character, headset])
  useEffect(() => { headset.visible = on }, [headset, on])
}
