import { app } from 'electron'
import { EventEmitter } from 'events'
import { spawn } from 'child_process'
import { createHash } from 'crypto'
import { createWriteStream, mkdirSync, writeFileSync, chmodSync, accessSync, openSync, constants, rmSync } from 'fs'
import { dirname, join } from 'path'
import { REPO, isNewer, pickAsset, assetDigest, bundlePath, isTranslocated, macInstallScript } from './update-core.js'
import { IS_MAC, IS_WIN } from './platform.js'

const CHECK_EVERY = 6 * 60 * 60 * 1000
// A function, not a constant: this module is imported before `ready`.
const updateDir = () => join(app.getPath('temp'), 'session-deck-update')

/**
 * Updates from GitHub releases, without Squirrel — which on macOS only accepts
 * apps signed with a Developer ID. The app downloads the release itself: a file
 * Node writes gets no quarantine flag, so the new version opens without the
 * Gatekeeper prompt a browser download would bring. A script that outlives the
 * app then swaps the bundle and relaunches it. On Windows the NSIS installer
 * does that part, silently.
 *
 * One state object, broadcast whole on every change.
 */
class Updater extends EventEmitter {
  constructor() {
    super()
    this.state = { status: 'idle', current: app.getVersion() }
    this.release = null
    this.file = null
    this.timer = null
  }

  set(patch) {
    this.state = { ...this.state, ...patch }
    this.emit('change', this.state)
  }

  /** Why this copy cannot replace itself, or null when it can. */
  installBlocker() {
    if (!app.isPackaged) return 'Updating works in the installed app, not in development.'
    if (IS_MAC) {
      const bundle = bundlePath(process.execPath)
      if (!bundle) return 'Could not tell where the app is installed.'
      if (isTranslocated(bundle)) return 'Move Session Deck to Applications first, then update.'
      try {
        accessSync(dirname(bundle), constants.W_OK)
      } catch {
        return `No permission to replace the app in ${dirname(bundle)}.`
      }
      return null
    }
    return IS_WIN ? null : 'Updates are only available on macOS and Windows.'
  }

  start() {
    // Late enough that the window is up and startup is not slowed down.
    setTimeout(() => this.check({ quiet: true }), 15_000)
    this.timer = setInterval(() => this.check({ quiet: true }), CHECK_EVERY)
  }

  /** `quiet` checks do not surface network errors: nobody asked for them. */
  async check({ quiet = false } = {}) {
    if (['checking', 'downloading', 'ready'].includes(this.state.status)) return this.state
    this.set({ status: 'checking', error: null })
    try {
      const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'session-deck' }
      })
      if (!res.ok) throw new Error(`GitHub answered ${res.status}`)
      const release = await res.json()
      const latest = String(release.tag_name ?? '').replace(/^v/, '')
      if (!latest || !isNewer(latest, this.state.current)) {
        this.release = null
        this.set({ status: 'none', latest: latest || null, checkedAt: Date.now() })
        return this.state
      }
      const asset = pickAsset(release.assets, process.platform, process.arch)
      this.release = { ...release, asset }
      this.set({
        status: 'available',
        latest,
        notes: release.body ?? '',
        pageUrl: release.html_url,
        size: asset?.size ?? null,
        // No asset for this machine still gets the release page link.
        blocker: !asset
          ? 'This release has no download for this machine.'
          : !assetDigest(asset)
            ? 'This release has no checksum, so the download cannot be verified.'
            : this.installBlocker(),
        checkedAt: Date.now()
      })
    } catch (err) {
      this.set(quiet ? { status: 'idle' } : { status: 'error', error: err.message })
    }
    return this.state
  }

  async download() {
    const asset = this.release?.asset
    if (!asset || this.state.status !== 'available' || this.state.blocker) return this.state
    this.set({ status: 'downloading', progress: 0, error: null })
    try {
      // Never install what could not be checked. check() already blocks this;
      // it is repeated here because this is the step that matters.
      const expected = assetDigest(asset)
      if (!expected) throw new Error('This release has no checksum, so the download cannot be verified.')
      mkdirSync(updateDir(), { recursive: true })
      const file = join(updateDir(), asset.name)
      const res = await fetch(asset.browser_download_url, { headers: { 'User-Agent': 'session-deck' } })
      if (!res.ok || !res.body) throw new Error(`Download failed: ${res.status}`)

      const hash = createHash('sha256')
      const out = createWriteStream(file)
      let received = 0
      let lastSent = 0
      for await (const chunk of res.body) {
        hash.update(chunk)
        received += chunk.length
        if (!out.write(chunk)) await new Promise((r) => out.once('drain', r))
        const progress = asset.size ? received / asset.size : 0
        if (progress - lastSent >= 0.01) {
          lastSent = progress
          this.set({ progress })
        }
      }
      await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())))

      if (asset.size && received !== asset.size) throw new Error('The download is incomplete.')
      if (hash.digest('hex') !== expected) {
        rmSync(file, { force: true })
        throw new Error('The download does not match the release checksum.')
      }
      this.file = file
      this.set({ status: 'ready', progress: 1 })
    } catch (err) {
      this.set({ status: 'available', error: err.message })
    }
    return this.state
  }

  /** Hand over to the installer and quit. Sessions come back as resumable. */
  install() {
    if (this.state.status !== 'ready' || !this.file) return false
    if (IS_MAC) {
      const script = join(updateDir(), 'install.sh')
      writeFileSync(script, macInstallScript(), 'utf8')
      chmodSync(script, 0o755)
      const log = openSync(join(updateDir(), 'install.log'), 'a')
      spawn('/bin/bash', [script, String(process.pid), this.file, bundlePath(process.execPath), '1'], {
        detached: true,
        stdio: ['ignore', log, log]
      }).unref()
    } else if (IS_WIN) {
      // /S installs silently over the existing install; --force-run starts it after.
      spawn(this.file, ['--updated', '/S', '--force-run'], { detached: true, stdio: 'ignore' }).unref()
    } else {
      return false
    }
    app.quit()
    return true
  }
}

export const updater = new Updater()
