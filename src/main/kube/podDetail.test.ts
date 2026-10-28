import { describe, expect, it } from 'vitest'
import type { CoreV1Event, V1Pod } from '@kubernetes/client-node'
import { toPodDetail, volumeSource } from './pods'
import { toEventRow } from './events'

const pod = {
  metadata: { name: 'api', namespace: 'prod', uid: 'u1', labels: { app: 'api' } },
  spec: {
    serviceAccountName: 'api-sa',
    restartPolicy: 'Always',
    initContainers: [{ name: 'migrate', image: 'api:1' }],
    containers: [
      { name: 'app', image: 'api:1', ports: [{ name: 'http', containerPort: 8080 }], resources: { limits: { cpu: '500m', memory: '256Mi' } } },
      { name: 'proxy', image: 'envoy:1' },
    ],
    volumes: [{ name: 'cfg', configMap: { name: 'api-config' } }, { name: 'data', persistentVolumeClaim: { claimName: 'api-data' } }, { name: 'tmp', emptyDir: {} }],
  },
  status: {
    phase: 'Running',
    qosClass: 'Burstable',
    initContainerStatuses: [{ name: 'migrate', ready: false, restartCount: 0, image: '', imageID: '', state: { terminated: { exitCode: 0, reason: 'Completed' } } }],
    containerStatuses: [
      { name: 'app', ready: true, restartCount: 3, image: '', imageID: '', state: { running: { startedAt: new Date('2026-10-27T10:00:00Z') } }, lastState: { terminated: { exitCode: 137, reason: 'OOMKilled' } } },
      { name: 'proxy', ready: false, restartCount: 0, image: '', imageID: '', state: { waiting: { reason: 'ImagePullBackOff', message: 'pull failed' } } },
    ],
  },
} as unknown as V1Pod

describe('toPodDetail', () => {
  const d = toPodDetail(pod)

  it('estado de cada container, com motivo e último encerramento', () => {
    expect(d.containerDetails.map((c) => [c.name, c.state, c.reason])).toEqual([
      ['app', 'Running', ''],
      ['proxy', 'Waiting', 'ImagePullBackOff'],
    ])
    expect(d.containerDetails[0].lastTermination).toBe('OOMKilled (exit 137)')
    expect(d.containerDetails[0].restarts).toBe(3)
    expect(d.containerDetails[0].ports).toEqual(['http:8080/TCP'])
    expect(d.containerDetails[0].cpuLimit).toBe(500)
  })

  it('init containers ficam separados', () => {
    expect(d.initContainers).toHaveLength(1)
    expect(d.initContainers[0]).toMatchObject({ state: 'Terminated', reason: 'Completed', exitCode: 0 })
  })

  it('campos do resumo', () => {
    expect(d).toMatchObject({ qosClass: 'Burstable', serviceAccount: 'api-sa', restartPolicy: 'Always', name: 'api' })
  })

  it('volumes resumidos por tipo', () => {
    expect(d.volumes).toEqual([
      { name: 'cfg', kind: 'ConfigMap', source: 'api-config' },
      { name: 'data', kind: 'PersistentVolumeClaim', source: 'api-data' },
      { name: 'tmp', kind: 'EmptyDir', source: '' },
    ])
    expect(volumeSource({ name: 'x', gitRepo: { repository: 'r' } } as never).kind).toBe('GitRepo')
  })
})

describe('toEventRow', () => {
  it('evento antigo: count e lastTimestamp', () => {
    const e = toEventRow({
      metadata: { uid: 'e1' }, type: 'Warning', reason: 'BackOff', message: 'Back-off pulling image', count: 5,
      firstTimestamp: new Date('2026-10-27T10:00:00Z'), lastTimestamp: new Date('2026-10-27T10:05:00Z'),
      source: { component: 'kubelet' }, involvedObject: { kind: 'Pod', name: 'api' },
    } as CoreV1Event)
    expect(e).toMatchObject({ type: 'Warning', count: 5, source: 'kubelet', object: 'Pod/api' })
    expect(e.last - e.first).toBe(5 * 60_000)
  })

  it('evento novo: series e reportingComponent', () => {
    const e = toEventRow({
      metadata: { uid: 'e2' }, reason: 'Pulled', reportingComponent: 'kubelet',
      eventTime: new Date('2026-10-27T10:00:00Z'), series: { count: 3, lastObservedTime: new Date('2026-10-27T10:02:00Z') },
      involvedObject: { kind: 'Pod', name: 'api' },
    } as unknown as CoreV1Event)
    expect(e).toMatchObject({ type: 'Normal', count: 3, source: 'kubelet' })
    expect(e.last).toBe(Date.parse('2026-10-27T10:02:00Z'))
  })
})
