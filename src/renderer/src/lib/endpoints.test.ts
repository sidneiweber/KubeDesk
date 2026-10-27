import { describe, expect, it } from 'vitest'
import type { EndpointSliceRow, SliceEndpoint } from '@shared/api'
import { groupEndpointSlices } from './endpoints'

const ep = (ip: string, o: Partial<SliceEndpoint> = {}): SliceEndpoint => ({ addresses: [ip], ready: true, terminating: false, pod: '', node: '', ...o })

const slice = (name: string, service: string, endpoints: SliceEndpoint[], ports = [{ name: 'http', port: 80, protocol: 'TCP' }]): EndpointSliceRow => ({
  uid: name, name, namespace: 'ns', service, addressType: 'IPv4', ports, endpoints, created: 1000,
})

describe('groupEndpointSlices', () => {
  it('junta os slices de um service e monta ip:porta como o kubectl', () => {
    const [g] = groupEndpointSlices([
      slice('web-a', 'web', [ep('10.0.0.2'), ep('10.0.0.10')]),
      slice('web-b', 'web', [ep('10.0.0.3')]),
    ])
    expect(g).toMatchObject({ uid: 'ns/web', service: 'web', slices: 2, notReady: 0, status: 'Prontos', statusClass: 'running' })
    expect(g.ready).toEqual(['10.0.0.2:80', '10.0.0.3:80', '10.0.0.10:80'])
  })

  it('separa prontos, não prontos e encerrando', () => {
    const [g] = groupEndpointSlices([slice('a', 'web', [ep('10.0.0.1'), ep('10.0.0.2', { ready: false }), ep('10.0.0.3', { ready: false, terminating: true })])])
    expect(g.ready).toEqual(['10.0.0.1:80'])
    expect(g.notReady).toBe(2)
    expect(g.endpoints.map((e) => e.state)).toEqual(['ready', 'notReady', 'terminating'])
    expect(g.status).toBe('Parcial')
  })

  it('service com pods mas nenhum pronto é falha; sem pods é desconhecido', () => {
    const groups = groupEndpointSlices([slice('a', 'quebrado', [ep('10.0.0.1', { ready: false })]), slice('b', 'vazio', [])])
    expect(groups.find((g) => g.service === 'quebrado')).toMatchObject({ status: 'Nenhum pronto', statusClass: 'failed' })
    expect(groups.find((g) => g.service === 'vazio')).toMatchObject({ status: 'Sem endpoints', statusClass: 'unknown' })
  })

  it('slice sem label de service vira grupo próprio pelo nome', () => {
    const [g] = groupEndpointSlices([slice('manual', '', [ep('1.2.3.4')], [])])
    expect(g).toMatchObject({ uid: 'ns/manual', service: 'manual', ready: ['1.2.3.4'] })
  })
})
