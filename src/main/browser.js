import { WebContentsView, session as electronSession, shell } from 'electron'
import { EventEmitter } from 'events'
import { fileURLToPath } from 'url'

/**
 * Browser panes, one per session that asks for one. A session opens pages
 * through the deck's MCP tools, and they appear in tabs beside its terminal.
 * A pane belongs to exactly one session and is never shared: it is keyed by
 * the session's uid, the same key its tile uses, and dies with the tile.
 *
 * Logins are shared, panes are not: every pane uses one persistent partition,
 * so signing in to Jira once works for every session's pane.
 *
 * Pages are untrusted. Each tab is a sandboxed WebContentsView with no preload
 * (so no route to the deck's IPC bridge), permission requests are refused,
 * downloads are refused, and only http(s), file and about:blank load.
 * `file:` is allowed on purpose: sessions write HTML reports to disk and open
 * them (jira-triage); Chromium still blocks one file page from reading others.
 *
 * A native view draws above the window's HTML, so it is shown only where the
 * renderer says a slot is free (`layout`), and hidden under any dialog.
 */

const PARTITION = 'persist:session-deck-browser'
const LOAD_TIMEOUT = 15_000
const MAX_RESULT = 60_000

const allowed = (url) => {
  try {
    const { protocol } = new URL(url)
    return protocol === 'http:' || protocol === 'https:' || protocol === 'file:' || url === 'about:blank'
  } catch {
    return false
  }
}

let hardened = false
function partition() {
  const ses = electronSession.fromPartition(PARTITION)
  if (!hardened) {
    hardened = true
    ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
    ses.setPermissionCheckHandler(() => false)
    ses.on('will-download', (event) => event.preventDefault())
    // Identify as plain Chrome. Some sign-ins (Google's) refuse browsers that
    // announce themselves as Electron or an embedding app.
    ses.setUserAgent(ses.getUserAgent().replace(/\s(Electron|session-deck|Session ?Deck)\/\S+/gi, ''))
  }
  return ses
}

class Browsers extends EventEmitter {
  constructor() {
    super()
    this.panes = new Map() // uid -> { tabs: Tab[], active, split, seq }
    this.win = null
    this.attached = new Set() // views currently added to the window
  }

  attach(win) {
    this.win = win
    this.attached.clear()
  }

  detach() {
    this.win = null
    this.attached.clear()
  }

  // ------------------------------------------------------------- tabs

  pane(uid, create = false) {
    let p = this.panes.get(uid)
    if (!p && create) {
      p = { tabs: [], active: null, split: null, seq: 0 }
      this.panes.set(uid, p)
    }
    return p ?? null
  }

  tab(uid, tabId) {
    const p = this.pane(uid)
    if (!p) return null
    const id = tabId ?? p.active
    return p.tabs.find((t) => t.id === Number(id)) ?? null
  }

  createTab(uid) {
    const p = this.pane(uid, true)
    const view = new WebContentsView({
      webPreferences: {
        session: partition(),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        // Keeps pages running while their session is not on screen.
        backgroundThrottling: false
      }
    })
    const tab = { id: ++p.seq, view, name: null, url: 'about:blank', title: 'New tab', loading: false }
    const wc = view.webContents

    // A link that wants a new window becomes a tab in the same pane. A named
    // target (target="jira", window.open(url, 'jira')) reuses the tab with
    // that name, as Chrome does; only _blank and unnamed ones add a tab.
    wc.setWindowOpenHandler(({ url, frameName }) => {
      const name = frameName && frameName !== '_blank' ? frameName : null
      if (allowed(url)) this.open(uid, url, { newTab: true, name }).catch(() => {})
      return { action: 'deny' }
    })
    wc.on('will-navigate', (event, url) => {
      if (!allowed(url)) event.preventDefault()
    })
    wc.on('will-redirect', (event, url) => {
      if (!allowed(url)) event.preventDefault()
    })
    const sync = () => {
      if (wc.isDestroyed()) return
      tab.url = wc.getURL() || tab.url
      tab.title = wc.getTitle() || tab.url
      tab.loading = wc.isLoading()
      this.changed()
    }
    for (const ev of ['did-navigate', 'did-navigate-in-page', 'page-title-updated', 'did-start-loading', 'did-stop-loading']) {
      wc.on(ev, sync)
    }

    p.tabs.push(tab)
    p.active = tab.id
    return tab
  }

  /** Load a url and wait for it, bounded, so the tool can report the result. */
  async load(tab, url) {
    const wc = tab.view.webContents
    tab.url = url
    tab.loading = true
    this.changed()
    await Promise.race([wc.loadURL(url).catch(() => {}), new Promise((r) => setTimeout(r, LOAD_TIMEOUT))])
    return { tab: tab.id, url: wc.getURL(), title: wc.getTitle() }
  }

