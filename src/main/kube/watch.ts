import { ListWatch, Watch, type KubeConfig, type KubernetesListObject, type KubernetesObject } from '@kubernetes/client-node'
import type { Batch } from '@shared/api'
import { errorMessage } from './errors'

const FLUSH_MS = 250
const RETRY_MS = 5_000

export interface WatchSpec<T extends KubernetesObject, R> {
  kc: KubeConfig
  /** Caminho da API para o watch, ex.: /api/v1/namespaces/x/pods */
  path: string
  /** Listagem com os mesmos filtros (namespace, seletores) do watch. */
  list: () => Promise<KubernetesListObject<T>>
  labelSelector?: string
  fieldSelector?: string
  toRow: (obj: T) => R
  emit: (b: Batch<R>) => void
  onError: (message: string) => void
}

/** Caminho da API de um recurso, com ou sem namespace. */
export function resourcePath(prefix: string, resource: string, namespace: string): string {
  return namespace ? `${prefix}/namespaces/${encodeURIComponent(namespace)}/${resource}` : `${prefix}/${resource}`
}

/**
 * Observa uma lista e entrega lotes de mudanças. O primeiro lote (reset) é a
 * lista completa; depois, o cluster empurra as mudanças pelo watch e o que
 * muda várias vezes em FLUSH_MS vira uma única linha atualizada.
 *
 * O informer da client-node para de vez quando o watch cai; é reiniciado
 * aqui, com um novo reset para não perder remoções que aconteceram no meio.
 */
export function watchResource<T extends KubernetesObject, R>(spec: WatchSpec<T, R>): () => void {
  const { toRow, emit, onError } = spec
  // ListWatch direto em vez de makeInformer: só ele aceita fieldSelector
  const informer = new ListWatch<T>(spec.path, new Watch(spec.kc), spec.list, false, spec.labelSelector, spec.fieldSelector)

  let stopped = false
  let synced = false
  let flushTimer: ReturnType<typeof setTimeout> | undefined
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let upserts = new Map<string, T>()
  let deletes = new Set<string>()

  const flush = () => {
    flushTimer = undefined
    if (stopped || (upserts.size === 0 && deletes.size === 0)) return
    const batch: Batch<R> = { reset: false, upsert: [...upserts.values()].map(toRow), deleted: [...deletes] }
    upserts = new Map()
    deletes = new Set()
    emit(batch)
  }
  const schedule = () => {
    flushTimer ??= setTimeout(flush, FLUSH_MS)
  }

  const onUpsert = (obj: T) => {
    // Durante a listagem inicial os eventos já estão contidos no reset
    const uid = obj.metadata?.uid
    if (!synced || !uid) return
    deletes.delete(uid)
    upserts.set(uid, obj)
    schedule()
  }
  informer.on('add', onUpsert)
  informer.on('update', onUpsert)
  informer.on('delete', (obj) => {
    const uid = obj.metadata?.uid
    if (!synced || !uid) return
    upserts.delete(uid)
    deletes.add(uid)
    schedule()
  })

  // Quando a listagem falha, o informer emite "error" e mesmo assim o start()
  // resolve. Sem este controle, a falha viraria uma tabela vazia, como se não
  // houvesse nada no namespace.
  let failed = false

  const retry = (err: unknown) => {
    if (stopped) return
    failed = true
    synced = false
    onError(`${errorMessage(err)} — tentando de novo em ${RETRY_MS / 1000}s`)
    clearTimeout(retryTimer)
    retryTimer = setTimeout(start, RETRY_MS)
  }
  informer.on('error', retry)

  function start() {
    failed = false
    informer
      .start()
      .then(() => {
        if (stopped || failed) return
        synced = true
        upserts = new Map()
        deletes = new Set()
        emit({ reset: true, upsert: informer.list().map(toRow), deleted: [] })
      })
      // Falhas antes do watch abrir (ex.: plugin de autenticação) rejeitam sem emitir "error"
      .catch(retry)
  }
  start()

  return () => {
    stopped = true
    clearTimeout(flushTimer)
    clearTimeout(retryTimer)
    void informer.stop()
  }
}
