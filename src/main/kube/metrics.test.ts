import { describe, expect, it } from 'vitest'
import { toPodUsage, unavailableReason } from './metrics'

describe('métricas', () => {
  it('soma os containers de cada pod e usa namespace/nome como chave', () => {
    const usage = toPodUsage({
      items: [{
        metadata: { name: 'web', namespace: 'prod' },
        containers: [{ usage: { cpu: '12500000n', memory: '20Mi' } }, { usage: { cpu: '3m', memory: '1024Ki' } }],
      }],
    })
    expect(usage).toHaveLength(1)
    expect(usage[0].key).toBe('prod/web')
    expect(usage[0].cpu).toBeCloseTo(15.5)
    expect(usage[0].memory).toBe(21 * 2 ** 20)
  })

  it.each<[number, RegExp]>([
    [404, /metrics-server não encontrado/],
    [503, /metrics-server não encontrado/],
    [403, /sem permissão/],
  ])('HTTP %d tem motivo legível', (code, re) => {
    expect(unavailableReason({ code, body: '' })).toMatch(re)
  })
})
