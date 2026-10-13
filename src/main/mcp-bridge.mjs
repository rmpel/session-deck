#!/usr/bin/env node
/**
 * Session Deck's MCP server: a stdio JSON-RPC bridge that forwards tool calls to
 * the running deck over localhost.
 *
 * Deliberately dependency-free (node builtins only) -- it is written to a temp
 * directory per session and executed by Claude Code, so it cannot rely on the
 * app's node_modules being reachable from wherever it lands.
 *
 * Identity comes from the environment: the deck exports SESSION_DECK_ID into the
 * session it spawned, and Claude Code passes its env down to MCP subprocesses.
 */
import { createInterface } from 'readline'
import { request } from 'http'
import { readFileSync } from 'fs'
import { homedir } from 'os'
import { join, resolve } from 'path'
import { pathToFileURL } from 'url'

const SESSION_ID = process.env.SESSION_DECK_ID || null
const PORT = Number(process.env.SESSION_DECK_PORT || 47823)
// Installed globally, the bridge gets no env from the deck: read the token file.
const TOKEN = process.env.SESSION_DECK_TOKEN || readToken()
// Its parent is the claude process, which the hooks have tied to a session.
const CLAUDE_PID = process.ppid

function readToken() {
  try {
    return readFileSync(join(homedir(), '.session-deck', 'token'), 'utf8').trim()
  } catch {
    return ''
  }
}

/**
 * Sent in the MCP handshake. Tool descriptions say what a tool does; this says
 * when to reach for them, which is what makes Claude use them unprompted.
 */
const INSTRUCTIONS = `Session Deck is a dashboard the user watches to see what each of their Claude Code sessions is doing. Keep it accurate with these tools — they are silent bookkeeping, so do not mention calling them.

- set_session_name: once, early in a task, with a short summary of the work (about 60 characters, lead with the ticket ID if there is one). Call again only if the task clearly changes.
- report_test_page: right after you create or update a page the user should open to check your work — for example a WordPress test page made with WP-CLI.
- report_pull_request: whenever you create a pull request, or hand the user a link to create one.
- add_user_todo: for each manual step the user must take after you finish that you cannot do yourself — e.g. clear a cache on staging, check something in a browser, merge or deploy, move a ticket. One short actionable item per call. Never add things you did or will do yourself.

Session Deck also gives this session its own browser pane, shown beside its terminal. Use the browser_* tools instead of the \`open\` command or Claude in Chrome whenever the user should see a page (a generated HTML report, a ticket, a test page) or you need to read or act on a web page: the pane is where the user is already looking, and it is this session's alone. Local files open too (pass a path). The pane keeps the user's logins, so authenticated pages (Jira, Atlassian) work once the user has signed in there; if a page asks for a login, ask the user to sign in in the pane, then continue.`
const FALLBACK_PROTOCOL = '2025-06-18'

const TAB = { type: 'number', description: 'Tab number from browser_tabs. Default: the active tab.' }

