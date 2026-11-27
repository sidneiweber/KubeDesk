import { describe, expect, it } from 'vitest'
import { eventTarget, podClass, problems, tally } from './overview'

describe('overview', () => {
  it('saúde: falha > pendente > ok; vazio é neutro', () => {
    expect(tally([]).health).toBe('empty')
    expect(tally([{ statusClass: 'running' }, { statusClass: 'succeeded' }])).toMatchObject({ total: 2, ok: 1, other: 1, health: 'ok' })
    expect(tally([{ statusClass: 'running' }, { statusClass: 'pending' }]).health).toBe('warn')
    expect(tally([{ statusClass: 'pending' }, { statusClass: 'failed' }]).health).toBe('bad')
  })

  it('pod Running com container não pronto conta como pendente', () => {
    expect(podClass({ status: 'Running', statusClass: 'running', ready: '1/2' })).toBe('pending')
    expect(podClass({ status: 'Running', statusClass: 'running', ready: '2/2' })).toBe('running')
    expect(podClass({ status: 'Completed', statusClass: 'succeeded', ready: '0/1' })).toBe('succeeded')
  })

  it('problemas: falhas primeiro', () => {
    const item = (name: string, statusClass: 'failed' | 'pending' | 'running') => ({ uid: name, namespace: 'n', name, status: '', statusClass })
    const out = problems([
      { kind: 'Pod', section: 'pods', items: [item('b', 'pending'), item('ok', 'running'), item('a', 'failed')] },
      { kind: 'Deployment', section: 'deployments', items: [item('c', 'pending')] },
    ])
    expect(out.map((p) => p.name)).toEqual(['a', 'c', 'b'])
  })

  it('evento leva ao recurso quando o app tem tela', () => {
    expect(eventTarget('Pod/web-1')).toEqual({ section: 'pods', name: 'web-1' })
    expect(eventTarget('Node/minikube')).toBeNull()
  })
})
