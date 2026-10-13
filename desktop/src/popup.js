'use strict'

let last = null

const $ = id => document.getElementById(id)

function level(p) {
  if (p >= 90) return 'high'
  if (p >= 75) return 'warn'
  return 'ok'
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function clock(d, now) {
  const t = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  return sameDay(d, now) ? t : `${d.toLocaleDateString('en-US', { weekday: 'short' })} ${t}`
}

function relative(d, now) {
  let mins = Math.round((d - now) / 60000)
  if (mins <= 0) return 'now'
  const days = Math.floor(mins / 1440)
  mins -= days * 1440
  const h = Math.floor(mins / 60)
  const m = mins - h * 60
  if (days > 0) return `in ${days}d ${h}h`
  if (h > 0) return `in ${h}h ${m}m`
  return `in ${m}m`
}

function ago(ms, now) {
  const mins = Math.floor((now - ms) / 60000)
  if (mins < 1) return 'Updated just now'
  if (mins < 60) return `Updated ${mins}m ago`
  return `Updated ${Math.floor(mins / 60)}h ago`
}

function row(label, win, extra, now) {
  const el = document.createElement('div')
  const pct = Math.round(win.percent)
  el.className = `row ${level(win.percent)}${extra ? ' extra' : ''}`
  const resets = win.resetsAt ? new Date(win.resetsAt) : null
  const sub = resets ? `Resets ${clock(resets, now)} · ${relative(resets, now)}` : 'No reset time reported'
  el.innerHTML = `
    <div class="top"><span class="label"></span><span class="pct">${pct}<small>%</small></span></div>
    <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><div class="fill" style="width:${Math.min(100, win.percent)}%"></div></div>
    <div class="sub"></div>`
  el.querySelector('.label').textContent = label
  el.querySelector('.bar').setAttribute('aria-label', `${label} ${pct}% used`)
  el.querySelector('.sub').textContent = sub
  return el
}

function draw() {
  const s = last
  if (!s) return
  const now = new Date()
  const rows = $('rows')
  rows.replaceChildren()

  if (s.usage) {
    if (s.usage.fiveHour) rows.append(row('5-hour window', s.usage.fiveHour, false, now))
    if (s.usage.weekly) rows.append(row('Weekly limit', s.usage.weekly, false, now))
    for (const e of s.usage.extras || []) rows.append(row(e.label, e, true, now))
  } else {
    const d = document.createElement('div')
    d.className = 'empty'
    d.textContent = s.status === 'loading' ? 'Checking your usage…' : 'No usage to show yet.'
    rows.append(d)
  }

  $('updated').textContent = s.updatedAt ? ago(s.updatedAt, now) : ''

  const showBanner = s.status === 'error' && s.error
  $('banner').hidden = !showBanner
  if (showBanner) {
    $('banner-text').textContent = s.usage ? `${s.error.message} Showing the last reading.` : s.error.message
    const canRenew = ['expired', 'auth'].includes(s.error.kind)
    $('renew').hidden = !canRenew
    $('renew').disabled = Boolean(s.renewing)
    $('renew').textContent = s.renewing ? 'Renewing…' : 'Renew sign-in'
  }

  requestAnimationFrame(() => window.meter.resize(document.documentElement.scrollHeight))
}

window.meter.onState(s => {
  last = s
  draw()
})

$('refresh').addEventListener('click', () => window.meter.refresh())
$('open').addEventListener('click', () => window.meter.openUsagePage())
$('renew').addEventListener('click', () => window.meter.renew())
$('menu').addEventListener('click', () => window.meter.menu())
$('minimize').addEventListener('click', () => window.meter.minimize())
$('close').addEventListener('click', () => window.meter.quit())
document.addEventListener('contextmenu', e => {
  e.preventDefault()
  window.meter.menu()
})

// Keep "in 2h 14m" and "Updated 3m ago" current between polls.
setInterval(draw, 30_000)