const BROWSER_TOOLS = [
  {
    name: 'browser_open',
    description:
      "Open a URL or local file in this session's browser pane in Session Deck, beside its terminal. " +
      'Navigates the active tab, or opens a new tab with new_tab. Waits for the page to load.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'http(s) URL, file:// URL, or a local file path.' },
        new_tab: { type: 'boolean', description: 'Open in a new tab instead of the active one.' },
        tab: TAB
      },
      required: ['url']
    }
  },
  {
    name: 'browser_tabs',
    description: "List the tabs in this session's browser pane.",
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'browser_select',
    description: 'Make a tab the active one in the pane.',
    inputSchema: { type: 'object', properties: { tab: TAB }, required: ['tab'] }
  },
  {
    name: 'browser_split',
    description: 'Show two tabs side by side in the pane, e.g. a list and the item opened from it. Omit `with` to end the split.',
    inputSchema: {
      type: 'object',
      properties: { tab: TAB, with: { type: 'number', description: 'The tab to show next to it.' } },
      required: ['tab']
    }
  },
  {
    name: 'browser_close',
    description: 'Close a tab in the pane.',
    inputSchema: { type: 'object', properties: { tab: TAB }, required: ['tab'] }
  },
  {
    name: 'browser_snapshot',
    description: "Read a tab: its URL, title, visible text, links and form fields.",
    inputSchema: { type: 'object', properties: { tab: TAB } }
  },
  {
    name: 'browser_screenshot',
    description: 'Screenshot a tab as it appears in the pane. Only works while the session is on screen in the deck.',
    inputSchema: { type: 'object', properties: { tab: TAB } }
  },
  {
    name: 'browser_click',
    description: 'Click the first element matching a CSS selector.',
    inputSchema: { type: 'object', properties: { selector: { type: 'string' }, tab: TAB }, required: ['selector'] }
  },
  {
    name: 'browser_type',
    description: 'Set the value of an input or textarea matching a CSS selector; optionally submit its form.',
    inputSchema: {
      type: 'object',
      properties: { selector: { type: 'string' }, text: { type: 'string' }, submit: { type: 'boolean' }, tab: TAB },
      required: ['selector', 'text']
    }
  },
  {
    name: 'browser_eval',
    description: 'Run a JavaScript expression in a tab and return its (JSON) value. Promises are awaited, so fetch() with the logged-in cookies works.',
    inputSchema: { type: 'object', properties: { expression: { type: 'string' }, tab: TAB }, required: ['expression'] }
  }
]

const TOOLS = [
  {
    name: 'set_session_name',
    description:
      'Name this Claude Code session so it is identifiable on the Session Deck ' +
      'dashboard. Call this once, early, with a short human-readable summary of ' +
      'the task you are working on (e.g. "Quotation template redesign"). ' +
      'Max ~60 characters.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Short task summary, ~60 chars max.' }
      },
      required: ['name']
    }
  },
  {
    name: 'report_pull_request',
    description:
      'Register a pull request for this session so it appears as a PR link on its ' +
      'Session Deck tile. Call it when you create a pull request, or when you give ' +
      'the user a URL to create one.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Full URL of the pull request (or its create page).' },
        title: { type: 'string', description: 'Optional pull request title.' }
      },
      required: ['url']
    }
  },
  {
    name: 'add_user_todo',
    description:
      "Add an item to the user's after-you-finish checklist on Session Deck: a manual " +
      'step they must take that you cannot do yourself (clear a cache, verify in a ' +
      'browser, deploy, update a ticket). One short, actionable item per call.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The step, phrased as an action. Max ~200 chars.' }
      },
      required: ['text']
    }
  },
  {
    name: 'report_test_page',
    description:
      'Register a preview/test page you created (usually via WP-CLI) so it appears ' +
      'as a clickable link on this session\'s dashboard tile. Call this immediately ' +
      'after creating the page, with its full URL.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Full URL, e.g. http://site.local/?p=4182' },
        title: { type: 'string', description: 'Optional label for the link.' }
      },
      required: ['url']
    }
  }
]

function post(path, body) {
  return new Promise((resolve) => {
    const data = JSON.stringify({ sessionId: SESSION_ID, claudePid: CLAUDE_PID, ...body })
    const req = request(
      {
        host: '127.0.0.1',
        port: PORT,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
          'X-Deck-Token': TOKEN
        },
        timeout: 2000
      },
      (res) => {
        res.resume()
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode })
      }
    )
    req.on('error', () => resolve({ ok: false, status: 0 }))
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, status: 0 }) })
    req.end(data)
  })
}

/** A browser action, answered with the deck's JSON (or its error). */
function browser(action, args) {
  return new Promise((resolve) => {
    const data = JSON.stringify({ sessionId: SESSION_ID, claudePid: CLAUDE_PID, action, args })
    const req = request(
      {
        host: '127.0.0.1',
        port: PORT,
        path: '/mcp/browser',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
          'X-Deck-Token': TOKEN
        },
        // Page loads wait up to 15s in the deck.
        timeout: 30000
      },
      (res) => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (c) => (body += c))
        res.on('end', () => {
          let json = null
          try {
            json = JSON.parse(body)
          } catch {}
          resolve({ status: res.statusCode, json })
        })
      }
    )
    req.on('error', () => resolve({ status: 0, json: null }))
    req.on('timeout', () => {
      req.destroy()
      resolve({ status: 0, json: null })
    })
    req.end(data)
  })
}

