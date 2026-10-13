'use strict'

const path = require('path')
const fs = require('fs')
const { spawn } = require('child_process')
const {
  app, Menu, BrowserWindow, Notification, ipcMain, net, screen, shell,
} = require('electron')

const U = require('./usage')
const { readCredentials, isExpired } = require('./credentials')

const APP_ID = 'com.brianwaletzko.claudeusagemeter'
const USAGE_URL = process.env.CUM_USAGE_URL || U.USAGE_URL // override is for local testing only
const USAGE_PAGE = 'https://claude.ai/settings/usage'
const ASSETS = path.join(__dirname, '..', 'assets')
const RENEW_COOLDOWN_MS = 10 * 60 * 1000
const WIDTH = 320
const MARGIN = 12

// ---------- settings ----------

const DEFAULTS = {
  openAtLogin: true,
  alwaysOnTop: true,
  pollMinutes: 5,
  alerts: true,
  autoRenew: false,
  position: null, // { x, y } of the window, remembered between runs
  seen: {}, // alert bookkeeping, keyed by window
}

let configPath
let config = { ...DEFAULTS }

function loadConfig() {
  configPath = path.join(app.getPath('userData'), 'config.json')
  try {
    config = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(configPath, 'utf8')) }
  } catch {
    config = { ...DEFAULTS }
  }
}

function saveConfig() {
  try {
    fs.mkdirSync(path.dirname(configPath), { recursive: true })
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
  } catch (err) {
    console.error('could not save settings', err)
  }
}

// ---------- state ----------

const state = {
  status: 'loading', // loading | ok | error
  usage: null, // last good reading, kept while errors happen
  error: null, // { kind, message }
  updatedAt: null, // ms of last good reading
  checkedAt: null,
  renewing: false,
}

let win = null
let timer = null
let failures = 0
let lastRenewAt = 0

const ERROR_TEXT = {
  'not-found': 'Claude Code sign-in not found. Install Claude Code and run "claude" once to sign in.',
  'no-oauth': 'Claude Code is signed in with an API key, not a Claude subscription, so there are no plan limits to show.',
  unreadable: "Couldn't read Claude Code's sign-in file.",
  expired: 'Your Claude Code sign-in has expired. Use Claude Code once (or "Renew sign-in") to refresh it.',
  auth: 'Sign-in was rejected. Use Claude Code once (or "Renew sign-in") to refresh it.',
  ratelimit: 'Checked too often. Waiting 10 minutes before trying again.',
  network: "Couldn't reach Anthropic. Will retry.",
  http: 'Unexpected response from the usage service.',
  parse: 'The usage response looked different than expected.',
}

function setError(kind, detail) {
  state.status = 'error'
  state.error = { kind, message: ERROR_TEXT[kind] || 'Something went wrong.', detail: detail || null }
}

// ---------- polling ----------

async function poll() {
  clearTimeout(timer)
  state.checkedAt = Date.now()
  let kind = null

  const creds = readCredentials()
  if (!creds.ok) {
    kind = creds.reason
    setError(kind)
  } else if (isExpired(creds)) {
    kind = 'expired'
    setError(kind)
    if (config.autoRenew) renewSignIn({ quiet: true })
  } else {
    try {
      const res = await net.fetch(USAGE_URL, {
        headers: {
          Authorization: `Bearer ${creds.token}`,
          'anthropic-beta': U.BETA_HEADER,
          'User-Agent': `claude-usage-meter/${app.getVersion()}`,
          Accept: 'application/json',
        },
      })
      if (res.status === 401 || res.status === 403) {
        kind = 'auth'
        setError(kind)
        if (config.autoRenew) renewSignIn({ quiet: true })
      } else if (res.status === 429) {
        kind = 'ratelimit'
        setError(kind)
      } else if (!res.ok) {
        kind = 'http'
        setError(kind, `HTTP ${res.status}`)
      } else {
        const json = await res.json()
        try {
          state.usage = U.parseUsage(json)
          state.status = 'ok'
          state.error = null
          state.updatedAt = Date.now()
          runAlerts()
        } catch (err) {
          kind = 'parse'
          setError(kind, err.message)
        }
      }
    } catch (err) {
      kind = 'network'
      setError(kind, err.message)
    }
  }

  failures = kind ? failures + 1 : 0
  const delay = U.nextDelay(config.pollMinutes * 60 * 1000, failures, kind)
  timer = setTimeout(poll, delay)
  render()
}

