import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import StatusPill from './StatusPill.jsx'
import SessionMeta from './SessionMeta.jsx'
import EditableName from './EditableName.jsx'
import SkinFrame from './SkinFrame.jsx'
import BrowserPanel from './BrowserPanel.jsx'
import { alertLabel, detachedNote } from './SessionTile.jsx'

const SIZE_KEY = 'deck.focusedSize'

function savedSize() {
  try {
    return JSON.parse(localStorage.getItem(SIZE_KEY)) ?? null
  } catch {
    return null
  }
}

/**
 * The only real terminal emulator in the app, mounted on focus and disposed on
 * close. The dialog is large by default and drag-resizable from its corner; the
 * terminal refits to it and the PTY is resized only when the grid actually
 * changes, so Claude's TUI re-flows on a deliberate resize, never on open.
 * Everything the tile shows is shown here too.
 *
 * `embedded` puts the same view inside a layout (the LCARS console) instead
 * of a dialog: no overlay, no own frame or size, and no close button.
 *
 * The terminal keys on `uid`, not `id`: Claude's session id can change while the
 * terminal is open (resume fallback, /clear), and remounting would flicker and
 * drop scroll position.
 */
export default function FocusedSession({ session, browser = null, obscured = false, embedded = false, fontSize = 12.5, theme, onClose, onShowPages, onShowPrs, onShowDiff, onShowSummary, onReopen, onShowTodos, onShowProcesses }) {
  const hostRef = useRef(null)
  const termRef = useRef(null)
  const refitRef = useRef(null)
  const dialogRef = useRef(null)
  const initialSize = useRef(savedSize())

  // Remember the size the user dragged the dialog to.
  useEffect(() => {
    const el = dialogRef.current
    if (!el || embedded) return
    let t
    const ro = new ResizeObserver(() => {
      clearTimeout(t)
      t = setTimeout(() => {
        try {
          localStorage.setItem(SIZE_KEY, JSON.stringify({ width: el.offsetWidth, height: el.offsetHeight }))
        } catch {}
      }, 250)
    })
    ro.observe(el)
    return () => {
      clearTimeout(t)
      ro.disconnect()
    }
  }, [embedded])
  const detached = !session.attached
  const blocked = session.status === 'needs-you'

  useEffect(() => {
    if (detached) return
    let term
    let offData
    let ro
    let timer
    let disposed = false

    ;(async () => {
      const { cols, rows } = await window.deck.ptySize(session.uid)
      if (disposed) return
      // The terminal follows the theme: its colours are the same tokens the
      // tiles use, read once from the document.
      const css = getComputedStyle(document.documentElement)
      const token = (name, fallback) => css.getPropertyValue(name).trim() || fallback
      term = new Terminal({
        cols,
        rows,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, "Cascadia Mono", Consolas, monospace',
        fontSize,
        theme: {
          background: token('--term', '#100e0f'),
          foreground: token('--term-ink', '#cdc4c9'),
          cursor: token('--accent', '#cdc4c9')
        },
        cursorBlink: true,
        // Enough to hold a long conversation's full reprint.
        scrollback: 25000
      })
      const fit = new FitAddon()
      term.loadAddon(fit)
      term.open(hostRef.current)
      // Subscribe before asking for the replay, and drop what arrives until it
      // lands: those chunks are already in it. Subscribing after lost them.
      let live = false
      offData = window.deck.onData(({ sessionId, chunk }) => {
        if (live && sessionId === session.uid) term.write(chunk)
      })
      const replay = await window.deck.buffer(session.uid)
      if (disposed) return
      term.write(replay)
      live = true
      term.focus()

      const refit = () => {
        if (disposed) return
        const dims = fit.proposeDimensions()
        if (!dims?.cols || !dims?.rows) return
        if (dims.cols === term.cols && dims.rows === term.rows) return
        term.resize(dims.cols, dims.rows)
        window.deck.resize(session.uid, dims.cols, dims.rows)
      }
      termRef.current = term
      refitRef.current = refit
      requestAnimationFrame(refit)
      ro = new ResizeObserver(() => {
        clearTimeout(timer)
        timer = setTimeout(refit, 120)
      })
      ro.observe(hostRef.current)
      term.onData((data) => window.deck.write(session.uid, data))
    })()

    return () => {
      disposed = true
      clearTimeout(timer)
      ro?.disconnect()
      offData?.()
      term?.dispose()
      termRef.current = null
      refitRef.current = null
    }
  }, [session.uid, detached])

  // The terminal follows a theme change without being remounted.
  useEffect(() => {
    const term = termRef.current
    if (!term) return
    const css = getComputedStyle(document.documentElement)
    const token = (name, fallback) => css.getPropertyValue(name).trim() || fallback
    term.options.theme = {
      background: token('--term', '#100e0f'),
      foreground: token('--term-ink', '#cdc4c9'),
      cursor: token('--accent', '#cdc4c9')
    }
  }, [theme])

  // Changing the text size re-flows the same terminal rather than remounting it.
  useEffect(() => {
    const term = termRef.current
    if (!term || term.options.fontSize === fontSize) return
    term.options.fontSize = fontSize
    refitRef.current?.()
  }, [fontSize])

  const view = (
      <div
        className={embedded ? 'focused focused--embedded' : 'focused'}
        ref={dialogRef}
        style={embedded ? undefined : (initialSize.current ?? undefined)}
        role={embedded ? 'region' : 'dialog'}
        aria-modal={embedded ? undefined : 'true'}
        aria-label={session.name ?? 'Session'}
      >
        {!embedded && <SkinFrame kind="window" />}
        <div className="fhead">
          <div className="fheadtext">
            <EditableName session={session} />
            <div className="pname">
              {session.project.name} <s>•</s> {session.project.domain}
              {session.external && <span className="badge">external</span>}
            </div>
          </div>
          {!embedded && (
            <button className="closeb" type="button" onClick={onClose}>
              Esc · close
            </button>
          )}
        </div>

        {blocked && (
          <div className="alertbar alertbar--top">
            <div className="q">
              <b>{alertLabel(session.questionKind)}</b>
              {session.question}
            </div>
          </div>
        )}

        <div className={browser?.tabs.length ? 'fbody fbody--browser' : 'fbody'}>
          {detached ? (
            <div className="fterm fterm--note">
              {session.external ? (
                <>
                  <p>
                    This session was started outside Session Deck, so there is no terminal to
                    attach to — the deck mirrors its status from hooks only.
                  </p>
                  <p>Switch to the terminal or editor it runs in to interact with it.</p>
                </>
              ) : (
                <>
                  {detachedNote(session)
                    .split('\n')
                    .map((line) => (
                      <p key={line}>{line.charAt(0).toUpperCase() + line.slice(1)}.</p>
                    ))}
                  {session.canReopen && (
                    <p>
                      <button className="newbtn" type="button" onClick={onReopen}>
                        {session.status === 'resumable' ? 'Resume session' : 'Reopen session'}
                      </button>
                    </p>
                  )}
                </>
              )}
            </div>
          ) : (
            // xterm mounts in an unpadded inner box: FitAddon measures its parent's
            // border-box height, so padding there made it plan a row too many and
            // the bottom line — Claude's prompt — was clipped.
            <div className="fterm">
              <div className="ftermhost" ref={hostRef} />
            </div>
          )}
          {/* Only a session that opened pages has a pane, and the graphics
              between it and the terminal come and go with it. */}
          {browser?.tabs.length > 0 && (
            <>
              <div className="bdivider" aria-hidden="true">
                <span />
                <span />
                <span />
                <span />
              </div>
              <BrowserPanel uid={session.uid} state={browser} obscured={obscured} />
            </>
          )}
        </div>

        <div className="ffoot">
          <StatusPill status={session.status} />
          <SessionMeta
            session={session}
            full
            onShowPages={onShowPages}
            onShowPrs={onShowPrs}
            onShowDiff={onShowDiff}
            onShowSummary={onShowSummary}
            onReopen={onReopen}
            onShowTodos={onShowTodos}
            onShowProcesses={onShowProcesses}
          />
          <button
            className="closeb"
            type="button"
            onClick={() => {
              // A live session gets ended; one with no terminal gets removed.
              if (session.attached) window.deck.close(session.uid)
              else window.deck.remove(session.uid)
              onClose()
            }}
          >
            {session.attached ? 'End session' : 'Remove from deck'}
          </button>
        </div>
      </div>
  )

  if (embedded) return view
  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      {view}
    </div>
  )
}
