import { describe, expect, it } from 'vitest'
import type { ContainerDetail } from '@shared/api'
import { containerState } from './containerState'

const c = (o: Partial<ContainerDetail>): ContainerDetail => ({
  name: 'c', image: '', state: '', reason: '', message: '', since: 0, exitCode: null, ready: false, restarts: 0,
  lastTermination: '', ports: [], cpuRequest: null, cpuLimit: null, memoryRequest: null, memoryLimit: null, ...o,
})

describe('containerState', () => {
  it.each<[string, Partial<ContainerDetail>, string, string]>([
    ['rodando e pronto', { state: 'Running', ready: true }, 'Running', 'running'],
    ['rodando sem passar no readiness', { state: 'Running', ready: false }, 'Running, não pronto', 'pending'],
    ['subindo', { state: 'Waiting', reason: 'ContainerCreating' }, 'ContainerCreating', 'pending'],
    ['crash loop', { state: 'Waiting', reason: 'CrashLoopBackOff' }, 'CrashLoopBackOff', 'failed'],
    ['terminou bem (init/job)', { state: 'Terminated', reason: 'Completed', exitCode: 0 }, 'Completed', 'succeeded'],
    ['morto por memória', { state: 'Terminated', reason: 'OOMKilled', exitCode: 137 }, 'OOMKilled (exit 137)', 'failed'],
    ['sem status ainda', {}, 'Sem status', 'unknown'],
  ])('%s', (_, o, status, statusClass) => {
    expect(containerState(c(o))).toEqual({ status, statusClass })
  })
})
