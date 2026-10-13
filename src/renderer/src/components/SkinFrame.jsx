import { createContext, useContext, useLayoutEffect, useRef, useState } from 'react'
import { skinShape, toPolygon, toPoints } from '../skins.js'

export const SkinContext = createContext('plain')

/**
 * The frame a skin draws around a tile or dialog: an SVG laid over its parent,
 * sized to it in pixels, so a 45° line stays 45° at any size (a stretched SVG
 * would skew it). The parent is clipped to the same geometry, so silhouette and
 * outline cannot disagree. Colours come from CSS (skins.css), per theme.
 *
 * Place it as the first child of the element it frames; with the plain skin it
 * renders nothing and leaves the parent alone.
 */
export default function SkinFrame({ kind }) {
  const skin = useContext(SkinContext)
  const ref = useRef(null)
  const [size, setSize] = useState(null)
  const active = skin && skin !== 'plain'

  useLayoutEffect(() => {
    const parent = ref.current?.parentElement
    if (!active || !parent) return
    const measure = () => setSize({ w: parent.offsetWidth, h: parent.offsetHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(parent)
    return () => ro.disconnect()
  }, [active])

  const shape = active && size ? skinShape(skin, kind, size.w, size.h) : null

  useLayoutEffect(() => {
    const parent = ref.current?.parentElement
    if (!parent) return
    parent.style.clipPath = shape?.clip ? toPolygon(shape.clip) : ''
  })
  useLayoutEffect(() => {
    // Unmounting must not leave a cut behind. The parent is taken now: by
    // cleanup time the ref may already be detached.
    const parent = ref.current?.parentElement
    return () => {
      if (parent) parent.style.clipPath = ''
    }
  }, [])

  return (
    <svg
      ref={ref}
      className={`skinframe skinframe--${kind}`}
      width={size?.w ?? 0}
      height={size?.h ?? 0}
      aria-hidden="true"
      focusable="false"
      style={active ? undefined : { display: 'none' }}
    >
      {shape?.fills?.map(({ d, tone }, n) => (
        <path key={`p${n}`} className={`skinframe-fill skinframe-fill--${tone}`} d={d} />
      ))}
      {shape?.faint.map((pts, n) => (
        <polyline key={`f${n}`} className="skinframe-faint" points={toPoints(pts)} />
      ))}
      {shape?.lines.map((pts, n) => (
        <polyline key={`l${n}`} className="skinframe-line" points={toPoints(pts)} />
      ))}
      {shape?.dots.map(([x, y, s], n) => (
        <rect key={`d${n}`} className="skinframe-dot" x={x} y={y} width={s} height={s} />
      ))}
    </svg>
  )
}
