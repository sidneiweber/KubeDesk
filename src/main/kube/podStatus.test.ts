import { describe, expect, it } from 'vitest'
import type { V1ContainerStatus, V1Pod } from '@kubernetes/client-node'
import { computePodStatus, podStatusClass } from './podStatus'

// Mesmos casos de legacy/test/pod-status.test.js.

const pod = (spec: object, status: object, metadata: object = {}) => ({ metadata, spec, status }) as V1Pod
const c = (state: object, ready = false, restartCount = 0) => ({ state, ready, restartCount }) as V1ContainerStatus

describe('status', () => {
  const cases: [string, V1Pod, string][] = [
    ['pod saudável', pod({ containers: [{}] }, { phase: 'Running', containerStatuses: [c({ running: {} }, true)] }), 'Running'],
    ['crash loop não some atrás de "Running"', pod({ containers: [{}] }, { phase: 'Running', containerStatuses: [c({ waiting: { reason: 'CrashLoopBackOff' } }, false, 7)] }), 'CrashLoopBackOff'],
    ['imagem que não baixa', pod({ containers: [{}] }, { phase: 'Pending', containerStatuses: [c({ waiting: { reason: 'ImagePullBackOff' } })] }), 'ImagePullBackOff'],
    ['pod sendo removido', pod({ containers: [{}] }, { phase: 'Running', containerStatuses: [c({ running: {} }, true)] }, { deletionTimestamp: new Date() }), 'Terminating'],
    ['job concluído', pod({ containers: [{}] }, { phase: 'Succeeded', containerStatuses: [c({ terminated: { reason: 'Completed', exitCode: 0 } })] }), 'Completed'],
    ['OOMKilled', pod({ containers: [{}] }, { phase: 'Running', containerStatuses: [c({ terminated: { reason: 'OOMKilled', exitCode: 137 } }, false, 3)] }), 'OOMKilled'],
    ['saída sem reason vira ExitCode', pod({ containers: [{}] }, { phase: 'Failed', containerStatuses: [c({ terminated: { exitCode: 2 } })] }), 'ExitCode:2'],
    ['init container em andamento', pod({ containers: [{}], initContainers: [{}, {}] }, { phase: 'Pending', initContainerStatuses: [{ state: { running: {} } }] }), 'Init:0/2'],
    ['init container que falhou', pod({ containers: [{}], initContainers: [{}] }, { phase: 'Pending', initContainerStatuses: [{ state: { terminated: { reason: 'Error', exitCode: 1 } } }] }), 'Init:Error'],
    ['init pronto, app subindo', pod({ containers: [{}], initContainers: [{}] }, { phase: 'Pending', initContainerStatuses: [{ state: { terminated: { exitCode: 0 } } }], containerStatuses: [c({ waiting: { reason: 'ContainerCreating' } })] }), 'ContainerCreating'],
    ['pod ainda não agendado', pod({ containers: [{}] }, { phase: 'Pending' }), 'Pending'],
  ]
  it.each(cases)('%s', (_, p, expected) => {
    expect(computePodStatus(p).status).toBe(expected)
  })
})

describe('ready e restarts', () => {
  it('denominador é o spec, não os statuses', () => {
    expect(computePodStatus(pod({ containers: [{}] }, { phase: 'Pending' })).ready).toBe('0/1')
  })
  it('um de dois containers pronto', () => {
    const p = pod({ containers: [{}, {}] }, { phase: 'Running', containerStatuses: [c({ running: {} }, true), c({ running: {} }, false)] })
    expect(computePodStatus(p).ready).toBe('1/2')
  })
  it('restarts somam todos os containers', () => {
    const p = pod({ containers: [{}, {}] }, { phase: 'Running', containerStatuses: [c({ running: {} }, true, 2), c({ running: {} }, true, 5)] })
    expect(computePodStatus(p).restarts).toBe(7)
  })
})

describe('cor', () => {
  const cores: Record<string, string> = {
    Running: 'running', Completed: 'succeeded', Succeeded: 'succeeded',
    Pending: 'pending', ContainerCreating: 'pending', Terminating: 'pending',
    'Init:1/3': 'pending', 'Init:Error': 'failed', 'Init:CrashLoopBackOff': 'failed',
    CrashLoopBackOff: 'failed', OOMKilled: 'failed', 'ExitCode:1': 'failed', 'Signal:9': 'failed',
  }
  it.each(Object.entries(cores))('%s -> %s', (status, expected) => {
    expect(podStatusClass(status)).toBe(expected)
  })
})