  async open(uid, url, { newTab = false, tab: tabId, name = null } = {}) {
    if (!allowed(url)) throw new Error('Only http(s) and file URLs can be opened.')
    const p = this.pane(uid)
    const named = name ? p?.tabs.find((t) => t.name === name) : null
    const existing = named || (!newTab && (tabId ? this.tab(uid, tabId) : p && this.tab(uid)))
    const tab = existing || this.createTab(uid)
    if (name) tab.name = name
    const pane = this.pane(uid)
    pane.active = tab.id
    // During a split, a tab opened from one side replaces the other side, so
    // a list stays put while each item it opens shows beside it.
    if (pane.split && !pane.split.includes(tab.id)) pane.split = [pane.split[0], tab.id]
    this.changed()
    return this.load(tab, url)
  }

  close(uid, tabId) {
    const p = this.pane(uid)
    const tab = this.tab(uid, tabId)
    if (!p || !tab) return false
    this.destroyTab(tab)
    p.tabs = p.tabs.filter((t) => t !== tab)
    if (p.split?.includes(tab.id)) p.split = null
    if (p.active === tab.id) p.active = p.tabs.at(-1)?.id ?? null
    if (!p.tabs.length) this.panes.delete(uid)
    this.changed()
    return true
  }

  destroyTab(tab) {
    if (this.attached.has(tab.view)) {
      try {
        this.win?.contentView.removeChildView(tab.view)
      } catch {}
      this.attached.delete(tab.view)
    }
    if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close()
  }

  /** Drop the panes of sessions the deck no longer has. */
  prune(uids) {
    const keep = new Set(uids)
    for (const [uid, p] of this.panes) {
      if (keep.has(uid)) continue
      for (const tab of p.tabs) this.destroyTab(tab)
      this.panes.delete(uid)
      this.changed()
    }
  }

  select(uid, tabId) {
    const p = this.pane(uid)
    const tab = this.tab(uid, tabId)
    if (!p || !tab) return false
    p.active = tab.id
    // Picking a tab that is not in the split ends the split.
    if (p.split && !p.split.includes(tab.id)) p.split = null
    this.changed()
    return true
  }

  /** Two tabs side by side, or `with` null to end it. */
  split(uid, tabId, withId) {
    const p = this.pane(uid)
    if (!p) return false
    if (withId == null) {
      p.split = null
    } else {
      const a = this.tab(uid, tabId)
      const b = this.tab(uid, withId)
      if (!a || !b || a === b) return false
      p.split = [a.id, b.id]
      p.active = a.id
    }
    this.changed()
    return true
  }

  // ----------------------------------------------------------- layout

  /**
   * Show exactly the views the renderer has slots for, at those rectangles;
   * everything else comes off the window. `slots` is [{ tab, x, y, width,
   * height }] in window coordinates, for the session `uid` on screen.
   */
  layout(uid, slots = []) {
    if (!this.win || this.win.isDestroyed()) return
    const want = new Map()
    for (const s of slots ?? []) {
      const tab = this.tab(uid, s.tab)
      if (tab && s.width > 0 && s.height > 0) want.set(tab.view, s)
    }
    for (const view of [...this.attached]) {
      if (want.has(view)) continue
      try {
        this.win.contentView.removeChildView(view)
      } catch {}
      this.attached.delete(view)
    }
    for (const [view, s] of want) {
      if (!this.attached.has(view)) {
        this.win.contentView.addChildView(view)
        this.attached.add(view)
      }
      view.setBounds({
        x: Math.round(s.x),
        y: Math.round(s.y),
        width: Math.round(s.width),
        height: Math.round(s.height)
      })
    }
  }

  // ------------------------------------------------- buttons in the deck