function runAlerts() {
  if (!state.usage) return
  const windows = [
    ['fiveHour', '5-hour window', state.usage.fiveHour],
    ['weekly', 'Weekly limit', state.usage.weekly],
  ]
  let seen = config.seen || {}
  for (const [key, label, w] of windows) {
    const r = U.checkAlert(seen, key, w)
    seen = r.seen
    if (r.fire !== null && config.alerts && Notification.isSupported()) {
      const when = w.resetsAt ? ` It resets ${U.formatClock(w.resetsAt)} (${U.formatRelative(w.resetsAt)}).` : ''
      new Notification({
        title: `Claude: ${label} at ${Math.round(w.percent)}%`,
        body: `You've used ${Math.round(w.percent)}% of your ${label.toLowerCase()}.${when}`,
        icon: path.join(ASSETS, 'icon.png'),
      }).show()
    }
  }
  config.seen = seen
  saveConfig()
}

// ---------- sign-in renewal ----------

// Runs a one-line Claude Code prompt on the cheapest model. Claude Code
// refreshes its own saved sign-in when it starts, which is all we need.
// It uses a very small amount of plan usage, so it's rate-limited.
function renewSignIn({ quiet = false } = {}) {
  if (state.renewing) return
  if (quiet && Date.now() - lastRenewAt < RENEW_COOLDOWN_MS) return
  lastRenewAt = Date.now()
  state.renewing = true
  render()
  let child
  try {
    child = spawn('claude', ['-p', 'ok', '--model', 'haiku', '--max-turns', '1'], {
      shell: true,
      windowsHide: true,
      timeout: 90_000,
      stdio: 'ignore',
    })
  } catch {
    state.renewing = false
    if (!quiet) notify('Could not run Claude Code', 'Make sure the "claude" command works in a terminal.')
    render()
    return
  }
  child.on('error', () => {
    if (!quiet) notify('Could not run Claude Code', 'Make sure the "claude" command works in a terminal.')
  })
  child.on('exit', () => {
    state.renewing = false
    poll()
  })
}

function notify(title, body) {
  if (Notification.isSupported()) new Notification({ title, body }).show()
}

// ---------- menu ----------

function buildMenu() {
  const needsRenew = state.status === 'error' && ['expired', 'auth'].includes(state.error.kind)
  return Menu.buildFromTemplate([
    { label: 'Refresh now', click: () => poll() },
    { type: 'separator' },
    { label: 'Always on top', type: 'checkbox', checked: config.alwaysOnTop, click: i => { setSetting('alwaysOnTop', i.checked); applyAlwaysOnTop() } },
    { label: 'Move to bottom-right corner', click: () => { config.position = null; saveConfig(); placeWindow() } },
    {
      label: 'Check every',
      submenu: [2, 5, 10, 15].map(m => ({
        label: `${m} minutes`, type: 'radio', checked: config.pollMinutes === m,
        click: () => { setSetting('pollMinutes', m); poll() },
      })),
    },
    { label: 'Alert at 75% and 90%', type: 'checkbox', checked: config.alerts, click: i => setSetting('alerts', i.checked) },
    { label: 'Start with Windows', type: 'checkbox', checked: config.openAtLogin, click: i => { setSetting('openAtLogin', i.checked); applyLoginItem() } },
    { type: 'separator' },
    {
      label: state.renewing ? 'Renewing sign-in…' : 'Renew sign-in (runs Claude Code)',
      enabled: needsRenew && !state.renewing,
      click: () => renewSignIn(),
    },
    { label: 'Auto-renew when expired', type: 'checkbox', checked: config.autoRenew, click: i => setSetting('autoRenew', i.checked) },
    { label: 'Open Claude usage page', click: () => shell.openExternal(USAGE_PAGE) },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ])
}

function showMenu() {
  if (win && !win.isDestroyed()) buildMenu().popup({ window: win })
}

function setSetting(key, value) {
  config[key] = value
  saveConfig()
  render()
}

function applyLoginItem() {
  if (process.platform === 'win32' || process.platform === 'darwin') {
    app.setLoginItemSettings({ openAtLogin: Boolean(config.openAtLogin) })
  }
}

function applyAlwaysOnTop() {
  if (win) win.setAlwaysOnTop(Boolean(config.alwaysOnTop), 'floating')
}

// ---------- window ----------

