import type { EngineInterface, Register, SessionRateLimit } from 'claude-code'

const LABELS: Record<string, string> = { five_hour: '5h', seven_day: 'Week' }
const THRESHOLDS = [50, 75, 90]

export function resetTime(iso: string | undefined): string {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  try {
    return new Date(t).toLocaleString('en-US', {
      timeZone: 'America/Chicago',
      weekday: 'short',
      hour: 'numeric',
      minute: '2-digit',
    })
  } catch {
    return new Date(t).toISOString().slice(11, 16) + ' UTC'
  }
}

export function line(limits: SessionRateLimit[]): string | undefined {
  const parts = limits
    .filter(l => l.kind in LABELS)
    .map(l => {
      const reset = resetTime(l.resetsAt)
      return `${LABELS[l.kind]}: ${Math.round(l.percentUsed)}%${reset ? ` (resets ${reset})` : ''}`
    })
  return parts.length ? `Usage · ${parts.join(' · ')}` : undefined
}

// Claude Code's reported reset time can wobble by a second or so between
// readings, so reset times this close together count as the same window.
// Real windows are hours or days apart.
const SAME_WINDOW_MS = 10 * 60 * 1000

export function sameWindow(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return a === b
  const ta = Date.parse(a)
  const tb = Date.parse(b)
  if (Number.isNaN(ta) || Number.isNaN(tb)) return a === b
  return Math.abs(ta - tb) < SAME_WINDOW_MS
}

export type Announced = { resetsAt?: string; level: number }

/**
 * Decides whether a reading crosses a new threshold in its window.
 * Returns the bookkeeping to keep, and the threshold to toast (if any).
 * No toast for the first reading of a session, only for crossings seen live.
 */
export function check(prev: Announced | undefined, l: SessionRateLimit): { next: Announced; toast?: number } {
  const level = prev && sameWindow(prev.resetsAt, l.resetsAt) ? prev.level : 0
  const crossed = THRESHOLDS.filter(t => l.percentUsed >= t && t > level)
  const top = crossed[crossed.length - 1]
  return { next: { resetsAt: l.resetsAt, level: top ?? level }, toast: prev !== undefined ? top : undefined }
}

// Highest threshold already announced per window.
const announced = new Map<string, Announced>()

function show($: EngineInterface, limits: SessionRateLimit[]): void {
  $.ui.status(line(limits))
  for (const l of limits) {
    if (!(l.kind in LABELS)) continue
    const { next, toast } = check(announced.get(l.kind), l)
    announced.set(l.kind, next)
    if (toast !== undefined) {
      const reset = resetTime(l.resetsAt)
      $.ui.toast(
        `${LABELS[l.kind]} window at ${Math.round(l.percentUsed)}%${reset ? ` — resets ${reset}` : ''}`,
        { timeoutMs: 8000 },
      )
    }
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    const { rateLimits } = await $.session.usage()
    if (rateLimits.length) show($, rateLimits)
    else $.ui.status('Usage · waiting for first reading')
    return r
  })

  on('session.measure', ($, e, next) => {
    if (e.changed.includes('rateLimits')) show($, e.rateLimits)
    return next(e)
  })
}
