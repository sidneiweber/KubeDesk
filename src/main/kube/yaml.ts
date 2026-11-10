import type { KubeConfig } from '@kubernetes/client-node'
import { dump, load } from 'js-yaml'
import type { WatchKind } from '@shared/api'
import { errorMessage } from './errors'
import { apiGet, apiPut } from './http'
import { objectPath } from './resources'

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
  const path = objectPath(kind, namespace, name)
  try {
    const res = await apiGet(kc, path)
    return toYaml((await res.json()) as Record<string, unknown>, managedFields)
  } catch (err) {
    throw new Error(`Erro ao buscar o YAML de ${name}: ${errorMessage(err)}`)
  }
}

/**
 * Lê o YAML editado e confere que ainda é o mesmo objeto. Renomear ou trocar
 * de namespace no editor não é suportado pela API (seria outro recurso), então
 * vira erro claro em vez de um 400 confuso.
 */
export function parseEdited(text: string, namespace: string, name: string): Record<string, unknown> {
  let obj: unknown
  try {
    obj = load(text)
  } catch (err) {
    throw new Error(`YAML inválido: ${(err as Error).message.split('\n')[0]}`)
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('O YAML precisa ser um objeto')
  const meta = (obj as { metadata?: { name?: unknown; namespace?: unknown } }).metadata
  if (!meta || meta.name !== name) throw new Error(`metadata.name precisa continuar "${name}"`)
  if (namespace && (meta.namespace ?? namespace) !== namespace) throw new Error(`metadata.namespace precisa continuar "${namespace}"`)
  return obj as Record<string, unknown>
}

export async function applyYaml(kc: KubeConfig, kind: WatchKind, namespace: string, name: string, text: string): Promise<void> {
  const obj = parseEdited(text, namespace, name)
  const path = objectPath(kind, namespace, name)
  try {
    await apiPut(kc, path, obj)
  } catch (err) {
    if ((err as { code?: number }).code === 409) {
      throw new Error('O recurso mudou no cluster depois que o YAML foi lido. Recarregue e refaça a edição.')
    }
    throw new Error(`Erro ao aplicar ${name}: ${errorMessage(err)}`)
  }
}
