import { EventEmitter } from 'events'
import { existsSync, readdirSync, statSync } from 'fs'
import { join, basename } from 'path'
import { homedir } from 'os'
import { randomUUID } from 'crypto'
import { launchSession, launchShell, COLS, ROWS } from './launcher.js'
import { getProject, projectForDirectory } from './local.js'
import { load, save, flush } from './store.js'
import { firstUserMessage, scanTitles, transcriptDigest } from './transcript.js'
import { primaryRepo } from './git.js'
import { snapshot, claudeAncestor, claudeShells, appFor, focusApp, killTree } from './proc.js'
import * as worklog from './worklog.js'
import { createReplay, append, replayText } from './replay.js'
import { runSummary, SUMMARY_MODEL } from './summary.js'

const MAX_ACTIVITY = 14 // enough for the tallest tile density
const WEEK = 7 * 24 * 60 * 60 * 1000
// Windows lists processes through PowerShell, which costs far more than ps.
const SCAN_INTERVAL = process.platform === 'win32' ? 10_000 : 5000
const FOREGROUND_VISIBLE_AFTER = 20_000 // a foreground command this old is worth showing too

/**
 * Where a name came from decides whether something else may replace it.
 * `user` covers both a rename in the deck and `/rename` inside Claude; between
 * those two the most recent wins.
 */
const NAME_RANK = { prompt: 1, mcp: 2, user: 3 }

/**
 * The one place a session object is built. Launch, adopt and restore used to
 * build their own literals, and they drifted: launched sessions never got
 * `touched`, so their first Edit threw inside the hook handler.
 */
function createSession(fields) {
  const now = Date.now()
  return {
    id: null,
    deckId: null, // SESSION_DECK_ID the PTY was spawned with; never changes
    name: null,
    nameSource: null,
    external: false,
    project: null,
    status: 'starting',
    activity: [],
    question: null,
    questionKind: null,
    cwd: null,
    launchDir: null, // a directory the user chose to start in; null = the site's own
    touched: [],
    transcriptPath: null,
    transcriptOffset: 0,
    transcriptCheckedAt: 0,
    branch: null,
    repoName: null,
    repoCheckedAt: 0,
    claudePid: null, // the claude process: the PTY for deck sessions, found via hooks otherwise
    claudePidHint: null, // a pid the hooks reported; the claude process is at or above it
    background: [], // run_in_background Bash calls seen in hooks
    processes: [], // live shells under claude, from the last scan
    finished: [], // background commands seen to exit
    appName: null,
    cols: COLS,
    rows: ROWS,
    startedAt: now,
    updatedAt: now,
    replay: createReplay(), // raw PTY output for the focused view
    pty: null,
    kind: 'claude', // or 'shell' (a plain terminal) or 'view' (a page, no terminal)
    ...fields
  }
}

/**
 * Tile state is derived from hook events, never from scraping the terminal.
 * Claude Code redraws its TUI with cursor movement, so the raw PTY stream has no
 * stable notion of "the last few lines" — hooks hand over the structured facts.
 */
class Registry extends EventEmitter {
  constructor() {
    super()
    this.sessions = new Map()
    this.quitting = false
    this.store = load()
    this.store.worklog ??= {}
    this.store.todos ??= {}
    this.store.pullRequests ??= {}
    this.store.ticketOverrides ??= {}
    this.store.summaries ??= {}
    this.summarizing = new Map() // session id -> the running summary job
    this.restore()
    this.scanTimer = setInterval(() => this.scanProcesses(), SCAN_INTERVAL)
  }

  /** Import work history that predates the work log, once. */
  backfillWorklog(hookLogPath) {
    if (this.store.worklogBackfilled) return
    const firstPrompt = {}
    const projects = new Map()
    const projectOfCwd = (cwd) => {
      if (!projects.has(cwd)) projects.set(cwd, cwd ? projectForDirectory(cwd) : null)
      return projects.get(cwd)
    }
    const WORK = new Set(['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Notification', 'Stop'])
    worklog.backfill(this.store.worklog, hookLogPath, (e) => {
      if (!WORK.has(e.hook_event_name)) return { skip: true }
      if (e.hook_event_name === 'UserPromptSubmit' && !firstPrompt[e.session_id] && e.prompt) {
        firstPrompt[e.session_id] = String(e.prompt).trim().replace(/\s+/g, ' ').slice(0, 60)
      }
      const project = projectOfCwd(e.cwd)
      return {
        project: project?.name,
        projectKey: this.projectKey(project),
        name: this.store.names[e.session_id] ?? firstPrompt[e.session_id]
      }
    })
    this.store.worklogBackfilled = Date.now()
    save(this.store)
  }

