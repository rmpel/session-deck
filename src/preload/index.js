import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('deck', {
  platform: process.platform,
  hostname: () => ipcRenderer.invoke('deck:hostname'),
  projects: () => ipcRenderer.invoke('deck:projects'),
  sessions: () => ipcRenderer.invoke('deck:sessions'),
  ptySize: (uid) => ipcRenderer.invoke('deck:pty-size', uid),
  resize: (uid, cols, rows) => ipcRenderer.send('deck:resize', { uid, cols, rows }),
  stopProcess: (uid, pid) => ipcRenderer.invoke('deck:stop-process', { uid, pid }),
  focusApp: (uid) => ipcRenderer.invoke('deck:focus-app', uid),
  addTodo: (uid, text) => ipcRenderer.send('deck:todo-add', { uid, text }),
  toggleTodo: (projectKey, todoId) => ipcRenderer.send('deck:todo-toggle', { projectKey, todoId }),
  removeTodo: (projectKey, todoId) => ipcRenderer.send('deck:todo-remove', { projectKey, todoId }),
  backgrounds: () => ipcRenderer.invoke('deck:backgrounds'),
  chooseBackground: () => ipcRenderer.invoke('deck:choose-background'),
  ticketBase: () => ipcRenderer.invoke('deck:ticket-base'),
  setTicketBase: (url) => ipcRenderer.invoke('deck:set-ticket-base', url),
  worklogDays: () => ipcRenderer.invoke('deck:worklog-days'),
  worklog: (day) => ipcRenderer.invoke('deck:worklog', day),
  summary: (uid) => ipcRenderer.invoke('deck:summary', uid),
  summarize: (uid) => ipcRenderer.invoke('deck:summarize', uid),
  setTicket: (key, ticket) => ipcRenderer.invoke('deck:set-ticket', { key, ticket }),
  launch: (projectId) => ipcRenderer.invoke('deck:launch', projectId),
  chooseDirectory: () => ipcRenderer.invoke('deck:choose-directory'),
  launchDirectory: (dir) => ipcRenderer.invoke('deck:launch-directory', dir),
  recentDirectories: () => ipcRenderer.invoke('deck:recent-directories'),
  resume: (sessionId) => ipcRenderer.invoke('deck:resume', sessionId),
  buffer: (sessionId) => ipcRenderer.invoke('deck:buffer', sessionId),
  gitRepos: (sessionId) => ipcRenderer.invoke('deck:git-repos', sessionId),
  gitDiff: (root, path, group) => ipcRenderer.invoke('deck:git-diff', { root, path, group }),

  write: (sessionId, data) => ipcRenderer.send('deck:write', { sessionId, data }),
  close: (sessionId) => ipcRenderer.send('deck:close', sessionId),
  remove: (sessionId) => ipcRenderer.send('deck:remove', sessionId),
  rename: (sessionId, name) => ipcRenderer.send('deck:rename', { sessionId, name }),
  forgetTestPage: (projectKey, pageId) =>
    ipcRenderer.send('deck:forget-test-page', { projectKey, pageId }),
  forgetPullRequest: (projectKey, prId) => ipcRenderer.send('deck:forget-pull-request', { projectKey, prId }),
  openExternal: (url) => ipcRenderer.send('deck:open-external', url),
  browserState: () => ipcRenderer.invoke('deck:browser-state'),
  browserLayout: (uid, slots) => ipcRenderer.send('deck:browser-layout', { uid, slots }),
  browserUi: (uid, action, tab) => ipcRenderer.send('deck:browser-ui', { uid, action, tab }),
  updateState: () => ipcRenderer.invoke('deck:update-state'),
  checkForUpdate: () => ipcRenderer.invoke('deck:update-check'),
  downloadUpdate: () => ipcRenderer.invoke('deck:update-download'),
  installUpdate: () => ipcRenderer.invoke('deck:update-install'),

  onSessions: (cb) => {
    const h = (_e, sessions) => cb(sessions)
    ipcRenderer.on('deck:sessions', h)
    return () => ipcRenderer.removeListener('deck:sessions', h)
  },
  onUpdate: (cb) => {
    const h = (_e, state) => cb(state)
    ipcRenderer.on('deck:update', h)
    return () => ipcRenderer.removeListener('deck:update', h)
  },
  onSettingsOpen: (cb) => {
    const h = () => cb()
    ipcRenderer.on('deck:settings-open', h)
    return () => ipcRenderer.removeListener('deck:settings-open', h)
  },
  onUpdateOpen: (cb) => {
    const h = () => cb()
    ipcRenderer.on('deck:update-open', h)
    return () => ipcRenderer.removeListener('deck:update-open', h)
  },
  onBrowser: (cb) => {
    const h = (_e, state) => cb(state)
    ipcRenderer.on('deck:browser', h)
    return () => ipcRenderer.removeListener('deck:browser', h)
  },
  onData: (cb) => {
    const h = (_e, payload) => cb(payload)
    ipcRenderer.on('deck:data', h)
    return () => ipcRenderer.removeListener('deck:data', h)
  }
})
