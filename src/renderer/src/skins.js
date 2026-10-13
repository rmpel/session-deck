/**
 * Skin geometry. A skin changes shapes and frames, never colours: this file
 * says *where* lines and cuts go, in pixels for a given box, and skins.css says
 * what colour they are, from the theme's tokens. So every skin works with every
 * theme.
 *
 * Each shape returns:
 * - `clip`: the silhouette, as polygon points — the element is cut to it.
 * - `lines`: polylines drawn as the frame (closed ones repeat their start).
 * - `faint`: the same, drawn at lower emphasis.
 * - `dots`: small filled squares, [x, y, size].
 * - `fills`: filled SVG paths, { d, tone }. Tone 1–3 picks the colour in
 *   skins.css, so a frame can be several colours and still follow the theme.
 *
 * `kind` is 'tile', 'dialog' or 'window' (the focused session, which keeps a
 * square bottom-right corner: that is where its resize handle is).
 */

export const SKINS = [
  { key: 'plain', label: 'Plain', title: 'Rounded corners, no frames' },
  { key: 'cyberdeck', label: 'Cyberdeck', title: 'Stepped panels with a traced bezel, like hardware' },
  { key: 'hud', label: 'HUD', title: 'Bracketed frames and markers, like a ship’s display' },
  { key: 'lcars', label: 'LCARS', title: 'Rounded elbows and segmented bars, like a starship console' }
]

const close = (pts) => [...pts, pts[0]]

/**
 * Cyberdeck: a panel whose top edge steps down part-way along and whose bottom
 * edge steps the other way, corners chamfered. `inset` gives the same outline
 * pulled inwards, for the traced line inside the bezel.
 */
function stepped(w, h, { step, cut, topAt, bottomAt, squareCorner = false }, inset = 0) {
  const i = inset
  const a = Math.round(w * topAt)
  const b = Math.round(w * bottomAt)
  const bottomRight = squareCorner ? [[w - i, h - i]] : [[w - i, h - cut - i], [w - cut - i, h - i]]
  return [
    [i, cut + i],
    [cut + i, i],
    [a - i, i],
    [a + step - i, step + i],
    [w - cut - i, step + i],
    [w - i, step + cut + i],
    ...bottomRight,
    [b + step + i, h - i],
    [b + i, h - step - i],
    [cut + i, h - step - i],
    [i, h - step - cut - i]
  ]
}

const CYBER = {
  tile: { step: 10, cut: 8, topAt: 0.58, bottomAt: 0.34 },
  dialog: { step: 14, cut: 12, topAt: 0.62, bottomAt: 0.3 },
  window: { step: 14, cut: 12, topAt: 0.62, bottomAt: 0.3, squareCorner: true }
}

function cyberdeck(kind, w, h) {
  const spec = CYBER[kind]
  return {
    clip: stepped(w, h, spec),
    // The stroke sits half a pixel in, so the clip does not shave it.
    lines: [close(stepped(w, h, spec, 0.75))],
    faint: [close(stepped(w, h, spec, kind === 'tile' ? 4.5 : 6))],
    dots: []
  }
}

/**
 * HUD: no outline, only pieces of one — corner brackets bent at 45°, a marker
 * square in each corner, a notched bar at the top centre and, on dialogs,
 * C-shaped side pieces and a row of ticks along the bottom.
 */
function hud(kind, w, h) {
  const big = kind !== 'tile'
  const i = 1
  const bend = big ? 12 : 8
  const armX = Math.min(w * (big ? 0.2 : 0.22), big ? 220 : 130)
  const armY = Math.min(h * 0.3, big ? 90 : 46)
  // Each arm runs along the edge, then steps inwards at 45° for its last part.
  const kink = big ? 6 : 4
  const corner = (sx, sy) => {
    const x = sx < 0 ? w - i : i
    const y = sy < 0 ? h - i : i
    const kx = armX * 0.62
    const ky = armY * 0.62
    return [
      [x + sx * kink, y + sy * armY],
      [x + sx * kink, y + sy * (ky + kink)],
      [x, y + sy * ky],
      [x, y + sy * bend],
      [x + sx * bend, y],
      [x + sx * kx, y],
      [x + sx * (kx + kink), y + sy * kink],
      [x + sx * armX, y + sy * kink]
    ]
  }
  const lines = [corner(1, 1), corner(-1, 1), corner(1, -1), corner(-1, -1)]

  // The notched bar at the top centre.
  const half = Math.min(w * (big ? 0.12 : 0.08), big ? 110 : 60)
  const cx = w / 2
  const drop = big ? 6 : 4
  lines.push([
    [cx - half, i],
    [cx - half + drop, i + drop],
    [cx + half - drop, i + drop],
    [cx + half, i]
  ])

  const faint = []
  if (big) {
    // C-shaped pieces halfway down each side, inside the dialog's padding:
    // any deeper and they cross labels and the terminal's first column.
    const my = h / 2
    const reach = Math.min(h * 0.14, 70)
    for (const [x, dir] of [[i, 1], [w - i, -1]]) {
      lines.push([[x, my - reach - 10], [x + dir * 8, my - reach], [x + dir * 8, my + reach], [x, my + reach + 10]])
    }
    // Ticks along the bottom centre.
    for (let t = -4; t <= 4; t++) {
      const x = cx + t * 12
      faint.push([[x, h - i], [x, h - i - (t % 2 === 0 ? 7 : 4)]])
    }
  }

  const s = big ? 5 : 4
  const dots = [
    [0, 0, s],
    [w - s, 0, s],
    [0, h - s, s],
    [w - s, h - s, s]
  ]
  return { clip: null, lines, faint, dots }
}

