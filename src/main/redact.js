/**
 * Masks the obvious secrets in what a hook reports — prompts, Bash commands,
 * URLs — before it is written to the hook log. Kept free of Electron so it can
 * be exercised directly.
 *
 * This is a safety net, not a guarantee: it knows the common shapes and nothing
 * else. The log stays private to the user for that reason.
 */
const MASK = '***'
// A name is secret when its *last* word is one of these: DB_PASSWORD, --api-key
// and "client_secret" are; max_tokens and --password-stdin are not.
const WORD = '(?:pass(?:word|wd)?|pwd|secret|token|api[-_]?key|access[-_]?key|secret[-_]?key|private[-_]?key)'
// Unquoted values stop at `&`: a shell operator, and the separator in a query string.
const VALUE = `("[^"]*"|'[^']*'|[^\\s"'&]+)`
// The rest of one command, up to a pipe or separator.
const SAME_COMMAND = '[^|;&\\n]*?'

const RULES = [
  // Authorization: Bearer abc / Authorization: Basic abc
  [/(authorization\s*[:=]\s*["']?(?:bearer|basic|token)\s+)[^\s"']+/gi, `$1${MASK}`],
  // X-Deck-Token: abc, X-Api-Key: abc
  [/(\bx-[a-z-]*(?:token|key|secret|auth)[a-z-]*\s*:\s*)[^\s"']+/gi, `$1${MASK}`],
  // --password=abc, --user_pass="a b"
  [new RegExp(`((?<![\\w-])--?(?:[a-z0-9]+[-_])*${WORD}=)${VALUE}`, 'gi'), `$1${MASK}`],
  // --password abc, --token "a b" — but not a following flag
  [new RegExp(`((?<![\\w-])--?(?:[a-z0-9]+[-_])*${WORD}\\s+)(?!-)${VALUE}`, 'gi'), `$1${MASK}`],
  // DB_PASSWORD=abc, GITHUB_TOKEN="abc", ?token=abc
  [new RegExp(`((?<![A-Za-z0-9_])(?:[A-Za-z0-9]+_)*${WORD}=)${VALUE}`, 'gi'), `$1${MASK}`],
  // "password": "abc", also inside an escaped or single-quoted JSON string
  [new RegExp(`(\\\\?["'](?:[A-Za-z0-9]+[-_])*${WORD}\\\\?["']\\s*:\\s*\\\\?["'])[^"'\\\\]*`, 'gi'), `$1${MASK}`],
  // https://user:secret@host
  [/(\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:)[^\s/@]+(@)/gi, `$1${MASK}$2`],
  // mysql -pS3cret (attached; `-p dbname` and -P 3306 are something else)
  [new RegExp(`(\\b(?:mysql|mysqldump|mysqladmin|mariadb|mariadb-dump)\\b${SAME_COMMAND}\\s-p)${VALUE}`, 'g'), `$1${MASK}`],
  // docker login -p abc
  [new RegExp(`(\\bdocker\\s+login\\b${SAME_COMMAND}\\s-p\\s+)${VALUE}`, 'g'), `$1${MASK}`],
  // curl -u user:pass, curl --user user:pass
  [new RegExp(`(\\bcurl\\b${SAME_COMMAND}\\s(?:-u|--user)(?:=|\\s+)["']?[^\\s:"']+:)(?!//)[^\\s"']+`, 'g'), `$1${MASK}`]
]

export function redact(text) {
  if (typeof text !== 'string') return text
  let out = text
  for (const [pattern, replacement] of RULES) out = out.replace(pattern, replacement)
  return out
}
