import { DiscoveryV1Api, type KubeConfig, type V1EndpointSlice } from '@kubernetes/client-node'
import type { Batch, EndpointSliceRow, WatchOptions } from '@shared/api'
import { millis } from './meta'
import { resourcePath, watchResource } from './watch'

// EndpointSlice substitui o v1 Endpoints, deprecado a partir do Kubernetes
// 1.33. Um service pode ter vários slices; o renderer agrupa por service.

export const SERVICE_NAME_LABEL = 'kubernetes.io/service-name'

export function toEndpointSliceRow(s: V1EndpointSlice): EndpointSliceRow {
  return {
    uid: s.metadata?.uid ?? '',
    name: s.metadata?.name ?? '',
    namespace: s.metadata?.namespace ?? '',
    service: s.metadata?.labels?.[SERVICE_NAME_LABEL] ?? '',
    addressType: s.addressType,
    ports: (s.ports ?? []).map((p) => ({ name: p.name ?? '', port: p.port ?? 0, protocol: p.protocol ?? 'TCP' })),
    endpoints: (s.endpoints ?? []).map((e) => ({
      addresses: e.addresses,
      // A API diz para tratar "ready" ausente como pronto
      ready: e.conditions?.ready ?? true,
      terminating: e.conditions?.terminating ?? false,
      pod: e.targetRef?.kind === 'Pod' ? (e.targetRef.name ?? '') : '',
      node: e.nodeName ?? '',
    })),
    created: millis(s.metadata?.creationTimestamp),
  }
}

export function watchEndpointSlices(
  kc: KubeConfig,
  { namespace, labelSelector }: WatchOptions,
  emit: (b: Batch<EndpointSliceRow>) => void,
  onError: (message: string) => void,
): () => void {
  const api = kc.makeApiClient(DiscoveryV1Api)
  return watchResource({
    kc,
    path: resourcePath('/apis/discovery.k8s.io/v1', 'endpointslices', namespace),
    list: () =>
      namespace
        ? api.listNamespacedEndpointSlice({ namespace, labelSelector })
        : api.listEndpointSliceForAllNamespaces({ labelSelector }),
    labelSelector,
    toRow: toEndpointSliceRow,
    emit,
    onError,
  })
}
