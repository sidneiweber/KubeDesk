import { HttpMethod, RequestContext, type KubeConfig } from '@kubernetes/client-node'
import { fetch } from 'undici'
import type { LogOptions } from '@shared/api'
import { errorMessage } from './errors'
import { LineBatcher } from './lineBatcher'

/**
 * Abre o log de um container e entrega as linhas em lotes.
 *
 * Não usa o `Log` da client-node 2.x: o callback de fim dele nunca é chamado,
 * e em erro HTTP ele descarta o corpo, onde está o motivo que o usuário
 * precisa ver ("container is waiting to start: ContainerCreating"). A
 * autenticação é a mesma, via applySecurityAuthentication.
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
    const cluster = kc.getCurrentCluster()
    if (!cluster) throw new Error('Nenhum cluster ativo')

    const url = new URL(
      `${cluster.server}/api/v1/namespaces/${encodeURIComponent(o.namespace)}/pods/${encodeURIComponent(o.pod)}/log`,
    )
    url.searchParams.set('container', o.container)
    url.searchParams.set('follow', String(o.follow))
    url.searchParams.set('timestamps', String(o.timestamps))
    if (o.tailLines > 0) url.searchParams.set('tailLines', String(o.tailLines))

    const ctx = new RequestContext(url.toString(), HttpMethod.GET)
    await kc.applySecurityAuthentication(ctx)

    const res = await fetch(url, {
      headers: ctx.getHeaders(),
      dispatcher: ctx.getDispatcher(),
      signal: controller.signal,
    })
    if (!res.ok) {
      const text = await res.text()
      throw { code: res.status, body: text, message: `HTTP ${res.status}` }
    }
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
