import { useEffect, useRef, type ReactNode } from 'react'
import type { Group } from 'three'
import { batchStatic, freeze } from '../../lib/freeze'

/**
 * A group whose contents never move once placed. Frozen after mount, and
 * again a few times over the first seconds so pieces that arrive late
 * (textures, fonts, streamed models) are caught too.
 */
export function Frozen({ children }: { children: ReactNode }) {
  const ref = useRef<Group>(null)
  useEffect(() => {
    const ids = [300, 1500, 4000, 9000].map((ms, i) => window.setTimeout(() => {
      if (!ref.current) return
      freeze(ref.current)
      // once things have loaded, merge what shares a material
      if (i >= 2) batchStatic(ref.current)
    }, ms))
    return () => ids.forEach((i) => window.clearTimeout(i))
  }, [])
  return <group ref={ref}>{children}</group>
}
