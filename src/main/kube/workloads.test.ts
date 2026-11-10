import { describe, expect, it } from 'vitest'
import type { V1CronJob, V1DaemonSet, V1Job, V1ReplicaSet, V1StatefulSet } from '@kubernetes/client-node'
import { cronJobStatus, daemonSetStatus, jobStatus, replicaSetStatus, revisionImages, statefulSetStatus, toCronJobRow, toJobRow } from './workloads'
import { jobFromCronJob } from './workloadActions'

describe('replicaSetStatus', () => {
  const rs = (desired: number, ready: number, available: number, current = desired) =>
    ({ spec: { replicas: desired, selector: {} }, status: { replicas: current, readyReplicas: ready, availableReplicas: available } }) as V1ReplicaSet

  it.each([
    ['revisão antiga de um deployment', rs(0, 0, 0), 'Scaled to 0'],
    ['descendo para 0', rs(0, 1, 1, 1), 'Scaling down'],
    ['todos disponíveis', rs(2, 2, 2), 'Available'],
    ['nenhum pronto', rs(2, 0, 0), 'Unavailable'],
    ['subindo', rs(3, 1, 1), 'Progressing'],
  ])('%s', (_, obj, status) => {
    expect(replicaSetStatus(obj).status).toBe(status)
  })
})

describe('daemonSetStatus', () => {
  const ds = (o: { desired: number; updated: number; available: number; strategy?: string }) =>
    ({
      metadata: { generation: 1 },
      spec: { selector: {}, template: {}, updateStrategy: { type: o.strategy ?? 'RollingUpdate' } },
      status: { observedGeneration: 1, desiredNumberScheduled: o.desired, updatedNumberScheduled: o.updated, numberAvailable: o.available, currentNumberScheduled: o.desired, numberMisscheduled: 0, numberReady: o.available },
    }) as V1DaemonSet

  it('sem nodes elegíveis não é falha', () => expect(daemonSetStatus(ds({ desired: 0, updated: 0, available: 0 })).status).toBe('Sem nodes'))
  it('rollout em andamento', () => expect(daemonSetStatus(ds({ desired: 3, updated: 1, available: 3 })).status).toBe('Progressing'))
  it('OnDelete não fica eternamente em rollout', () =>
    expect(daemonSetStatus(ds({ desired: 3, updated: 1, available: 3, strategy: 'OnDelete' })).status).toBe('Available'))
  it('perdeu pods', () => expect(daemonSetStatus(ds({ desired: 3, updated: 3, available: 2 })).status).toBe('Degraded'))
})

describe('statefulSetStatus', () => {
  const sts = (o: { desired: number; replicas?: number; ready: number; updated?: number; current?: string; update?: string }) =>
    ({
      metadata: { generation: 1 },
      spec: { replicas: o.desired, selector: {}, serviceName: 'db', template: {} },
      status: {
        observedGeneration: 1, replicas: o.replicas ?? o.desired, readyReplicas: o.ready, updatedReplicas: o.updated ?? o.desired,
        currentRevision: o.current ?? 'r1', updateRevision: o.update ?? o.current ?? 'r1',
      },
    }) as V1StatefulSet

  it('estável', () => expect(statefulSetStatus(sts({ desired: 3, ready: 3 })).status).toBe('Available'))
  it('revisão nova ainda entrando', () => expect(statefulSetStatus(sts({ desired: 3, ready: 3, updated: 1, update: 'r2' })).status).toBe('Progressing'))
  it('escalando', () => expect(statefulSetStatus(sts({ desired: 3, replicas: 2, ready: 2 })).status).toBe('Progressing'))
  it('escalado para 0', () => expect(statefulSetStatus(sts({ desired: 0, ready: 0 })).status).toBe('Scaled to 0'))
  it('sem nenhum pronto', () => expect(statefulSetStatus(sts({ desired: 2, ready: 0 })).status).toBe('Unavailable'))
})

describe('jobStatus', () => {
  const job = (status: V1Job['status'], suspend = false) => ({ spec: { suspend, template: {} }, status }) as V1Job

  it('completo', () => expect(jobStatus(job({ conditions: [{ type: 'Complete', status: 'True' }] }))).toEqual({ status: 'Complete', statusClass: 'succeeded' }))
  it('falhou', () => expect(jobStatus(job({ conditions: [{ type: 'Failed', status: 'True' }] })).statusClass).toBe('failed'))
  it('rodando', () => expect(jobStatus(job({ active: 1 })).status).toBe('Running'))
  it('suspenso', () => expect(jobStatus(job({}, true)).status).toBe('Suspended'))
  it('completions ausente vira null (fila de trabalho)', () => expect(toJobRow(job({})).completions).toBeNull())
})

describe('cronJob', () => {
  const cj = {
    metadata: { name: 'backup', namespace: 'prod', uid: 'c1' },
    spec: {
      schedule: '0 3 * * *',
      jobTemplate: {
        metadata: { labels: { app: 'backup' } },
        spec: { template: { spec: { containers: [{ name: 'b', image: 'pg:16' }], restartPolicy: 'Never' } } },
      },
    },
    status: { active: [{ name: 'backup-1' }] },
  } as V1CronJob

  it('status e linha', () => {
    expect(cronJobStatus(cj).status).toBe('Active')
    expect(toCronJobRow(cj)).toMatchObject({ schedule: '0 3 * * *', active: 1, images: ['pg:16'], selector: '' })
    expect(cronJobStatus({ ...cj, spec: { ...cj.spec!, suspend: true } }).status).toBe('Suspended')
  })

  it('jobFromCronJob: template, dono e anotação de disparo manual', () => {
    const job = jobFromCronJob(cj, 1_700_000_000_000)
    expect(job.metadata?.name).toMatch(/^backup-manual-[a-z0-9]{6}$/)
    expect(job.metadata?.labels).toEqual({ app: 'backup' })
    expect(job.metadata?.annotations).toEqual({ 'cronjob.kubernetes.io/instantiate': 'manual' })
    expect(job.metadata?.ownerReferences?.[0]).toMatchObject({ kind: 'CronJob', name: 'backup', uid: 'c1', controller: true })
    expect(job.spec?.template.spec?.containers[0].image).toBe('pg:16')
  })

  it('jobFromCronJob: nome longo cabe nos 63 caracteres do label job-name', () => {
    const long = { ...cj, metadata: { ...cj.metadata, name: 'x'.repeat(52) } }
    expect(jobFromCronJob(long, Date.now()).metadata?.name?.length).toBeLessThanOrEqual(63)
  })
})

describe('revisionImages', () => {
  it('lê as imagens do patch guardado na ControllerRevision', () => {
    expect(revisionImages({ revision: 2, data: { spec: { template: { spec: { containers: [{ name: 'a', image: 'redis:7' }] } } } } })).toEqual(['redis:7'])
  })
})
