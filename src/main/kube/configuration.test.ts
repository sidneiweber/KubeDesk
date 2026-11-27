import { describe, expect, it } from 'vitest'
import type { V1ConfigMap, V1Secret, V2HorizontalPodAutoscaler } from '@kubernetes/client-node'
import { decodeSecretData, hpaMetrics, hpaStatus, toConfigMapRow, toHpaRow, toSecretRow } from './configuration'

const b64 = (s: string) => Buffer.from(s).toString('base64')

describe('configmaps', () => {
  it('data e binaryData juntos, em ordem, binário sem valor', () => {
    const row = toConfigMapRow({
      metadata: { name: 'cfg' },
      data: { 'b.conf': 'olá', 'a.txt': 'x' },
      binaryData: { 'logo.png': b64('\x89PNG') },
    } as V1ConfigMap)
    expect(row.entries).toEqual([
      { key: 'a.txt', value: 'x', size: 1 },
      { key: 'b.conf', value: 'olá', size: 4 },
      { key: 'logo.png', value: null, size: 5 },
    ])
  })
})

describe('secrets', () => {
  const secret = {
    metadata: {
      name: 'db',
      annotations: { 'kubectl.kubernetes.io/last-applied-configuration': '{"data":{"password":"c2VncmVkbw=="}}' },
    },
    type: 'Opaque',
    data: { password: b64('segredo'), user: b64('admin') },
  } as V1Secret

  it('a linha não leva valores nem annotations', () => {
    const row = toSecretRow(secret)
    expect(row.keys).toEqual([{ key: 'password', size: 7 }, { key: 'user', size: 5 }])
    expect(JSON.stringify(row)).not.toContain(b64('segredo'))
    expect(JSON.stringify(row)).not.toContain('segredo')
    expect(row).not.toHaveProperty('annotations')
  })

  it('revelar decodifica o base64', () => {
    expect(decodeSecretData(secret)).toEqual({ password: 'segredo', user: 'admin' })
  })
})

describe('hpa', () => {
  const hpa = {
    metadata: { name: 'web' },
    spec: {
      scaleTargetRef: { kind: 'Deployment', name: 'web', apiVersion: 'apps/v1' },
      minReplicas: 2,
      maxReplicas: 10,
      metrics: [
        { type: 'Resource', resource: { name: 'cpu', target: { type: 'Utilization', averageUtilization: 80 } } },
        { type: 'Resource', resource: { name: 'memory', target: { type: 'AverageValue', averageValue: '1Gi' } } },
        { type: 'Pods', pods: { metric: { name: 'rps' }, target: { type: 'AverageValue', averageValue: '100' } } },
        {
          type: 'Object',
          object: { metric: { name: 'hits' }, describedObject: { kind: 'Ingress', name: 'main' }, target: { type: 'Value', value: '2k' } },
        },
      ],
    },
    status: {
      currentReplicas: 3,
      desiredReplicas: 4,
      currentMetrics: [
        { type: 'Resource', resource: { name: 'cpu', current: { averageUtilization: 45, averageValue: '450m' } } },
        { type: 'Resource', resource: { name: 'memory', current: { averageValue: '200Mi' } } },
      ],
      conditions: [
        { type: 'AbleToScale', status: 'True' },
        { type: 'ScalingActive', status: 'True' },
      ],
    },
  } as unknown as V2HorizontalPodAutoscaler

  it('métricas no formato do TARGETS, <unknown> sem leitura', () => {
    expect(hpaMetrics(hpa)).toEqual([
      { type: 'Resource', name: 'cpu', current: '45%', target: '80%' },
      { type: 'Resource', name: 'memory', current: '200Mi', target: '1Gi' },
      { type: 'Pods', name: 'rps', current: '<unknown>', target: '100' },
      { type: 'Object', name: 'hits (Ingress/main)', current: '<unknown>', target: '2k' },
    ])
  })

  it('alvo, limites e réplicas', () => {
    expect(toHpaRow(hpa)).toMatchObject({
      target: { kind: 'Deployment', name: 'web' },
      minReplicas: 2,
      maxReplicas: 10,
      currentReplicas: 3,
      desiredReplicas: 4,
      status: 'Ativo',
      statusClass: 'running',
    })
  })

  it.each<[string, object[], string, string]>([
    ['sem condições ainda', [], 'Aguardando métricas', 'pending'],
    ['sem métricas', [{ type: 'AbleToScale', status: 'True' }, { type: 'ScalingActive', status: 'False', reason: 'FailedGetResourceMetric' }], 'FailedGetResourceMetric', 'failed'],
    ['no limite', [{ type: 'AbleToScale', status: 'True' }, { type: 'ScalingActive', status: 'True' }, { type: 'ScalingLimited', status: 'True' }], 'No limite', 'pending'],
  ])('status: %s', (_, conditions, status, statusClass) => {
    expect(hpaStatus({ status: { conditions } } as unknown as V2HorizontalPodAutoscaler)).toEqual({ status, statusClass })
  })
})