function createWindow() {
  win = new BrowserWindow({
    width: WIDTH,
    height: 240,
    show: false,
    frame: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: Boolean(config.alwaysOnTop),
    title: 'Claude Usage Meter',
    icon: path.join(ASSETS, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  applyAlwaysOnTop()
  win.loadFile(path.join(__dirname, 'popup.html'))
  placeWindow()
  win.once('ready-to-show', () => win.show())
  win.webContents.on('did-finish-load', () => sendState())

  // Remember where the user drags it.
  win.on('moved', () => {
    const [x, y] = win.getPosition()
    config.position = { x, y }
    saveConfig()
  })

  // Right-clicking the drag area would show Windows' own window menu; show ours instead.
  win.on('system-context-menu', e => {
    e.preventDefault()
    showMenu()
  })

  win.on('closed', () => { win = null })
}

// Put the window at its saved spot, or the bottom-right corner of the main
// screen. Keeps it fully on a screen in case monitors changed since last run.
function placeWindow() {
  if (!win) return
  const [w, h] = win.getSize()
  const saved = config.position
  const wa = (saved ? screen.getDisplayNearestPoint(saved) : screen.getPrimaryDisplay()).workArea
  const x = saved ? saved.x : wa.x + wa.width - w - MARGIN
  const y = saved ? saved.y : wa.y + wa.height - h - MARGIN
  win.setBounds(onScreen({ x, y, width: w, height: h }))
}

function onScreen(b) {
  const wa = screen.getDisplayNearestPoint({ x: b.x + b.width / 2, y: b.y + b.height / 2 }).workArea
  return {
    ...b,
    x: Math.max(wa.x, Math.min(b.x, wa.x + wa.width - b.width)),
    y: Math.max(wa.y, Math.min(b.y, wa.y + wa.height - b.height)),
  }
}

function serializable() {
  const u = state.usage
  const w = v => (v ? { percent: v.percent, resetsAt: v.resetsAt ? v.resetsAt.toISOString() : null } : null)
  return {
    status: state.status,
    error: state.error,
    updatedAt: state.updatedAt,
    checkedAt: state.checkedAt,
    renewing: state.renewing,
    usage: u ? { fiveHour: w(u.fiveHour), weekly: w(u.weekly), extras: u.extras.map(e => ({ label: e.label, ...w(e) })) } : null,
  }
}

function sendState() {
  if (win && !win.isDestroyed()) win.webContents.send('state', serializable())
}

// Taskbar title, e.g. "Claude 42% · 18%", so it's readable even when minimized.
function windowTitle() {
  const u = state.usage
  if (!u) return 'Claude Usage Meter'
  const parts = [u.fiveHour, u.weekly].filter(Boolean).map(v => `${Math.round(v.percent)}%`)
  return parts.length ? `Claude ${parts.join(' · ')}` : 'Claude Usage Meter'
}

function render() {
  if (win && !win.isDestroyed()) win.setTitle(windowTitle())
  sendState()
}

// ---------- app ----------

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  // Launching it again just brings the existing window forward.
  app.on('second-instance', () => {
    if (!win) return createWindow()
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  })

  app.whenReady().then(() => {
    if (process.platform === 'win32') app.setAppUserModelId(APP_ID)
    loadConfig()
    applyLoginItem()
    createWindow()

    ipcMain.on('refresh', () => poll())
    ipcMain.on('open-usage-page', () => shell.openExternal(USAGE_PAGE))
    ipcMain.on('renew', () => renewSignIn())
    ipcMain.on('menu', () => showMenu())
    ipcMain.on('minimize', () => win && win.minimize())
    ipcMain.on('quit', () => app.quit())
    ipcMain.on('resize', (_e, height) => {
      if (!win) return
      const h = Math.max(120, Math.min(600, Math.round(Number(height) || 0)))
      const [, oldH] = win.getSize()
      if (h === oldH) return
      // Grow/shrink upward when it sits in the bottom half, so it stays in its corner.
      const [x, y] = win.getPosition()
      const wa = screen.getDisplayMatching(win.getBounds()).workArea
      const bottomHalf = y + oldH / 2 > wa.y + wa.height / 2
      win.setBounds(onScreen({ x, y: bottomHalf ? y + oldH - h : y, width: WIDTH, height: h }))
    })

    render()
    poll()

    // Testing hook: save a screenshot of the window, then quit.
    if (process.env.CUM_SCREENSHOT) {
      setTimeout(async () => {
        const img = await win.webContents.capturePage()
        fs.writeFileSync(process.env.CUM_SCREENSHOT, img.toPNG())
        console.log('STATE', JSON.stringify(serializable()))
        console.log('TITLE', JSON.stringify(windowTitle()))
        app.quit()
      }, 4000)
    }
  })

  app.on('window-all-closed', () => app.quit())
}
