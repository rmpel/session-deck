import { homedir } from 'os'
import { join, basename } from 'path'
import { isInside, localDataDir, entryScriptName, tildify as tildifyPath, IS_MAC } from './platform.js'
import { siteShellScript } from './launch-script.js'
import { readFileSync, writeFileSync, mkdirSync, readdirSync, chmodSync, existsSync } from 'fs'
import { CONFIG_DIR, ensureConfigDir } from './config-dir.js'

/** Local stores some site paths with a literal, unexpanded `~`. */
function expandTilde(p) {
  if (!p) return ''
  return p.startsWith('~') ? join(homedir(), p.slice(1)) : p
}

const LOCAL_DIR = localDataDir()
const SITES_JSON = join(LOCAL_DIR, 'sites.json')
const SSH_ENTRY = join(LOCAL_DIR, 'ssh-entry')
const SERVICES_DIR = join(LOCAL_DIR, 'lightning-services')
const LOCAL_TOOLS = '/Applications/Local.app/Contents/Resources/extraResources/bin'
// Our own stand-ins live outside Local's folder: Local's data is read-only to us.
const SITE_SHELLS = join(CONFIG_DIR, 'site-shells')

/** A service's install dir: `php-8.3.23+0` for 8.3.23, or an exact `mysql-8.4.0`. */
function serviceDir(service) {
  if (!service?.name || !service.version) return null
  const exact = `${service.name}-${service.version}`
  const dirs = existsSync(SERVICES_DIR) ? readdirSync(SERVICES_DIR) : []
  const dir = dirs.find((d) => d === exact) ?? dirs.filter((d) => d.startsWith(`${exact}+`)).sort().pop()
  return dir ? join(SERVICES_DIR, dir) : null
}

/**
 * The bin/<platform> dir of an installed service, e.g. bin/darwin-arm64. Falls
 * back to any build for this OS: Local installs one architecture per service,
 * which needn't match ours (an x64 process under Rosetta on Apple Silicon).
 */
function platformDir(dir) {
  const bin = join(dir, 'bin')
  const exact = `${process.platform}-${process.arch}`
  const builds = existsSync(bin) ? readdirSync(bin) : []
  const build = builds.includes(exact) ? exact : builds.find((b) => b.startsWith(process.platform))
  return build ? join(bin, build) : null
}

/**
 * Where Local's own script would cd: the WordPress root. Not in sites.json, so
 * take the first that exists — a freshly cloned composer site has no
 * app/public until composer has run.
 */
function webRoot(sitePath) {
  const candidates = [join(sitePath, 'app', 'public'), join(sitePath, 'app', 'public_html'), join(sitePath, 'app')]
  return candidates.find((dir) => existsSync(dir)) ?? sitePath
}

/**
 * Local only writes a site's ssh-entry script the first time "Open site shell"
 * is used, so a new site has none. Build the same environment from sites.json
 * instead — macOS only, where Local's install location is fixed. Null when the
 * site's services can't be found; the session then starts in a plain shell.
 */
function generatedEntryScript(id, site) {
  if (!IS_MAC || !existsSync(LOCAL_TOOLS)) return null
  const services = Object.values(site.services ?? {})
  const dirs = ['db', 'php'].map((role) => serviceDir(services.find((s) => s.role === role)))
  if (dirs.some((d) => !d)) return null
  const [dbDir, phpDir] = dirs.map(platformDir)
  if (!dbDir || !phpDir) return null

  const script = siteShellScript({
    name: site.name ?? id,
    runDir: join(LOCAL_DIR, 'run', id),
    binDirs: [join(dbDir, 'bin'), join(phpDir, 'bin')],
    toolsDir: LOCAL_TOOLS,
    publicDir: webRoot(expandTilde(site.path)),
    imageMagickDir: join(phpDir, 'ImageMagick', 'modules-Q16', 'coders')
  })
  ensureConfigDir()
  mkdirSync(SITE_SHELLS, { recursive: true })
  const path = join(SITE_SHELLS, entryScriptName(id))
  writeFileSync(path, script, 'utf8')
  chmodSync(path, 0o755)
  return path
}

/** Local's own script when it has written one, otherwise our stand-in. */
function entryScriptFor(id, site) {
  const local = join(SSH_ENTRY, entryScriptName(id))
  return existsSync(local) ? local : generatedEntryScript(id, site)
}

/**
 * Local owns this data; we only ever read it.
 * The `cd` inside each ssh-entry script is authoritative for the project path —
 * site paths are inconsistent across machines, so never derive one from the name.
 * Every site is listed, including new ones Local hasn't written a script for yet.
 */
export function listProjects() {
  if (!existsSync(SITES_JSON)) return []

  const sites = JSON.parse(readFileSync(SITES_JSON, 'utf8'))

  return Object.entries(sites)
    .map(([id, site]) => ({
      id,
      name: site.name ?? id,
      path: expandTilde(site.path),
      domain: site.domain ?? '',
      // services.php.version is set on every site; the top-level phpVersion is a
      // legacy field present on only a couple of them.
      phpVersion: site.services?.php?.version ?? site.phpVersion ?? '',
      entryScript: entryScriptFor(id, site)
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function getProject(id) {
  return listProjects().find((p) => p.id === id) ?? null
}

export function tildify(p) {
  return tildifyPath(p)
}

/**
 * The project for a session started in a chosen directory. Inside a Local site
 * it is that site — so the session still gets the site shell with WP-CLI and the
 * right PHP — just started in the chosen folder. The most specific site wins.
 * Anywhere else it is a plain directory project, keyed by its path.
 */
export function projectForDirectory(dir) {
  const site = listProjects()
    .filter((p) => isInside(p.path, dir))
    .sort((a, b) => b.path.length - a.path.length)[0]
  if (site) return { ...site, cwd: dir }
  return { id: null, name: basename(dir) || dir, domain: tildify(dir), path: dir, entryScript: null, cwd: dir }
}
