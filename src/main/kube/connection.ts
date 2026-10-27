import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { CoreV1Api, KubeConfig, VersionApi } from '@kubernetes/client-node'
import type { KubeContext } from '@shared/api'
import { errorMessage, isForbidden } from './errors'

const CONNECT_TIMEOUT_MS = 10_000

/**
 * Carrega o kubeconfig. Sem `path`, segue o kubectl: $KUBECONFIG (vários
 * arquivos separados por ":" ou ";") ou ~/.kube/config.
 *
 * Retorna null se não houver arquivo nenhum. O loadFromDefault da client-node
 * cairia num cluster fictício em localhost:8080, que só confundiria.
 */
export function loadKubeconfig(path: string | null): KubeConfig | null {
  const kc = new KubeConfig()
  if (path) {
    kc.loadFromFile(path)
    return kc
  }
  if (!process.env.KUBECONFIG && !existsSync(join(homedir(), '.kube', 'config'))) return null
  kc.loadFromDefault()
  return kc
}

export function listContexts(kc: KubeConfig | null): KubeContext[] {
  if (!kc) return []
  const current = kc.getCurrentContext()
  return kc
    .getContexts()
    .map((c) => ({ name: c.name, cluster: c.cluster, namespace: c.namespace || 'default', current: c.name === current }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Seleciona o contexto, confirma que o cluster responde e lista os
 * namespaces. Sem permissão para listar namespaces, devolve lista vazia.
 */
export async function connect(path: string | null, context: string): Promise<{ kc: KubeConfig; namespaces: string[] }> {
  const kc = loadKubeconfig(path)
  if (!kc) throw new Error('Nenhum kubeconfig encontrado')
  kc.setCurrentContext(context)

  // /version não exige permissão nenhuma. O timeout evita a tela presa em
  // "Conectando…" quando o cluster está desligado e a conexão não é recusada.
  try {
    await withTimeout(kc.makeApiClient(VersionApi).getCode(), CONNECT_TIMEOUT_MS)
  } catch (err) {
    throw new Error(`Não foi possível conectar a "${context}": ${errorMessage(err)}`)
  }

  try {
    const list = await kc.makeApiClient(CoreV1Api).listNamespace()
    const namespaces = list.items.map((n) => n.metadata?.name ?? '').filter(Boolean).sort()
    return { kc, namespaces }
  } catch (err) {
    if (isForbidden(err)) return { kc, namespaces: [] }
    throw new Error(`Erro ao listar namespaces: ${errorMessage(err)}`)
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`sem resposta em ${ms / 1000}s`)), ms)
  })
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer))
}
