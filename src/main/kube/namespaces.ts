import { CoreV1Api, type KubeConfig, type V1Namespace } from '@kubernetes/client-node'
import type { Batch, NamespaceRow, WatchOptions } from '@shared/api'
import { millis } from './meta'
import { watchResource } from './watch'

export function toNamespaceRow(n: V1Namespace): NamespaceRow {
  const status = n.metadata?.deletionTimestamp ? 'Terminating' : (n.status?.phase ?? 'Unknown')
  return {
    uid: n.metadata?.uid ?? '',
    name: n.metadata?.name ?? '',
    status,
    statusClass: status === 'Active' ? 'running' : status === 'Terminating' ? 'pending' : 'unknown',
    created: millis(n.metadata?.creationTimestamp),
    labels: n.metadata?.labels ?? {},
  }
}

/** Namespaces não têm namespace: opts.namespace é ignorado. */
export function watchNamespaces(
  kc: KubeConfig,
  { labelSelector }: WatchOptions,
  emit: (b: Batch<NamespaceRow>) => void,
  onError: (message: string) => void,
): () => void {
  const api = kc.makeApiClient(CoreV1Api)
  return watchResource({
    kc,
    path: '/api/v1/namespaces',
    list: () => api.listNamespace({ labelSelector }),
    labelSelector,
    toRow: toNamespaceRow,
    emit,
    onError,
  })
}
