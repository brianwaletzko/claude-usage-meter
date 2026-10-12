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

// Highest threshold already announced per window, keyed by its reset time
// so a fresh window starts announcing again.
const announced = new Map<string, { resetsAt?: string; level: number }>()

function show($: EngineInterface, limits: SessionRateLimit[]): void {
  $.ui.status(line(limits))
  for (const l of limits) {
    if (!(l.kind in LABELS)) continue
    const prev = announced.get(l.kind)
    const level = prev && prev.resetsAt === l.resetsAt ? prev.level : 0
    const crossed = THRESHOLDS.filter(t => l.percentUsed >= t && t > level)
    const top = crossed[crossed.length - 1]
    announced.set(l.kind, { resetsAt: l.resetsAt, level: top ?? level })
    if (top !== undefined && prev !== undefined) {
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
