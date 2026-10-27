import {
  AppsV1Api,
  PatchStrategy,
  setHeaderOptions,
  type KubeConfig,
  type V1Deployment,
  type V1LabelSelector,
} from '@kubernetes/client-node'
import type { Batch, DeploymentRow, StatusClass, WatchOptions } from '@shared/api'
import { errorMessage } from './errors'
import { millis } from './meta'
import { resourcePath, watchResource } from './watch'

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

/** V1LabelSelector -> "app=web,tier in (a,b),!legacy", como o kubectl aceita. */
export function labelSelectorString(sel: V1LabelSelector | undefined): string {
  if (!sel) return ''
  const parts = Object.entries(sel.matchLabels ?? {}).map(([k, v]) => `${k}=${v}`)
  for (const e of sel.matchExpressions ?? []) {
    const values = (e.values ?? []).join(',')
    switch (e.operator) {
      case 'In':
        parts.push(`${e.key} in (${values})`)
        break
      case 'NotIn':
        parts.push(`${e.key} notin (${values})`)
        break
      case 'Exists':
        parts.push(e.key)
        break
      case 'DoesNotExist':
        parts.push(`!${e.key}`)
        break
    }
  }
  return parts.join(',')
}

export function toDeploymentRow(d: V1Deployment): DeploymentRow {
  const { status, statusClass } = deploymentStatus(d)
  const containers = d.spec?.template?.spec?.containers ?? []
  return {
    uid: d.metadata?.uid ?? '',
    name: d.metadata?.name ?? '',
    namespace: d.metadata?.namespace ?? '',
    status,
    statusClass,
    desired: d.spec?.replicas ?? 1,
    ready: d.status?.readyReplicas ?? 0,
    upToDate: d.status?.updatedReplicas ?? 0,
    available: d.status?.availableReplicas ?? 0,
    created: millis(d.metadata?.creationTimestamp),
    images: containers.map((c) => c.image ?? ''),
    strategy: d.spec?.strategy?.type ?? 'RollingUpdate',
    paused: d.spec?.paused ?? false,
    revision: d.metadata?.annotations?.['deployment.kubernetes.io/revision'] ?? '',
    selector: labelSelectorString(d.spec?.selector),
    labels: d.metadata?.labels ?? {},
    conditions: (d.status?.conditions ?? []).map((c) => ({
      type: c.type,
      status: c.status,
      reason: c.reason ?? '',
      message: c.message ?? '',
      lastTransition: millis(c.lastTransitionTime),
    })),
    containers: containers.map((c) => ({
      name: c.name,
      image: c.image ?? '',
      ports: (c.ports ?? []).map((p) => `${p.name ? `${p.name}:` : ''}${p.containerPort}/${p.protocol ?? 'TCP'}`),
      requests: (c.resources?.requests ?? {}) as Record<string, string>,
      limits: (c.resources?.limits ?? {}) as Record<string, string>,
    })),
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

export async function scaleDeployment(kc: KubeConfig, namespace: string, name: string, replicas: number): Promise<void> {
  if (!Number.isInteger(replicas) || replicas < 0) throw new Error(`Número de réplicas inválido: ${replicas}`)
  try {
    await kc
      .makeApiClient(AppsV1Api)
      .patchNamespacedDeploymentScale(
        { name, namespace, body: { spec: { replicas } } },
        setHeaderOptions('Content-Type', PatchStrategy.MergePatch),
      )
  } catch (err) {
    throw new Error(`Erro ao escalar ${name}: ${errorMessage(err)}`)
  }
}

/** Mesmo efeito de `kubectl rollout restart`: muda uma anotação do template. */
export async function restartDeployment(kc: KubeConfig, namespace: string, name: string): Promise<void> {
  const api = kc.makeApiClient(AppsV1Api)
  try {
    // Como o kubectl: num deployment pausado a anotação mudaria sem efeito nenhum
    const current = await api.readNamespacedDeployment({ name, namespace })
    if (current.spec?.paused) throw new Error('o deployment está pausado; retome o rollout antes de reiniciar')

    const restartedAt = new Date().toISOString()
    await api.patchNamespacedDeployment(
      { name, namespace, body: { spec: { template: { metadata: { annotations: { 'kubectl.kubernetes.io/restartedAt': restartedAt } } } } } },
      setHeaderOptions('Content-Type', PatchStrategy.StrategicMergePatch),
    )
  } catch (err) {
    throw new Error(`Erro ao reiniciar ${name}: ${errorMessage(err)}`)
  }
}
