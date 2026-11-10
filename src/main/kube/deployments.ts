import { AppsV1Api, type KubeConfig, type V1Deployment, type V1PodTemplateSpec, type V1ReplicaSet } from '@kubernetes/client-node'
import type { Batch, DeploymentRow, StatusClass, WatchOptions } from '@shared/api'
import { resourcePath, watchResource } from './watch'
import { labelSelectorString, workloadBase } from './workloads'

export { labelSelectorString }

/**
 * Status de um deployment, seguindo a mesma leitura do `kubectl rollout status`.
 *
 * O app antigo usava só "ready == replicas": um deployment escalado para 0
 * aparecia em vermelho como "Unavailable", e qualquer rollout em andamento
 * parecia falha. Aqui as condições Progressing/Available separam rollout em
 * curso, rollout travado e deployment estável que perdeu pods.
 */
export function deploymentStatus(d: V1Deployment): { status: string; statusClass: StatusClass } {
  const desired = d.spec?.replicas ?? 1
  const st = d.status ?? {}
  const total = st.replicas ?? 0
  const updated = st.updatedReplicas ?? 0
  const available = st.availableReplicas ?? 0
  const progressing = st.conditions?.find((c) => c.type === 'Progressing')

  if (d.spec?.paused) return { status: 'Paused', statusClass: 'unknown' }
  if (progressing?.reason === 'ProgressDeadlineExceeded') return { status: 'ProgressDeadlineExceeded', statusClass: 'failed' }
  if (desired === 0 && total === 0) return { status: 'Scaled to 0', statusClass: 'unknown' }

  const rolling =
    (d.metadata?.generation ?? 0) > (st.observedGeneration ?? 0) ||
    updated < desired ||
    total > updated ||
    // Rollout novo cujos pods ainda não ficaram disponíveis
    (available < desired && progressing?.reason !== 'NewReplicaSetAvailable')
  if (rolling) return { status: 'Progressing', statusClass: 'pending' }

  // Rollout concluído: o que faltar disponível é pod que caiu depois
  if (available >= desired) return { status: 'Available', statusClass: 'running' }
  if (available === 0) return { status: 'Unavailable', statusClass: 'failed' }
  return { status: 'Degraded', statusClass: 'pending' }
}

export function toDeploymentRow(d: V1Deployment): DeploymentRow {
  return {
    ...workloadBase(d, d.spec?.template, d.spec?.selector, d.status?.conditions, deploymentStatus(d)),
    desired: d.spec?.replicas ?? 1,
    ready: d.status?.readyReplicas ?? 0,
    upToDate: d.status?.updatedReplicas ?? 0,
    available: d.status?.availableReplicas ?? 0,
    strategy: d.spec?.strategy?.type ?? 'RollingUpdate',
    paused: d.spec?.paused ?? false,
    revision: d.metadata?.annotations?.['deployment.kubernetes.io/revision'] ?? '',
  }
}

export function watchDeployments(
  kc: KubeConfig,
  { namespace, labelSelector }: WatchOptions,
  emit: (b: Batch<DeploymentRow>) => void,
  onError: (message: string) => void,
): () => void {
  const api = kc.makeApiClient(AppsV1Api)
  return watchResource({
    kc,
    path: resourcePath('/apis/apps/v1', 'deployments', namespace),
    list: () =>
      namespace
        ? api.listNamespacedDeployment({ namespace, labelSelector })
        : api.listDeploymentForAllNamespaces({ labelSelector }),
    labelSelector,
    toRow: toDeploymentRow,
    emit,
    onError,
  })
}

/**
 * Template a restaurar num rollback: o do ReplicaSet da revisão, sem o label
 * pod-template-hash, que o controller põe sozinho (igual ao kubectl).
 */
export function rollbackTemplate(rs: V1ReplicaSet): V1PodTemplateSpec {
  const template = structuredClone(rs.spec?.template)
  if (!template) throw new Error(`o ReplicaSet ${rs.metadata?.name ?? ''} não tem template`)
  if (template.metadata?.labels) delete template.metadata.labels['pod-template-hash']
  return template
}
