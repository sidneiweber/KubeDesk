import { describe, expect, it } from 'vitest'
import { formatAge } from './formatAge'

const now = Date.UTC(2026, 9, 27, 12, 0, 0)
const ago = (ms: number) => now - ms
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

describe('formatAge', () => {
  it.each([
    [ago(42_000), '42s'],
    [ago(5 * MIN + 10_000), '5m'],
    [ago(5 * HOUR + 30 * MIN), '5h 30m'],
    [ago(3 * DAY + 4 * HOUR + 10 * MIN), '3d 4h'],
  ])('%i -> %s', (created, expected) => {
    expect(formatAge(created, now)).toBe(expected)
  })

  it('sem data ou no futuro mostra "-"', () => {
    expect(formatAge(0, now)).toBe('-')
    expect(formatAge(now + 1000, now)).toBe('-')
  })
})
