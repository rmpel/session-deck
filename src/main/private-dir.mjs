import { mkdirSync, chmodSync, lstatSync, statSync } from 'fs'

/**
 * A directory only this user can enter — or an error. Used for everything that
 * holds the token: ~/.session-deck and the per-session launcher files.
 *
 * It fails closed. A directory that exists but belongs to someone else (made
 * ahead of us in a shared temp folder, or a symlink planted there) is never
 * used: its owner could read the token files in it or swap a launcher script.
 * The user's own symlink to their own directory is fine. Windows has no uid;
 * its profile and temp folders are per-user by ACL.
 *
 * An .mjs file so scripts/install-integration.mjs can share it with the app.
 */
export function ensurePrivateDir(dir) {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const uid = typeof process.getuid === 'function' ? process.getuid() : null
  const mine = (stat) => uid === null || stat.uid === uid
  const target = statSync(dir)
  if (!target.isDirectory() || !mine(target) || !mine(lstatSync(dir))) {
    throw new Error(`${dir} is not a directory owned by this user; refusing to use it.`)
  }
  // `mode` above only applies on creation; this tightens an existing one.
  chmodSync(dir, 0o700)
  return dir
}

/** A file an older version wrote with default permissions. Missing is fine. */
export function makePrivate(file) {
  try {
    chmodSync(file, 0o600)
  } catch {}
}
