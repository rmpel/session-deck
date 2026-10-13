import { spawn } from 'node-pty'
import { randomUUID } from 'crypto'
import { writeFileSync, chmodSync, mkdirSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir, homedir } from 'os'
import { bundledBridge } from './bridge-copy.js'
import { resolveClaudeBin, resolveNodeBin } from './claude-bin.js'
import { getToken, PORT } from './hooks.js'
import { launcherScript, windowsLauncherScript, shq } from './launch-script.js'
import { IS_WIN } from './platform.js'

// Pinned for the session's whole life. Never resized on focus change — that is
// what keeps Claude Code's TUI from re-flowing every time a tile is opened.
export const COLS = 120
export const ROWS = 32

const LAUNCHER_DIR = join(tmpdir(), 'session-deck-launchers')

/**
 * When the tools are installed globally (`npm run install-integration`), every
 * session already has them — passing --mcp-config as well would register a
 * second copy of the same server.
 */
function globalBridgeInstalled() {
  try {
    const cfg = JSON.parse(readFileSync(join(homedir(), '.claude.json'), 'utf8'))
    return Boolean(cfg.mcpServers?.['session-deck'])
  } catch {
    return false
  }
}

/**
 * Remove the variables a running Claude session exports to its children. If the
 * deck itself was started from inside a Claude session (a terminal, a script),
 * every session it launched inherited CLAUDECODE / CLAUDE_CODE_CHILD_SESSION and
 * ran as that session's *child* — and child sessions are never saved as
 * resumable transcripts, so nothing the deck launched could be reopened.
 * CLAUDE_CONFIG_DIR is user configuration, not session state, so it stays.
 */
export function scrubClaudeSession(env) {
  for (const key of Object.keys(env)) {
    if (key === 'CLAUDE_CONFIG_DIR') continue
    if (key === 'CLAUDECODE' || key === 'CLAUDE_PID' || key === 'CLAUDE_EFFORT' || key.startsWith('CLAUDE_CODE_')) {
      delete env[key]
    }
  }
  return env
}


/**
 * Variables naming the terminal app that started the deck. Sessions run in the
 * deck's own terminal, so inheriting them (TERM_PROGRAM=Apple_Terminal) told
 * programs they were in an app they were not in.
 */
function scrubTerminalApp(env) {
  for (const key of ['TERM_PROGRAM', 'TERM_PROGRAM_VERSION', 'TERM_SESSION_ID', 'ITERM_SESSION_ID', 'WT_SESSION', 'COLORTERM']) {
    delete env[key]
  }
  env.TERM_PROGRAM = 'session-deck'
  // The deck's terminal (xterm.js) draws 24-bit colour; say so, rather than
  // inherit whatever the starting terminal claimed.
  env.COLORTERM = 'truecolor'
  return env
}

/** The user's own shell. Inside the PTY, SHELL is borrowed for the Local trick. */
function userShell() {
  const sh = process.env.SHELL
  return sh && existsSync(sh) && !sh.includes('session-deck-launchers') ? sh : '/bin/zsh'
}

/**
 * Two ways in:
 *
 * - **A Local site.** Local's ssh-entry script sets up PHP/MySQL/WP-CLI, cd's
 *   into the site, and ends with `exec $SHELL`. Overriding SHELL makes that line
 *   hand control to the launcher instead of zsh — no parsing, and it survives
 *   Local rewriting the script.
 * - **Any other directory.** No site environment to borrow, so the launcher
 *   runs under the user's login shell.
 *
 * `cwd`, when given, is a directory the user chose. The launcher cd's into it
 * *after* Local's own cd, so a folder inside a site keeps the site shell.
 */
