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

function Clock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
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
  onSettings,
  onWorklog,
  onUpdate,
  update,
  launchError,
  onDismissError,
  fontSize,
  theme,
  handlers
}) {
  const [host, setHost] = useState('')
  useEffect(() => {
    window.deck.hostname?.().then((h) => setHost(h ?? ''))
  }, [])

  const count = (fn) => sessions.filter(fn).length
  const running = count((s) => s.attached || (s.external && s.status !== 'closed'))
  const waiting = count((s) => s.status === 'needs-you')
  const done = count((s) => s.status === 'done')
  const updating = ['available', 'downloading', 'ready'].includes(update.status)

  return (
    <div className="lcars">
      <section className="lc-top">
        <div className="lc-col">
          <div className="lc-block lc-bg-2">Session deck</div>
          <div className="lc-block lc-bg-3 lc-grow">{update.current ? `V ${update.current}` : 'Online'}</div>
        </div>

        <div className="lc-readout">
          <h2 className="lc-sr">Sessions</h2>
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
                    <span className="lc-state">{STATUS[s.status] ?? s.status}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="lc-command">
          <h1 className="lc-title">{host || 'Session Deck'}</h1>
          <div className="lc-buttons">
            <button type="button" className="lc-btn lc-bg-3" onClick={onWorklog}>
              Worked on
            </button>
            <button type="button" className="lc-btn lc-bg-peach" onClick={onSettings}>
              Settings
            </button>
            <button type="button" className="lc-btn lc-bg-1" onClick={onNew}>
              New session
            </button>
            <button type="button" className="lc-btn lc-bg-3" onClick={onUpdate}>
              {updating ? (update.status === 'ready' ? 'Restart to update' : `Update ${update.latest}`) : 'Updates'}
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
          <div className="lc-block lc-bg-red">Active {pad(running)}</div>
          <div className={`lc-block lc-bg-red lc-tall${waiting ? ' lc-alert' : ''}`}>Waiting {pad(waiting)}</div>
          <div className="lc-block lc-bg-1">Done {pad(done)}</div>
          <div className="lc-block lc-bg-peach lc-grow">Total {pad(sessions.length)}</div>
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
                  fontSize={fontSize}
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
          <Clock />
        </div>
      </section>
    </div>
  )
}
