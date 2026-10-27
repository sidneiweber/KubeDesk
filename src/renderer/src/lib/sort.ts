// Ordenação das tabelas, porte do motor do renderer.js antigo.

export type SortValue = string | number | null | undefined
export type Accessors<T> = Record<string, (item: T) => SortValue>
export interface SortState {
  column: string
  direction: 'asc' | 'desc'
}

/** Cópia ordenada; a lista original não muda. Sem estado (ou coluna sem accessor), mantém a ordem. */
export function sortRows<T>(items: readonly T[], accessors: Accessors<T>, state: SortState | null): T[] {
  const accessor = state && accessors[state.column]
  if (!accessor) return [...items]

  const factor = state.direction === 'desc' ? -1 : 1
  return [...items].sort((a, b) => {
    const left = accessor(a)
    const right = accessor(b)
    if (left === right) return 0
    // Valores ausentes vão sempre para o fim, seja qual for a direção
    if (left == null || left === '') return 1
    if (right == null || right === '') return -1

    const result =
      typeof left === 'number' && typeof right === 'number'
        ? left - right
        : String(left).localeCompare(String(right), 'pt-BR', { numeric: true, sensitivity: 'base' })
    return result * factor
  })
}

/** Clique no cabeçalho: asc -> desc -> sem ordenação. */
export function nextSort(state: SortState | null, column: string): SortState | null {
  if (!state || state.column !== column) return { column, direction: 'asc' }
  if (state.direction === 'asc') return { column, direction: 'desc' }
  return null
}

/** "1/2" -> 0.5, para ordenar Ready pela fração e não pelo texto. */
export function readyFraction(ready: string): number {
  const [n, d] = ready.split('/').map(Number)
  return d ? n / d : 0
}