export function launchSession(project, { resumeId, cwd } = {}) {
  // --resume reuses the original session id (forking is opt-in via
  // --fork-session), so a resumed session's hooks keep matching its tile.
  const sessionId = resumeId ?? randomUUID()
  mkdirSync(LAUNCHER_DIR, { recursive: true })

  const launcherPath = join(LAUNCHER_DIR, `launch-${sessionId}.${IS_WIN ? 'cmd' : 'sh'}`)
  const claudeBin = resolveClaudeBin()
  const workdir = cwd && existsSync(cwd) ? cwd : null
  const viaLocal = Boolean(project.entryScript && existsSync(project.entryScript))

  // Per-session MCP config, passed with --mcp-config. Nothing global is touched,
  // and the server only exists for sessions the deck launched.
  const mcpConfigPath = join(LAUNCHER_DIR, `mcp-${sessionId}.json`)
  writeFileSync(
    mcpConfigPath,
    JSON.stringify(
      {
        mcpServers: {
          'session-deck': {
            command: resolveNodeBin(),
            args: [bundledBridge()],
            env: {
              SESSION_DECK_ID: sessionId,
              SESSION_DECK_PORT: String(PORT),
              SESSION_DECK_TOKEN: getToken()
            }
          }
        }
      },
      null,
      2
    ),
    'utf8'
  )

  const mcpFlag = globalBridgeInstalled() ? null : mcpConfigPath
  const script = IS_WIN
    ? windowsLauncherScript({
        entryScript: viaLocal ? project.entryScript : null,
        claudeBin,
        sessionId,
        resumeId,
        mcpConfigPath: mcpFlag,
        workdir
      })
    : launcherScript({ claudeBin, sessionId, resumeId, mcpConfigPath: mcpFlag, workdir, shell: userShell() })
  writeFileSync(launcherPath, script, 'utf8')
  chmodSync(launcherPath, 0o755)

  const env = {
    ...process.env,
    ...(IS_WIN ? {} : { SHELL: viaLocal ? launcherPath : userShell() }),
    TERM: 'xterm-256color',
    SESSION_DECK_ID: sessionId,
    SESSION_DECK_PORT: String(PORT),
    SESSION_DECK_TOKEN: getToken()
  }
  // Electron leaks these into children and they confuse the site shell.
  delete env.ELECTRON_RUN_AS_NODE
  delete env.NODE_ENV
  delete env.NODE_OPTIONS
  scrubClaudeSession(env)
  scrubTerminalApp(env)

  // The PTY's cwd only has to be *valid* — a missing one makes posix_spawnp
  // fail outright. Local's script and the launcher both cd where they need to.
  const valid = (d) => (d && existsSync(d) ? d : null)
  const ptyCwd = valid(workdir) ?? valid(project.path) ?? homedir()
  const [file, args] = IS_WIN
    ? // The launcher calls Local's .bat itself, so both cases are one cmd session.
      [process.env.ComSpec || 'cmd.exe', ['/d', '/c', launcherPath]]
    : viaLocal
      ? ['/bin/bash', [project.entryScript]]
      : [userShell(), ['-l', '-c', `exec ${shq(launcherPath)}`]]

  const pty = spawn(file, args, { name: 'xterm-256color', cols: COLS, rows: ROWS, cwd: ptyCwd, env })
  return { sessionId, pty, launcherPath }
}

/**
 * A plain terminal in the deck: the user's login shell, no Claude, started in
 * `cwd`. It gets no SESSION_DECK_* variables, so a `claude` run inside it is
 * just another session the hooks report on its own.
 */
export function launchShell(cwd) {
  const id = randomUUID()
  const env = { ...process.env, TERM: 'xterm-256color' }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.NODE_ENV
  delete env.NODE_OPTIONS
  scrubClaudeSession(env)
  scrubTerminalApp(env)
  const [file, args] = IS_WIN ? [process.env.ComSpec || 'cmd.exe', []] : [userShell(), ['-l']]
  const pty = spawn(file, args, { name: 'xterm-256color', cols: COLS, rows: ROWS, cwd, env })
  return { id, pty }
}
