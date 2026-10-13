import { app, BrowserWindow, ipcMain, Notification, shell, Menu, nativeImage, dialog, nativeTheme } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { listProjects, getProject, projectForDirectory, tildify } from './local.js'
import { statSync } from 'fs'
import { hostname } from 'os'
import { registry } from './registry.js'
import { startHookServer, HOOK_LOG } from './hooks.js'
import { installBridgeCopy } from './bridge-copy.js'
import { IS_MAC, IS_WIN } from './platform.js'
import { listBackgrounds, chooseBackground, registerScheme, serveBackgrounds, urlFor } from './backgrounds.js'
import { reposForSession, fileDiff } from './git.js'
import { updater } from './updater.js'
import { browsers } from './browser.js'

// Must run before `ready`, or the menu bar and About panel say "Electron".
app.setName('Session Deck')
// Windows shows toast notifications only for an app with an AppUserModelID,
// and it must match the installer's appId.
if (IS_WIN) app.setAppUserModelId('io.github.frankabeekman.session-deck')
// Must happen before `ready`: privileged schemes cannot be registered later.
registerScheme()

let win = null
const notified = new Set()

/** A window can be destroyed between an event firing and this running. */
function send(channel, payload) {
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return
  win.webContents.send(channel, payload)
}

/** In dev we run Electron's own binary, so the dock icon needs setting by hand. */
function applyDevIcon() {
  if (app.isPackaged || process.platform !== 'darwin') return
  const icon = join(__dirname, '../../build/icon.png')
  if (existsSync(icon)) app.dock.setIcon(nativeImage.createFromPath(icon))
}

/**
 * Electron's default menu is labelled "Electron" and omits Edit, so the focused
 * terminal has no copy/paste. This replaces it with a minimal correct one.
 */
