import { describe, expect, it } from 'vitest'
import type { V1Deployment, V1ReplicaSet } from '@kubernetes/client-node'
import { deploymentStatus, labelSelectorString, rollbackTemplate } from './deployments'
import { toReplicaSetRow } from './workloads'

interface Opts {
  desired?: number
  replicas?: number
  updated?: number
  available?: number
  generation?: number
  observed?: number
  progressing?: string
  paused?: boolean
}

function dep(o: Opts): V1Deployment {
  return {
    metadata: { generation: o.generation ?? 1 },
    spec: { replicas: o.desired, paused: o.paused, selector: {}, template: {} },
    status: {
      observedGeneration: o.observed ?? 1,
      replicas: o.replicas,
      updatedReplicas: o.updated,
      availableReplicas: o.available,
      conditions: o.progressing ? [{ type: 'Progressing', status: 'True', reason: o.progressing }] : [],
    },
  } as V1Deployment
}

describe('deploymentStatus', () => {
  it.each<[string, Opts, string, string]>([
    ['estável', { desired: 3, replicas: 3, updated: 3, available: 3, progressing: 'NewReplicaSetAvailable' }, 'Available', 'running'],
    ['escalado para 0 não é falha', { desired: 0, replicas: 0 }, 'Scaled to 0', 'unknown'],
    ['descendo para 0, pods ainda saindo', { desired: 0, replicas: 2, updated: 0 }, 'Progressing', 'pending'],
    ['rollout criando pods novos', { desired: 3, replicas: 4, updated: 2, available: 3, progressing: 'ReplicaSetUpdated' }, 'Progressing', 'pending'],
    ['rollout com pods novos ainda subindo', { desired: 2, replicas: 2, updated: 2, available: 1, progressing: 'ReplicaSetUpdated' }, 'Progressing', 'pending'],
    ['spec mudou e controller ainda não viu', { desired: 2, replicas: 2, updated: 2, available: 2, generation: 2, observed: 1 }, 'Progressing', 'pending'],
    ['rollout travado', { desired: 2, replicas: 3, updated: 1, available: 2, progressing: 'ProgressDeadlineExceeded' }, 'ProgressDeadlineExceeded', 'failed'],
    ['estável que perdeu todos os pods', { desired: 2, replicas: 2, updated: 2, available: 0, progressing: 'NewReplicaSetAvailable' }, 'Unavailable', 'failed'],
    ['estável que perdeu parte dos pods', { desired: 3, replicas: 3, updated: 3, available: 1, progressing: 'NewReplicaSetAvailable' }, 'Degraded', 'pending'],
    ['pausado', { desired: 2, replicas: 2, updated: 1, available: 2, paused: true }, 'Paused', 'unknown'],
    ['replicas ausente vale 1, como no Kubernetes', { replicas: 1, updated: 1, available: 1, progressing: 'NewReplicaSetAvailable' }, 'Available', 'running'],
  ])('%s', (_, opts, status, statusClass) => {
    expect(deploymentStatus(dep(opts))).toEqual({ status, statusClass })
  })
})

describe('labelSelectorString', () => {
  it('matchLabels e matchExpressions no formato do kubectl', () => {
    expect(
      labelSelectorString({
        matchLabels: { app: 'web' },
        matchExpressions: [
          { key: 'tier', operator: 'In', values: ['a', 'b'] },
          { key: 'env', operator: 'NotIn', values: ['dev'] },
          { key: 'canary', operator: 'Exists' },
          { key: 'legacy', operator: 'DoesNotExist' },
        ],
      }),
    ).toBe('app=web,tier in (a,b),env notin (dev),canary,!legacy')
  })

  it('sem seletor vira string vazia', () => {
    expect(labelSelectorString(undefined)).toBe('')
  })
})

describe('rollbackTemplate', () => {
  const rs = {
    metadata: { name: 'web-abc' },
    spec: {
      selector: {},
      template: {
        metadata: { labels: { app: 'web', 'pod-template-hash': 'abc' } },
        spec: { containers: [{ name: 'web', image: 'nginx:1.25' }] },
      },
    },
  } as V1ReplicaSet

  it('tira o pod-template-hash e mantém o resto', () => {
    expect(rollbackTemplate(rs)).toEqual({
      metadata: { labels: { app: 'web' } },
      spec: { containers: [{ name: 'web', image: 'nginx:1.25' }] },
    })
  })

  it('não altera o ReplicaSet original', () => {
    rollbackTemplate(rs)
    expect(rs.spec?.template?.metadata?.labels?.['pod-template-hash']).toBe('abc')
  })
})

describe('toReplicaSetRow', () => {
  it('lê revisão, dono e motivo das anotações', () => {
    const row = toReplicaSetRow({
      metadata: {
        uid: 'u1', name: 'web-abc', namespace: 'prod',
        annotations: { 'deployment.kubernetes.io/revision': '3', 'kubernetes.io/change-cause': 'nova imagem' },
        ownerReferences: [{ apiVersion: 'apps/v1', kind: 'Deployment', name: 'web', uid: 'd1', controller: true }],
      },
      spec: { replicas: 2, selector: {}, template: { spec: { containers: [{ name: 'web', image: 'nginx:1.25' }] } } },
      status: { replicas: 2, readyReplicas: 1 },
    } as V1ReplicaSet)
    expect(row).toMatchObject({ revision: 3, owner: { kind: 'Deployment', name: 'web', uid: 'd1' }, changeCause: 'nova imagem', desired: 2, ready: 1, available: 0, images: ['nginx:1.25'] })
  })
})
