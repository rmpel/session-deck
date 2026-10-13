import { useEffect, useState } from 'react'
import FocusedSession from './FocusedSession.jsx'

/**
 * The LCARS skin as a whole console rather than framed tiles: the sessions are
 * a readout across the top, the selected one runs in the viewer below, and the
 * computer's name and the clock sit where the screen's titles would.
 *
 * Shapes are drawn here and coloured from skins.css, so the console follows
 * whichever theme is active, like every other skin.
 */

const STATUS = {
  starting: 'Starting',
  ready: 'Ready',
  working: 'Working',
  'needs-you': 'Needs you',
  done: 'Done',
  closed: 'Closed',
  resumable: 'Interrupted'
}

const pad = (n) => String(n).padStart(2, '0')

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

/**
 * A stardate for show, not for navigation: TNG-style five digits that grow by
 * a thousand a year, the fraction being how far through the day it is.
 */
function stardate(now) {
  const start = new Date(now.getFullYear(), 0, 1)
  const day = (now - start) / 86_400_000
  const year = now.getFullYear() - 1987
  return (year * 1000 + (day / 365.25) * 1000).toFixed(1)
}

function uptime(ms) {
  const min = Math.floor(ms / 60_000)
  return `${pad(Math.floor(min / 60))}:${pad(min % 60)}`
}

/** The time, ticking once a second; shared by the clock and the readouts. */
function useNow() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  return now
}

const randomRow = (cols) =>
  Array.from({ length: cols }, (_, n) => {
    const len = n === 1 ? 7 : 1 + Math.floor(Math.random() * 4)
    return String(Math.floor(Math.random() * 10 ** len)).padStart(n % 3 ? 1 : 2, '0')
  })

/**
 * Decorative columns of figures, as on every LCARS screen. A cell changes now
 * and then, which is what makes the screen look alive; with reduced motion it
 * holds still. Hidden from assistive technology: it means nothing.
 */
function NumberGrid({ rows = 7, cols = 13 }) {
  const [grid, setGrid] = useState(() => Array.from({ length: rows }, () => randomRow(cols)))
  useEffect(() => {
    if (reducedMotion()) return
    const t = setInterval(() => {
      setGrid((g) => {
        const next = g.map((r) => [...r])
        const r = Math.floor(Math.random() * rows)
        next[r] = randomRow(cols)
        return next
      })
    }, 900)
    return () => clearInterval(t)
  }, [rows, cols])
  return (
    <div className="lc-grid" aria-hidden="true">
      {grid.map((row, r) => (
        <div key={r} className="lc-gridrow">
          {row.map((v, c) => (
            <span key={c} className={(r * 7 + c * 3) % 5 === 0 ? 'lc-hot' : undefined}>
              {v}
            </span>
          ))}
        </div>
      ))}
    </div>
  )
}

/**
 * An elbow: the left column turning into a horizontal arm. `corner` is where
 * the outer curve sits — 'bottom' sweeps down-and-right, 'top' up-and-right.
 */
function Elbow({ corner, width, height, column, arm, outer, inner, tone }) {
  const d =
    corner === 'bottom'
      ? `M0 0 H${column} V${height - arm - inner} A${inner} ${inner} 0 0 0 ${column + inner} ${height - arm} H${width} V${height} H${outer} A${outer} ${outer} 0 0 1 0 ${height - outer} Z`
      : `M0 ${height} H${column} V${arm + inner} A${inner} ${inner} 0 0 1 ${column + inner} ${arm} H${width} V0 H${outer} A${outer} ${outer} 0 0 0 0 ${outer} Z`
  return (
    <svg className="lc-elbow" width={width} height={height} aria-hidden="true" focusable="false">
      <path className={`lc-fill lc-${tone}`} d={d} />
    </svg>
  )
}

