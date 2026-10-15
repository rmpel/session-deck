import { execFile } from 'child_process'
import { existsSync, statSync } from 'fs'
import { basename, dirname, join, resolve } from 'path'
import { isInside } from './platform.js'

const MAX_DIFF_BYTES = 400_000

function git(cwd, args, { maxBuffer = MAX_DIFF_BYTES } = {}) {
  return new Promise((r) => {
    execFile('git', args, { cwd, maxBuffer, timeout: 10_000 }, (err, stdout, stderr) => {
      if (err && !stdout) return r({ ok: false, out: '', err: stderr || err.message })
      r({ ok: true, out: stdout, err: '' })
    })
  })
}

/**
 * A LocalWP site is not one repository. On a typical agency WordPress project
 * the site-level repo gitignores `public/` entirely, and the real work lives in
 * many independent repos under wp-content (the theme, each custom plugin, and
 * often vendored third-party ones). Resolving a single "the" repo finds one that
 * can never show a change.
 *
 * So repos are discovered two ways: from the files a session actually edited
 * (precise, and free -- PreToolUse gives us the paths), and by a shallow scan of
 * the usual WordPress locations as a fallback.
 */

/** Nearest enclosing repo for a path, walking up to the first existing dir. */
async function repoFor(path) {
  let dir = path
  // Walk up to the first existing directory. `dirname` of a root returns the
  // root itself ("/" or "C:\\"), which is the stop condition on every platform.
  while (dir && !existsSync(dir)) {
    const up = dirname(dir)
    if (up === dir) return null
    dir = up
  }
  if (!dir) return null
  try {
    if (!statSync(dir).isDirectory()) dir = dirname(dir)
  } catch {
    return null
  }
  const r = await git(dir, ['rev-parse', '--show-toplevel'])
  const top = r.out.trim()
  return r.ok && top ? top : null
}

/** wp-content is where the interesting repos live; look only one level deep. */
function candidateDirs(cwd) {
  const out = []
  if (!cwd) return out
  // The session usually runs in app/public; wp-content may be here or one up.
  for (const base of [cwd, resolve(cwd, '..'), resolve(cwd, '../..')]) {
    const wpc = join(base, 'wp-content')
    if (!existsSync(wpc)) continue
    for (const group of ['themes', 'plugins', 'mu-plugins']) {
      const dir = join(wpc, group)
      if (!existsSync(dir)) continue
      out.push({ dir, scan: true })
    }
    break
  }
  return out
}

async function scanForRepos(cwd) {
  const { readdirSync } = await import('fs')
  const found = new Set()
  for (const { dir } of candidateDirs(cwd)) {
    let entries = []
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue
      const child = join(dir, e.name)
      if (existsSync(join(child, '.git'))) found.add(child)
    }
  }
  return [...found]
}

const STATUS_LABEL = {
  M: 'modified', A: 'added', D: 'deleted', R: 'renamed',
  C: 'copied', U: 'conflicted', T: 'type changed', '?': 'untracked'
}

const CONFLICT_PAIRS = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'])

/**
 * Porcelain gives two status letters per path: X for the index, Y for the
 * working tree. A file can be staged *and* have further unstaged edits ("MM"),
 * so it can legitimately appear in both groups -- each with its own diff.
 */
export async function statusFor(root) {
  const [statusRes, branchRes] = await Promise.all([
    git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']),
    git(root, ['rev-parse', '--abbrev-ref', 'HEAD'])
  ])

  const files = []
  const parts = statusRes.out.split('\0')
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i]
    if (!entry || entry.length < 4) continue
    const x = entry[0]
    const y = entry[1]
    const path = entry.slice(3)
    let from = null
    if (x === 'R' || x === 'C') from = parts[++i] ?? null
    const push = (group, code) =>
      files.push({ path, from, group, code, label: STATUS_LABEL[code] ?? 'changed' })

    if (x === '?' && y === '?') push('untracked', '?')
    else if (CONFLICT_PAIRS.has(x + y)) push('conflicted', 'U')
    else {
      if (x !== ' ') push('staged', x)
      if (y !== ' ') push('unstaged', y)
    }
  }
  files.sort((a, b) => a.path.localeCompare(b.path))
  return { root, name: basename(root), branch: branchRes.out.trim() || null, files }
}

/** The repo a session is most plausibly working in — for the branch chip. */
export async function primaryRepo(cwd, touchedPaths = []) {
  const candidates = [...touchedPaths].reverse()
  if (cwd) candidates.push(cwd)
  for (const p of candidates) {
    const root = await repoFor(p)
    if (!root) continue
    const b = await git(root, ['rev-parse', '--abbrev-ref', 'HEAD'])
    return { root, name: basename(root), branch: b.out.trim() || null }
  }
  return null
}

/**
 * Repos worth showing for a session: every repo it edited into, plus any other
 * WordPress repo with uncommitted work. Repos with nothing changed and nothing
 * touched are dropped, so the panel does not list ten clean vendored plugins.
 */
export async function reposForSession(cwd, touchedPaths = []) {
  const roots = new Set()

  for (const p of touchedPaths) {
    const root = await repoFor(p)
    if (root) roots.add(root)
  }
  const touched = new Set(roots)

  for (const root of await scanForRepos(cwd)) roots.add(root)
  if (cwd) {
    const own = await repoFor(cwd)
    if (own) roots.add(own)
  }

  const statuses = await Promise.all([...roots].map((r) => statusFor(r)))
  return statuses
    .filter((s) => s.files.length > 0 || touched.has(s.root))
    .map((s) => ({ ...s, touched: touched.has(s.root) }))
    .sort((a, b) => Number(b.touched) - Number(a.touched) || a.name.localeCompare(b.name))
}

export async function fileDiff(root, path, { group = 'unstaged' } = {}) {
  if (!root) return { text: '', truncated: false, error: 'No repository' }
  // `path` comes from the renderer. An untracked file is read with --no-index,
  // which would show any readable file on disk, so it has to stay in the repo.
  if (!path || !isInside(root, resolve(root, String(path)))) {
    return { text: '', truncated: false, error: 'Not a file in this repository' }
  }
  const args =
    group === 'untracked'
      ? ['diff', '--no-index', '--no-color', '--', '/dev/null', path]
      : group === 'staged'
        ? ['diff', '--cached', '--no-color', '--', path]
        : ['diff', '--no-color', '--', path]
  const r = await git(root, args)
  if (!r.ok && !r.out) return { text: '', truncated: false, error: r.err }
  return {
    text: r.out,
    truncated: Buffer.byteLength(r.out) >= MAX_DIFF_BYTES - 1024,
    error: null
  }
}
