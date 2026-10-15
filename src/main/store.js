import { readFileSync, writeFileSync, renameSync, existsSync } from 'fs'
import { join } from 'path'
import { CONFIG_DIR, ensureConfigDir, makePrivate } from './config-dir.js'

/**
 * Durable state for the deck. Deliberately a JSON file, not SQLite: the payload
 * is a few hundred links, and a native module would buy nothing while adding the
 * rebuild/arch failure modes that already cost us a day on node-pty.
 *
 * Writes go through a temp file + rename so a crash mid-write cannot leave a
 * truncated store behind. The store — session names, prompts in the hours
 * list, summaries — is readable by the user only: the temp file is made 0600
 * before it is renamed into place. `mode` alone would not do it, since it is
 * ignored when a temp file is left over from an older version.
 */
const DIR = CONFIG_DIR
const FILE = join(DIR, 'store.json')
const TMP = join(DIR, 'store.json.tmp')

const EMPTY = { version: 1, testPages: {}, sessions: {}, names: {}, recentDirs: [], ticketBase: null }

export function load() {
  try {
    if (!existsSync(FILE)) return structuredClone(EMPTY)
    makePrivate(FILE)
    const parsed = JSON.parse(readFileSync(FILE, 'utf8'))
    return {
      ...structuredClone(EMPTY),
      ...parsed,
      testPages: parsed.testPages ?? {},
      sessions: parsed.sessions ?? {},
      names: parsed.names ?? {},
      recentDirs: parsed.recentDirs ?? []
    }
  } catch (err) {
    console.error('[store] unreadable, starting empty:', err.message)
    return structuredClone(EMPTY)
  }
}

let pending = null

export function save(state) {
  // Coalesce bursts -- a single tool call can touch the store several times.
  if (pending) clearTimeout(pending)
  pending = setTimeout(() => {
    pending = null
    try {
      ensureConfigDir()
      writeFileSync(TMP, JSON.stringify(state, null, 2), { encoding: 'utf8', mode: 0o600 })
      makePrivate(TMP)
      renameSync(TMP, FILE)
    } catch (err) {
      console.error('[store] write failed:', err.message)
    }
  }, 200)
}

/** Flush synchronously — used on quit, where a timer would never fire. */
export function flush(state) {
  if (pending) {
    clearTimeout(pending)
    pending = null
  }
  try {
    ensureConfigDir()
    writeFileSync(TMP, JSON.stringify(state, null, 2), { encoding: 'utf8', mode: 0o600 })
    makePrivate(TMP)
    renameSync(TMP, FILE)
  } catch (err) {
    console.error('[store] flush failed:', err.message)
  }
}

export const STORE_PATH = FILE