/** The bars that carry an elbow's arm across the screen. */
function Rail({ align, parts }) {
  return (
    <div className={`lc-rail lc-rail--${align}`} aria-hidden="true">
      {parts.map(([tone, grow], n) => (
        <span key={n} className={`lc-bg-${tone}`} style={{ flexGrow: grow, flexBasis: grow ? 0 : 36 }} />
      ))}
    </div>
  )
}

/** A bracket of the viewer, with its scale. */
function Bracket({ side }) {
  return (
    <div className={`lc-bracket lc-bracket--${side}`} aria-hidden="true">
      <div className="lc-scale">
        {[0, 10, 20, 30, 40, 50, 60, 70].map((n) => (
          <span key={n}>{String(n).padStart(3, '0')}</span>
        ))}
      </div>
      <div className="lc-brace" />
    </div>
  )
}

function Clock({ now }) {
  return (
    <div className="lc-clock">
      <time dateTime={now.toISOString()}>
        {now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
      </time>
      <span className="lc-date">{now.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</span>
    </div>
  )
}

export default function LcarsLayout({
  sessions,
  focused,
  onSelect,
  onNew,
  onShell,
  views,
  onOpenView,
  onManageViews,
  onSettings,
  onWorklog,
  onUpdate,
  update,
  launchError,
  onDismissError,
  browser,
  obscured,
  fontSize,
  fontFamily,
  theme,
  handlers
}) {
  const [host, setHost] = useState('')
  useEffect(() => {
    window.deck.hostname?.().then((h) => setHost(h ?? ''))
  }, [])

  const now = useNow()
  const [startedAt] = useState(() => Date.now())

  // The left column's counts are also shortcuts: each selects the first
  // session it counts, so Waiting takes you straight to what needs you.
  const isRunning = (s) => s.attached || (s.external && s.status !== 'closed')
  const groups = {
    active: sessions.filter(isRunning),
    waiting: sessions.filter((s) => s.status === 'needs-you'),
    done: sessions.filter((s) => s.status === 'done')
  }
  const waiting = groups.waiting.length
  const jump = (list) => {
    if (!list.length) return
    // From the selected one, on to the next: repeated clicks walk the group.
    const at = list.findIndex((s) => s.uid === focused?.uid)
    onSelect(list[(at + 1) % list.length].uid)
  }
  const updating = ['available', 'downloading', 'ready'].includes(update.status)

  return (
    <div className="lcars">
      <section className="lc-top">
        <div className="lc-col">
          <div className="lc-block lc-bg-2">
            <span className="lc-sr">Stardate </span>
            {stardate(now)}
          </div>
          <div className="lc-block lc-bg-3 lc-grow lc-lines">
            <span>Online {uptime(now - startedAt)}</span>
            <span>{update.current ? `Deck ${update.current}` : 'Session deck'}</span>
          </div>
        </div>

        <div className="lc-readout">
          <h2 className="lc-sr">Sessions</h2>
          {/* Behind the list, filling whatever room it leaves. */}
          <NumberGrid />
          {sessions.length === 0 ? (
            <p className="lc-none">No sessions</p>
          ) : (
            <ul className="lc-sessions">
              {sessions.map((s, n) => (
                <li key={s.uid}>
                  <button
                    type="button"
                    className={`lc-sess lc-s-${s.status}`}
                    aria-pressed={focused?.uid === s.uid}
                    onClick={() => onSelect(s.uid)}
                    title={`${s.name ?? 'Untitled session'} — ${s.project.name}`}
                  >
                    <span className="lc-num">{pad(n + 1)}</span>
                    <span className="lc-name">{s.name ?? 'Untitled session'}</span>
                    <span className="lc-state">
                      {s.kind === 'view' ? 'View' : s.kind === 'shell' ? 'Shell' : (STATUS[s.status] ?? s.status)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Saved views: a column of their own, so they never make the band taller. */}
        <nav className="lc-views" aria-label="Views">
          {views.map((v, n) => {
            const open = focused?.uid === `view-${v.id}`
            return (
              <button
                key={v.id}
                type="button"
                className={`lc-view lc-bg-${['3', '2', 'peach', '1'][n % 4]}`}
                aria-pressed={open}
                onClick={() => onOpenView(v)}
                title={v.url}
              >
                {v.label}
              </button>
            )
          })}
          <button type="button" className="lc-view lc-view--add" onClick={onManageViews}>
            {views.length ? 'Views' : '+ View'}
          </button>
        </nav>

        <div className="lc-command">
          <h1 className="lc-title">{host || 'Session Deck'}</h1>
          <div className="lc-buttons">
            <button type="button" className="lc-btn lc-bg-3" onClick={onWorklog}>
              Worked on
            </button>
            <button type="button" className="lc-btn lc-bg-peach" onClick={onSettings}>
              Settings
            </button>
            <button type="button" className="lc-btn lc-bg-3" onClick={onUpdate}>
              {updating ? (update.status === 'ready' ? 'Restart to update' : `Update ${update.latest}`) : 'Updates'}
            </button>
            <button type="button" className="lc-btn lc-bg-1" onClick={onNew}>
              New session
            </button>
            <button
              type="button"
              className="lc-btn lc-bg-2"
              onClick={onShell}
              title={focused?.cwd ? `A shell in ${focused.cwd}` : 'A shell in your home folder'}
            >
              Terminal
            </button>
          </div>
        </div>
      </section>

      <div className="lc-sweep">
        <Elbow corner="bottom" width={210} height={64} column={150} arm={20} outer={56} inner={24} tone="3" />
        <Rail align="end" parts={[['3', 6], ['1', 0], ['2', 3], ['2', 5], ['red', 0]]} />
      </div>
      <div className="lc-sweep">
        <Elbow corner="top" width={210} height={64} column={150} arm={20} outer={56} inner={24} tone="red" />
        <Rail align="start" parts={[['red', 6], ['tan', 0], ['tan', 3], ['2', 5], ['1', 0]]} />
      </div>

      <section className="lc-body">
        <div className="lc-col">
          <button type="button" className="lc-block lc-bg-red" onClick={() => jump(groups.active)} disabled={!groups.active.length}>
            Active {pad(groups.active.length)}
          </button>
          <button
            type="button"
            className={`lc-block lc-bg-red lc-tall${waiting ? ' lc-alert' : ''}`}
            onClick={() => jump(groups.waiting)}
            disabled={!waiting}
          >
            Waiting {pad(waiting)}
          </button>
          <button type="button" className="lc-block lc-bg-1" onClick={() => jump(groups.done)} disabled={!groups.done.length}>
            Done {pad(groups.done.length)}
          </button>
          <button type="button" className="lc-block lc-bg-peach lc-grow" onClick={() => onSelect(null)} disabled={!focused}>
            {focused ? 'Standby' : `Total ${pad(sessions.length)}`}
          </button>
        </div>

        <div className="lc-main">
          {launchError && (
            <div className="alertbar launcherror" role="alert">
              <div className="q">
                <b>Could not start the session</b>
                {launchError}
              </div>
              <button className="closeb" type="button" onClick={onDismissError}>
                Dismiss
              </button>
            </div>
          )}
          <div className="lc-viewer">
            <Bracket side="left" />
            <div className="lc-screen">
              {focused ? (
                <FocusedSession
                  key={focused.uid}
                  session={focused}
                  embedded
                  browser={browser}
                  obscured={obscured}
                  fontSize={fontSize}
                  fontFamily={fontFamily}
                  theme={theme}
                  {...handlers(focused)}
                />
              ) : (
                <div className="lc-standby">
                  <p>Standby</p>
                  <p className="lc-hint">{sessions.length ? 'Select a session above' : 'No sessions are running'}</p>
                  <button type="button" className="lc-btn lc-bg-1" onClick={onNew}>
                    New session
                  </button>
                </div>
              )}
            </div>
            <Bracket side="right" />
          </div>
          <Clock now={now} />
        </div>
      </section>
    </div>
  )
}
