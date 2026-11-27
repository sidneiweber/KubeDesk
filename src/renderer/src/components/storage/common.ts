import { formatAge, formatDateTime } from '../../lib/formatAge'
import { now } from '../../lib/now.svelte'

/** "26/11/2026, 21:47 (3d)". Lê o relógio: chamar no template para andar sozinho. */
export function createdText(ms: number): string {
  return ms ? `${formatDateTime(ms)} (${formatAge(ms, now.value)})` : '-'
}

export const yesNo = (b: boolean): string => (b ? 'Sim' : 'Não')
