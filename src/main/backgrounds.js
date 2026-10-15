import { app, dialog, nativeImage, protocol, net } from 'electron'
import { existsSync, readdirSync, statSync } from 'fs'
import { join, extname, basename, resolve } from 'path'
import { pathToFileURL } from 'url'
import { isInside } from './platform.js'

const EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.bmp'])

/**
 * The default backgrounds ship with the app, so everyone gets the same set and
 * they can live in the repository. Anything else comes from the file picker.
 */
export function bundledDir() {
  return app.isPackaged
    ? join(process.resourcesPath, 'backgrounds')
    : join(__dirname, '..', '..', 'resources', 'backgrounds')
}

/** "03-neon-circuit.jpg" -> "Neon circuit" */
function labelFor(file) {
  const name = basename(file, extname(file)).replace(/^\d+[-_]/, '').replace(/[-_]+/g, ' ')
  return name.charAt(0).toUpperCase() + name.slice(1)
}

/**
 * Images are handed to the renderer as `deckbg://` URLs rather than file://:
 * the renderer runs from http:// in dev and file:// when packaged, and its CSP
 * allows neither. One scheme works in both.
 */
export const SCHEME = 'deckbg'
export const urlFor = (path) => `${SCHEME}://img/${encodeURIComponent(path)}`

export function registerScheme() {
  protocol.registerSchemesAsPrivileged([
    { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
  ])
}

/**
 * This scheme can reach the disk, so it serves only images the deck knows: the
 * ones that ship with the app, and the ones the user chose in the file picker
 * (`pickedPaths` returns those). Any other path is a 404, image or not.
 */
export function serveBackgrounds(pickedPaths) {
  protocol.handle(SCHEME, (request) => {
    const path = resolve(decodeURIComponent(new URL(request.url).pathname.replace(/^\//, '')))
    const known = isInside(bundledDir(), path) || pickedPaths().includes(path)
    if (!known || !EXTS.has(extname(path).toLowerCase()) || !existsSync(path) || !statSync(path).isFile()) {
      return new Response('Not found', { status: 404 })
    }
    return net.fetch(pathToFileURL(path).toString())
  })
}

function thumb(path) {
  try {
    const image = nativeImage.createFromPath(path)
    if (image.isEmpty()) return null
    return image.resize({ width: 220, quality: 'good' }).toDataURL()
  } catch {
    return null
  }
}

export function listBackgrounds() {
  const dir = bundledDir()
  if (!existsSync(dir)) return { dir: null, images: [] }
  let files = []
  try {
    files = readdirSync(dir)
      .filter((f) => EXTS.has(extname(f).toLowerCase()))
      .sort((a, b) => a.localeCompare(b))
      .map((f) => join(dir, f))
  } catch {
    return { dir, images: [] }
  }
  return {
    dir,
    images: files.map((path) => ({ path, label: labelFor(path), file: basename(path), thumb: thumb(path) }))
  }
}

export async function chooseBackground(win) {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Choose a background image',
    buttonLabel: 'Use as background',
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'bmp'] }]
  })
  const path = canceled ? null : (filePaths[0] ? resolve(filePaths[0]) : null)
  if (!path) return null
  return { path, label: basename(path), file: basename(path), thumb: thumb(path) }
}

