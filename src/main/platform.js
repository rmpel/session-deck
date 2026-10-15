import path from 'path'
import { homedir } from 'os'

export const IS_WIN = process.platform === 'win32'
export const IS_MAC = process.platform === 'darwin'

/**
 * Whether `dir` is `base` or inside it. Uses path.relative rather than a string
 * prefix: a prefix check says "C:\Sites\site-a2" is inside "C:\Sites\site-a",
 * and cannot cope with Windows' case-insensitive, backslash-separated paths.
 * `impl` is injectable so the Windows behaviour can be tested anywhere.
 */
export function isInside(base, dir, impl = path) {
  if (!base || !dir) return false
  const rel = impl.relative(base, dir)
  // "Outside" is the segment `..`, not a name that starts with two dots:
  // `..env.swp` and `...notes/` are ordinary files inside.
  const outside = rel === '..' || rel.startsWith(`..${impl.sep}`) || impl.isAbsolute(rel)
  return rel === '' || !outside
}

export function tildify(p, home = homedir(), impl = path) {
  if (!p) return p
  if (impl.relative(home, p) === '') return '~'
  return isInside(home, p, impl) ? `~${impl.sep}${impl.relative(home, p)}` : p
}

/** Where Local keeps sites.json and its ssh-entry scripts. */
export function localDataDir(platform = process.platform, env = process.env, home = homedir()) {
  if (platform === 'win32') {
    return path.win32.join(env.APPDATA || path.win32.join(home, 'AppData', 'Roaming'), 'Local')
  }
  if (platform === 'darwin') return path.posix.join(home, 'Library', 'Application Support', 'Local')
  return path.posix.join(env.XDG_CONFIG_HOME || path.posix.join(home, '.config'), 'Local')
}

/** Local writes a site shell script per platform: .bat on Windows, .sh elsewhere. */
export function entryScriptName(siteId, platform = process.platform) {
  return `${siteId}.${platform === 'win32' ? 'bat' : 'sh'}`
}

/** Last path segment for either separator — process lines mix both on Windows. */
export function baseName(p) {
  return String(p ?? '').split(/[\\/]/).filter(Boolean).pop() ?? ''
}