  // ---------------------------------------------------------------- lookup

  get(id) {
    return this.sessions.get(id) ?? null
  }

  /** By current session id, or by the deck id the PTY was launched with. */
  resolve(id) {
    return this.sessions.get(id) ?? this.byDeckId(id)
  }

  /**
   * Who an MCP call belongs to. A deck-launched bridge sends its deck id; a
   * globally installed one can only send its parent pid — the claude process
   * the hooks already tied to a session.
   */
  async resolveMcp(sessionId, claudePid) {
    const direct = this.resolve(sessionId)
    if (direct) return direct
    const pid = Number(claudePid)
    if (!pid) return null
    const match = (p) =>
      [...this.sessions.values()].find((s) => s.claudePid === p || s.claudePidHint === p || s.pty?.pid === p) ?? null
    // The parent is normally claude itself; if something sits in between (npx,
    // a shell), walk up to the claude process.
    return match(pid) ?? match(claudeAncestor(pid, await snapshot()))
  }

  byDeckId(deckId) {
    if (!deckId) return null
    for (const s of this.sessions.values()) if (s.deckId === deckId) return s
    return null
  }

  // ------------------------------------------------------------- lifecycle

  launch(project, { resumeId, name, nameSource } = {}) {
    const launchDir = project.cwd ?? null
    const { sessionId, pty } = launchSession(project, { resumeId, cwd: launchDir })
    const session = createSession({
      id: sessionId,
      deckId: sessionId,
      name: name ?? this.store.names[sessionId] ?? null,
      nameSource: nameSource ?? (this.store.names[sessionId] ? 'user' : null),
      project: pick(project),
      cwd: launchDir ?? project.path,
      launchDir,
      claudePid: pty.pid, // bash -> exec launcher -> exec claude: same pid
      pty
    })

    pty.onData((chunk) => {
      append(session.replay, chunk)
      // Keyed by deckId: the Claude session id can change mid-stream.
      this.emit('data', session.deckId, chunk)
    })
    pty.onExit(() => {
      session.pty = null
      session.status = 'closed'
      // Quitting the app is an interruption, not an ending: keep it resumable.
      if (!this.quitting) this.markEnded(session.id)
      this.touch(session)
    })

    this.sessions.set(sessionId, session)
    this.remember(session)
    this.refreshRepo(session, true)
    this.touch(session)
    return session
  }

  /**
   * A plain terminal: the user's shell in `dir`, for the odd command without
   * leaving the deck. Not remembered — there is no conversation to resume —
   * and gone when the shell exits.
   */
  launchShell(dir) {
    const cwd = dir && existsSync(dir) ? dir : homedir()
    const { id, pty } = launchShell(cwd)
    const session = createSession({
      id,
      deckId: id,
      kind: 'shell',
      name: `Terminal · ${cwd === homedir() ? '~' : basename(cwd)}`,
      nameSource: 'user',
      project: pick(projectForDirectory(cwd)),
      cwd,
      status: 'ready',
      pty
    })
    pty.onData((chunk) => {
      append(session.replay, chunk)
      this.emit('data', session.deckId, chunk)
    })
    pty.onExit(() => {
      if (this.quitting) return
      this.sessions.delete(session.id)
      this.emit('change', this.serialize())
    })
    this.sessions.set(id, session)
    this.touch(session)
    return session
  }

  /**
   * A view: one of the user's saved pages (mail, calendar, hours) as a session
   * of its own, the page filling the viewer. One per saved view — asking again
   * returns the open one. Not remembered across restarts; logins are, by the
   * browser panes.
   */
  launchView({ id, label, url }) {
    const deckId = `view-${id}`
    const open = this.byDeckId(deckId)
    if (open) return { session: open, fresh: false }
    let host = ''
    try {
      host = new URL(url).host
    } catch {}
    const session = createSession({
      id: deckId,
      deckId,
      kind: 'view',
      name: label,
      nameSource: 'user',
      // A key of its own, so it never shares a real project's lists.
      project: { id: null, name: label, domain: host, path: `view:${id}` },
      status: 'ready'
    })
    this.sessions.set(deckId, session)
    this.touch(session)
    return { session, fresh: true }
  }