  ui(uid, action, tabId) {
    const tab = this.tab(uid, tabId)
    if (action === 'select') return this.select(uid, tabId)
    if (action === 'close') return this.close(uid, tabId)
    if (action === 'unsplit') return this.split(uid, tabId, null)
    if (action === 'split') {
      // Next to the active tab: the most recent other one.
      const p = this.pane(uid)
      const other = p?.tabs.filter((t) => t.id !== Number(tabId)).at(-1)
      return other ? this.split(uid, tabId, other.id) : false
    }
    if (!tab) return false
    const wc = tab.view.webContents
    if (action === 'back' && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack()
    else if (action === 'forward' && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward()
    else if (action === 'reload') wc.reload()
    else if (action === 'external') {
      // Same rule as the rest of the deck: only web pages go to the system.
      const { protocol } = new URL(tab.url)
      if (protocol === 'http:' || protocol === 'https:') shell.openExternal(tab.url)
      else if (protocol === 'file:') shell.openPath(fileURLToPath(tab.url))
    }
    return true
  }

  // ----------------------------------------------------- session tools

  /** What a session's MCP tools call. Every action is scoped to `uid`. */
  async handle(uid, action, args = {}) {
    switch (action) {
      case 'open':
        return this.open(uid, String(args.url ?? ''), { newTab: Boolean(args.newTab), tab: args.tab })
      case 'tabs':
        return { tabs: this.describe(uid) }
      case 'select':
        return { ok: this.select(uid, args.tab), tabs: this.describe(uid) }
      case 'split':
        return { ok: this.split(uid, args.tab, args.with ?? null), tabs: this.describe(uid) }
      case 'close':
        return { ok: this.close(uid, args.tab), tabs: this.describe(uid) }
      case 'snapshot':
        return this.run(uid, args.tab, SNAPSHOT)
      case 'click':
        return this.run(uid, args.tab, `(${CLICK})(${JSON.stringify(String(args.selector ?? ''))})`)
      case 'type':
        return this.run(
          uid,
          args.tab,
          `(${TYPE})(${JSON.stringify(String(args.selector ?? ''))}, ${JSON.stringify(String(args.text ?? ''))}, ${Boolean(args.submit)})`
        )
      case 'eval':
        return this.run(uid, args.tab, String(args.expression ?? ''))
      case 'screenshot': {
        const tab = this.need(uid, args.tab)
        const image = await tab.view.webContents.capturePage()
        if (image.isEmpty()) throw new Error('Nothing to capture: the tab is not on screen. Ask the user to select this session in the deck.')
        return { tab: tab.id, png: image.toPNG().toString('base64') }
      }
      default:
        throw new Error(`Unknown browser action: ${action}`)
    }
  }

  need(uid, tabId) {
    const tab = this.tab(uid, tabId)
    if (!tab) throw new Error(this.pane(uid) ? `No tab ${tabId}.` : 'This session has no browser tabs yet. Open a page first.')
    return tab
  }

  async run(uid, tabId, code) {
    const tab = this.need(uid, tabId)
    const value = await tab.view.webContents.executeJavaScript(code, true)
    let text = typeof value === 'string' ? value : JSON.stringify(value ?? null, null, 2)
    if (text.length > MAX_RESULT) text = text.slice(0, MAX_RESULT) + '\n… (truncated)'
    return { tab: tab.id, result: text }
  }

  describe(uid) {
    const p = this.pane(uid)
    return (p?.tabs ?? []).map((t) => ({ tab: t.id, url: t.url, title: t.title, active: t.id === p.active }))
  }

  // ------------------------------------------------------------ state

  changed() {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.emit('change', this.serialize()), 30)
  }

  serialize() {
    const out = {}
    for (const [uid, p] of this.panes) {
      out[uid] = {
        active: p.active,
        split: p.split,
        tabs: p.tabs.map(({ id, url, title, loading }) => ({ id, url, title, loading }))
      }
    }
    return out
  }
}

/** Readable text and the things a session can act on, in one pass. */
const SNAPSHOT = `(() => {
  const text = (document.body?.innerText ?? '').replace(/\\n{3,}/g, '\\n\\n').slice(0, 30000)
  const pick = (el) => el.id ? '#' + CSS.escape(el.id) : null
  const links = [...document.querySelectorAll('a[href]')].slice(0, 150).map((a) => ({ text: a.innerText.trim().slice(0, 80), href: a.href }))
  const fields = [...document.querySelectorAll('input, textarea, select, button')].slice(0, 80).map((el) => ({
    tag: el.tagName.toLowerCase(), type: el.type || null, name: el.name || null, id: pick(el),
    label: (el.labels?.[0]?.innerText || el.placeholder || el.innerText || el.value || '').trim().slice(0, 60)
  }))
  return { url: location.href, title: document.title, text, links, fields }
})()`

const CLICK = (selector) => {
  const el = document.querySelector(selector)
  if (!el) return { ok: false, error: `No element matches ${selector}` }
  el.scrollIntoView({ block: 'center' })
  el.click()
  return { ok: true }
}

const TYPE = (selector, text, submit) => {
  const el = document.querySelector(selector)
  if (!el) return { ok: false, error: `No element matches ${selector}` }
  el.focus()
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  // The native setter, so frameworks that track input see the change.
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, text)
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
  if (submit && el.form) {
    if (el.form.requestSubmit) el.form.requestSubmit()
    else el.form.submit()
  }
  return { ok: true }
}

export const browsers = new Browsers()
