import { describe, expect, it } from 'vitest'
import type { V1EndpointSlice, V1Ingress, V1Namespace, V1Service } from '@kubernetes/client-node'
import { serviceExternalIP, servicePorts, toServiceRow } from './services'
import { ingressRules, toIngressRow } from './ingresses'
import { toEndpointSliceRow } from './endpointSlices'
import { toNamespaceRow } from './namespaces'

const svc = (spec: object, status: object = {}) => ({ metadata: { name: 's' }, spec, status }) as V1Service

describe('services no formato do kubectl', () => {
  it('PORT(S) com e sem nodePort', () => {
    expect(servicePorts(svc({ ports: [{ port: 80, protocol: 'TCP' }, { port: 443, nodePort: 30443, protocol: 'TCP' }, { port: 53, protocol: 'UDP' }] })))
      .toEqual(['80/TCP', '443:30443/TCP', '53/UDP'])
  })

  it.each<[string, V1Service, string]>([
    ['ClusterIP sem externalIPs', svc({ type: 'ClusterIP' }), '<none>'],
    ['ClusterIP com externalIPs', svc({ type: 'ClusterIP', externalIPs: ['1.2.3.4'] }), '1.2.3.4'],
    ['LoadBalancer ainda sem endereço', svc({ type: 'LoadBalancer' }), '<pending>'],
    ['LoadBalancer com IP e hostname', svc({ type: 'LoadBalancer' }, { loadBalancer: { ingress: [{ ip: '10.0.0.1' }, { hostname: 'lb.example.com' }] } }), '10.0.0.1,lb.example.com'],
    ['ExternalName', svc({ type: 'ExternalName', externalName: 'db.example.com' }), 'db.example.com'],
  ])('EXTERNAL-IP: %s', (_, s, expected) => {
    expect(serviceExternalIP(s)).toBe(expected)
  })

  it('headless mantém "None" e seletor vira label selector', () => {
    const row = toServiceRow(svc({ type: 'ClusterIP', clusterIP: 'None', selector: { app: 'db', tier: 'data' } }))
    expect(row.clusterIP).toBe('None')
    expect(row.selector).toBe('app=db,tier=data')
  })

  it('targetPort ausente vale a própria porta', () => {
    expect(toServiceRow(svc({ ports: [{ port: 8080 }] })).portDetails[0].targetPort).toBe('8080')
  })
})

describe('ingresses', () => {
  const ing = {
    metadata: { name: 'i', annotations: { 'kubernetes.io/ingress.class': 'nginx' } },
    spec: {
      tls: [{ hosts: ['a.example.com'], secretName: 'a-tls' }],
      defaultBackend: { service: { name: 'fallback', port: { number: 80 } } },
      rules: [
        { host: 'a.example.com', http: { paths: [{ path: '/', pathType: 'Prefix', backend: { service: { name: 'web', port: { number: 80 } } } }, { path: '/api', pathType: 'Prefix', backend: { service: { name: 'api', port: { name: 'http' } } } }] } },
        { http: { paths: [{ path: '/static', pathType: 'Exact', backend: { resource: { kind: 'StorageBucket', name: 'assets' } } }] } },
      ],
    },
  } as unknown as V1Ingress

  it('regras achatadas com backend padrão no fim', () => {
    expect(ingressRules(ing)).toEqual([
      { host: 'a.example.com', path: '/', pathType: 'Prefix', backend: 'web:80' },
      { host: 'a.example.com', path: '/api', pathType: 'Prefix', backend: 'api:http' },
      { host: '*', path: '/static', pathType: 'Exact', backend: 'StorageBucket/assets' },
      { host: '*', path: '(padrão)', pathType: '-', backend: 'fallback:80' },
    ])
  })

  it('classe pelo annotation antigo, hosts sem repetir e 443 com TLS', () => {
    const row = toIngressRow(ing)
    expect(row.className).toBe('nginx')
    expect(row.hosts).toEqual(['a.example.com', '*'])
    expect(row.ports).toBe('80, 443')
  })
})

describe('endpoint slices', () => {
  it('ready ausente conta como pronto; targetRef de pod vira o nome do pod', () => {
    const row = toEndpointSliceRow({
      metadata: { name: 'web-abc', labels: { 'kubernetes.io/service-name': 'web' } },
      addressType: 'IPv4',
      ports: [{ name: 'http', port: 80, protocol: 'TCP' }],
      endpoints: [
        { addresses: ['10.0.0.1'], targetRef: { kind: 'Pod', name: 'web-1' }, nodeName: 'n1' },
        { addresses: ['10.0.0.2'], conditions: { ready: false, terminating: true }, targetRef: { kind: 'Pod', name: 'web-2' } },
      ],
    } as V1EndpointSlice)
    expect(row.service).toBe('web')
    expect(row.endpoints).toEqual([
      { addresses: ['10.0.0.1'], ready: true, terminating: false, pod: 'web-1', node: 'n1' },
      { addresses: ['10.0.0.2'], ready: false, terminating: true, pod: 'web-2', node: '' },
    ])
  })
})

describe('namespaces', () => {
  it('Terminating quando há deletionTimestamp', () => {
    const row = toNamespaceRow({ metadata: { name: 'x', deletionTimestamp: new Date() }, status: { phase: 'Active' } } as V1Namespace)
    expect(row).toMatchObject({ status: 'Terminating', statusClass: 'pending' })
  })
})