  /** Start a session in a chosen directory (a Local site's shell if inside one). */
  launchDirectory(dir) {
    const recent = (this.store.recentDirs ?? []).filter((d) => d !== dir)
    this.store.recentDirs = [dir, ...recent].slice(0, 8)
    save(this.store)
    return this.launch(projectForDirectory(dir))
  }

  recentDirectories() {
    return (this.store.recentDirs ?? []).filter((d) => existsSync(d))
  }

  /**
   * Adopt a session started outside the deck. Hooks are global, so its events
   * arrive anyway — dropping them made the deck under-report what was running.
   * Read-only: no PTY, so no terminal, but full status.
   */
  adopt(id, cwd, transcriptPath) {
    const dir = cwd || ''
    const persisted = this.store.names[id]
    const session = createSession({
      id,
      external: true,
      name: persisted ?? firstUserMessage(transcriptPath),
      nameSource: persisted ? 'user' : 'prompt',
      project: dir ? pick(projectForDirectory(dir)) : { id: null, name: 'unknown', domain: '', path: '' },
      status: 'working',
      cwd: dir,
      transcriptPath: transcriptPath ?? null
    })
    this.sessions.set(id, session)
    this.syncTranscript(session, true)
    this.refreshRepo(session, true)
    this.touch(session)
    return session
  }

  /**
   * The id a terminal reports is not stable. A resume that falls back to a fresh
   * session, the resume picker, `/resume` and `/clear` all switch it. Hooks
   * carry the PTY's SESSION_DECK_ID, so when it shows up under a new id the tile
   * follows — absorbing any duplicate that was adopted under that id meanwhile.
   */
  rebind(session, newId) {
    if (!newId || session.id === newId) return
    const dup = this.sessions.get(newId)
    if (dup && dup !== session) {
      if (rank(dup.nameSource) > rank(session.nameSource)) {
        session.name = dup.name
        session.nameSource = dup.nameSource
      }
      if (dup.activity.length) session.activity = dup.activity
      session.claudePidHint ??= dup.claudePidHint
      session.touched = [...new Set([...session.touched, ...dup.touched])]
      this.sessions.delete(newId)
    }

    const oldId = session.id
    this.sessions.delete(oldId)
    session.id = newId
    session.transcriptPath = null // a different conversation file; the next hook supplies it
    session.transcriptOffset = 0
    this.sessions.set(newId, session)

    const rec = this.store.sessions[oldId]
    if (rec) {
      delete this.store.sessions[oldId]
      this.store.sessions[newId] = { ...rec, id: newId, transcriptPath: null }
    }
    if (this.store.names[oldId] && !this.store.names[newId]) {
      this.store.names[newId] = this.store.names[oldId]
    }
    delete this.store.names[oldId]
    save(this.store)
  }

  /** End a running session. The tile stays, showing Closed. */
  close(id) {
    const s = this.resolve(id)
    if (!s) return
    if (!s.pty) return this.remove(s.id)
    s.pty.kill() // onExit marks it closed and ended
  }

  /** Drop a tile and forget it entirely, killing its PTY if one is running. */
  remove(id) {
    const s = this.resolve(id)
    if (!s) return
    s.pty?.kill()
    this.sessions.delete(s.id)
    delete this.store.sessions[s.id]
    delete this.store.names[s.id]
    save(this.store)
    this.emit('change', this.serialize())
  }

  /**
   * Reopen a conversation — an interrupted one after a restart, or one that was
   * closed but not removed. Refused when its transcript is gone: `--resume` on a
   * missing conversation falls back to a fresh session or the resume picker,
   * which is exactly how the duplicate-tile bug started.
   */
  reopen(id) {
    const s = this.resolve(id)
    if (!s || s.pty || s.external || !this.canReopen(s)) return null
    const project = projectOf(s.project, s.launchDir)
    if (!project) return null
    this.sessions.delete(s.id)
    // Claude files a conversation under the directory it started in, so it has
    // to be resumed from that same directory to be found.
    try {
      return this.launch(project, { resumeId: s.id, name: s.name, nameSource: s.nameSource })
    } catch (err) {
      // Keep the tile: it is still resumable once whatever broke is fixed.
      this.sessions.set(s.id, s)
      throw err
    }
  }

