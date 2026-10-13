/**
 * Render the built renderer with fixture data and save a PNG.
 *   npx electron scripts/preview/render.cjs <scenario> <out.png> [width] [height]
 * Scenarios click through the real UI, so what gets captured is what a user
 * would see — not a separately maintained mock.
 */
const { app, BrowserWindow, protocol, net } = require('electron')
const { pathToFileURL } = require('url')
const { existsSync } = require('fs')

// Same image scheme the app registers, so backgrounds render here too.
protocol.registerSchemesAsPrivileged([
  { scheme: 'deckbg', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
])
const { writeFileSync } = require('fs')
const { join } = require('path')

const [scenario = 'deck', out = 'preview.png', w = '1180', h = '820'] = process.argv.slice(2)

const SCENARIOS = {
  deck: [],
  prs: ["[...document.querySelectorAll('.links a')].find(a => a.title === 'Pull requests reported for this project').click()"],
  pages: ["[...document.querySelectorAll('.links a')].find(a => a.title === 'Test pages recorded for this project').click()"],
  diff: ["[...document.querySelectorAll('.links a')].find(a => /Diff/.test(a.textContent)).click()"],
  summary: ["document.querySelector('.card').click()", "[...document.querySelectorAll('.links a')].find(a => a.textContent.trim() === 'Summary').click()"],
  focused: ["document.querySelector('.card').click()"],
  new: ["document.querySelector('.titlebar .newbtn').click()"],
  newdir: ["document.querySelector('.titlebar .newbtn').click()", "document.querySelector('#tab-directory').click()"],
  appearance: ["[...document.querySelectorAll('.titlebar button')].find(b => /Settings/.test(b.textContent)).click()"],
  // Themes are applied from JS now, so a scenario sets the saved settings and reloads.
  ...Object.fromEntries(
    ['candy', 'gothic', 'cyberpunk', 'nature', 'electric', 'spaceship', 'default', 'lcars'].flatMap((theme) =>
      ['light', 'dark'].map((mode) => [
        `${theme}-${mode}`,
        [
          `localStorage.setItem('deck.appearance', JSON.stringify({ theme: '${theme}', mode: '${mode}', density: 'small', tileFont: 'medium', termFont: 'medium' })); location.reload()`
        ]
      ])
    )
  ),
  ...(() => {
    const { readdirSync } = require('fs')
    const { join } = require('path')
    const dir = join(__dirname, '..', '..', 'resources', 'backgrounds')
    const files = existsSync(dir) ? readdirSync(dir).filter((f) => /\.(png|jpe?g|webp)$/i.test(f)).sort() : []
    const first = files[3] ?? files[0] ?? null
    const set = (extra) =>
      `localStorage.setItem('deck.appearance', JSON.stringify(Object.assign({ theme: 'electric', mode: 'dark', density: 'small', tileFont: 'medium', termFont: 'medium', background: { path: ${JSON.stringify(first ? join(dir, first) : null)}, dim: 'medium' } }, ${extra}))); location.reload()`
    return {
      bg: [set('{}')],
      'bg-glass': [set("{ tileOpacity: 0.6, theme: 'spaceship' }")],
      'bg-nebula': [set("{ theme: 'spaceship', mode: 'dark', tileOpacity: 0.7, background: { path: " + JSON.stringify(files.includes('08-nebula.jpg') ? join(dir, '08-nebula.jpg') : null) + ", dim: 'subtle' } }")],
      'bg-blossom': [set("{ theme: 'candy', mode: 'light', tileOpacity: 0.72, background: { path: " + JSON.stringify(files.includes('07-blossom.jpg') ? join(dir, '07-blossom.jpg') : null) + ", dim: 'subtle' } }")],
      'bg-subtle': [set("{ background: { path: " + JSON.stringify(first ? join(dir, first) : null) + ", dim: 'subtle' } }")],
      'bg-panel': [set('{}'), "[...document.querySelectorAll('.titlebar button')].find(b => /Settings/.test(b.textContent)).click()"]
    }
  })(),
  // Skins, each with its natural theme and a mismatched one: they must hold up in any.
  ...Object.fromEntries(
    [['cyberdeck', 'cyberpunk', 'dark'], ['cyberdeck', 'default', 'light'], ['hud', 'spaceship', 'dark'], ['hud', 'candy', 'light'], ['lcars', 'lcars', 'dark'], ['lcars', 'lcars', 'light'], ['lcars', 'nature', 'dark']].flatMap(([skin, theme, mode]) => {
      const set = `localStorage.setItem('deck.appearance', JSON.stringify({ skin: '${skin}', theme: '${theme}', mode: '${mode}', density: 'small', tileFont: 'medium', termFont: 'medium' })); location.reload()`
      return [
        [`skin-${skin}-${theme}-${mode}`, [set]],
        [`skin-${skin}-${theme}-${mode}-focused`, [set, "document.querySelector('.card').click()"]],
        [`skin-${skin}-${theme}-${mode}-dialog`, [set, "[...document.querySelectorAll('.titlebar button')].find(b => /Settings/.test(b.textContent)).click()"]]
      ]
    })
  ),
  // The LCARS skin is one console rather than tiles: select from its readout.
  ...(() => {
    const set = (mode) => `localStorage.setItem('deck.appearance', JSON.stringify({ skin: 'lcars', theme: 'lcars', mode: '${mode}', density: 'small', tileFont: 'medium', termFont: 'medium' })); location.reload()`
    return {
      'lcars-console': [set('dark')],
      'lcars-console-selected': [set('dark'), "document.querySelector('.lc-sess').click()"],
      'lcars-console-light': [set('light'), "document.querySelector('.lc-sess').click()"],
      'lcars-console-dialog': [set('dark'), "[...document.querySelectorAll('.lc-btn')].find(b => /Settings/.test(b.textContent)).click()"]
    }
  })(),
  shot_deck: ["localStorage.setItem('deck.appearance', JSON.stringify({ theme: 'default', mode: 'dark', density: 'small', tileFont: 'medium', termFont: 'medium', background: { path: null, dim: 'medium' }, tileOpacity: 1 })); location.reload()"],
  shot_focused: ["localStorage.removeItem('deck.focusedSize'); localStorage.setItem('deck.appearance', JSON.stringify({ theme: 'default', mode: 'dark', density: 'small', tileFont: 'medium', termFont: 'medium', background: { path: null, dim: 'medium' }, tileOpacity: 1 })); location.reload()", "document.querySelector('.card').click()"],
  shot_summary: ["localStorage.removeItem('deck.focusedSize'); localStorage.setItem('deck.appearance', JSON.stringify({ theme: 'default', mode: 'dark', density: 'small', tileFont: 'medium', termFont: 'medium', background: { path: null, dim: 'medium' }, tileOpacity: 1 })); location.reload()", "document.querySelector('.card').click()", "[...document.querySelectorAll('.links a')].find(a => a.textContent.trim() === 'Summary').click()"],
  shot_skin_cyberdeck: ["localStorage.setItem('deck.appearance', JSON.stringify({ skin: 'cyberdeck', theme: 'cyberpunk', mode: 'dark', density: 'small', tileFont: 'medium', termFont: 'medium' })); location.reload()"],
  shot_skin_hud: ["localStorage.setItem('deck.appearance', JSON.stringify({ skin: 'hud', theme: 'spaceship', mode: 'dark', density: 'small', tileFont: 'medium', termFont: 'medium' })); location.reload()"],
  shot_diff: ["localStorage.setItem('deck.appearance', JSON.stringify({ theme: 'default', mode: 'dark', density: 'small', tileFont: 'medium', termFont: 'medium', background: { path: null, dim: 'medium' }, tileOpacity: 1 })); location.reload()", "[...document.querySelectorAll('.links a')].find(a => /Diff/.test(a.textContent)).click()"],
  shot_worklog: ["localStorage.setItem('deck.appearance', JSON.stringify({ theme: 'default', mode: 'dark', density: 'small', tileFont: 'medium', termFont: 'medium', background: { path: null, dim: 'medium' }, tileOpacity: 1 })); location.reload()", "[...document.querySelectorAll('.titlebar button')].find(b => /Worked on/.test(b.textContent)).click()"],
  shot_appearance: ["localStorage.setItem('deck.appearance', JSON.stringify({ theme: 'spaceship', mode: 'dark', density: 'small', tileFont: 'medium', termFont: 'medium', background: { path: null, dim: 'medium' }, tileOpacity: 1 })); location.reload()", "[...document.querySelectorAll('.titlebar button')].find(b => /Settings/.test(b.textContent)).click()"],
  appearance_bottom: ["localStorage.setItem('deck.appearance', JSON.stringify({ theme: 'default', mode: 'dark', density: 'small', tileFont: 'medium', termFont: 'medium' })); location.reload()", "[...document.querySelectorAll('.titlebar button')].find(b => /Settings/.test(b.textContent)).click()", "document.querySelector('.appbody').scrollTop = 99999"],
  appearance2: ["localStorage.setItem('deck.appearance', JSON.stringify({ theme: 'candy', mode: 'light', density: 'small', tileFont: 'medium', termFont: 'medium' })); location.reload()", "[...document.querySelectorAll('.titlebar button')].find(b => /Settings/.test(b.textContent)).click()"],
  todos: ["[...document.querySelectorAll('.links a')].find(a => /to-do/.test(a.textContent)).click()"],
  procs: ["[...document.querySelectorAll('.links a')].find(a => /running/.test(a.textContent)).click()"],
  worklog_ticket: ["[...document.querySelectorAll('.titlebar button')].find(b => /Worked on/.test(b.textContent)).click()", "[...document.querySelectorAll('.ticketbtn')].find(b => /no ticket/.test(b.textContent)).click()"],
  worklog: ["[...document.querySelectorAll('.titlebar button')].find(b => /Worked on/.test(b.textContent)).click()"],
  tall: ["document.querySelector('[data-density=\"tall\"]').click()"],
  closed: ["[...document.querySelectorAll('.card')].find(c => c.classList.contains('closed')).click()"]
}

app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  protocol.handle('deckbg', (request) => {
    const p = decodeURIComponent(new URL(request.url).pathname.replace(/^\//, ''))
    return existsSync(p) ? net.fetch(pathToFileURL(p).toString()) : new Response('nope', { status: 404 })
  })
  const win = new BrowserWindow({
    width: Number(w), height: Number(h), show: false,
    webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: false, backgroundThrottling: false }
  })
  await win.loadFile(join(__dirname, '../../out/renderer/index.html'))
  // A hidden window throttles animation, so a capture could freeze a transition
  // halfway. Screenshots must show end states.
  await win.webContents.insertCSS('*,*::before,*::after{transition:none!important;animation:none!important}')
  await new Promise((r) => setTimeout(r, 500))
  for (const js of SCENARIOS[scenario] ?? []) {
    await win.webContents.executeJavaScript(js)
    await new Promise((r) => setTimeout(r, 700))
    await win.webContents.insertCSS('*,*::before,*::after{transition:none!important;animation:none!important}')
  }
  writeFileSync(out, (await win.capturePage()).toPNG())
  console.log(`preview: ${scenario} -> ${out}`)
  app.exit(0)
})