function applyMenu() {
  const template = [
    {
      label: 'Session Deck',
      submenu: [
        { role: 'about', label: 'About Session Deck' },
        { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: () => send('deck:settings-open') },
        {
          label: 'Check for Updates…',
          click: () => {
            send('deck:update-open')
            updater.check()
          }
        },
        // hide / hideOthers / unhide exist only on macOS.
        ...(IS_MAC
          ? [{ type: 'separator' }, { role: 'hide', label: 'Hide Session Deck' }, { role: 'hideOthers' }, { role: 'unhide' }]
          : []),
        { type: 'separator' },
        { role: 'quit', label: IS_MAC ? 'Quit Session Deck' : 'Exit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    { role: 'windowMenu' }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 720,
    // The LCARS console stacks its sections; shorter than this they collapse.
    minHeight: 560,
    show: false,
    title: 'Session Deck',
    // macOS: content runs under the traffic lights. Windows: a normal frame,
    // with the menu bar tucked away until Alt is pressed.
    ...(IS_MAC ? { titleBarStyle: 'hiddenInset' } : { autoHideMenuBar: true }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.once('ready-to-show', () => win.show())
  browsers.attach(win)

  // Without this, `win` stays a live reference to a destroyed object and every
  // later send throws "Object has been destroyed".
  win.on('closed', () => {
    win = null
    browsers.detach()
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/**
 * Notify for every blocked session, per the v1 decision. If this turns noisy,
 * the first thing to cut is notifying for a session already visible on screen.
 */
function notifyBlocked(sessions) {
  for (const s of sessions) {
    if (s.status === 'needs-you' && !notified.has(s.id)) {
      notified.add(s.id)
      new Notification({
        title: s.name ?? s.project.name,
        body: s.question ?? 'Needs your input',
        silent: false
      }).show()
    }
    if (s.status !== 'needs-you') notified.delete(s.id)
  }
}

app.whenReady().then(() => {
  serveBackgrounds()
  // Keep the globally installed MCP bridge (if any) in step with this app version.
  installBridgeCopy()
  // One-off: build the hours list from hook history that predates it.
  setTimeout(() => registry.backfillWorklog(HOOK_LOG), 1500)
  applyDevIcon()
  applyMenu()
  startHookServer(() => {
    dialog.showMessageBox({
      type: 'warning',
      title: 'Session Deck is already running',
      message: 'Another Session Deck has the status port.',
      detail:
        'This window can still launch and drive sessions, but status pills and ' +
        'notifications will go to the other instance. Both also save to the same ' +
        'store, so an older copy can overwrite what this one saves — ticket ' +
        'changes, summaries. Quit it, then reopen this one.',
      buttons: ['OK']
    })
  })
  createWindow()

  registry.on('change', (sessions) => {
    notifyBlocked(sessions)
    send('deck:sessions', sessions)
    // A pane lives exactly as long as its session's tile.
    browsers.prune(sessions.map((s) => s.uid))
  })

  browsers.on('change', (state) => send('deck:browser', state))
  // Pages in the panes follow the deck's light/dark mode (prefers-color-scheme).
  ipcMain.on('deck:color-scheme', (_e, mode) => {
    nativeTheme.themeSource = mode === 'dark' || mode === 'light' ? mode : 'system'
  })
  ipcMain.handle('deck:browser-state', () => browsers.serialize())
  ipcMain.on('deck:browser-layout', (_e, { uid, slots }) => browsers.layout(uid, slots))
  ipcMain.on('deck:browser-ui', (_e, { uid, action, tab }) => browsers.ui(uid, action, tab))

  registry.on('data', (sessionId, chunk) => {
    send('deck:data', { sessionId, chunk })
  })

  updater.on('change', (state) => send('deck:update', state))
  updater.start()
  ipcMain.handle('deck:update-state', () => updater.state)
  ipcMain.handle('deck:update-check', () => updater.check())
  ipcMain.handle('deck:update-download', () => updater.download())
  ipcMain.handle('deck:update-install', () => updater.install())

  // The LCARS console shows the computer's name as its title.
  ipcMain.handle('deck:hostname', () => hostname().replace(/\.local$/, ''))
  ipcMain.handle('deck:projects', () => listProjects())
  ipcMain.handle('deck:sessions', () => registry.serialize())
  ipcMain.handle('deck:pty-size', (_e, uid) => registry.ptySize(uid))
  ipcMain.on('deck:resize', (_e, { uid, cols, rows }) => registry.resize(uid, cols, rows))
  ipcMain.handle('deck:stop-process', (_e, { uid, pid }) => registry.stopProcess(uid, pid))
  ipcMain.handle('deck:focus-app', (_e, uid) => registry.focusApp(uid))
  ipcMain.on('deck:todo-add', (_e, { uid, text }) => registry.addTodo(uid, text, 'user'))
  ipcMain.on('deck:todo-toggle', (_e, { projectKey, todoId }) => registry.toggleTodo(projectKey, todoId))
  ipcMain.on('deck:todo-remove', (_e, { projectKey, todoId }) => registry.removeTodo(projectKey, todoId))
  ipcMain.handle('deck:backgrounds', () => {
    const { dir, images } = listBackgrounds()
    return { dir, images: images.map((i) => ({ ...i, url: urlFor(i.path) })) }
  })
  ipcMain.handle('deck:choose-background', async () => {
    const picked = await chooseBackground(win)
    return picked ? { ...picked, url: urlFor(picked.path) } : null
  })
  ipcMain.handle('deck:ticket-base', () => registry.ticketBase())
  ipcMain.handle('deck:set-ticket-base', (_e, url) => registry.setTicketBase(url))
  ipcMain.handle('deck:worklog-days', () => registry.worklogDays())
  ipcMain.handle('deck:worklog', (_e, day) => registry.worklogFor(day))
  ipcMain.handle('deck:summary', (_e, uid) => registry.summaryFor(uid))
  ipcMain.handle('deck:summarize', (_e, uid) => registry.summarize(uid))
  ipcMain.handle('deck:set-ticket', (_e, { key, ticket }) => registry.setTicket(key, ticket))

  ipcMain.handle('deck:resume', (_e, sessionId) => registry.reopen(sessionId)?.id ?? null)
  ipcMain.on('deck:rename', (_e, { sessionId, name }) => registry.setName(sessionId, name, 'user'))

  ipcMain.handle('deck:choose-directory', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Start a session in a directory',
      buttonLabel: 'Start session here',
      properties: ['openDirectory', 'createDirectory']
    })
    return canceled ? null : (filePaths[0] ?? null)
  })

  ipcMain.handle('deck:launch-directory', (_e, dir) => {
    let ok = false
    try {
      ok = statSync(dir).isDirectory()
    } catch {}
    if (!ok) throw new Error(`Not a directory: ${dir}`)
    return registry.launchDirectory(dir).deckId
  })

  ipcMain.handle('deck:recent-directories', () =>
    registry.recentDirectories().map((dir) => {
      const project = projectForDirectory(dir)
      return { path: dir, display: tildify(dir), name: project.name, site: project.id ? project.name : null }
    })
  )

  ipcMain.handle('deck:launch-shell', (_e, dir) => registry.launchShell(dir).deckId)

  // A saved view: web pages only, whatever the renderer sends.
  ipcMain.handle('deck:open-view', (_e, view) => {
    const url = String(view?.url ?? '')
    let ok = false
    try {
      ok = ['http:', 'https:'].includes(new URL(url).protocol)
    } catch {}
    if (!ok || !view?.id) throw new Error('A view needs an http(s) address.')
    const { session, fresh } = registry.launchView({ id: String(view.id), label: String(view.label || url).slice(0, 40), url })
    // Not awaited: the page loads in its pane while the viewer already shows
    // it. An open view whose tabs were all closed loads again.
    if (fresh || !browsers.pane(session.deckId)) browsers.open(session.deckId, url).catch(() => {})
    return session.deckId
  })

  ipcMain.handle('deck:launch', (_e, projectId) => {
    const project = getProject(projectId)
    if (!project) throw new Error(`Unknown project: ${projectId}`)
    return registry.launch(project).id
  })

  ipcMain.handle('deck:git-repos', async (_e, sessionId) => {
    const s = registry.resolve(sessionId)
    if (!s) return []
    return reposForSession(s.cwd ?? s.project.path, s.touched ?? [])
  })

  ipcMain.handle('deck:git-diff', (_e, { root, path, group }) => fileDiff(root, path, { group }))

  ipcMain.handle('deck:buffer', (_e, sessionId) => registry.replayFor(sessionId))
  ipcMain.on('deck:write', (_e, { sessionId, data }) => registry.write(sessionId, data))
  ipcMain.on('deck:close', (_e, sessionId) => registry.close(sessionId))
  ipcMain.on('deck:remove', (_e, sessionId) => registry.remove(sessionId))
  ipcMain.on('deck:forget-test-page', (_e, { projectKey, pageId }) =>
    registry.forgetTestPage(projectKey, pageId)
  )
  ipcMain.on('deck:forget-pull-request', (_e, { projectKey, prId }) => registry.forgetPullRequest(projectKey, prId))
  ipcMain.on('deck:open-external', (_e, url) => shell.openExternal(url))

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Closing the window must not kill the sessions -- watching long-running work is
// the entire point of the app. On macOS the app stays in the dock with its
// sessions alive and the window reopens showing them; elsewhere, closing quits.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Sessions are children of this process, so quitting really does take them with
// it. Their UUIDs survive, so v1.5 can offer `claude --resume <uuid>`.
app.on('before-quit', () => {
  // Kills every PTY without marking it ended (so it returns as Interrupted),
  // then writes the store synchronously — a debounced write never fires here.
  registry.shutdown()
})
