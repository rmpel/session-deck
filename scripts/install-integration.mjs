#!/usr/bin/env node
/**
 * Installs Session Deck's Claude Code integration for every session, including
 * ones started outside the deck:
 *
 *   1. hooks in ~/.claude/settings.json — status, and the ids that tie a
 *      terminal to its tile
 *   2. the MCP server at user scope — session names, test pages, pull
 *      requests and the user's checklist, plus instructions telling Claude when
 *      to use them
 *
 * Dry run by default: prints what would change and changes nothing.
 * Pass --write to apply (settings.json is backed up first).
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { randomBytes } from 'crypto'
import { execFileSync, execSync } from 'child_process'
import { dirname } from 'path'
import { fileURLToPath } from 'url'
import { ensurePrivateDir, makePrivate } from '../src/main/private-dir.mjs'

const SETTINGS = join(homedir(), '.claude', 'settings.json')
const CONFIG_DIR = join(homedir(), '.session-deck')
const TOKEN_FILE = join(CONFIG_DIR, 'token')
const TOKEN_HEADER_FILE = join(CONFIG_DIR, 'token-header')
const PORT = 47823
const MARKER = 'session-deck'

const EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'Notification',
  'Stop',
  'SessionEnd'
]

/** Private to the user: the token, the hook log and the store live here. */
const ensureConfigDir = () => ensurePrivateDir(CONFIG_DIR)

/**
 * The token, and the same token as a header line for curl's `-H @file`. The
 * app keeps both in step too (getToken in src/main/hooks.js).
 */
function ensureToken() {
  ensureConfigDir()
  let token = existsSync(TOKEN_FILE) ? readFileSync(TOKEN_FILE, 'utf8').trim() : ''
  // An emptied file counts as missing: an empty token matches a request without one.
  if (token.length < 32) {
    token = randomBytes(24).toString('hex')
    writeFileSync(TOKEN_FILE, token, { mode: 0o600 })
    makePrivate(TOKEN_FILE)
  }
  const header = `X-Deck-Token: ${token}\n`
  if (!existsSync(TOKEN_HEADER_FILE) || readFileSync(TOKEN_HEADER_FILE, 'utf8') !== header) {
    writeFileSync(TOKEN_HEADER_FILE, header, { mode: 0o600 })
    makePrivate(TOKEN_HEADER_FILE)
  }
  return token
}

// Claude Code already puts hook_event_name and session_id in the stdin JSON,
// so the hook is a straight pass-through. `|| true` keeps a dead deck from
// ever failing a hook and blocking the session.
const IS_WIN = process.platform === 'win32'
// Declared before anything calls resolveNode(): the hook command is built at
// load time, and a later `let` would still be in its temporal dead zone.
let cachedNode = null
const HOOK_CLIENT_COPY = join(CONFIG_DIR, 'hook-client.mjs')
const HOOK_CLIENT_SOURCE = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'main', 'hook-client.mjs')

/**
 * Which hook to install. macOS/Linux: curl — it costs ~10ms per hook against
 * ~150ms for starting node, and hooks run on every tool call. Windows: the Node
 * script, because hooks may run under cmd.exe or Git Bash and the curl form
 * depends on POSIX shell syntax. `--hook-runner=curl|node` overrides either.
 */
const runnerFlag = process.argv.find((a) => a.startsWith('--hook-runner='))?.split('=')[1]
const HOOK_RUNNER = runnerFlag === 'curl' || runnerFlag === 'node' ? runnerFlag : IS_WIN ? 'node' : 'curl'

// X-Deck-Session carries the SESSION_DECK_ID the deck exported into the PTY.
// Hooks inherit Claude's environment, so this is how the deck recognises its own
// terminal after Claude switches session id (resume fallback, /clear, /resume).
// $PPID is the process that ran the hook — claude or a shell under it; the deck
// walks up from there to find the claude process and its app.
// The token header is read by curl from a file (`-H @file`). Expanding it in
// the shell would put the token in curl's arguments, where every local user can
// read it with `ps` while a hook runs.
const curlCommand =
  `curl -sS -m 2 -X POST -H 'Content-Type: application/json' ` +
  `-H "@$HOME/.session-deck/token-header" ` +
  `-H "X-Deck-Session: \${SESSION_DECK_ID:-}" ` +
  `-H "X-Claude-Pid: $PPID" ` +
  `--data-binary @- http://127.0.0.1:${PORT}/hook >/dev/null 2>&1 || true`

// Forward slashes: valid for node and for both cmd.exe and Git Bash, where
// backslashes inside double quotes are not reliably literal.
const slash = (p) => (IS_WIN ? p.replace(/\\/g, '/') : p)
const nodeCommand = () => `"${slash(resolveNode())}" "${slash(HOOK_CLIENT_COPY)}"`

const command = HOOK_RUNNER === 'node' ? nodeCommand() : curlCommand

const entry = { matcher: '*', hooks: [{ type: 'command', command, timeout: 5 }] }

function deckEntries(list) {
  return (list ?? []).filter((e) => JSON.stringify(e).includes(MARKER))
}

