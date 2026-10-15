const { contextBridge } = require('electron')
const f = require('./fixtures.cjs')

let sessions = f.sessions
const listeners = []
contextBridge.exposeInMainWorld('deck', {
  projects: async () => [
    { id: 'a', name: 'example-corporate', domain: 'example-corporate.test', phpVersion: '8.3.23' },
    { id: 'b', name: 'example-foundation', domain: 'example-foundation.test', phpVersion: '8.2.27' },
    { id: 'c', name: 'example-municipality', domain: 'example-municipality.test', phpVersion: '8.1.29' }
  ],
  recentDirectories: async () => [
    { path: '/Users/me/development/session-deck', display: '~/development/session-deck', name: 'session-deck', site: null },
    { path: '/Users/me/Local Sites/example-corporate/app/public/wp-content/themes/example-theme', display: '~/Local Sites/example-corporate/app/public/wp-content/themes/example-theme', name: 'example-theme', site: 'example-corporate' }
  ],
  chooseDirectory: async () => null,
  backgrounds: async () => {
    const { nativeImage } = require('electron')
    const { readdirSync, existsSync } = require('fs')
    const { join, basename, extname } = require('path')
    const dir = join(__dirname, '..', '..', 'resources', 'backgrounds')
    if (!existsSync(dir)) return { dir: null, images: [] }
    const files = readdirSync(dir).filter((f) => /\.(png|jpe?g|webp)$/i.test(f)).sort()
    return {
      dir,
      images: files.map((f) => {
        const path = join(dir, f)
        const name = basename(f, extname(f)).replace(/^\d+[-_]/, '').replace(/[-_]+/g, ' ')
        return {
          path,
          label: name.charAt(0).toUpperCase() + name.slice(1),
          file: f,
          thumb: nativeImage.createFromPath(path).resize({ width: 220 }).toDataURL(),
          url: `deckbg://img/${encodeURIComponent(path)}`
        }
      })
    }
  },
  chooseBackground: async () => null,
  ticketBase: async () => 'https://example.atlassian.net/browse',
  setTicketBase: async (v) => ({ ok: true, value: v }),
  pathForFile: () => '',
  worklogDays: async () => ['2026-09-15', '2026-09-14'],
  worklog: async (day) => ({ day, totalMinutes: 297, rows: [
    { key: 'a', project: 'example-corporate', name: 'Quotation template redesign', ticket: 'EXC-207', minutes: 102, first: Date.now() - 6.2 * 3600e3, last: Date.now() - 4.1 * 3600e3, blocks: 6 },
    { key: 'b', project: 'example-corporate', name: 'Chrome padding on the quote page', ticket: 'EXC-207', minutes: 54, first: Date.now() - 3.9 * 3600e3, last: Date.now() - 3 * 3600e3, blocks: 1 },
    { key: 'c', project: 'example-municipality', name: 'Fix 500 on the vacancies archive', ticket: 'EXM-1140', minutes: 46, first: Date.now() - 2.8 * 3600e3, last: Date.now() - 2 * 3600e3, blocks: 1 },
    { key: 'd', project: 'session-deck', name: 'session-deck', ticket: null, minutes: 95, first: Date.now() - 1.9 * 3600e3, last: Date.now() - 0.2 * 3600e3, blocks: 3 }
  ] }),
  addTodo: () => {}, toggleTodo: () => {}, removeTodo: () => {}, stopProcess: async () => true, focusApp: async () => 'Terminal', resize: () => {},
  launchDirectory: async () => null,
  sessions: async () => sessions,
  ptySize: async () => ({ cols: 120, rows: 32 }),
  hostname: async () => 'ENTERPRISE-D',
  // The first session has opened a report and a ticket from it, side by side.
  browserState: async () => (sessions[0] ? { [sessions[0].uid]: { active: 1, split: [1, 2], tabs: [
    { id: 1, url: 'file:///Users/example/jira-triage.html', title: 'Jira triage', loading: false },
    { id: 2, url: 'https://example.atlassian.net/browse/EXC-207', title: 'EXC-207 Vacancy filter', loading: false }
  ] } } : {}),
  onBrowser: () => () => {},
  browserLayout: () => {},
  browserUi: () => {},
  launch: async () => null,
  resume: async () => null,
  buffer: async () => '\x1b[2m> add a department filter to the vacancy block\x1b[0m\r\n\r\n● Edit render.php\r\n',
  gitRepos: async () => f.repos,
  gitDiff: async () => ({ text: f.diff, truncated: false, error: null }),
  write: () => {}, close: () => {}, remove: () => {}, rename: () => {},
  forgetTestPage: () => {}, forgetPullRequest: () => {}, setTicket: async () => true,
  summary: async () => ({ summary: { text: f.summary, at: Date.now() - 12 * 60e3, size: 1 }, available: true, outdated: true, pending: false }),
  summarize: async () => ({ summary: { text: f.summary, at: Date.now(), size: 1 }, available: true, outdated: false, pending: false }), openExternal: () => {}, focusExternal: () => {},
  onSessions: (cb) => { listeners.push(cb); return () => {} },
  updateState: async () => ({ status: 'none', current: '0.2.0' }),
  checkForUpdate: async () => {}, downloadUpdate: async () => {}, installUpdate: async () => {},
  onUpdate: () => () => {},
  onUpdateOpen: () => () => {},
  onSettingsOpen: () => () => {},
  onData: () => () => {}
})
