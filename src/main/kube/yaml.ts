import type { KubeConfig } from '@kubernetes/client-node'
import { dump } from 'js-yaml'
import type { WatchKind } from '@shared/api'
import { errorMessage } from './errors'
import { apiGet } from './http'
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
}

/**
 * Objeto da API em YAML, no formato do `kubectl get -o yaml`: chaves em
 * ordem alfabética em todos os níveis (por isso apiVersion vem antes de
 * kind) e sem managedFields, que o kubectl também esconde por padrão. São
 * dezenas de linhas de registro interno do server-side apply.
 */
export function toYaml(obj: Record<string, unknown>, managedFields = false): string {
  const copy = structuredClone(obj)
  const meta = copy.metadata as Record<string, unknown> | undefined
  if (!managedFields && meta) delete meta.managedFields
  return dump(copy, {
    sortKeys: true,
    // Estilo do kubectl: aspas duplas e listas sem recuo extra sob a chave
    quoteStyle: 'double',
    seqNoIndent: true,
    // Não quebra strings longas (certificados, JSON em annotations)
    lineWidth: -1,
    noRefs: true,
  })
}

export async function resourceYaml(
  kc: KubeConfig,
  kind: WatchKind,
  namespace: string,
  name: string,
  managedFields: boolean,
): Promise<string> {
  const loc = LOCATION[kind]
  if (!loc) throw new Error(`Recurso desconhecido: ${kind}`)
  const base = resourcePath(loc.prefix, loc.resource, loc.namespaced ? namespace : '')
  try {
    const res = await apiGet(kc, `${base}/${encodeURIComponent(name)}`)
    return toYaml((await res.json()) as Record<string, unknown>, managedFields)
  } catch (err) {
    throw new Error(`Erro ao buscar o YAML de ${name}: ${errorMessage(err)}`)
  }
}