/** Paths become file:// URLs, resolved from where Claude runs. */
const toUrl = (value) => {
  const v = String(value ?? '').trim()
  return /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : pathToFileURL(resolve(v)).href
}

async function callBrowser(name, args = {}) {
  const action = name.replace(/^browser_/, '')
  const payload =
    action === 'open'
      ? { url: toUrl(args.url), newTab: Boolean(args.new_tab), tab: args.tab }
      : { ...args }
  const r = await browser(action, payload)
  if (r.status !== 200) return text(r.json?.error ?? explain(r), true)
  if (action === 'screenshot') {
    return { content: [{ type: 'image', data: r.json.png, mimeType: 'image/png' }], isError: false }
  }
  if (action === 'snapshot' || action === 'eval' || action === 'click' || action === 'type') {
    return text(r.json.result ?? '')
  }
  return text(JSON.stringify(r.json, null, 2))
}

function reply(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n')
}
function fail(id, code, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n')
}
const text = (t, isError = false) => ({ content: [{ type: 'text', text: t }], isError })

/** Distinguish "app is not running" from "app is running but does not know me". */
function explain({ status }) {
  if (status === 0) return 'Session Deck is not running, so nothing was recorded.'
  if (status === 404) return 'Session Deck is running but is not tracking this session.'
  if (status === 403) return 'Session Deck rejected the token for this session.'
  return `Session Deck returned HTTP ${status}.`
}

async function callTool(name, args) {
  if (BROWSER_TOOLS.some((t) => t.name === name)) return callBrowser(name, args)

  if (name === 'set_session_name') {
    const value = String(args?.name ?? '').trim().slice(0, 80)
    if (!value) return text('A non-empty name is required.', true)
    const r = await post('/mcp/name', { name: value })
    return r.ok ? text(`Session named "${value}" on the deck.`) : text(explain(r), true)
  }

  if (name === 'report_test_page') {
    const url = String(args?.url ?? '').trim()
    if (!/^https?:\/\//i.test(url)) return text('A full http(s) URL is required.', true)
    const r = await post('/mcp/test-page', {
      url,
      title: String(args?.title ?? '').trim().slice(0, 120)
    })
    return r.ok ? text(`Test page registered on the deck: ${url}`) : text(explain(r), true)
  }

  if (name === 'report_pull_request') {
    const url = String(args?.url ?? '').trim()
    if (!/^https?:\/\//i.test(url)) return text('A full http(s) URL is required.', true)
    const r = await post('/mcp/pull-request', { url, title: String(args?.title ?? '').trim().slice(0, 200) })
    return r.ok ? text(`Pull request registered on the deck: ${url}`) : text(explain(r), true)
  }

  if (name === 'add_user_todo') {
    const item = String(args?.text ?? '').trim().slice(0, 300)
    if (!item) return text('A non-empty item is required.', true)
    const r = await post('/mcp/todo', { text: item })
    return r.ok ? text(`Added to the user's checklist: ${item}`) : text(explain(r), true)
  }

  return text(`Unknown tool: ${name}`, true)
}

createInterface({ input: process.stdin }).on('line', async (line) => {
  if (!line.trim()) return
  let msg
  try {
    msg = JSON.parse(line)
  } catch {
    return
  }
  const { id, method, params } = msg
  // Notifications carry no id and must never be answered.
  if (id === undefined || id === null) return

  try {
    if (method === 'initialize') {
      reply(id, {
        protocolVersion: params?.protocolVersion ?? FALLBACK_PROTOCOL,
        capabilities: { tools: {} },
        serverInfo: { name: 'session-deck', version: '0.2.0' },
        instructions: INSTRUCTIONS
      })
    } else if (method === 'tools/list') {
      reply(id, { tools: [...TOOLS, ...BROWSER_TOOLS] })
    } else if (method === 'tools/call') {
      reply(id, await callTool(params?.name, params?.arguments))
    } else if (method === 'ping') {
      reply(id, {})
    } else {
      fail(id, -32601, `Method not found: ${method}`)
    }
  } catch (err) {
    fail(id, -32603, err?.message ?? 'Internal error')
  }
})
