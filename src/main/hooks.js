import { createServer } from 'http'
import { appendFileSync, statSync, renameSync } from 'fs'
import { randomBytes } from 'crypto'
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs'
import { homedir } from 'os'
import { join, basename } from 'path'
import { registry } from './registry.js'
import { browsers } from './browser.js'

export const PORT = 47823
const CONFIG_DIR = join(homedir(), '.session-deck')
const TOKEN_FILE = join(CONFIG_DIR, 'token')
const LOG_FILE = join(CONFIG_DIR, 'hooks.jsonl')
export const HOOK_LOG = LOG_FILE
const LOG_LIMIT = 20 * 1024 * 1024

/**
 * The raw log is for diagnosis, so it keeps what explains behaviour and drops
 * bulk: Write/Edit payloads carry whole files, and grew the log past 11MB in a
 * week. Rotates once at 20MB, keeping one previous file.
 */
function slim(payload) {
  const out = { ...payload }
  if (out.tool_input) {
    const { command, file_path, path, pattern, url, description, run_in_background } = out.tool_input
    out.tool_input = { command, file_path, path, pattern, url, description, run_in_background }
  }
  if (out.tool_response && typeof out.tool_response === 'object') {
    const { backgroundTaskId, interrupted } = out.tool_response
    out.tool_response = { backgroundTaskId, interrupted }
  } else if (out.tool_response) {
    out.tool_response = String(out.tool_response).slice(0, 200)
  }
  if (typeof out.prompt === 'string') out.prompt = out.prompt.slice(0, 1000)
  return out
}

function appendLog(entry) {
  try {
    if (statSync(LOG_FILE).size > LOG_LIMIT) renameSync(LOG_FILE, `${LOG_FILE}.1`)
  } catch {}
  try {
    appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n')
  } catch {}
}

export function getToken() {
  mkdirSync(CONFIG_DIR, { recursive: true })
  if (!existsSync(TOKEN_FILE)) {
    writeFileSync(TOKEN_FILE, randomBytes(24).toString('hex'), { mode: 0o600 })
  }
  return readFileSync(TOKEN_FILE, 'utf8').trim()
}

/** Turn a raw hook payload into the one line a tile should show. */
function describe(payload) {
  const tool = payload.tool_name
  const input = payload.tool_input ?? {}

  if (!tool) return null
  if (tool === 'Bash') return `Bash  ${(input.command ?? '').slice(0, 60)}`

  const target = input.file_path ?? input.path ?? input.pattern ?? input.url ?? ''
  return target ? `${tool}  ${basename(String(target))}` : tool
}

/** Events that represent real work; start/end alone would log empty sessions. */
const WORK_EVENTS = new Set(['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Notification', 'Stop'])

/** SessionEnd reasons that mean "switching conversation", not "finished". */
const TRANSITIONS = new Set(['clear', 'resume'])

function nameFromPrompt(prompt) {
  const clean = String(prompt ?? '').trim().replace(/\s+/g, ' ')
  if (!clean || clean.startsWith('/')) return null
  if (clean.length <= 60) return clean
  const cut = clean.slice(0, 60)
  const space = cut.lastIndexOf(' ')
  return (space > 36 ? cut.slice(0, space) : cut).trimEnd() + '…'
}

function apply(payload, deckId, claudePid) {
  if (!payload.session_id) return
  const event = payload.hook_event_name

  // The PTY's own id travels with every hook, so a session whose Claude id just
  // changed (resume fallback, the picker, /clear, /resume) stays on its tile.
  const owner = registry.byDeckId(deckId)
  if (owner) registry.rebind(owner, payload.session_id)

  let session = registry.get(payload.session_id)
  if (!session) {
    if (event === 'SessionEnd') return // don't adopt something only as it ends
    session = registry.adopt(payload.session_id, payload.cwd, payload.transcript_path)
  }

  if (payload.cwd) session.cwd = payload.cwd
  registry.setTranscript(session, payload.transcript_path)
  if (claudePid) registry.noteClaudePid(session, claudePid)

  switch (event) {
    case 'SessionStart':
      session.status = 'ready'
      break
    case 'UserPromptSubmit': {
      session.status = 'working'
      session.question = null
      session.questionKind = null
      // A tile should never read "Untitled session". The first prompt is a
      // decent name immediately; anything better outranks it later.
      if (!session.name) registry.setName(session.id, nameFromPrompt(payload.prompt), 'prompt')
      // A pasted ticket URL teaches the deck where tickets live.
      registry.learnTicketBase(payload.prompt)
      registry.pushActivity(session, `> ${String(payload.prompt ?? '').slice(0, 70)}`)
      break
    }
    case 'PreToolUse': {
      session.status = 'working'
      const target = payload.tool_input?.file_path ?? payload.tool_input?.path
      if (target) registry.pushTouched(session, String(target))
      if (payload.tool_name === 'Bash' && payload.tool_input?.run_in_background) {
        registry.noteBackground(session, {
          toolUseId: payload.tool_use_id,
          command: String(payload.tool_input.command ?? ''),
          description: payload.tool_input.description ?? null
        })
      }
      const line = describe(payload)
      if (line) registry.pushActivity(session, line)
      break
    }
    case 'PostToolUse':
      // A Bash call may have switched branches; let the throttled check see it.
      if (payload.tool_name === 'Bash') session.repoCheckedAt = 0
      if (payload.tool_response?.backgroundTaskId) {
        registry.noteBackgroundTask(session, payload.tool_use_id, payload.tool_response.backgroundTaskId)
      }
      break
    case 'Notification': {
      const kind = payload.notification_type ?? ''
      // `idle_prompt` just means Claude finished and awaits the next instruction.
      // Treating it as blocked raised the one urgent signal for a session that
      // wanted nothing — the fastest way to make the alert useless.
      if (kind === 'idle_prompt') {
        session.status = 'done'
        session.question = null
        session.questionKind = null
        break
      }
      session.status = 'needs-you'
      session.question = payload.message ?? 'Waiting for your input'
      session.questionKind = kind || 'unknown'
      break
    }
    case 'Stop':
      session.status = 'done'
      session.question = null
      session.questionKind = null
      break
    case 'SessionEnd':
      if (TRANSITIONS.has(payload.reason)) return // a new id follows immediately
      if (session.pty) break // the PTY's own exit is the authoritative end
      session.status = 'closed'
      registry.markEnded(session.id)
      break
    default:
      return
  }

  if (WORK_EVENTS.has(event)) registry.recordWork(session, Date.now(), payload.prompt)
  registry.syncTranscript(session)
  registry.refreshRepo(session)
  registry.touch(session)
}

