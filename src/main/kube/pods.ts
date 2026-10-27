import { CoreV1Api, makeInformer, type KubeConfig, type V1Pod } from '@kubernetes/client-node'
import type { PodBatch, PodRow } from '@shared/api'
import { errorMessage } from './errors'
import { computePodStatus, podStatusClass } from './podStatus'

const FLUSH_MS = 250
const RETRY_MS = 5_000

export function toPodRow(p: V1Pod): PodRow {
  const s = computePodStatus(p)
  return {
    uid: p.metadata?.uid ?? '',
    name: p.metadata?.name ?? '',
    namespace: p.metadata?.namespace ?? '',
    status: s.status,
    statusClass: podStatusClass(s.status),
    ready: s.ready,
    restarts: s.restarts,
    node: p.spec?.nodeName ?? '',
    ip: p.status?.podIP ?? '',
    created: p.metadata?.creationTimestamp ? new Date(p.metadata.creationTimestamp).getTime() : 0,
    containers: (p.spec?.containers ?? []).map((c) => c.name),
  }
}

/**
 * Observa os pods de um namespace ("" = todos) e entrega lotes de mudanças.
 *
 * O app antigo refazia a lista inteira por polling. Aqui o cluster empurra as
 * mudanças pelo watch, e um pod que muda dez vezes em 250 ms vira uma única
 * linha atualizada. O primeiro lote (reset) é a lista completa.
 *
 * O informer da client-node para de vez quando o watch cai; é reiniciado
 * aqui, com um novo reset para não perder remoções que aconteceram no meio.
 */
export function watchPods(
  kc: KubeConfig,
  namespace: string,
  emit: (b: PodBatch) => void,
  onError: (message: string) => void,
): () => void {
  const api = kc.makeApiClient(CoreV1Api)
  const path = namespace ? `/api/v1/namespaces/${encodeURIComponent(namespace)}/pods` : '/api/v1/pods'
  const list = () => (namespace ? api.listNamespacedPod({ namespace }) : api.listPodForAllNamespaces())
  const informer = makeInformer<V1Pod>(kc, path, list)

  let stopped = false
  let synced = false
  let flushTimer: ReturnType<typeof setTimeout> | undefined
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let upserts = new Map<string, V1Pod>()
  let deletes = new Set<string>()

  const flush = () => {
    flushTimer = undefined
    if (stopped || (upserts.size === 0 && deletes.size === 0)) return
    const batch: PodBatch = { reset: false, upsert: [...upserts.values()].map(toPodRow), deleted: [...deletes] }
    upserts = new Map()
    deletes = new Set()
    emit(batch)
  }
  const schedule = () => {
    flushTimer ??= setTimeout(flush, FLUSH_MS)
  }

  const onUpsert = (p: V1Pod) => {
    // Durante a listagem inicial os eventos já estão contidos no reset
    if (!synced || !p.metadata?.uid) return
    deletes.delete(p.metadata.uid)
    upserts.set(p.metadata.uid, p)
    schedule()
  }
  informer.on('add', onUpsert)
  informer.on('update', onUpsert)
  informer.on('delete', (p) => {
    if (!synced || !p.metadata?.uid) return
    upserts.delete(p.metadata.uid)
    deletes.add(p.metadata.uid)
    schedule()
  })
  // Quando a listagem falha, o informer emite "error" e mesmo assim o start()
  // resolve. Sem este controle, a falha viraria uma tabela vazia, como se o
  // namespace não tivesse pods.
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
        emit({ reset: true, upsert: informer.list().map(toPodRow), deleted: [] })
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
