'use strict'

// Reads the sign-in Claude Code already saved on this computer.
// We only READ it. We never refresh, rotate or write credentials, because
// doing so could sign Claude Code itself out.

const fs = require('fs')
const os = require('os')
const path = require('path')

function credentialPaths(env = process.env, home = os.homedir()) {
  const paths = []
  if (env.CLAUDE_CONFIG_DIR) paths.push(path.join(env.CLAUDE_CONFIG_DIR, '.credentials.json'))
  paths.push(path.join(home, '.claude', '.credentials.json'))
  return paths
}

/**
 * Returns one of:
 *   { ok: true, token, expiresAt (ms|null), source }
 *   { ok: false, reason: 'not-found' | 'no-oauth' | 'unreadable', path? }
 */
function readCredentials(env = process.env, home = os.homedir()) {
  if (env.CLAUDE_CODE_OAUTH_TOKEN && env.CLAUDE_CODE_OAUTH_TOKEN.trim()) {
    return { ok: true, token: env.CLAUDE_CODE_OAUTH_TOKEN.trim(), expiresAt: null, source: 'env' }
  }
  for (const p of credentialPaths(env, home)) {
    let text
    try {
      text = fs.readFileSync(p, 'utf8')
    } catch {
      continue
    }
    try {
      const json = JSON.parse(text)
      const oauth = json && json.claudeAiOauth
      if (!oauth || typeof oauth.accessToken !== 'string' || !oauth.accessToken) {
        return { ok: false, reason: 'no-oauth', path: p }
      }
      const exp = Number(oauth.expiresAt)
      return {
        ok: true,
        token: oauth.accessToken,
        expiresAt: Number.isFinite(exp) && exp > 0 ? exp : null,
        source: p,
      }
    } catch {
      return { ok: false, reason: 'unreadable', path: p }
    }
  }
  return { ok: false, reason: 'not-found' }
}

function isExpired(creds, now = Date.now(), skewMs = 60_000) {
  return Boolean(creds && creds.ok && creds.expiresAt && now >= creds.expiresAt - skewMs)
}

module.exports = { credentialPaths, readCredentials, isExpired }
