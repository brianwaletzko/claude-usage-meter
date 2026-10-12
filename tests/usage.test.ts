import { describe, expect, test } from 'claude-code/testing'
import { line } from '../hooks/register'

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
