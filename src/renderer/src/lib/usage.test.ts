import { describe, expect, it } from 'vitest'
import { formatCpu, formatMemory, usageView } from './usage'

describe('formato do kubectl top', () => {
  it('CPU em milicores', () => {
    expect(formatCpu(12.4)).toBe('12m')
    expect(formatCpu(1250)).toBe('1250m')
  })
  it('memória em Mi, Gi acima de 1024Mi', () => {
    expect(formatMemory(50 * 2 ** 20)).toBe('50Mi')
    expect(formatMemory(2 * 2 ** 30)).toBe('2Gi')
    expect(formatMemory(1.5 * 2 ** 30)).toBe('1.5Gi')
  })
})

describe('usageView', () => {
  it('mede contra o limit quando existe', () => {
    expect(usageView(450, 100, 500, formatCpu)).toMatchObject({ percent: 90, of: 'limit', level: 'high' })
    expect(usageView(360, 100, 500, formatCpu)).toMatchObject({ percent: 72, level: 'warn' })
  })
  it('sem limit, mede contra o request sem acusar problema ao passar dele', () => {
    expect(usageView(300, 100, null, formatCpu)).toMatchObject({ percent: 300, of: 'request', level: 'neutral' })
  })
  it('sem referência, só o valor', () => {
    expect(usageView(5, null, null, formatCpu)).toMatchObject({ text: '5m', percent: null, of: null })
  })
})
