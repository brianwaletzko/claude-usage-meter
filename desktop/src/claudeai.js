'use strict'

// Lets people who use claude.ai in a browser (and not Claude Code) sign in to
// claude.ai inside the app. The sign-in lives in its own persistent browser
// session, like a separate browser profile, and is only ever sent to claude.ai.
// Usage is read from the same endpoint claude.ai's own usage page uses.

const { BrowserWindow, session, shell } = require('electron')
const { pickOrg } = require('./usage')

const ORIGIN = 'https://claude.ai'
const PARTITION = 'persist:claudeai'
const SESSION_COOKIE = 'sessionKey'
const ORG_COOKIE = 'lastActiveOrg'
// Sign-in pages that may open in a popup (Google / Apple sign-in).
const SIGN_IN_HOSTS = /(^|\.)(claude\.ai|anthropic\.com|google\.com|apple\.com)$/

let ses = null
let loginWin = null

// A plain Chrome user agent. Some sign-in providers (Google in particular)
// refuse browsers that identify as Electron.
function browserUserAgent() {
  const platform = {
    win32: 'Windows NT 10.0; Win64; x64',
    darwin: 'Macintosh; Intel Mac OS X 10_15_7',
  }[process.platform] || 'X11; Linux x86_64'
  const chrome = process.versions.chrome.split('.')[0]
  return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome}.0.0.0 Safari/537.36`
}

function getSession() {
  if (!ses) {
    ses = session.fromPartition(PARTITION)
    ses.setUserAgent(browserUserAgent())
  }
  return ses
}

async function cookie(name) {
  const found = await getSession().cookies.get({ url: ORIGIN, name })
  return found.length ? found[0].value : null
}

async function isSignedIn() {
  return Boolean(await cookie(SESSION_COOKIE))
}

/** Opens the claude.ai sign-in window. Calls onSignedIn once signed in. */
function openSignIn(onSignedIn) {
  if (loginWin && !loginWin.isDestroyed()) {
    loginWin.show()
    loginWin.focus()
    return
  }
  const ses = getSession()
  loginWin = new BrowserWindow({
    width: 480,
    height: 720,
    title: 'Sign in to claude.ai',
    autoHideMenuBar: true,
    webPreferences: { partition: PARTITION, contextIsolation: true, nodeIntegration: false, sandbox: true },
  })

  let finished = false
  const finish = () => {
    if (finished) return
    finished = true
    if (loginWin && !loginWin.isDestroyed()) loginWin.close()
    onSignedIn()
  }
  const onCookie = (_e, c, _cause, removed) => {
    if (!removed && c.name === SESSION_COOKIE && /claude\.ai$/.test(c.domain.replace(/^\./, ''))) {
      setTimeout(finish, 1500) // let claude.ai finish setting up the session
    }
  }
  ses.cookies.on('changed', onCookie)

  // Already signed in (claude.ai redirects away from /login): done.
  loginWin.webContents.on('did-navigate', async (_e, url) => {
    if (url.startsWith(ORIGIN) && !/\/login/.test(url) && await isSignedIn()) finish()
  })

  // Allow sign-in popups; send any other link to the normal browser.
  loginWin.webContents.setWindowOpenHandler(({ url }) => {
    try {
      if (SIGN_IN_HOSTS.test(new URL(url).hostname)) return { action: 'allow' }
    } catch {}
    shell.openExternal(url)
    return { action: 'deny' }
  })

  loginWin.on('closed', () => {
    ses.cookies.removeListener('changed', onCookie)
    loginWin = null
  })
  loginWin.loadURL(`${ORIGIN}/login`)
}

async function signOut() {
  const ses = getSession()
  await ses.clearStorageData()
  await ses.clearCache()
}

function isJson(type) {
  return /application\/json/i.test(type || '')
}

// Normal request through the sign-in session (sends its cookies).
async function directGet(path) {
  const res = await getSession().fetch(ORIGIN + path, {
    headers: { Accept: 'application/json' },
    credentials: 'include',
  })
  return { status: res.status, type: res.headers.get('content-type'), body: await res.text() }
}

// Fallback when claude.ai's bot check answers a direct request with a
// challenge page: make the request from inside a real (hidden) claude.ai page.
async function pageGet(path) {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { partition: PARTITION, contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  try {
    try {
      await win.loadURL(`${ORIGIN}/robots.txt`)
    } catch {} // an error status still leaves a claude.ai page to run in
    // If a challenge page ("Just a moment...") loaded, give it up to 10s to clear.
    for (let i = 0; i < 20 && /just a moment/i.test(win.webContents.getTitle()); i++) {
      await new Promise(r => setTimeout(r, 500))
    }
    return await win.webContents.executeJavaScript(`
      fetch(${JSON.stringify(path)}, { headers: { Accept: 'application/json' }, credentials: 'include' })
        .then(async r => ({ status: r.status, type: r.headers.get('content-type'), body: await r.text() }))
    `)
  } finally {
    win.destroy()
  }
}

async function getJson(path) {
  let r = await directGet(path)
  if (!isJson(r.type) && (r.status === 403 || r.status === 503)) r = await pageGet(path)
  let json = null
  if (isJson(r.type)) {
    try { json = JSON.parse(r.body) } catch {}
  }
  return { status: r.status, json, challenged: !isJson(r.type) }
}

/**
 * Reads usage with the claude.ai sign-in. Returns
 *   { ok: true, json, orgId }  or  { ok: false, kind, detail? }
 * where kind is an error kind main.js knows how to show.
 */
async function fetchUsage(savedOrgId) {
  if (!(await isSignedIn())) return { ok: false, kind: 'web-signed-out' }

  let orgId = savedOrgId || (await cookie(ORG_COOKIE))
  let r
  if (orgId) {
    r = await getJson(`/api/organizations/${encodeURIComponent(orgId)}/usage`)
    // A saved org that no longer works: look it up again below.
    if (r.status === 403 || r.status === 404) orgId = null
  }
  if (!orgId) {
    const orgs = await getJson('/api/organizations')
    const bad = classify(orgs)
    if (bad) return bad
    orgId = pickOrg(orgs.json, await cookie(ORG_COOKIE))
    if (!orgId) return { ok: false, kind: 'web-no-org' }
    r = await getJson(`/api/organizations/${encodeURIComponent(orgId)}/usage`)
  }
  const bad = classify(r)
  if (bad) return bad
  return { ok: true, json: r.json, orgId }
}

function classify(r) {
  if (r.challenged) return { ok: false, kind: 'web-blocked', detail: `HTTP ${r.status}` }
  if (r.status === 401 || r.status === 403) return { ok: false, kind: 'web-signed-out' }
  if (r.status === 429) return { ok: false, kind: 'ratelimit' }
  if (r.status < 200 || r.status >= 300 || !r.json) return { ok: false, kind: 'http', detail: `HTTP ${r.status}` }
  return null
}

module.exports = { isSignedIn, openSignIn, signOut, fetchUsage }
