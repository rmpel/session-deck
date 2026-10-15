/**
 * Links reach the deck from Claude (test pages, pull requests), from settings
 * (the ticket base) and from GitHub (the release page), and end up in
 * `shell.openExternal`. Only web links may: a `file:`, `smb:` or custom-scheme
 * URL would start a local handler the moment the link is clicked.
 */
export function isHttpUrl(url) {
  try {
    const { protocol } = new URL(String(url ?? ''))
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}
