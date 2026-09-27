import { useEffect } from 'react'
import { useStore } from '../../state/store'

/**
 * A few lines with someone in the world. Short on purpose — atmosphere, not a
 * dialogue tree. E, Space, Enter or a click moves it on; the last line closes
 * it and they go back to what they were doing.
 */
export function Dialog() {
  const dialog = useStore((s) => s.dialog)
  const advance = useStore((s) => s.advanceDialog)

  useEffect(() => {
    if (!dialog) return
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'KeyE' || e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault()
        e.stopImmediatePropagation()
        advance()
      } else if (e.code === 'Escape') {
        useStore.getState().setDialog(null)
      }
    }
    // capture: while talking, E and Space belong to the conversation
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [dialog, advance])

  if (!dialog) return null
  const line = dialog.lines[dialog.index]
  const last = dialog.index + 1 >= dialog.lines.length
  return (
    <div className={`dialog is-${line.who}`} key={`${dialog.key}-${dialog.index}`} onClick={advance} role="dialog">
      <span className="dialog__who">{line.who === 'you' ? 'Coach Blue' : dialog.name}</span>
      <p>{line.text}</p>
      <span className="dialog__next"><kbd>E</kbd> {last ? 'Done' : 'Next'}</span>
    </div>
  )
}
