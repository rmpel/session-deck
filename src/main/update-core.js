/**
 * The decisions behind updating, kept free of Electron so they can be exercised
 * directly: is a release newer, which file is ours, and the script that swaps
 * the app bundle once we have quit.
 */
/**
 * Accepted risk: this GitHub repository is the whole trust anchor for updates.
 * The download link and its sha256 come from the same API response, so the
 * checksum catches a corrupted download, not a tampered release — and nothing
 * is signed: the Windows installer runs without an Authenticode check, and the
 * macOS install script clears the quarantine flag, so Gatekeeper never looks at
 * the new version. Whoever controls this account can ship code to every
 * install. Closing that needs a key of our own (minisign, or Developer ID and
 * Authenticode signing).
 */
export const REPO = 'FrankaBeekman/session-deck'

/** The asset's sha256 as GitHub publishes it, or null when it has none. */
export function assetDigest(asset) {
  const digest = String(asset?.digest ?? '')
  return /^sha256:[0-9a-f]{64}$/i.test(digest) ? digest.slice(7).toLowerCase() : null
}

/** "v0.10.0" > "0.9.3". Pre-release suffixes are ignored; /releases/latest skips those anyway. */
export function isNewer(latest, current) {
  const parts = (v) => String(v).replace(/^v/, '').split('-')[0].split('.').map((n) => Number(n) || 0)
  const a = parts(latest)
  const b = parts(current)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0)
  }
  return false
}

/**
 * The asset for this machine. GitHub turns the spaces in "Session Deck" into
 * dots, so match on the tail only: `-arm64.dmg` / `-x64.dmg`, or the .exe.
 */
export function pickAsset(assets, platform, arch) {
  const list = assets ?? []
  if (platform === 'darwin') return list.find((a) => a.name.endsWith(`-${arch}.dmg`)) ?? null
  if (platform === 'win32') return list.find((a) => /\.exe$/i.test(a.name)) ?? null
  return null
}

/** `/Applications/Session Deck.app` from `…/Session Deck.app/Contents/MacOS/Session Deck`. */
export function bundlePath(execPath) {
  const m = String(execPath).match(/^(.*?\.app)\/Contents\/MacOS\//)
  return m ? m[1] : null
}

/**
 * A quarantined app that was never moved runs from a random read-only copy
 * (App Translocation). Replacing that copy would change nothing.
 */
export function isTranslocated(bundle) {
  return String(bundle).includes('/AppTranslocation/')
}

/**
 * Runs detached after the app quits: wait for our pid to go, mount the dmg,
 * swap the bundle (keeping the old one until the new one is in place), clear
 * any quarantine flag and start the new version. Every step logs, and a failed
 * copy puts the old app back.
 */
export function macInstallScript() {
  return `#!/bin/bash
PID="$1"; DMG="$2"; TARGET="$3"; RELAUNCH="$4"
echo "[update] $(date) waiting for $PID"
for _ in $(seq 1 120); do kill -0 "$PID" 2>/dev/null || break; sleep 0.5; done
if kill -0 "$PID" 2>/dev/null; then echo "[update] app did not quit; giving up"; exit 1; fi

MNT="$(mktemp -d /tmp/session-deck-update.XXXXXX)"
hdiutil attach -nobrowse -readonly -noautoopen -mountpoint "$MNT" "$DMG" || { echo "[update] mount failed"; exit 1; }
APP="$(find "$MNT" -maxdepth 1 -name '*.app' | head -1)"
if [ -z "$APP" ]; then echo "[update] no app in dmg"; hdiutil detach "$MNT" -quiet; exit 1; fi

rm -rf "$TARGET.old"
mv "$TARGET" "$TARGET.old" || { echo "[update] cannot move the old app"; hdiutil detach "$MNT" -quiet; exit 1; }
if ditto "$APP" "$TARGET"; then
  rm -rf "$TARGET.old"
  echo "[update] installed"
else
  echo "[update] copy failed; restoring"
  rm -rf "$TARGET"; mv "$TARGET.old" "$TARGET"
fi
hdiutil detach "$MNT" -quiet
rmdir "$MNT" 2>/dev/null
xattr -dr com.apple.quarantine "$TARGET" 2>/dev/null
rm -f "$DMG"
[ "$RELAUNCH" = "1" ] && open "$TARGET"
exit 0
`
}
