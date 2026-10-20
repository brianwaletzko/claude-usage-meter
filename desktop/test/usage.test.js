'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const U = require('../src/usage')
const { readCredentials, isExpired, credentialPaths } = require('../src/credentials')

const SAMPLE = {
  five_hour: { utilization: 42.4, resets_at: '2026-10-12T20:15:00Z' },
  seven_day: { utilization: 18, resets_at: '2026-10-15T14:00:00Z' },
  seven_day_opus: { utilization: 31, resets_at: '2026-10-15T14:00:00Z' },
  seven_day_sonnet: null,
}

test('parses both windows and model-scoped extras', () => {
  const u = U.parseUsage(SAMPLE)
  assert.equal(u.fiveHour.percent, 42.4)
  assert.equal(u.weekly.percent, 18)
  assert.equal(u.fiveHour.resetsAt.toISOString(), '2026-10-12T20:15:00.000Z')
  assert.deepEqual(u.extras.map(e => e.label), ['Weekly · Opus'])
})

test('reads the limits array without duplicating flat keys', () => {
  const u = U.parseUsage({
    ...SAMPLE,
    limits: [
      { kind: 'weekly_all', percent: 18 },
      { kind: 'weekly_scoped', percent: 31, scope: { model: { display_name: 'Opus' } } },
      { kind: 'weekly_scoped', percent: 3, resets_at: null, scope: { model: { display_name: 'Fable' } } },
    ],
  })
  assert.deepEqual(u.extras.map(e => [e.label, e.percent]), [['Weekly · Opus', 31], ['Weekly · Fable', 3]])
  assert.equal(u.extras[1].resetsAt.toISOString(), '2026-10-15T14:00:00.000Z') // falls back to weekly reset
})

test('tolerates missing windows but rejects empty responses', () => {
  const u = U.parseUsage({ five_hour: { utilization: 0, resets_at: null } })
  assert.equal(u.fiveHour.percent, 0)
  assert.equal(u.fiveHour.resetsAt, null)
  assert.equal(u.weekly, null)
  assert.throws(() => U.parseUsage({}), /no usage values/)
  assert.throws(() => U.parseUsage(null), /invalid response/)
})

test('levels match the alert thresholds', () => {
  assert.equal(U.level(74.9), 'ok')
  assert.equal(U.level(75), 'warn')
  assert.equal(U.level(90), 'high')
})

test('relative time formatting', () => {
  const now = new Date('2026-10-12T18:00:00Z')
  assert.equal(U.formatRelative(new Date('2026-10-12T20:14:00Z'), now), 'in 2h 14m')
  assert.equal(U.formatRelative(new Date('2026-10-12T18:12:00Z'), now), 'in 12m')
  assert.equal(U.formatRelative(new Date('2026-10-15T22:00:00Z'), now), 'in 3d 4h')
  assert.equal(U.formatRelative(new Date('2026-10-12T17:00:00Z'), now), 'now')
})

test('clock shows time today and weekday otherwise', () => {
  const now = new Date(2026, 9, 12, 13, 0) // local time
  assert.equal(U.formatClock(new Date(2026, 9, 12, 15, 15), now), '3:15 PM')
  assert.equal(U.formatClock(new Date(2026, 9, 15, 9, 0), now), 'Thu 9:00 AM')
})

test('tooltip stays under the Windows 127-char cap', () => {
  const t = U.tooltip(U.parseUsage(SAMPLE))
  assert.ok(t.startsWith('Claude usage\n5-hour: 42%'))
  assert.ok(t.length <= 127)
})

test('alerts fire once per threshold per window, and re-arm on a new window', () => {
  const w = p => ({ percent: p, resetsAt: new Date('2026-10-12T20:15:00Z') })
  let r = U.checkAlert({}, 'fiveHour', w(50))
  assert.equal(r.fire, null)
  r = U.checkAlert(r.seen, 'fiveHour', w(76))
  assert.equal(r.fire, 75)
  r = U.checkAlert(r.seen, 'fiveHour', w(80))
  assert.equal(r.fire, null)
  r = U.checkAlert(r.seen, 'fiveHour', w(95))
  assert.equal(r.fire, 90)
  r = U.checkAlert(r.seen, 'fiveHour', w(99))
  assert.equal(r.fire, null)
  // Jumping straight past both thresholds raises only the higher one.
  r = U.checkAlert({}, 'weekly', w(93))
  assert.equal(r.fire, 90)
  // New window (different reset time) starts over.
  r = U.checkAlert(r.seen, 'weekly', { percent: 80, resetsAt: new Date('2026-10-19T14:00:00Z') })
  assert.equal(r.fire, 75)
})

test('backoff grows on failures and respects rate limits', () => {
  const base = 5 * 60 * 1000
  assert.equal(U.nextDelay(base, 0, null), base)
  assert.equal(U.nextDelay(base, 1, 'network'), base * 2)
  assert.equal(U.nextDelay(base, 9, 'network'), 30 * 60 * 1000)
  assert.equal(U.nextDelay(base, 1, 'ratelimit'), 10 * 60 * 1000)
})

test('reads Claude Code credentials file', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cum-'))
  assert.deepEqual(readCredentials({}, home), { ok: false, reason: 'not-found' })
  fs.mkdirSync(path.join(home, '.claude'))
  const file = path.join(home, '.claude', '.credentials.json')
  fs.writeFileSync(file, JSON.stringify({ claudeAiOauth: { accessToken: 'tok', expiresAt: 2_000_000_000_000 } }))
  const c = readCredentials({}, home)
  assert.equal(c.ok, true)
  assert.equal(c.token, 'tok')
  assert.equal(isExpired(c, 1_000), false)
  assert.equal(isExpired(c, 2_000_000_000_000), true)
  fs.writeFileSync(file, JSON.stringify({ primaryApiKey: 'x' }))
  assert.equal(readCredentials({}, home).reason, 'no-oauth')
  fs.writeFileSync(file, '{not json')
  assert.equal(readCredentials({}, home).reason, 'unreadable')
})

