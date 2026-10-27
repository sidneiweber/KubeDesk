import { describe, expect, it } from 'vitest'
import { toYaml } from './yaml'

const obj = {
  apiVersion: 'v1',
  kind: 'Service',
  metadata: {
    name: 'web',
    managedFields: [{ manager: 'kubectl', operation: 'Apply' }],
    annotations: { 'last-applied': '{"um":"json","bem":"comprido","que":"não deve quebrar em várias linhas no meio do valor"}' },
  },
  spec: { ports: [{ port: 80 }] },
}

describe('toYaml', () => {
  it('ordena as chaves como o kubectl e omite managedFields por padrão', () => {
    const y = toYaml(obj)
    expect(y.indexOf('apiVersion')).toBeLessThan(y.indexOf('kind'))
    expect(y.indexOf('kind')).toBeLessThan(y.indexOf('metadata'))
    expect(y.indexOf('annotations')).toBeLessThan(y.indexOf('name:'))
    expect(y).not.toContain('managedFields')
  })

  it('estilo do kubectl: aspas duplas e listas sem recuo extra', () => {
    const y = toYaml({ metadata: { resourceVersion: '123', finalizers: ['kubernetes'] } })
    expect(y).toBe('metadata:\n  finalizers:\n  - kubernetes\n  resourceVersion: "123"\n')
  })

  it('mostra managedFields quando pedido', () => {
    expect(toYaml(obj, true)).toContain('managedFields')
  })

  it('não altera o objeto original', () => {
    toYaml(obj)
    expect(obj.metadata.managedFields).toHaveLength(1)
  })

  it('não quebra strings longas', () => {
    const line = toYaml(obj).split('\n').find((l) => l.includes('last-applied'))
    expect(line).toContain('não deve quebrar em várias linhas no meio do valor')
  })
})
