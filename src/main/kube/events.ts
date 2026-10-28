import { CoreV1Api, type CoreV1Event, type KubeConfig } from '@kubernetes/client-node'
import type { Batch, EventRow, WatchOptions } from '@shared/api'
import { millis } from './meta'
import { resourcePath, watchResource } from './watch'

// Eventos são o que o `kubectl describe` mostra no fim: "Back-off pulling
// image", "Liveness probe failed", "Scaled up replica set"… O filtro típico
// é involvedObject.uid=<uid>, para os eventos de um recurso só.

export function toEventRow(e: CoreV1Event): EventRow {
  // Eventos novos (events.k8s.io) preenchem eventTime/series; os antigos,
  // firstTimestamp/lastTimestamp/count. Aceita os dois.
  const last = millis(e.series?.lastObservedTime) || millis(e.lastTimestamp) || millis(e.eventTime) || millis(e.metadata?.creationTimestamp)
  return {
    uid: e.metadata?.uid ?? '',
    type: e.type ?? 'Normal',
    reason: e.reason ?? '',
    message: e.message ?? '',
    count: e.series?.count ?? e.count ?? 1,
    last,
    first: millis(e.firstTimestamp) || millis(e.eventTime) || last,
    source: e.reportingComponent || e.source?.component || '',
    object: `${e.involvedObject.kind ?? ''}/${e.involvedObject.name ?? ''}`,
  }
}

export function watchEvents(
  kc: KubeConfig,
  { namespace, fieldSelector, labelSelector }: WatchOptions,
  emit: (b: Batch<EventRow>) => void,
  onError: (message: string) => void,
): () => void {
  const api = kc.makeApiClient(CoreV1Api)
  return watchResource({
    kc,
    path: resourcePath('/api/v1', 'events', namespace),
    list: () =>
      namespace
        ? api.listNamespacedEvent({ namespace, fieldSelector, labelSelector })
        : api.listEventForAllNamespaces({ fieldSelector, labelSelector }),
    fieldSelector,
    labelSelector,
    toRow: toEventRow,
    emit,
    onError,
  })
}
