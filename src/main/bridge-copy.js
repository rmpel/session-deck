import { app } from 'electron'
import { copyFileSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { CONFIG_DIR, ensureConfigDir } from './config-dir.js'

/**
 * Global installs need paths that survive the app moving or updating, so the
 * MCP bridge and the Node hook client are registered from ~/.session-deck. The
 * app refreshes those copies on start whenever its bundled versions differ.
 */
const SUPPORT_DIR = CONFIG_DIR
export const BRIDGE_COPY = join(SUPPORT_DIR, 'mcp-bridge.mjs')
export const HOOK_CLIENT_COPY = join(SUPPORT_DIR, 'hook-client.mjs')

function bundled(file) {
  return app.isPackaged ? join(process.resourcesPath, file) : join(__dirname, '../../src/main', file)
}

export function bundledBridge() {
  return bundled('mcp-bridge.mjs')
}

export function installBridgeCopy() {
  ensureConfigDir()
  for (const [file, dest] of [
    ['mcp-bridge.mjs', BRIDGE_COPY],
    ['hook-client.mjs', HOOK_CLIENT_COPY]
  ]) {
    try {
      const src = bundled(file)
      if (!existsSync(src)) continue
      const same = existsSync(dest) && readFileSync(dest, 'utf8') === readFileSync(src, 'utf8')
      if (!same) copyFileSync(src, dest)
    } catch (err) {
      console.error(`[support] copying ${file} failed:`, err.message)
    }
  }
}