export function startHookServer(onPortBusy) {
  const token = getToken()

  const ROUTES = new Set(['/hook', '/mcp/name', '/mcp/test-page', '/mcp/pull-request', '/mcp/todo', '/mcp/browser'])

  const server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/sessions') {
      if (req.headers['x-deck-token'] !== token) {
        res.writeHead(403).end()
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(registry.serialize(), null, 2))
      return
    }

    if (req.method !== 'POST' || !ROUTES.has(req.url)) {
      res.writeHead(404).end()
      return
    }
    if (req.headers['x-deck-token'] !== token) {
      res.writeHead(403).end()
      return
    }

    let body = ''
    req.on('data', (c) => {
      body += c
      if (body.length > 1_000_000) req.destroy()
    })
    req.on('end', async () => {
      // Browser tools answer with data, so they get their own branch. The pane
      // is the calling session's own: resolved the same way as the other tools.
      if (req.url === '/mcp/browser') {
        const reply = (status, data) => {
          res.writeHead(status, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(data))
        }
        try {
          const { sessionId, claudePid, action, args } = JSON.parse(body)
          const target = await registry.resolveMcp(sessionId, claudePid)
          if (!target) return reply(404, { error: 'Session Deck is not tracking this session.' })
          reply(200, await browsers.handle(target.deckId ?? target.id, String(action ?? ''), args ?? {}))
        } catch (err) {
          reply(400, { error: err.message })
        }
        return
      }
      if (req.url !== '/hook') {
        try {
          const { sessionId, claudePid, name, url, title, text } = JSON.parse(body)
          // A deck-launched bridge knows its deck id; a globally installed one
          // only knows its parent: the Claude process the hooks already mapped.
          const target = await registry.resolveMcp(sessionId, claudePid)
          const id = target?.id
          const ok = !id
            ? false
            : req.url === '/mcp/name'
              ? registry.setName(id, name, 'mcp')
              : req.url === '/mcp/test-page'
                ? registry.addTestPage(id, { url, title })
                : req.url === '/mcp/pull-request'
                  ? registry.addPullRequest(id, { url, title })
                  : registry.addTodo(id, text, 'claude')
          res.writeHead(ok ? 204 : 404).end()
        } catch (err) {
          console.error('[mcp] request failed:', req.url, err.message)
          res.writeHead(400).end()
        }
        return
      }
      let payload
      try {
        payload = JSON.parse(body)
      } catch (err) {
        console.error('[hooks] unparseable payload:', err.message)
        res.writeHead(400).end()
        return
      }
      const deckId = req.headers['x-deck-session'] || null
      const claudePid = Number(req.headers['x-claude-pid']) || null
      // Raw payloads, so status bugs are diagnosed from evidence, not the UI.
      appendLog({ at: Date.now(), deckId, claudePid, ...slim(payload) })
      // Kept apart from parsing: a thrown bug used to be logged as "bad
      // payload", which is how a crash on every Edit went unnoticed.
      try {
        apply(payload, deckId, claudePid)
      } catch (err) {
        console.error('[hooks] apply failed:', payload.hook_event_name, err.stack)
      }
      // Answer only once the claude process is resolved: until then the hook's
      // shell is still alive to walk up from. Bounded, so a slow ps can never
      // hold Claude's hook past its timeout.
      const pending = registry.get(payload.session_id)?.pidResolution
      if (pending) {
        await Promise.race([pending.catch(() => {}), new Promise((r) => setTimeout(r, 1500))])
      }
      res.writeHead(204).end()
    })
  })

  // Dev and the packaged app share this port. Without this, launching one while
  // the other runs throws an unhandled EADDRINUSE and the app dies at startup.
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(
        `[hooks] port ${PORT} is already in use — another Session Deck ` +
          `(or \`npm run dev\`) is running. Status updates will not arrive in this window.`
      )
      onPortBusy?.()
      return
    }
    console.error('[hooks]', err)
  })

  server.listen(PORT, '127.0.0.1', () => {
    console.log(`[hooks] listening on 127.0.0.1:${PORT}`)
  })
  return server
}