  canReopen(s) {
    return Boolean(
      !s.pty && !s.external && (s.project?.id || s.project?.path) && s.transcriptPath && existsSync(s.transcriptPath)
    )
  }

  /** Quit: kill everything without marking it ended, so it comes back resumable. */
  shutdown() {
    this.quitting = true
    clearInterval(this.scanTimer)
    for (const s of this.sessions.values()) s.pty?.kill()
    flush(this.store)
  }

  // ----------------------------------------------------------- persistence

  /**
   * Rebuild tiles for sessions the deck launched before it last quit. They stay
   * until removed; records are pruned only when they could never be reopened.
   */
  restore() {
    let pruned = false
    for (const rec of Object.values(this.store.sessions)) {
      const project = projectOf({ id: rec.projectId, path: rec.projectPath }, rec.launchDir)
      const transcript =
        rec.transcriptPath && existsSync(rec.transcriptPath) ? rec.transcriptPath : locateTranscript(rec.id)
      // A tile that can never be reopened is only clutter: no site, a week idle,
      // or no saved conversation to go back to.
      if (!project || !transcript || Date.now() - (rec.lastSeen ?? 0) > WEEK) {
        delete this.store.sessions[rec.id]
        pruned = true
        continue
      }
      rec.transcriptPath = transcript
      const persisted = this.store.names[rec.id]
      this.sessions.set(
        rec.id,
        createSession({
          id: rec.id,
          deckId: rec.deckId ?? rec.id,
          name: persisted ?? rec.name ?? null,
          nameSource: persisted ? 'user' : (rec.nameSource ?? null),
          project: pick(project),
          status: rec.endedCleanly ? 'closed' : 'resumable',
          cwd: rec.cwd ?? project.path,
          launchDir: rec.launchDir ?? null,
          transcriptPath: transcript,
          startedAt: rec.startedAt ?? rec.lastSeen,
          updatedAt: rec.lastSeen
        })
      )
    }
      if (pruned) save(this.store)
  }

  remember(session) {
    if (session.external) return
    const prev = this.store.sessions[session.id] ?? {}
    this.store.sessions[session.id] = {
      ...prev,
      id: session.id,
      deckId: session.deckId,
      projectId: session.project.id,
      projectPath: session.project.path,
      projectName: session.project.name,
      launchDir: session.launchDir,
      name: session.name,
      nameSource: session.nameSource,
      cwd: session.cwd,
      transcriptPath: session.transcriptPath ?? prev.transcriptPath ?? null,
      startedAt: session.startedAt,
      lastSeen: Date.now(),
      endedCleanly: prev.endedCleanly && !session.pty ? prev.endedCleanly : false
    }
    save(this.store)
  }

  markEnded(id) {
    if (this.quitting) return
    const rec = this.store.sessions[id]
    if (!rec) return
    rec.endedCleanly = true
    save(this.store)
  }

  // ----------------------------------------------------------------- names

  setName(id, name, source) {
    const s = this.resolve(id)
    const clean = String(name ?? '').trim()
    if (!s || !clean) return false
    if (rank(source) < rank(s.nameSource)) return false
    s.name = clean.slice(0, 80)
    s.nameSource = source
    if (source === 'user') {
      this.store.names[s.id] = s.name
      save(this.store)
    }
    this.touch(s)
    return true
  }

  /**
   * Pick up `/rename` from the transcript. On the first read of a file a title
   * found there is old news, so it must not override a rename made in the deck.
   */
  syncTranscript(session, force = false) {
    if (!session.transcriptPath) return
    if (!force && Date.now() - session.transcriptCheckedAt < 2000) return
    session.transcriptCheckedAt = Date.now()
    const initial = session.transcriptOffset === 0
    const { title, offset } = scanTitles(session.transcriptPath, session.transcriptOffset)
    session.transcriptOffset = offset
    if (!title || title === session.name) return
    if (initial && this.store.names[session.id]) return
    this.setName(session.id, title, 'user')
  }

  setTranscript(session, path) {
    if (!path || path === session.transcriptPath) return
    session.transcriptPath = path
    session.transcriptOffset = 0
    if (!session.external) this.remember(session)
    this.syncTranscript(session, true)
  }

  // ------------------------------------------------------------------ repo

  async refreshRepo(session, force = false) {
    if (!force && Date.now() - session.repoCheckedAt < 10_000) return
    session.repoCheckedAt = Date.now()
    const info = await primaryRepo(session.cwd, session.touched).catch(() => null)
    const branch = info?.branch ?? null
    const repoName = info?.name ?? null
    if (branch === session.branch && repoName === session.repoName) return
    session.branch = branch
    session.repoName = repoName
    if (this.sessions.get(session.id) === session) this.touch(session)
  }

  // ------------------------------------------------------ processes & apps

  /**
   * Resolve the claude process from a pid a hook reported — right away, while
   * the hook's request is in flight and every process between it and claude is
   * guaranteed alive. Resolved later on a scan, a short-lived shell in that
   * chain may already have exited, leaving nothing to walk up from.
   */
  noteClaudePid(session, pid) {
    if (session.pty || !pid) return null // a deck session's claude pid is already known
    session.claudePidHint = pid
    if (session.claudePid) return null // resolved already; scans notice if it dies
    // Returned so the hook handler can hold its response until this is done:
    // the hook's shell waits on curl, and curl waits on that response.
    session.pidResolution = snapshot().then((table) => {
      const claude = claudeAncestor(pid, table)
      if (!claude || session.claudePid === claude) return
      session.claudePid = claude
      session.appName = appFor(claude, table)?.name ?? null
      if (this.sessions.get(session.id) === session) this.emit('change', this.serialize())
    })
    return session.pidResolution
  }

  noteBackground(session, { toolUseId, command, description }) {
    if (!command) return
    session.background = [
      ...session.background.filter((b) => b.toolUseId !== toolUseId),
      { toolUseId, command, description, taskId: null, at: Date.now() }
    ].slice(-30)
  }

  noteBackgroundTask(session, toolUseId, taskId) {
    const b = session.background.find((x) => x.toolUseId === toolUseId)
    if (b) b.taskId = taskId
  }

  /**
   * Every few seconds, one `ps` for all sessions: which shells Claude is running,
   * which of them it started in the background, which have finished, and which
   * app an external session lives in. Emits only when something changed.
   */
  async scanProcesses() {
    const live = [...this.sessions.values()].filter((s) => s.kind !== 'shell' && (s.pty || s.claudePid || s.claudePidHint))
    if (!live.length) return
    const table = await snapshot()
    let changed = false

    for (const s of live) {
      const pid = s.pty
        ? s.pty.pid
        : s.claudePid && table.has(s.claudePid)
          ? s.claudePid
          : claudeAncestor(s.claudePidHint, table)
      if (pid !== s.claudePid) {
        s.claudePid = pid
        changed = true
      }
      const app = !s.pty && pid ? (appFor(pid, table)?.name ?? null) : null
      if (app !== s.appName) {
        s.appName = app
        changed = true
      }

      const shells = pid ? claudeShells(pid, table) : []
      const now = Date.now()
      const processes = shells
        .map((sh) => {
          const bg = [...s.background].reverse().find((b) => b.command === sh.command)
          return {
            pid: sh.pid,
            command: sh.command,
            description: bg?.description ?? null,
            taskId: bg?.taskId ?? null,
            background: Boolean(bg),
            startedAt: sh.startedAt,
            running: sh.running
          }
        })
        .filter((p) => p.background || now - p.startedAt >= FOREGROUND_VISIBLE_AFTER)

      // Background commands that were running last scan and are gone now.
      const gone = s.processes.filter((p) => p.background && !processes.some((q) => q.pid === p.pid))
      if (gone.length) {
        s.finished = [
          ...gone.map((p) => ({ ...p, endedAt: now })),
          ...s.finished
        ].slice(0, 5)
      }
      const sig = (list) => list.map((p) => `${p.pid}:${p.taskId}:${p.running.join('|')}`).join(',')
      if (sig(processes) !== sig(s.processes) || gone.length) {
        s.processes = processes
        changed = true
      }
    }
    if (changed) this.emit('change', this.serialize())
  }

  /** Stop a shell Claude started — only one currently listed for this session. */
  async stopProcess(id, pid) {
    const s = this.resolve(id)
    if (!s || !s.processes.some((p) => p.pid === Number(pid))) return false
    killTree(Number(pid), await snapshot())
    setTimeout(() => this.scanProcesses(), 800)
    return true
  }

  /** Bring an external session's app (Terminal, iTerm, PhpStorm…) to the front. */
  async focusApp(id) {
    const s = this.resolve(id)
    if (!s?.claudePid) return null
    const app = appFor(s.claudePid, await snapshot())
    if (!app) return null
    focusApp(app)
    return app.name
  }

  // --------------------------------------------------------------- terminal

  resize(id, cols, rows) {
    const s = this.resolve(id)
    const c = Math.max(40, Math.min(400, Math.round(cols)))
    const r = Math.max(10, Math.min(200, Math.round(rows)))
    if (!s?.pty || (s.cols === c && s.rows === r)) return
    s.cols = c
    s.rows = r
    try {
      s.pty.resize(c, r)
    } catch {}
  }

  /** What the focused view writes into a fresh terminal before going live. */
  replayFor(id) {
    const s = this.resolve(id)
    return s ? replayText(s.replay) : ''
  }

  ptySize(id) {
    const s = this.resolve(id)
    return { cols: s?.cols ?? COLS, rows: s?.rows ?? ROWS }
  }

  // ---------------------------------------------------------------- worklog

  recordWork(session, at, text) {
    worklog.record(this.store.worklog, {
      key: session.deckId ?? session.id,
      at,
      project: session.project?.name,
      projectKey: this.projectKey(session.project),
      name: session.name,
      cwd: session.cwd,
      branch: session.branch,
      text
    })
    save(this.store)
  }

  worklogDays() {
    return worklog.days(this.store.worklog)
  }

  worklogFor(day) {
    return worklog.summarize(this.store.worklog, day, this.store.ticketOverrides)
  }

  /**
   * Set a session's ticket by hand, or clear it back to the detected one with an
   * empty value. Keyed like the work log, so it applies on every day the
   * session ran and on its tile.
   */
  setTicket(key, text) {
    const clean = String(text ?? '').trim()
    const ticket = worklog.normalizeTicket(clean)
    if (clean && !ticket) return false
    if (ticket) this.store.ticketOverrides[key] = ticket
    else delete this.store.ticketOverrides[key]
    save(this.store)
    this.emit('change', this.serialize())
    return true
  }

  // --------------------------------------------------------------- tickets

  /**
   * The ticket a session is on, from its branch (feature/EXC-207-…) or its name.
   * Linked only once a base URL is known — learned from any ticket URL pasted
   * into a prompt, or set in Settings. A ticket set by hand in "Worked on"
   * wins. Read-only: a link, nothing else.
   */
  ticketFor(session) {
    const key =
      this.store.ticketOverrides[session.deckId ?? session.id] ??
      worklog.ticketsIn(`${session.branch ?? ''} ${session.name ?? ''}`)[0] ??
      null
    if (!key) return null
    const base = this.store.ticketBase
    return { key, url: base ? `${base.replace(/\/+$/, '')}/${key}` : null }
  }

  learnTicketBase(text) {
    if (this.store.ticketBase) return
    const m = String(text ?? '').match(/https?:\/\/[^\s"'<>]+\/browse\//i)
    if (!m) return
    this.store.ticketBase = m[0].replace(/\/+$/, '')
    save(this.store)
  }

  setTicketBase(url) {
    const clean = String(url ?? '').trim().replace(/\/+$/, '')
    this.store.ticketBase = clean || null
    save(this.store)
    this.emit('change', this.serialize())
    return this.store.ticketBase
  }

  ticketBase() {
    return this.store.ticketBase ?? null
  }

  // ---------------------------------------------------------- pull requests

  addPullRequest(id, { url, title }) {
    const s = this.resolve(id)
    if (!s || !/^https?:\/\//i.test(String(url ?? ''))) return false
    const key = this.projectKey(s.project)
    const entry = {
      id: randomUUID(),
      url,
      title: title || null,
      branch: s.branch ?? null,
      at: Date.now(),
      sessionId: s.id,
      sessionName: s.name ?? null
    }
    const list = (this.store.pullRequests[key] ?? []).filter((e) => e.url !== url)
    this.store.pullRequests[key] = [...list, entry].slice(-50)
    save(this.store)
    this.touch(s)
    return true
  }

  pullRequestsFor(project) {
    return this.store.pullRequests[this.projectKey(project)] ?? []
  }

  forgetPullRequest(projectKey, prId) {
    const list = this.store.pullRequests[projectKey] ?? []
    const next = list.filter((e) => e.id !== prId)
    if (next.length === list.length) return false
    this.store.pullRequests[projectKey] = next
    save(this.store)
    this.emit('change', this.serialize())
    return true
  }

  /** The PR for what this session is on: its branch first, else its own latest. */
  pullRequestFor(s) {
    const byTime = [...this.pullRequestsFor(s.project)].sort((a, b) => b.at - a.at)
    return (
      (s.branch && byTime.find((p) => p.branch === s.branch)) ||
      byTime.find((p) => p.sessionId === s.id) ||
      null
    )
  }

  // --------------------------------------------------------------- summaries

  transcriptOf(s) {
    const path = s.transcriptPath && existsSync(s.transcriptPath) ? s.transcriptPath : locateTranscript(s.id)
    return path ?? null
  }

  /** The saved summary, and whether the conversation has moved on since. */
  summaryFor(id) {
    const s = this.resolve(id)
    if (!s) return null
    const path = this.transcriptOf(s)
    const saved = this.store.summaries[s.id] ?? null
    let size = 0
    try {
      size = path ? statSync(path).size : 0
    } catch {}
    return {
      summary: saved,
      pending: this.summarizing.has(s.id),
      available: Boolean(path),
      outdated: Boolean(saved && size > saved.size)
    }
  }

  /** Summarize a session with `claude -p`. One run per session at a time. */
  summarize(id) {
    const s = this.resolve(id)
    if (!s) return Promise.reject(new Error('This session is no longer on the deck.'))
    if (this.summarizing.has(s.id)) return this.summarizing.get(s.id)
    const path = this.transcriptOf(s)
    const digest = path && transcriptDigest(path)
    if (!digest) return Promise.reject(new Error('There is nothing to summarize yet.'))
    const size = statSync(path).size
    const key = s.id
    const job = runSummary(digest)
      .then((text) => {
        this.store.summaries[key] = { text, at: Date.now(), size, model: SUMMARY_MODEL }
        // Kept for the sessions still around, not forever.
        const keep = Object.entries(this.store.summaries).sort((a, b) => b[1].at - a[1].at).slice(0, 200)
        this.store.summaries = Object.fromEntries(keep)
        save(this.store)
        return this.summaryFor(key)
      })
      .finally(() => this.summarizing.delete(key))
    this.summarizing.set(key, job)
    return job
  }

  // ------------------------------------------------------------------ to-dos

  /** Things the *user* has to do once Claude is done — added by Claude or by hand. */
  addTodo(id, text, source) {
    const s = this.resolve(id)
    const clean = String(text ?? '').trim().slice(0, 300)
    if (!s || !clean) return false
    const key = this.projectKey(s.project)
    this.store.todos[key] = [
      ...(this.store.todos[key] ?? []),
      { id: randomUUID(), text: clean, done: false, at: Date.now(), doneAt: null, sessionId: s.id, sessionName: s.name ?? null, source }
    ]
    save(this.store)
    this.touch(s)
    return true
  }

  toggleTodo(projectKey, todoId) {
    const item = (this.store.todos[projectKey] ?? []).find((t) => t.id === todoId)
    if (!item) return false
    item.done = !item.done
    item.doneAt = item.done ? Date.now() : null
    save(this.store)
    this.emit('change', this.serialize())
    return true
  }

  removeTodo(projectKey, todoId) {
    const list = this.store.todos[projectKey] ?? []
    const next = list.filter((t) => t.id !== todoId)
    if (next.length === list.length) return false
    this.store.todos[projectKey] = next
    save(this.store)
    this.emit('change', this.serialize())
    return true
  }

  // ------------------------------------------------------------ test pages

  projectKey(project) {
    return project?.id || project?.path || 'unknown'
  }

  pagesFor(project) {
    return this.store.testPages[this.projectKey(project)] ?? []
  }

  addTestPage(id, page) {
    const s = this.resolve(id)
    if (!s) return false
    const key = this.projectKey(s.project)
    const entry = {
      id: randomUUID(),
      url: page.url,
      title: page.title || page.url,
      at: Date.now(),
      sessionId: s.id,
      sessionName: s.name ?? null,
      projectName: s.project.name
    }
    const existing = (this.store.testPages[key] ?? []).filter((e) => e.url !== entry.url)
    this.store.testPages[key] = [...existing, entry]
    save(this.store)
    this.touch(s)
    return true
  }

  forgetTestPage(projectKey, pageId) {
    const list = this.store.testPages[projectKey]
    if (!list) return false
    const next = list.filter((e) => e.id !== pageId)
    if (next.length === list.length) return false
    this.store.testPages[projectKey] = next
    save(this.store)
    this.emit('change', this.serialize())
    return true
  }

  flushStore() {
    flush(this.store)
  }

  // --------------------------------------------------------------- activity

  write(id, data) {
    this.resolve(id)?.pty?.write(data)
  }

  /** Paths a session edited — how the diff view finds the repos that matter. */
  pushTouched(session, path) {
    if (!path || session.touched.includes(path)) return
    session.touched = [...session.touched, path].slice(-300)
  }

  pushActivity(session, line) {
    session.activity = [...session.activity, line].slice(-MAX_ACTIVITY)
  }

  touch(session) {
    session.updatedAt = Date.now()
    const rec = this.store.sessions[session.id]
    if (rec && !session.external) {
      rec.name = session.name ?? rec.name
      rec.nameSource = session.nameSource ?? rec.nameSource
      rec.cwd = session.cwd ?? rec.cwd
      rec.lastSeen = session.updatedAt
      save(this.store)
    }
    this.emit('change', this.serialize())
  }

  /** PTY handles and raw buffers never cross the IPC boundary. */
  serialize() {
    return [...this.sessions.values()].map((s) => ({
      // Stable UI identity. `id` follows Claude's session id, which can change
      // under a tile; selection and terminal streams key on this instead.
      uid: s.deckId ?? s.id,
      id: s.id,
      kind: s.kind,
      cwd: s.cwd,
      name: s.name,
      nameSource: s.nameSource,
      project: s.project,
      projectKey: this.projectKey(s.project),
      status: s.status,
      activity: s.activity,
      question: s.question,
      questionKind: s.questionKind,
      external: s.external,
      resumable: s.status === 'resumable',
      attached: Boolean(s.pty),
      canReopen: this.canReopen(s),
      branch: s.branch,
      repoName: s.repoName,
      testPages: this.pagesFor(s.project),
      pullRequest: this.pullRequestFor(s),
      pullRequests: this.pullRequestsFor(s.project),
      ticket: this.ticketFor(s),
      todos: this.store.todos[this.projectKey(s.project)] ?? [],
      processes: s.processes,
      finished: s.finished,
      appName: s.appName,
      startedAt: s.startedAt,
      updatedAt: s.updatedAt
    }))
  }
}

/**
 * Find a conversation's transcript by session id. Records from before the path
 * was stored have none, and "unknown" must not be read as "gone".
 */
function locateTranscript(id) {
  const root = join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects')
  try {
    for (const dir of readdirSync(root)) {
      const candidate = join(root, dir, `${id}.jsonl`)
      if (existsSync(candidate)) return candidate
    }
  } catch {}
  return null
}

/**
 * Resolve a stored project back to something launchable: a Local site by id, or
 * a directory by path. `launchDir` restores a chosen start folder.
 */
function projectOf(project, launchDir) {
  const base = project?.id
    ? getProject(project.id)
    : project?.path && existsSync(project.path)
      ? projectForDirectory(project.path)
      : null
  if (!base) return null
  return { ...base, cwd: launchDir && existsSync(launchDir) ? launchDir : undefined }
}

function pick(p) {
  return { id: p.id, name: p.name, domain: p.domain, path: p.path }
}

function rank(source) {
  return NAME_RANK[source] ?? 0
}

export const registry = new Registry()
export { COLS, ROWS }
