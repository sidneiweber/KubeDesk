import type { V1ContainerStateTerminated, V1Pod } from '@kubernetes/client-node'
import type { StatusClass } from '@shared/api'

// Status de pod no formato da coluna STATUS do kubectl (printPod): init
// containers primeiro, depois os containers normais e, por último, o
// desligamento. `status.phase` sozinho engana: um pod em CrashLoopBackOff
// continua na fase "Running", e um pod sendo removido também.

const FAILURE_REASONS = new Set([
  'CrashLoopBackOff', 'ImagePullBackOff', 'ErrImagePull', 'InvalidImageName',
  'CreateContainerConfigError', 'CreateContainerError', 'OOMKilled',
  'Error', 'Failed', 'Evicted', 'DeadlineExceeded', 'NodeLost',
])

const PENDING_REASONS = new Set(['Pending', 'ContainerCreating', 'PodInitializing', 'Terminating', 'NotReady'])

function terminatedReason(t: V1ContainerStateTerminated): string {
  if (t.reason) return t.reason
  if (t.signal) return `Signal:${t.signal}`
  return `ExitCode:${t.exitCode}`
}

// Enquanto houver init container sem sucesso, é ele que define o status.
function initStatus(pod: V1Pod): string | null {
  const statuses = pod.status?.initContainerStatuses ?? []
  const total = pod.spec?.initContainers?.length ?? 0

  for (const [i, { state = {} }] of statuses.entries()) {
    if (state.terminated?.exitCode === 0) continue
    if (state.terminated) return `Init:${terminatedReason(state.terminated)}`
    if (state.waiting?.reason && state.waiting.reason !== 'PodInitializing') return `Init:${state.waiting.reason}`
    return `Init:${i}/${total}`
  }
  return null
}

// O kubectl percorre de trás para frente e deixa o primeiro container vencer.
function containerStatus(pod: V1Pod): string | null {
  const statuses = pod.status?.containerStatuses ?? []
  let reason: string | null = null
  let hasRunning = false

  for (let i = statuses.length - 1; i >= 0; i--) {
    const { state = {}, ready } = statuses[i]
    if (state.waiting?.reason) reason = state.waiting.reason
    else if (state.terminated) reason = terminatedReason(state.terminated)
    else if (ready && state.running) hasRunning = true
  }

  // "Completed" com container rodando é um pod reiniciado: a condição Ready
  // diz se ele voltou de fato
  if (reason === 'Completed' && hasRunning) {
    const isReady = (pod.status?.conditions ?? []).some((c) => c.type === 'Ready' && c.status === 'True')
    reason = isReady ? 'Running' : 'NotReady'
  }
  return reason
}

export interface PodStatus {
  status: string
  ready: string
  readyCount: number
  totalContainers: number
  restarts: number
}

export function computePodStatus(pod: V1Pod): PodStatus {
  const statuses = pod.status?.containerStatuses ?? []

  // O denominador é o que o pod declara: um pod não agendado mostra 0/1, não 0/0
  const totalContainers = pod.spec?.containers?.length || statuses.length
  const readyCount = statuses.filter((c) => c.ready).length

  let status = initStatus(pod) ?? containerStatus(pod) ?? (pod.status?.reason || pod.status?.phase || 'Unknown')

  // O desligamento vence tudo: o pod segue "Running" com deletionTimestamp preenchido
  if (pod.metadata?.deletionTimestamp) {
    status = pod.status?.reason === 'NodeLost' ? 'Unknown' : 'Terminating'
  }

  return {
    status,
    ready: `${readyCount}/${totalContainers}`,
    readyCount,
    totalContainers,
    restarts: statuses.reduce((n, c) => n + (c.restartCount ?? 0), 0),
  }
}

export function podStatusClass(status: string): StatusClass {
  if (!status) return 'unknown'
  if (status === 'Running') return 'running'
  if (status === 'Succeeded' || status === 'Completed') return 'succeeded'

  // "Init:2/3" é progresso; "Init:CrashLoopBackOff" é falha. Decide o sufixo
  if (status.startsWith('Init:')) {
    const detail = status.slice('Init:'.length)
    return /^\d+\/\d+$/.test(detail) ? 'pending' : podStatusClass(detail)
  }

  if (PENDING_REASONS.has(status)) return 'pending'
  if (FAILURE_REASONS.has(status)) return 'failed'

  // Motivo desconhecido: tratar como problema é mais seguro do que pintar de
  // verde algo que não sabemos ler
  return 'failed'
}
