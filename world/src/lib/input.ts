// Keyboard, mouse-look and touch input, kept out of React so the render loop
// can read it without re-rendering anything.

/** Radians of camera turn per pixel of pointer movement. */
const LOOK_SENS_X = 0.0045
const LOOK_SENS_Y = 0.0035

export const input = {
  forward: 0,      // -1..1
  strafe: 0,       // -1..1
  run: false,
  jump: false,
  /** Space (or the touch action button) held down */
  actionHeld: false,
  /** C or Ctrl held: dive, while swimming */
  diveHeld: false,
  /** Space presses not yet consumed — activities read these as "do a rep" */
  taps: 0,
  /** true while the page holds the cursor for mouse look */
  pointerLocked: false,
  /**
   * Click-to-capture mouse look. Off until the world is actually being played:
   * the canvas is mounted underneath the loading and mode screens, and
   * capturing the pointer there leaves those screens with no visible cursor.
   */
  mouseLook: false,
  lookDX: 0,       // consumed each frame by the camera
  lookDY: 0,
  zoom: 0,
  touch: false,
  pointerX: 0,
  pointerY: 0,
}

const held = new Set<string>()

function refresh() {
  const f = (held.has('KeyW') || held.has('ArrowUp') ? 1 : 0) - (held.has('KeyS') || held.has('ArrowDown') ? 1 : 0)
  const s = (held.has('KeyD') || held.has('ArrowRight') ? 1 : 0) - (held.has('KeyA') || held.has('ArrowLeft') ? 1 : 0)
  input.forward = f
  input.strafe = s
  input.run = held.has('ShiftLeft') || held.has('ShiftRight')
  input.actionHeld = held.has('Space') || touchAction
  input.diveHeld = held.has('KeyC') || held.has('ControlLeft') || held.has('ControlRight') || touchDive
}

let touchAction = false
let touchDive = false
/** The touch layout's dive button, shown while swimming. */
export function setTouchDive(down: boolean) {
  touchDive = down
  refresh()
}
/** The touch layout's action button: a press is a tap, holding it is held. */
export function setTouchAction(down: boolean) {
  if (down && !touchAction) {
    input.taps += 1
    input.jump = true
  }
  touchAction = down
  refresh()
}

/** Take the pending taps (activities call this once per frame). */
export function consumeTaps() {
  const n = input.taps
  input.taps = 0
  return n
}

export type KeyHandlers = {
  onInteract?: () => void
  onMap?: () => void
  onJournal?: () => void
  onPhotoMode?: () => void
  onEscape?: () => void
  onView?: () => void
  onHeadset?: () => void
  onNextTrack?: () => void
  onPrevTrack?: () => void
  onSummonVehicle?: () => void
  onOutfit?: () => void
}

export function attachInput(el: HTMLElement, handlers: KeyHandlers) {
  const onKeyDown = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null
    if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
    if (e.repeat) return
    held.add(e.code)
    if (e.code === 'Space') {
      input.jump = true
      input.taps += 1
      e.preventDefault()
    }
    if (e.code === 'KeyE') handlers.onInteract?.()
    if (e.code === 'KeyM') handlers.onMap?.()
    if (e.code === 'KeyJ') handlers.onJournal?.()
    if (e.code === 'KeyP') handlers.onPhotoMode?.()
    if (e.code === 'KeyV') handlers.onView?.()
    if (e.code === 'KeyH') handlers.onHeadset?.()
    if (e.code === 'Period') handlers.onNextTrack?.()
    if (e.code === 'Comma') handlers.onPrevTrack?.()
    if (e.code === 'KeyO') handlers.onSummonVehicle?.()
    if (e.code === 'KeyK') handlers.onOutfit?.()
    if (e.code === 'Escape') handlers.onEscape?.()
    refresh()
  }
  const onKeyUp = (e: KeyboardEvent) => {
    held.delete(e.code)
    refresh()
  }
  const onBlur = () => {
    held.clear()
    refresh()
  }

  let dragging = false

  let dragId = -1
  let lastX = 0
  let lastY = 0

  /**
   * Mouse look, the way a third-person game does it: click once to hand the
   * cursor to the page, after which every movement of the mouse or trackpad
   * turns the camera, with nothing to hold down and no edge of the screen to
   * run out of. Escape gives the cursor back. Dragging still works for anyone
   * who would rather not capture the pointer, and for touch.
   */
  const locked = () => document.pointerLockElement === el

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return
    // Only a press on the 3D view itself turns the camera. The host element
    // also holds every HTML overlay — the mode cards, the HUD, panels — and
    // capturing the pointer for a press on one of those retargets the release
    // to the host, so the button underneath never receives its click.
    if (!(e.target instanceof HTMLCanvasElement)) return
    if (e.pointerType === 'mouse' && !locked() && input.mouseLook) {
      // requestPointerLock rejects if the document is not focused or the call
      // is not user-driven; falling through to dragging keeps it usable
      el.requestPointerLock?.()
      return
    }
    // one finger turns the camera; others (on the stick, the buttons) never do
    if (dragging) return
    dragging = true
    dragId = e.pointerId
    lastX = e.clientX
    lastY = e.clientY
    el.setPointerCapture?.(e.pointerId)
  }
  const onPointerMove = (e: PointerEvent) => {
    input.pointerX = e.clientX
    input.pointerY = e.clientY
    if (locked()) {
      // movementX/Y are raw deltas and keep arriving past the screen edge
      input.lookDX += e.movementX * LOOK_SENS_X
      input.lookDY += e.movementY * LOOK_SENS_Y
      return
    }
    if (!dragging || e.pointerId !== dragId) return
    // a finger on glass moves further than a mouse for the same intent
    const k = e.pointerType === 'touch' ? 1.6 : 1
    input.lookDX += (e.clientX - lastX) * LOOK_SENS_X * k
    input.lookDY += (e.clientY - lastY) * LOOK_SENS_Y * k
    lastX = e.clientX
    lastY = e.clientY
  }
  const onPointerUp = (e: PointerEvent) => {
    if (e.pointerId !== dragId) return
    dragging = false
    el.releasePointerCapture?.(e.pointerId)
  }
  const onLockChange = () => {
    input.pointerLocked = locked()
    dragging = false
  }
  const onWheel = (e: WheelEvent) => {
    input.zoom += Math.sign(e.deltaY) * 0.6
  }

  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('blur', onBlur)
  el.addEventListener('pointerdown', onPointerDown)
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  el.addEventListener('wheel', onWheel, { passive: true })
  document.addEventListener('pointerlockchange', onLockChange)

  return () => {
    document.removeEventListener('pointerlockchange', onLockChange)
    if (locked()) document.exitPointerLock?.()
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('keyup', onKeyUp)
    window.removeEventListener('blur', onBlur)
    el.removeEventListener('pointerdown', onPointerDown)
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
    el.removeEventListener('wheel', onWheel)
  }
}

/** Virtual stick on touch devices. */
export function setJoystick(x: number, y: number) {
  input.strafe = x
  input.forward = -y
  input.run = Math.hypot(x, y) > 0.85
}

export const isTouchDevice = () =>
  typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches
