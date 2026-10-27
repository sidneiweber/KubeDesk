/** Data da API (Date ou string ISO) em epoch ms; 0 quando ausente. */
export function millis(d: Date | string | undefined | null): number {
  return d ? new Date(d).getTime() : 0
}
