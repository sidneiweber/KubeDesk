// Formatação e referência de uso de CPU/memória, no estilo do `kubectl top`.

export function formatCpu(millicores: number): string {
  return `${Math.round(millicores)}m`
}

export function formatMemory(bytes: number): string {
  const mi = bytes / 2 ** 20
  if (mi < 1024) return `${Math.round(mi)}Mi`
  return `${(mi / 1024).toFixed(1).replace(/\.0$/, '')}Gi`
}

export interface UsageView {
  text: string
  /** 0–100+ em relação à referência; null sem referência. */
  percent: number | null
  /** Contra o que a porcentagem é medida. */
  of: 'limit' | 'request' | null
  /** Só contra limit passar de 90% é problema; passar do request é normal. */
  level: 'ok' | 'warn' | 'high' | 'neutral'
  title: string
}

/**
 * Uso contra o limit, se houver; senão contra o request. Sem nenhum dos dois,
 * só o valor absoluto, como o `kubectl top`.
 */
export function usageView(used: number, request: number | null, limit: number | null, format: (n: number) => string): UsageView {
  const text = format(used)
  const ref = limit ?? request
  const of = limit !== null ? 'limit' : request !== null ? 'request' : null
  if (ref === null || ref <= 0 || of === null) {
    return { text, percent: null, of: null, level: 'neutral', title: `${text} (sem request nem limit declarados)` }
  }
  const percent = Math.round((used / ref) * 100)
  const level = of === 'request' ? 'neutral' : percent >= 90 ? 'high' : percent >= 70 ? 'warn' : 'ok'
  return { text, percent, of, level, title: `${text} de ${format(ref)} (${of}) — ${percent}%` }
}
