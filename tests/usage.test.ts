import { describe, expect, test } from 'claude-code/testing'
import { check, line, sameWindow } from '../hooks/register'

describe('usage-meter line', () => {
  test('formats both windows', async () => {
    const s = line([
      { kind: 'five_hour', percentUsed: 42.4, resetsAt: '2026-10-11T20:15:00Z' },
      { kind: 'seven_day', percentUsed: 18, resetsAt: '2026-10-15T14:00:00Z' },
    ])
    expect(s).toContain('5h: 42%')
    expect(s).toContain('Week: 18%')
    expect(s).toContain('3:15')
  })

  test('nothing to show off a subscription', async () => {
    expect(line([])).toBeUndefined()
  })
})

describe('usage-meter toasts', () => {
  const at = (resetsAt: string, percentUsed: number) => ({ kind: 'five_hour', percentUsed, resetsAt })

  test('a reset time that wobbles by a second is the same window', async () => {
    expect(sameWindow('2026-10-13T03:29:59.659Z', '2026-10-13T03:30:00.642Z')).toBe(true)
    expect(sameWindow('2026-10-13T03:30:00Z', '2026-10-13T08:30:00Z')).toBe(false)
    expect(sameWindow(undefined, undefined)).toBe(true)
    expect(sameWindow(undefined, '2026-10-13T03:30:00Z')).toBe(false)
  })

  test('each threshold toasts once per window, even when the reset time wobbles', async () => {
    let r = check(undefined, at('2026-10-13T03:29:59.659Z', 40)) // first reading: no toast
    expect(r.toast).toBeUndefined()
    r = check(r.next, at('2026-10-13T03:30:00.100Z', 52))
    expect(r.toast).toBe(50)
    r = check(r.next, at('2026-10-13T03:30:00.642Z', 53)) // same window, new timestamp
    expect(r.toast).toBeUndefined()
    r = check(r.next, at('2026-10-13T08:30:00.000Z', 55)) // next window starts over
    expect(r.toast).toBe(50)
  })
})
