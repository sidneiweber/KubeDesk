import { describe, expect, it } from 'vitest'
import { cpuMillicores, memoryBytes, parseQuantity, sumResources } from './quantity'

describe('quantidades', () => {
  it.each<[string, number]>([
    ['250m', 250],
    ['1', 1000],
    ['0.5', 500],
    ['1500000n', 1.5],
    ['100u', 0.1],
    ['2k', 2_000_000],
  ])('CPU %s = %d milicores', (q, m) => {
    expect(cpuMillicores(q)).toBeCloseTo(m)
  })

  it.each<[string, number]>([
    ['128Mi', 128 * 2 ** 20],
    ['1Gi', 2 ** 30],
    ['500M', 500e6],
    ['1e3', 1000],
    ['123456', 123456],
    ['64Ki', 65536],
  ])('memória %s = %d bytes', (q, b) => {
    expect(memoryBytes(q)).toBe(b)
  })

  it('valor ilegível vira null, não 0', () => {
    expect(parseQuantity('muito')).toBeNull()
    expect(parseQuantity('12XB')).toBeNull()
    expect(parseQuantity(undefined)).toBeNull()
  })
})

describe('sumResources', () => {
  it('limit: um container sem limit tira o teto do pod inteiro', () => {
    expect(sumResources([500, null], 'limit')).toBeNull()
    expect(sumResources([500, 250], 'limit')).toBe(750)
  })

  it('request: ausente conta como 0, mas nenhum pedido é null', () => {
    expect(sumResources([100, null], 'request')).toBe(100)
    expect(sumResources([null, null], 'request')).toBeNull()
  })
})
