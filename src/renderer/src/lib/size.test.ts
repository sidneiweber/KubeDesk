import { describe, expect, it } from 'vitest'
import { formatBytes } from './size'

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [1023, '1023 B'],
    [1024, '1 KiB'],
    [1536, '1.5 KiB'],
    [5 * 2 ** 20, '5 MiB'],
    [3 * 2 ** 30, '3 GiB'],
  ])('%d -> %s', (n, expected) => expect(formatBytes(n)).toBe(expected))
})
