import type { RolloutKind, ScalableKind, WorkloadKind } from '@shared/api'

export interface WorkloadMeta {
  /** Nome do tipo na API, ex.: "StatefulSet". */
  label: string
  /** Plural para listas e o botão de voltar. */
  plural: string
  scalable: boolean
  /** Tem rollout: reiniciar e voltar revisão. */
  rollout: boolean
}

export const WORKLOADS: Record<WorkloadKind, WorkloadMeta> = {
  deployments: { label: 'Deployment', plural: 'Deployments', scalable: true, rollout: true },
  replicasets: { label: 'ReplicaSet', plural: 'ReplicaSets', scalable: true, rollout: false },
  daemonsets: { label: 'DaemonSet', plural: 'DaemonSets', scalable: false, rollout: true },
  statefulsets: { label: 'StatefulSet', plural: 'StatefulSets', scalable: true, rollout: true },
  jobs: { label: 'Job', plural: 'Jobs', scalable: false, rollout: false },
  cronjobs: { label: 'CronJob', plural: 'CronJobs', scalable: false, rollout: false },
}

export const isScalable = (k: WorkloadKind): k is ScalableKind => WORKLOADS[k].scalable
export const isRollout = (k: WorkloadKind): k is RolloutKind => WORKLOADS[k].rollout

/** Kind de um ownerReference ("ReplicaSet") -> seção do app, se houver. */
export function kindToSection(kind: string): WorkloadKind | null {
  const found = (Object.keys(WORKLOADS) as WorkloadKind[]).find((k) => WORKLOADS[k].label === kind)
  return found ?? null
}
