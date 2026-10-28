import { NetworkingV1Api, type KubeConfig, type V1Ingress, type V1IngressBackend } from '@kubernetes/client-node'
import type { Batch, IngressRow, IngressRule, WatchOptions } from '@shared/api'
import { millis } from './meta'
import { resourcePath, watchResource } from './watch'

/** "web:80", "web:http" ou "StorageBucket/static" para backends de recurso. */
export function backendString(b: V1IngressBackend | undefined): string {
  if (!b) return '-'
  if (b.service) return `${b.service.name}:${b.service.port?.number ?? b.service.port?.name ?? '?'}`
  if (b.resource) return `${b.resource.kind}/${b.resource.name}`
  return '-'
}

/** Regras achatadas em host + caminho -> backend, incluindo o backend padrão. */
export function ingressRules(ing: V1Ingress): IngressRule[] {
  const rules: IngressRule[] = []
  for (const r of ing.spec?.rules ?? []) {
    for (const p of r.http?.paths ?? []) {
      rules.push({ host: r.host || '*', path: p.path || '/', pathType: p.pathType, backend: backendString(p.backend) })
    }
  }
  if (ing.spec?.defaultBackend) {
    rules.push({ host: '*', path: '(padrão)', pathType: '-', backend: backendString(ing.spec.defaultBackend) })
  }
  return rules
}

export function toIngressRow(ing: V1Ingress): IngressRow {
  const spec = ing.spec ?? {}
  const hosts = [...new Set((spec.rules ?? []).map((r) => r.host || '*'))]
  return {
    uid: ing.metadata?.uid ?? '',
    name: ing.metadata?.name ?? '',
    namespace: ing.metadata?.namespace ?? '',
    // O annotation é o jeito antigo, anterior ao ingressClassName, e ainda aparece
    className: spec.ingressClassName ?? ing.metadata?.annotations?.['kubernetes.io/ingress.class'] ?? '',
    hosts,
    addresses: (ing.status?.loadBalancer?.ingress ?? []).map((i) => i.ip || i.hostname || '').filter(Boolean),
    // O Ingress não declara portas: o kubectl mostra 80, e 443 quando há TLS
    ports: spec.tls?.length ? '80, 443' : '80',
    rules: ingressRules(ing),
    tls: (spec.tls ?? []).map((t) => ({ hosts: t.hosts ?? [], secretName: t.secretName ?? '' })),
    created: millis(ing.metadata?.creationTimestamp),
    labels: ing.metadata?.labels ?? {},
  }
}

export function watchIngresses(
  kc: KubeConfig,
  { namespace, labelSelector }: WatchOptions,
  emit: (b: Batch<IngressRow>) => void,
  onError: (message: string) => void,
): () => void {
  const api = kc.makeApiClient(NetworkingV1Api)
  return watchResource({
    kc,
    path: resourcePath('/apis/networking.k8s.io/v1', 'ingresses', namespace),
    list: () => (namespace ? api.listNamespacedIngress({ namespace, labelSelector }) : api.listIngressForAllNamespaces({ labelSelector })),
    labelSelector,
    toRow: toIngressRow,
    emit,
    onError,
  })
}
