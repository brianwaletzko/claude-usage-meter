'use strict'

// Pure logic: parse the usage response, format times, decide alerts.
// No Electron imports here so it can be unit-tested with plain Node.

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const BETA_HEADER = 'oauth-2025-04-20'
const ALERT_THRESHOLDS = [75, 90]

function toPercent(v) {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return null
  return Math.max(0, Math.round(n * 10) / 10)
}

function toDate(v) {
  if (!v) return null
  const t = Date.parse(v)
  return Number.isNaN(t) ? null : new Date(t)
}

function readWindow(raw) {
  if (!raw || typeof raw !== 'object') return null
  const percent = toPercent(raw.utilization)
  if (percent === null) return null
  return { percent, resetsAt: toDate(raw.resets_at) }
}

function titleCase(s) {
  return s.replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

/**
 * Turns the endpoint's JSON into { fiveHour, weekly, extras[] }.
 * fiveHour / weekly are { percent, resetsAt } or null.
 * extras are model-scoped weekly pools (e.g. "Weekly · Opus") when present.
 */
function parseUsage(data) {
  if (!data || typeof data !== 'object') throw new Error('invalid response')
  const fiveHour = readWindow(data.five_hour)
  const weekly = readWindow(data.seven_day)
  const extras = []
  const seen = new Set()

  for (const [key, value] of Object.entries(data)) {
    const m = /^seven_day_(.+)$/.exec(key)
    if (!m) continue
    const w = readWindow(value)
    if (!w) continue
    const label = titleCase(m[1])
    seen.add(label.toLowerCase())
    extras.push({ label: `Weekly · ${label}`, ...w })
  }

  if (Array.isArray(data.limits)) {
    for (const item of data.limits) {
      if (!item || typeof item !== 'object') continue
      const model = item.scope && item.scope.model && item.scope.model.display_name
      if (!model || seen.has(String(model).toLowerCase())) continue
      const percent = toPercent(item.percent ?? item.utilization)
      if (percent === null) continue
      seen.add(String(model).toLowerCase())
      extras.push({
        label: `Weekly · ${model}`,
        percent,
        resetsAt: toDate(item.resets_at) || (weekly && weekly.resetsAt) || null,
      })
    }
  }

  if (!fiveHour && !weekly && extras.length === 0) throw new Error('no usage values')
  return { fiveHour, weekly, extras }
}

function level(percent) {
  if (percent >= 90) return 'high'
  if (percent >= 75) return 'warn'
  return 'ok'
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

/** "3:15 PM" today, otherwise "Thu 9:00 AM". Uses the computer's time zone. */
function formatClock(date, now = new Date()) {
  if (!date) return ''
  const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  if (sameDay(date, now)) return time
  const day = date.toLocaleDateString('en-US', { weekday: 'short' })
  return `${day} ${time}`
}

/** "in 2h 14m", "in 3d 4h", "in 12m", "now". */
function formatRelative(date, now = new Date()) {
  if (!date) return ''
  let mins = Math.round((date.getTime() - now.getTime()) / 60000)
  if (mins <= 0) return 'now'
  const d = Math.floor(mins / 1440)
  mins -= d * 1440
  const h = Math.floor(mins / 60)
  const m = mins - h * 60
  if (d > 0) return `in ${d}d ${h}h`
  if (h > 0) return `in ${h}h ${m}m`
  return `in ${m}m`
}

function short(p) {
  return `${Math.round(p)}%`
}

/** Windows caps tray tooltips at 127 characters, so keep this compact. */
function tooltip(usage, now = new Date()) {
  const lines = ['Claude usage']
  if (usage.fiveHour) {
    lines.push(`5-hour: ${short(usage.fiveHour.percent)} (resets ${formatClock(usage.fiveHour.resetsAt, now)})`)
  }
  if (usage.weekly) {
    lines.push(`Weekly: ${short(usage.weekly.percent)} (resets ${formatClock(usage.weekly.resetsAt, now)})`)
  }
  return lines.join('\n').slice(0, 127)
}

/**
 * Decides which alert (if any) to raise for one window.
 * `seen` is { [windowKey]: { resetsAt: iso|null, level: number } } and is
 * returned updated; persist it so restarts don't repeat alerts.
 * Returns { seen, fire } where fire is the threshold crossed, or null.
 */
function checkAlert(seen, key, win, thresholds = ALERT_THRESHOLDS) {
  const next = { ...seen }
  if (!win) return { seen: next, fire: null }
  const resetIso = win.resetsAt ? win.resetsAt.toISOString() : null
  const prev = next[key]
  const prevLevel = prev && prev.resetsAt === resetIso ? prev.level : 0
  const crossed = thresholds.filter(t => win.percent >= t && t > prevLevel)
  const top = crossed.length ? crossed[crossed.length - 1] : null
  next[key] = { resetsAt: resetIso, level: top ?? prevLevel }
  return { seen: next, fire: top }
}

/**
 * Which sign-in to read usage with: 'code' (Claude Code's saved token) or
 * 'web' (the claude.ai sign-in made inside the app).
 * pref is 'auto' | 'claude-code' | 'claude-ai'. In auto, a working Claude Code
 * sign-in wins; otherwise claude.ai is used if signed in; otherwise 'code', so
 * its error (e.g. "sign-in not found") is what gets shown.
 */
function chooseSource(pref, code, webSignedIn) {
  if (pref === 'claude-code') return 'code'
  if (pref === 'claude-ai') return 'web'
  if (code && code.ok && !code.expired) return 'code'
  return webSignedIn ? 'web' : 'code'
}

/**
 * Picks the organization whose usage to show from claude.ai's
 * /api/organizations list: the preferred one (the account's last active org)
 * if present, else the first that can chat, else the first. Returns its uuid.
 */
function pickOrg(orgs, preferredId) {
  if (!Array.isArray(orgs)) return null
  const valid = orgs.filter(o => o && typeof o.uuid === 'string' && o.uuid)
  const preferred = preferredId && valid.find(o => o.uuid === preferredId)
  if (preferred) return preferred.uuid
  const chat = valid.find(o => Array.isArray(o.capabilities) && o.capabilities.includes('chat'))
  return (chat || valid[0] || {}).uuid || null
}

const WINDOW_MS = { fiveHour: 5 * 3600 * 1000, weekly: 7 * 24 * 3600 * 1000 }
const MIN_ELAPSED_TO_PROJECT = 0.1 // projections from the first few minutes are noise

/**
 * How far through its window a usage window is, and where usage is heading.
 * Returns null when it can't tell (no reset time yet, or odd data), else
 *   { elapsed: 0–100 (% of the window gone),
 *     projected: % used by reset at the current rate, or null if too early,
 *     runsOutAt: Date the limit would be hit at the current rate, if before reset }
 */
function pace(win, windowMs, now = new Date()) {
  if (!win || !win.resetsAt || !windowMs) return null
  const left = win.resetsAt.getTime() - now.getTime()
  if (left <= 0 || left > windowMs) return null
  const fraction = (windowMs - left) / windowMs
  const out = { elapsed: Math.round(fraction * 1000) / 10, projected: null, runsOutAt: null }
  if (fraction < MIN_ELAPSED_TO_PROJECT) return out
  out.projected = Math.round(win.percent / fraction)
  if (win.percent > 0 && win.percent < 100 && out.projected >= 100) {
    const start = win.resetsAt.getTime() - windowMs
    out.runsOutAt = new Date(start + (now.getTime() - start) * (100 / win.percent))
  }
  return out
}

/** Milliseconds to wait before the next poll, with backoff on errors. */
function nextDelay(baseMs, failures, kind) {
  if (kind === 'ratelimit') return Math.max(baseMs, 10 * 60 * 1000)
  if (failures <= 0) return baseMs
  return Math.min(baseMs * 2 ** Math.min(failures, 4), 30 * 60 * 1000)
}

module.exports = {
  USAGE_URL,
  BETA_HEADER,
  ALERT_THRESHOLDS,
  parseUsage,
  level,
  formatClock,
  formatRelative,
  tooltip,
  checkAlert,
  nextDelay,
  chooseSource,
  pickOrg,
  WINDOW_MS,
  pace,
}
