import { HttpMethod, RequestContext, type KubeConfig } from '@kubernetes/client-node'
import { fetch, type Response } from 'undici'

/**
 * GET autenticado direto na API, para quando a client-node atrapalha (stream
 * de logs, objeto cru para o YAML). A autenticação é a mesma dela:
 * certificado, token, plugin exec, via applySecurityAuthentication.
 *
 * Erro HTTP vira exceção com o corpo, para errorMessage() extrair o motivo
 * que o apiserver deu.
 */
export async function apiGet(
  kc: KubeConfig,
  path: string,
  query: Record<string, string> = {},
  signal?: AbortSignal,
): Promise<Response> {
  const cluster = kc.getCurrentCluster()
  if (!cluster) throw new Error('Nenhum cluster ativo')

  const url = new URL(cluster.server.replace(/\/$/, '') + path)
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v)

  const ctx = new RequestContext(url.toString(), HttpMethod.GET)
  await kc.applySecurityAuthentication(ctx)

  const res = await fetch(url, { headers: ctx.getHeaders(), dispatcher: ctx.getDispatcher(), signal })
  if (!res.ok) {
    throw { code: res.status, body: await res.text(), message: `HTTP ${res.status}` }
  }
  return res
}
