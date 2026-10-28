import type { ContainerDetail, StatusClass } from '@shared/api'

// Motivos de espera que indicam problema (o resto é transição normal,
// como ContainerCreating ou PodInitializing).
const WAITING_FAILURES = new Set([
  'CrashLoopBackOff', 'ImagePullBackOff', 'ErrImagePull', 'InvalidImageName',
  'CreateContainerConfigError', 'CreateContainerError', 'RunContainerError',
])

/** Texto e cor do estado de um container, para a pill. */
export function containerState(c: ContainerDetail): { status: string; statusClass: StatusClass } {
  switch (c.state) {
    case 'Running':
      return c.ready ? { status: 'Running', statusClass: 'running' } : { status: 'Running, não pronto', statusClass: 'pending' }
    case 'Waiting':
      return { status: c.reason || 'Waiting', statusClass: WAITING_FAILURES.has(c.reason) ? 'failed' : 'pending' }
    case 'Terminated':
      return c.exitCode === 0
        ? { status: c.reason || 'Completed', statusClass: 'succeeded' }
        : { status: `${c.reason || 'Error'} (exit ${c.exitCode})`, statusClass: 'failed' }
    default:
      return { status: 'Sem status', statusClass: 'unknown' }
  }
}
