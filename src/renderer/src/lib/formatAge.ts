/**
 * Idade de um recurso no formato do kubectl: duas unidades enquanto a maior
 * é pequena ("5h 30m"), segundos abaixo de um minuto.
 */
export function formatAge(createdMs: number, now: number): string {
  if (!createdMs) return '-'
  const diff = now - createdMs
  if (diff < 0) return '-'

  const s = Math.floor(diff / 1000)
  const m = Math.floor(s / 60)
  const h = Math.floor(m / 60)
  const d = Math.floor(h / 24)

  if (d > 0) return `${d}d ${h % 24}h`
  if (h > 0) return `${h}h ${m % 60}m`
  if (m > 0) return `${m}m`
  return `${s}s`
}

/** Data e hora locais, ex.: "27/10/2026, 20:22:45". */
export function formatDateTime(ms: number): string {
  return ms ? new Date(ms).toLocaleString('pt-BR') : '-'
}
