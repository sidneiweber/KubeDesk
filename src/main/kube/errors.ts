// Mensagem legível a partir dos erros da client-node.
//
// ApiException traz no `message` o código, o corpo e todos os headers
// concatenados. O que interessa ao usuário é o `message` do V1Status que o
// apiserver devolve ("pods "x" is forbidden: ...").

interface MaybeApiError {
  code?: number
  body?: unknown
  message?: string
  cause?: { code?: string; message?: string }
}

export function errorMessage(err: unknown): string {
  const e = err as MaybeApiError

  const body = typeof e?.body === 'string' ? safeJson(e.body) : e?.body
  const statusMessage = (body as { message?: string } | undefined)?.message
  if (statusMessage) return statusMessage

  // fetch do undici: "fetch failed" com o motivo em `cause`
  if (e?.cause?.code === 'ECONNREFUSED') return `Conexão recusada (${e.cause.message ?? 'cluster fora do ar?'})`
  if (e?.cause?.message) return e.cause.message

  if (typeof e?.code === 'number') {
    const m = /Message: (.*)/.exec(e.message ?? '')
    return `HTTP ${e.code}${m ? `: ${m[1]}` : ''}`
  }
  return e?.message ?? String(err)
}

export function isForbidden(err: unknown): boolean {
  return (err as MaybeApiError)?.code === 403
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return undefined
  }
}
