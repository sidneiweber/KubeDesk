import { HttpMethod, RequestContext, type KubeConfig } from '@kubernetes/client-node'
import { fetch, type Response } from 'undici'

/**
 * Requisição autenticada direto na API, para quando a client-node atrapalha (stream
 * de logs, objeto cru para o YAML). A autenticação é a mesma dela:
 * certificado, token, plugin exec, via applySecurityAuthentication.
 *
 * Erro HTTP vira exceção com o corpo, para errorMessage() extrair o motivo
 * que o apiserver deu.
 */
export function apiGet(
  kc: KubeConfig,
  path: string,
  query: Record<string, string> = {},
  signal?: AbortSignal,
): Promise<Response> {
  return apiRequest(kc, HttpMethod.GET, path, { query, signal })
}

/** PUT de um objeto JSON (substitui o recurso inteiro). */
export function apiPut(kc: KubeConfig, path: string, body: unknown): Promise<Response> {
  return apiRequest(kc, HttpMethod.PUT, path, { body })
}

/** PATCH; contentType escolhe o tipo (merge, strategic merge, JSON patch). */
export function apiPatch(kc: KubeConfig, path: string, body: unknown, contentType: string): Promise<Response> {
  return apiRequest(kc, HttpMethod.PATCH, path, { body, contentType })
}

/** POST de um objeto JSON (cria o recurso). */
export function apiPost(kc: KubeConfig, path: string, body: unknown): Promise<Response> {
  return apiRequest(kc, HttpMethod.POST, path, { body })
}

async function apiRequest(
  kc: KubeConfig,
  method: HttpMethod,
  path: string,
  {
    query = {},
    body,
    contentType = 'application/json',
    signal,
  }: { query?: Record<string, string>; body?: unknown; contentType?: string; signal?: AbortSignal },
): Promise<Response> {
  const cluster = kc.getCurrentCluster()
  if (!cluster) throw new Error('Nenhum cluster ativo')

  const url = new URL(cluster.server.replace(/\/$/, '') + path)
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v)

  const ctx = new RequestContext(url.toString(), method)
  await kc.applySecurityAuthentication(ctx)
  const headers = ctx.getHeaders()
  if (body !== undefined) headers['Content-Type'] = contentType

  const res = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    dispatcher: ctx.getDispatcher(),
    signal,
  })
  if (!res.ok) {
    throw { code: res.status, body: await res.text(), message: `HTTP ${res.status}` }
  }
  return res
}
