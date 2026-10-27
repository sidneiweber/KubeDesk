import { CoreV1Api, type KubeConfig, type V1Pod } from '@kubernetes/client-node'
import type { Batch, PodRow, WatchOptions } from '@shared/api'
import { computePodStatus, podStatusClass } from './podStatus'
import { resourcePath, watchResource } from './watch'

export function toPodRow(p: V1Pod): PodRow {
  const s = computePodStatus(p)
  return {
    uid: p.metadata?.uid ?? '',
    name: p.metadata?.name ?? '',
    namespace: p.metadata?.namespace ?? '',
    status: s.status,
    statusClass: podStatusClass(s.status),
    ready: s.ready,
    restarts: s.restarts,
    node: p.spec?.nodeName ?? '',
    ip: p.status?.podIP ?? '',
    created: p.metadata?.creationTimestamp ? new Date(p.metadata.creationTimestamp).getTime() : 0,
    containers: (p.spec?.containers ?? []).map((c) => c.name),
  }
}

export function watchPods(
  kc: KubeConfig,
  { namespace, labelSelector }: WatchOptions,
  emit: (b: Batch<PodRow>) => void,
  onError: (message: string) => void,
): () => void {
  const api = kc.makeApiClient(CoreV1Api)
  return watchResource({
    kc,
    path: resourcePath('/api/v1', 'pods', namespace),
    list: () => (namespace ? api.listNamespacedPod({ namespace, labelSelector }) : api.listPodForAllNamespaces({ labelSelector })),
    labelSelector,
    toRow: toPodRow,
    emit,
    onError,
  })
}
