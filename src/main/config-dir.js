import { homedir } from 'os'
import { join } from 'path'
import { ensurePrivateDir, makePrivate } from './private-dir.mjs'

export const CONFIG_DIR = join(homedir(), '.session-deck')

/**
 * ~/.session-deck holds the token, the hook log (prompts and Bash commands) and
 * the store, so it is private to the user: home folders on macOS are often
 * readable by the `staff` group.
 */
export function ensureConfigDir() {
  return ensurePrivateDir(CONFIG_DIR)
}

export { makePrivate }
