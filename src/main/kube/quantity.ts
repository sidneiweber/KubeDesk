// Quantidades do Kubernetes (resource.Quantity) em números.
//
// CPU: "250m", "1", "0.5", "100u", "1500000n" -> milicores.
// Memória: "128Mi", "1Gi", "500M", "1e3", "123456" -> bytes.
// Valor que não dá para ler vira null, nunca 0: zero é uma medição, e um
// número inventado é pior que nenhum.

const DECIMAL_SUFFIX: Record<string, number> = { n: 1e-9, u: 1e-6, m: 1e-3, '': 1, k: 1e3, M: 1e6, G: 1e9, T: 1e12, P: 1e15, E: 1e18 }
const BINARY_SUFFIX: Record<string, number> = { Ki: 2 ** 10, Mi: 2 ** 20, Gi: 2 ** 30, Ti: 2 ** 40, Pi: 2 ** 50, Ei: 2 ** 60 }

const QUANTITY = /^([+-]?\d*\.?\d+(?:[eE][+-]?\d+)?)([a-zA-Z]*)$/

/** Quantidade na unidade base (cores para CPU, bytes para memória). */
export function parseQuantity(q: string | number | undefined | null): number | null {
  if (q === undefined || q === null) return null
  if (typeof q === 'number') return q
  const m = QUANTITY.exec(q.trim())
  if (!m) return null
  const [, num, suffix] = m
  const mult = BINARY_SUFFIX[suffix] ?? DECIMAL_SUFFIX[suffix]
  return mult === undefined ? null : Number(num) * mult
}

export function cpuMillicores(q: string | number | undefined | null): number | null {
  const cores = parseQuantity(q)
  return cores === null ? null : cores * 1000
}

export function memoryBytes(q: string | number | undefined | null): number | null {
  return parseQuantity(q)
}

/**
 * Soma de requests/limits dos containers de um pod.
 *
 * Limit: se algum container não tem limit, o pod não tem teto, então o total
 * é null. Somar só os que existem daria uma porcentagem que parece real e
 * não é.
 * Request: container sem request conta como 0 (é o que o scheduler faz);
 * null só se nenhum container pede nada.
 */
export function sumResources(values: (number | null)[], kind: 'request' | 'limit'): number | null {
  if (values.length === 0) return null
  if (kind === 'limit') return values.some((v) => v === null) ? null : values.reduce<number>((a, v) => a + (v as number), 0)
  return values.every((v) => v === null) ? null : values.reduce<number>((a, v) => a + (v ?? 0), 0)
}