/**
 * LCARS: a filled frame down the left side only. Rounded elbows at the top-
 * and bottom-left join a thick left bar to thin bars along the top and bottom;
 * the bars are split into blocks of different colours, and end in a rounded
 * cap. The right side stays open, as on the real panels.
 *
 * `bar` is the left bar's width, `rail` the top/bottom bars' thickness, `outer`
 * and `inner` the elbow radii, `reach` how far an elbow runs along the top and
 * `drop` how far down the side.
 */
const LCARS = {
  tile: { bar: 10, rail: 7, outer: 18, inner: 6, reach: 90, drop: 30, gap: 3 },
  dialog: { bar: 16, rail: 10, outer: 26, inner: 8, reach: 140, drop: 44, gap: 4 },
  window: { bar: 16, rail: 10, outer: 26, inner: 8, reach: 140, drop: 44, gap: 4, squareCorner: true }
}

function lcars(kind, w, h) {
  const { bar, rail, outer, inner, reach: maxReach, drop: maxDrop, gap, squareCorner } = LCARS[kind]
  const reach = Math.min(maxReach, w * 0.22)
  const drop = Math.min(maxDrop, (h - gap) / 3)
  const fills = []

  // Elbows. The bottom one is the top one mirrored, so its arcs turn the other way.
  fills.push({
    tone: 1,
    d: `M0 ${drop} V${outer} A${outer} ${outer} 0 0 1 ${outer} 0 H${reach} V${rail} H${bar + inner} A${inner} ${inner} 0 0 0 ${bar} ${rail + inner} V${drop} Z`
  })
  fills.push({
    tone: 1,
    d: `M0 ${h - drop} V${h - outer} A${outer} ${outer} 0 0 0 ${outer} ${h} H${reach} V${h - rail} H${bar + inner} A${inner} ${inner} 0 0 1 ${bar} ${h - rail - inner} V${h - drop} Z`
  })

  // The left bar between them: two blocks, or one when the panel is short.
  const top = drop + gap
  const bottom = h - drop - gap
  if (bottom - top > 40) {
    const split = Math.round(top + (bottom - top) * 0.62)
    fills.push({ tone: 2, d: rect(0, top, bar, split - gap / 2) })
    fills.push({ tone: 3, d: rect(0, split + gap / 2, bar, bottom) })
  } else if (bottom > top) {
    fills.push({ tone: 2, d: rect(0, top, bar, bottom) })
  }

  // Rails: blocks across the top and bottom, the last one capped. The focused
  // window keeps its bottom-right corner clear for the resize handle.
  const rails = (y, end, parts, capped) => {
    let x = reach + gap
    const span = end - x
    parts.forEach(([share, tone], n) => {
      const last = n === parts.length - 1
      const x2 = last ? end : Math.round(x + span * share)
      if (x2 - x > rail) fills.push({ tone, d: last && capped ? capRight(x, y, x2, rail) : rect(x, y, x2, y + rail) })
      x = x2 + gap
    })
  }
  rails(0, w, [[0.16, 2], [0.62, 1], [0, 3]], true)
  rails(h - rail, squareCorner ? w - 24 : w, [[0.46, 3], [0.22, 2], [0, 1]], !squareCorner)

  return { clip: null, lines: [], faint: [], dots: [], fills }
}

const rect = (x1, y1, x2, y2) => `M${x1} ${y1} H${x2} V${y2} H${x1} Z`

/** A bar whose right end is a half circle. */
function capRight(x1, y, x2, height) {
  const r = height / 2
  return `M${x1} ${y} H${x2 - r} A${r} ${r} 0 0 1 ${x2 - r} ${y + height} H${x1} Z`
}

export function skinShape(skin, kind, w, h) {
  if (!w || !h) return null
  if (skin === 'cyberdeck') return cyberdeck(kind, w, h)
  if (skin === 'hud') return hud(kind, w, h)
  if (skin === 'lcars') return lcars(kind, w, h)
  return null
}

export const toPolygon = (pts) => `polygon(${pts.map(([x, y]) => `${x}px ${y}px`).join(', ')})`
export const toPoints = (pts) => pts.map(([x, y]) => `${x},${y}`).join(' ')