function main() {
  const write = process.argv.includes('--write')
  ensureToken()

  const settings = existsSync(SETTINGS) ? JSON.parse(readFileSync(SETTINGS, 'utf8')) : {}
  settings.hooks ??= {}

  const added = []
  const updated = []
  for (const event of EVENTS) {
    settings.hooks[event] ??= []
    const existing = deckEntries(settings.hooks[event])
    if (existing.length === 0) {
      settings.hooks[event].push(entry)
      added.push(event)
      continue
    }
    // Upgrade an older deck hook in place rather than adding a second one.
    for (const e of existing) {
      for (const h of e.hooks ?? []) {
        if (h.type === 'command' && h.command.includes(MARKER) && h.command !== command) {
          h.command = command
          if (!updated.includes(event)) updated.push(event)
        }
      }
    }
  }

  const mcp = planMcp()
  const hooksCurrent = added.length === 0 && updated.length === 0

  if (hooksCurrent && !mcp.change) {
    console.log('Session Deck hooks and MCP server are installed and current. Nothing to do.')
    return
  }

  if (hooksCurrent) console.log('\nHooks: installed and current.')
  if (added.length) console.log(`\nWould add a Session Deck hook to: ${added.join(', ')}`)
  if (updated.length) console.log(`\nWould update the Session Deck hook on: ${updated.join(', ')}`)
  if (!hooksCurrent) console.log(`\nHook command (${HOOK_RUNNER}):\n  ${command}`)
  console.log(mcp.change ? `\nWould ${mcp.change} the MCP server (user scope):\n  ${mcp.node} ${BRIDGE_COPY}` : '\nMCP server: installed and current.')
  console.log('')

  if (!write) {
    console.log('Dry run — nothing written. Re-run with --write to apply:')
    console.log(`  npm run install-integration -- --write${runnerFlag ? ` --hook-runner=${HOOK_RUNNER}` : ''}\n`)
    return
  }

  if (!hooksCurrent) {
    if (HOOK_RUNNER === 'node') {
      ensureConfigDir()
      copyFileSync(HOOK_CLIENT_SOURCE, HOOK_CLIENT_COPY)
    }
    if (existsSync(SETTINGS)) {
      const backup = `${SETTINGS}.bak-${Date.now()}`
      copyFileSync(SETTINGS, backup)
      console.log(`Backed up existing settings to:\n  ${backup}`)
    }
    writeFileSync(SETTINGS, JSON.stringify(settings, null, 2) + '\n')
    console.log(`Wrote ${SETTINGS}`)
  }
  if (mcp.change) applyMcp(mcp)
  console.log('\nNew Claude Code sessions pick this up; running ones keep their old setup.\n')
}

// ------------------------------------------------------------------ MCP server

const BRIDGE_COPY = join(CONFIG_DIR, 'mcp-bridge.mjs')
const BRIDGE_SOURCE = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'main', 'mcp-bridge.mjs')

function resolveNode() {
  if (cachedNode) return cachedNode
  try {
    cachedNode = IS_WIN
      ? execFileSync('where', ['node'], { encoding: 'utf8' }).split(/\r?\n/).map((l) => l.trim()).find((l) => /\.exe$/i.test(l))
      : execFileSync(process.env.SHELL || '/bin/zsh', ['-lc', 'command -v node'], { encoding: 'utf8' }).trim()
  } catch {}
  return (cachedNode ||= process.execPath)
}

function planMcp() {
  const node = resolveNode()
  let current = null
  try {
    current = JSON.parse(readFileSync(join(homedir(), '.claude.json'), 'utf8')).mcpServers?.['session-deck'] ?? null
  } catch {}
  const wanted = { command: node, args: [BRIDGE_COPY] }
  const same = current && current.command === wanted.command && JSON.stringify(current.args) === JSON.stringify(wanted.args)
  const bridgeStale = !existsSync(BRIDGE_COPY) || readFileSync(BRIDGE_COPY, 'utf8') !== readFileSync(BRIDGE_SOURCE, 'utf8')
  return { node, change: !current ? 'add' : !same ? 'update' : bridgeStale ? 'refresh' : null, exists: Boolean(current) }
}

function applyMcp({ node, exists, change }) {
  // A stable path, refreshed by the app on start, so the registration survives
  // the app moving or updating.
  ensureConfigDir()
  copyFileSync(BRIDGE_SOURCE, BRIDGE_COPY)
  if (change === 'refresh') {
    console.log(`Refreshed ${BRIDGE_COPY}`)
    return
  }
  // Registered through the Claude CLI rather than by editing ~/.claude.json.
  // On Windows `claude` may be an npm .cmd shim, which only runs through a shell
  // — so the command is one quoted string there.
  const claude = (args) =>
    IS_WIN
      ? execSync(`claude ${args.map((a) => (/[\s"]/.test(a) ? `"${a}"` : a)).join(' ')}`, { stdio: 'inherit' })
      : execFileSync('claude', args, { stdio: 'inherit' })
  if (exists) claude(['mcp', 'remove', '--scope', 'user', 'session-deck'])
  claude(['mcp', 'add', '--scope', 'user', 'session-deck', '--', node, BRIDGE_COPY])
}

main()
