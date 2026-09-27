import { useEffect, useRef, useState } from 'react'

/**
 * Keyboard navigation for the screens before the world.
 *
 * These are full-screen choices reached before anyone has touched the game,
 * which means they have to work for someone driving with the keyboard as well
 * as someone with a mouse — and both at once, not one or the other. Arrows or
 * A/D move the selection, Enter or Space confirms, and moving the mouse over
 * an option selects it too so the two never disagree about what is highlighted.
 *
 * Callers must call this before any early return (hooks run in the same order
 * every render) and pass `enabled` to switch the listener off while their
 * screen is hidden.
 */
export function useMenuKeys(
  count: number,
  onConfirm: (index: number) => void,
  enabled = true,
) {
  const [index, setIndex] = useState(0)
  const confirm = useRef(onConfirm)
  confirm.current = onConfirm
  // read by the key handler; confirming must happen outside a state updater,
  // which React may run during render (and then refuses the store update)
  const current = useRef(index)
  current.current = index

  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return

      if (e.code === 'ArrowRight' || e.code === 'KeyD') {
        setIndex((i) => (i + 1) % count)
        e.preventDefault()
      } else if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
        setIndex((i) => (i - 1 + count) % count)
        e.preventDefault()
      } else if (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space') {
        confirm.current(current.current)
        e.preventDefault()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [count, enabled])

  return [index, setIndex] as const
}
