'use strict'

// A small log file for troubleshooting ("Open log file" in the menu).
// Never pass tokens, cookies or other secrets to it.

const fs = require('fs')
const path = require('path')

const MAX_BYTES = 512 * 1024 // about a few weeks of checks; then the file starts over

function stamp(d) {
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/**
 * Appends "2026-10-20 14:03:22 INFO  message" lines (local time) to `file`.
 * When the file would pass maxBytes it's renamed to *.old.log (replacing the
 * previous one) and a fresh file is started. Logging never throws.
 */
function createLogger(file, { maxBytes = MAX_BYTES, now = () => new Date() } = {}) {
  const oldFile = file.replace(/\.log$/, '') + '.old.log'
  function write(level, msg) {
    const line = `${stamp(now())} ${level.padEnd(5)} ${msg}\n`
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      let size = 0
      try { size = fs.statSync(file).size } catch {}
      if (size > 0 && size + Buffer.byteLength(line) > maxBytes) fs.renameSync(file, oldFile)
      fs.appendFileSync(file, line)
    } catch {}
  }
  return {
    file,
    info: msg => write('INFO', msg),
    warn: msg => write('WARN', msg),
    error: msg => write('ERROR', msg),
  }
}

module.exports = { createLogger }
