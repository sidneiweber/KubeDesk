import { CoreV1Api, type KubeConfig, type V1Service } from '@kubernetes/client-node'
import type { Batch, ServiceRow, WatchOptions } from '@shared/api'
import { millis } from './meta'
import { resourcePath, watchResource } from './watch'

/** Coluna PORT(S) do kubectl: "80/TCP", ou "80:30080/TCP" com nodePort. */
export function servicePorts(s: V1Service): string[] {
  return (s.spec?.ports ?? []).map((p) => `${p.port}${p.nodePort ? `:${p.nodePort}` : ''}/${p.protocol ?? 'TCP'}`)
}

/** Coluna EXTERNAL-IP do kubectl. */
export function serviceExternalIP(s: V1Service): string {
  const spec = s.spec ?? {}
  const external = spec.externalIPs ?? []

  switch (spec.type) {
    case 'ExternalName':
      return spec.externalName ?? '<none>'
    case 'LoadBalancer': {
      const lb = (s.status?.loadBalancer?.ingress ?? []).map((i) => i.ip || i.hostname || '').filter(Boolean)
      const all = [...lb, ...external]
      // Sem endereço ainda: o provedor não atribuiu (ou não existe, como no minikube sem tunnel)
      return all.length ? all.join(',') : '<pending>'
    }
    default:
      return external.length ? external.join(',') : '<none>'
  }
}

export function toServiceRow(s: V1Service): ServiceRow {
  const spec = s.spec ?? {}
  return {
    uid: s.metadata?.uid ?? '',
    name: s.metadata?.name ?? '',
    namespace: s.metadata?.namespace ?? '',
    type: spec.type ?? 'ClusterIP',
    clusterIP: spec.clusterIP || (spec.type === 'ExternalName' ? '<none>' : ''),
    externalIP: serviceExternalIP(s),
    ports: servicePorts(s),
    portDetails: (spec.ports ?? []).map((p) => ({
      name: p.name ?? '',
      port: p.port,
      targetPort: p.targetPort === undefined ? String(p.port) : String(p.targetPort),
      nodePort: p.nodePort ?? null,
      protocol: p.protocol ?? 'TCP',
    })),
    selector: Object.entries(spec.selector ?? {}).map(([k, v]) => `${k}=${v}`).join(','),
    sessionAffinity: spec.sessionAffinity ?? 'None',
    created: millis(s.metadata?.creationTimestamp),
    labels: s.metadata?.labels ?? {},
  }
}

export function watchServices(
  kc: KubeConfig,
  { namespace, labelSelector }: WatchOptions,
  emit: (b: Batch<ServiceRow>) => void,
  onError: (message: string) => void,
): () => void {
  const api = kc.makeApiClient(CoreV1Api)
  return watchResource({
    kc,
    path: resourcePath('/api/v1', 'services', namespace),
    list: () => (namespace ? api.listNamespacedService({ namespace, labelSelector }) : api.listServiceForAllNamespaces({ labelSelector })),
    labelSelector,
    toRow: toServiceRow,
    emit,
    onError,
  })
}
