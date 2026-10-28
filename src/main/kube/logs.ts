import type { KubeConfig } from '@kubernetes/client-node'
import type { LogOptions } from '@shared/api'
import { errorMessage } from './errors'
import { apiGet } from './http'
import { LineBatcher } from './lineBatcher'

/**
 * Abre o log de um container e entrega as linhas em lotes.
 *
 * Não usa o `Log` da client-node 2.x: o callback de fim dele nunca é chamado,
 * e em erro HTTP ele descarta o corpo, onde está o motivo que o usuário
 * precisa ver ("container is waiting to start: ContainerCreating"). Por
 * isso usa apiGet, com a mesma autenticação.
 *
 * onEnd é chamado uma única vez: null quando o stream acabou sozinho (pod
 * encerrado, follow desligado), ou a mensagem de erro. Não é chamado depois
 * de stop().
 */
export function streamLogs(
  kc: KubeConfig,
  o: LogOptions,
  onLines: (lines: string[]) => void,
  onEnd: (error: string | null) => void,
): () => void {
  const controller = new AbortController()
  const batcher = new LineBatcher(onLines)
  let done = false

  const finish = (error: string | null) => {
    if (done) return
    done = true
    if (error === null) batcher.end()
    else batcher.dispose()
    onEnd(error)
  }

  void (async () => {
    const query: Record<string, string> = {
      container: o.container,
      follow: String(o.follow),
      timestamps: String(o.timestamps),
    }
    if (o.tailLines > 0) query.tailLines = String(o.tailLines)

    const path = `/api/v1/namespaces/${encodeURIComponent(o.namespace)}/pods/${encodeURIComponent(o.pod)}/log`
    const res = await apiGet(kc, path, query, controller.signal)
    if (!res.body) throw new Error('Resposta sem corpo')

    for await (const chunk of res.body) {
      batcher.write(chunk as Uint8Array)
    }
    finish(null)
  })().catch((err) => {
    if (controller.signal.aborted) return
    finish(errorMessage(err))
  })

  return () => {
    done = true
    batcher.dispose()
    controller.abort()
  }
}
