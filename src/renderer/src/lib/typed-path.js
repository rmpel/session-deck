/**
 * A dropped file's path as a terminal would type it: unquoted, with the ASCII
 * characters a shell would interpret backslash-escaped. Everything else is left
 * alone — accents, emoji, and the narrow no-break space macOS puts in
 * screenshot names are all plain characters to a shell, and escaping them
 * breaks the path. Claude Code reads this form (and turns an image path into an
 * attachment). Windows paths are quoted instead, since a backslash is their
 * separator.
 */
export function typedPath(path, platform) {
  if (platform === 'win32') return /\s/.test(path) ? `"${path}"` : path
  return path.replace(/[ \t!"#$&'()*;<=>?[\\\]^`{|}~]/g, '\\$&')
}
