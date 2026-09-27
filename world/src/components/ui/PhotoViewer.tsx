import { useEffect } from 'react'
import { transformations } from '../../data/transformations'
import { useStore } from '../../state/store'
import { closeInteraction } from '../3d/InteractionSystem'

export function PhotoViewer() {
  const index = useStore((s) => s.photoIndex)
  const openPhoto = useStore((s) => s.openPhoto)

  useEffect(() => {
    if (index === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') openPhoto((index + 1) % transformations.length)
      if (e.key === 'ArrowLeft') openPhoto((index - 1 + transformations.length) % transformations.length)
      if (e.key === 'Escape') {
        openPhoto(null)
        closeInteraction()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, openPhoto])

  if (index === null) return null
  const photo = transformations[index]

  return (
    <div className="viewer">
      <div className="caption">Client transformation — {index + 1} / {transformations.length}</div>
      <img src={photo.src} alt="Client transformation" />
      <div className="bar">
        <button className="btn" onClick={() => openPhoto((index - 1 + transformations.length) % transformations.length)}>
          ← Prev
        </button>
        <button className="btn" onClick={() => { openPhoto(null); closeInteraction() }}>Close</button>
        <button className="btn" onClick={() => openPhoto((index + 1) % transformations.length)}>Next →</button>
      </div>
    </div>
  )
}