test('env token and CLAUDE_CONFIG_DIR are honored', () => {
  assert.equal(readCredentials({ CLAUDE_CODE_OAUTH_TOKEN: ' abc ' }, '/nowhere').token, 'abc')
  assert.equal(credentialPaths({ CLAUDE_CONFIG_DIR: '/cfg' }, '/home/x')[0], path.join('/cfg', '.credentials.json'))
})

test('chooses Claude Code when it works, claude.ai otherwise', () => {
  const good = { ok: true, expired: false }
  const expired = { ok: true, expired: true }
  const missing = { ok: false }
  assert.equal(U.chooseSource('auto', good, true), 'code')
  assert.equal(U.chooseSource('auto', expired, true), 'web')
  assert.equal(U.chooseSource('auto', missing, true), 'web')
  assert.equal(U.chooseSource('auto', missing, false), 'code') // shows the Claude Code error
  assert.equal(U.chooseSource('claude-ai', good, false), 'web')
  assert.equal(U.chooseSource('claude-code', missing, true), 'code')
})

test('picks the preferred organization, then one that can chat', () => {
  const orgs = [
    { uuid: 'api-org', capabilities: ['api'] },
    { uuid: 'chat-org', capabilities: ['chat', 'claude_pro'] },
  ]
  assert.equal(U.pickOrg(orgs, 'api-org'), 'api-org')
  assert.equal(U.pickOrg(orgs, 'gone'), 'chat-org')
  assert.equal(U.pickOrg(orgs, null), 'chat-org')
  assert.equal(U.pickOrg([{ uuid: 'only' }], null), 'only')
  assert.equal(U.pickOrg([], null), null)
  assert.equal(U.pickOrg({ error: 'nope' }, null), null)
})

test('pace: time elapsed and projection through the week', () => {
  const week = U.WINDOW_MS.weekly
  const now = new Date('2026-10-12T12:00:00Z')
  const resetsIn = ms => new Date(now.getTime() + ms)

  // Halfway through the week, 30% used: on pace for ~60%.
  let p = U.pace({ percent: 30, resetsAt: resetsIn(week / 2) }, week, now)
  assert.equal(p.elapsed, 50)
  assert.equal(p.projected, 60)
  assert.equal(p.runsOutAt, null)

  // Quarter of the way through, 50% used: runs out at the halfway point.
  p = U.pace({ percent: 50, resetsAt: resetsIn(week * 0.75) }, week, now)
  assert.equal(p.elapsed, 25)
  assert.equal(p.projected, 200)
  assert.equal(p.runsOutAt.toISOString(), resetsIn(week * 0.25).toISOString())

  // Too early to project, but elapsed is still reported.
  p = U.pace({ percent: 4, resetsAt: resetsIn(week * 0.99) }, week, now)
  assert.equal(p.elapsed, 1)
  assert.equal(p.projected, null)

  // Already at the limit: no "runs out" time.
  p = U.pace({ percent: 100, resetsAt: resetsIn(week / 2) }, week, now)
  assert.equal(p.runsOutAt, null)
})

test('pace: gives up on missing or inconsistent reset times', () => {
  const h5 = U.WINDOW_MS.fiveHour
  const now = new Date('2026-10-12T12:00:00Z')
  assert.equal(U.pace({ percent: 10, resetsAt: null }, h5, now), null)
  assert.equal(U.pace({ percent: 10, resetsAt: new Date(now.getTime() - 1000) }, h5, now), null)
  assert.equal(U.pace({ percent: 10, resetsAt: new Date(now.getTime() + 6 * 3600e3) }, h5, now), null)
  assert.equal(U.pace(null, h5, now), null)
})

test('alerts: a reset time that wobbles by a second is still the same window', () => {
  const at = (iso, percent) => ({ percent, resetsAt: new Date(iso) })
  let r = U.checkAlert({}, 'fiveHour', at('2026-10-13T03:29:59.659Z', 80))
  assert.equal(r.fire, 75)
  r = U.checkAlert(r.seen, 'fiveHour', at('2026-10-13T03:30:00.642Z', 81)) // same window, new timestamp
  assert.equal(r.fire, null)
  r = U.checkAlert(r.seen, 'fiveHour', at('2026-10-13T08:30:00.000Z', 80)) // next window: fires again
  assert.equal(r.fire, 75)
})

test('log file: local-time lines, and starts over when it gets too big', () => {
  const { createLogger } = require('../src/log')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cum-log-'))
  const file = path.join(dir, 'meter.log')
  const log = createLogger(file, { maxBytes: 200, now: () => new Date(2026, 9, 20, 14, 3, 22) })
  log.info('started')
  assert.equal(fs.readFileSync(file, 'utf8'), '2026-10-20 14:03:22 INFO  started\n')
  for (let i = 0; i < 10; i++) log.warn(`check ${i} failed`)
  assert.ok(fs.statSync(file).size <= 200)
  assert.ok(fs.existsSync(path.join(dir, 'meter.old.log')))
  assert.match(fs.readFileSync(file, 'utf8'), /WARN  check 9 failed\n$/)
  fs.rmSync(dir, { recursive: true, force: true })
})
