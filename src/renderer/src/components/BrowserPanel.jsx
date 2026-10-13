import { useEffect, useRef } from 'react'

/**
 * A session's own browser pane: its tabs, and one or two slots where the main
 * process lays the real pages (native views, drawn above this HTML). The slots
 * are empty boxes here; their position on screen is what matters, so it is
 * reported whenever it might have changed, and withdrawn when the pane is
 * covered by a dialog or unmounted.
 */
export default function BrowserPanel({ uid, state, obscured }) {
  const slotsRef = useRef(null)
  const shown = state.split ?? (state.active ? [state.active] : [])

  useEffect(() => {
    let last = ''
    let frame = 0
    const report = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const slots = obscured
          ? []
          : [...(slotsRef.current?.querySelectorAll('[data-tab]') ?? [])].map((el) => {
              const r = el.getBoundingClientRect()
              return { tab: Number(el.dataset.tab), x: r.left, y: r.top, width: r.width, height: r.height }
            })
        const key = JSON.stringify(slots)
        if (key === last) return
        last = key
        window.deck.browserLayout(uid, slots)
      })
    }
    report()
    const ro = new ResizeObserver(report)
    if (slotsRef.current) ro.observe(slotsRef.current)
    ro.observe(document.body)
    window.addEventListener('resize', report)
    // Position can change without any size changing (a banner above, a
    // scroll); a light poll catches what the observers cannot.
    const poll = setInterval(report, 400)
    return () => {
      cancelAnimationFrame(frame)
      ro.disconnect()
      window.removeEventListener('resize', report)
      clearInterval(poll)
      window.deck.browserLayout(uid, [])
    }
  }, [uid, obscured, shown.join(',')])

  const act = (action, tab = state.active) => window.deck.browserUi(uid, action, tab)
  const active = state.tabs.find((t) => t.id === state.active)

  return (
    <section className="bpane" aria-label="Browser">
      <div className="bbar">
        <div className="btabs" role="tablist" aria-label="Browser tabs">
          {state.tabs.map((t) => (
            <div key={t.id} className={`btab${shown.includes(t.id) ? ' btab--shown' : ''}`}>
              <button
                type="button"
                role="tab"
                aria-selected={t.id === state.active}
                className="btabsel"
                onClick={() => act('select', t.id)}
                title={t.url}
              >
                {t.loading && <span className="bload" aria-label="Loading" />}
                {t.title || t.url}
              </button>
              <button type="button" className="btabx" onClick={() => act('close', t.id)} aria-label={`Close ${t.title || 'tab'}`}>
                ×
              </button>
            </div>
          ))}
        </div>
        <div className="bctl">
          <button type="button" onClick={() => act('back')} title="Back" aria-label="Back">
            ‹
          </button>
          <button type="button" onClick={() => act('reload')} title="Reload" aria-label="Reload">
            ↻
          </button>
          {state.tabs.length > 1 && (
            <button type="button" onClick={() => act(state.split ? 'unsplit' : 'split')} aria-pressed={Boolean(state.split)}>
              {state.split ? 'Single' : 'Split'}
            </button>
          )}
          <button type="button" onClick={() => act('external')} title={active ? `Open ${active.url} outside the deck` : undefined}>
            Open outside
          </button>
        </div>
      </div>
      <div className={`bslots${state.split ? ' bslots--split' : ''}`} ref={slotsRef}>
        {shown.map((id) => (
          <div key={id} className="bslot" data-tab={id} />
        ))}
      </div>
    </section>
  )
}
