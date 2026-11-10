import type { WatchKind } from '@shared/api'
import { resourcePath } from './watch'

// Onde cada recurso mora na API. Namespaces são do cluster, não de um namespace.
const LOCATION: Record<WatchKind, { prefix: string; resource: string; namespaced: boolean }> = {
  pods: { prefix: '/api/v1', resource: 'pods', namespaced: true },
  deployments: { prefix: '/apis/apps/v1', resource: 'deployments', namespaced: true },
  namespaces: { prefix: '/api/v1', resource: 'namespaces', namespaced: false },
  services: { prefix: '/api/v1', resource: 'services', namespaced: true },
  ingresses: { prefix: '/apis/networking.k8s.io/v1', resource: 'ingresses', namespaced: true },
  endpointslices: { prefix: '/apis/discovery.k8s.io/v1', resource: 'endpointslices', namespaced: true },
  poddetails: { prefix: '/api/v1', resource: 'pods', namespaced: true },
  events: { prefix: '/api/v1', resource: 'events', namespaced: true },
  replicasets: { prefix: '/apis/apps/v1', resource: 'replicasets', namespaced: true },
  daemonsets: { prefix: '/apis/apps/v1', resource: 'daemonsets', namespaced: true },
  statefulsets: { prefix: '/apis/apps/v1', resource: 'statefulsets', namespaced: true },
  controllerrevisions: { prefix: '/apis/apps/v1', resource: 'controllerrevisions', namespaced: true },
  jobs: { prefix: '/apis/batch/v1', resource: 'jobs', namespaced: true },
  cronjobs: { prefix: '/apis/batch/v1', resource: 'cronjobs', namespaced: true },
}

/** Caminho da coleção, ex.: /apis/apps/v1/namespaces/prod/statefulsets */
export function collectionPath(kind: WatchKind, namespace: string): string {
  const loc = LOCATION[kind]
  if (!loc) throw new Error(`Recurso desconhecido: ${kind}`)
  return resourcePath(loc.prefix, loc.resource, loc.namespaced ? namespace : '')
}

/** Caminho de um objeto, ex.: /apis/apps/v1/namespaces/prod/statefulsets/db */
export function objectPath(kind: WatchKind, namespace: string, name: string): string {
  return `${collectionPath(kind, namespace)}/${encodeURIComponent(name)}`
}
